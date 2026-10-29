import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { TIPOS, verTamano } from "@/lib/documentos";
import { puede } from "@/lib/permisos";
import { puedeVer } from "@/lib/pestanas";
import { CATEGORIAS, ESTADOS, listarRecepciones } from "@/lib/recepciones";
import { cambiarEstadoRecepcion, subirDocumentos } from "../recepcion-acciones";

export const metadata = { title: "Documentos · Empire Tax’N Legal" };

const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });
const FILTROS: Record<string, string> = { pendientes: "Por procesar", procesado: "Procesados", descartado: "Descartados", todos: "Todos" };

// Bandeja de documentos del cliente: el cliente sube fotos de gastos, facturas recibidas, estados bancarios o contratos,
// y el equipo los procesa (por ejemplo, registrando la compra con ese documento como soporte).
export default async function Recepcion({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ estado?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa, usuario, permisos, pestanas } = await accesoEmpresa(id);
  const cliente = await soloCliente(empresa.firma_id, usuario.id);
  const filtro = FILTROS[sp.estado ?? ""] ? sp.estado! : cliente ? "todos" : "pendientes";
  const lista = await conEmpresa(id, (tx) => listarRecepciones(tx, filtro === "todos" ? null : filtro));
  const sube = puede(permisos, "adjuntar");
  const procesa = puede(permisos, "registrar") && !cliente;
  const haceCompras = procesa && puedeVer(pestanas, "/compras");

  return (
    <>
      <h1>{cliente ? "Mis documentos" : "Documentos recibidos"}</h1>
      <p className="sub">
        {cliente
          ? "Sube aquí las fotos o PDF de tus gastos, facturas de proveedores, estados bancarios y contratos. Tu firma los recibe y te avisa cuando estén procesados."
          : `Lo que sube ${empresa.nombre} para que el equipo lo procese. Un gasto o una factura recibida se convierte en compra con el documento como soporte.`}
      </p>

      {sube && (
        <div className="tarjeta" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>Subir documentos</h2>
          <Formulario accion={subirDocumentos.bind(null, id)} boton="Subir" className="fila">
            <label style={{ flex: "2 1 280px" }}>Archivos (PDF, JPG o PNG, hasta 4 MB cada uno; desde el celular puedes tomar la foto)
              <input type="file" name="archivos" accept="application/pdf,image/jpeg,image/png" multiple required />
            </label>
            <label style={{ flex: "1 1 200px" }}>Qué es
              <select name="categoria" defaultValue="gasto">
                {Object.entries(CATEGORIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label style={{ flex: "2 1 280px" }}>Nota (opcional)<input name="nota" maxLength={500} placeholder="Ej.: pagado con la tarjeta de la empresa" /></label>
          </Formulario>
        </div>
      )}

      <nav className="fila" style={{ marginBottom: 12 }} aria-label="Filtro">
        {Object.entries(FILTROS).map(([k, v]) => (
          <Link key={k} className={`boton${k === filtro ? " primario" : ""}`} href={`/e/${id}/recepcion?estado=${k}`}>{v}</Link>
        ))}
      </nav>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Documento</th><th>Qué es</th><th>Subido</th><th>Estado</th>{procesa && <th />}</tr></thead>
          <tbody>
            {lista.map((r) => (
              <tr key={r.id} className={r.estado === "descartado" ? "anulado" : undefined}>
                <td>
                  <a href={`/e/${id}/recepcion/${r.id}`} target="_blank" rel="noopener">{r.nombre}</a>
                  <div className="sub" style={{ margin: 0 }}>{TIPOS[r.tipo]} · {verTamano(r.tamano)}</div>
                  {r.nota && <div style={{ fontSize: "0.9rem" }}>«{r.nota}»</div>}
                </td>
                <td>{CATEGORIAS[r.categoria]}</td>
                <td>{r.quien}<div className="sub" style={{ margin: 0 }}>{fechaHora(r.subido_en)}</div></td>
                <td>
                  <strong>{ESTADOS[r.estado]}</strong>
                  {r.compra_id && <div><Link href={`/e/${id}/compras/${r.compra_id}`}>Compra {r.compra_ncf ?? "en borrador"}</Link></div>}
                  {r.respuesta && <div style={{ fontSize: "0.9rem" }}>{r.respuesta}</div>}
                  {r.procesador && r.procesado_en && <div className="sub" style={{ margin: 0 }}>{r.procesador} · {fechaHora(r.procesado_en)}</div>}
                </td>
                {procesa && (
                  <td style={{ minWidth: 260 }}>
                    {(r.estado === "nuevo" || r.estado === "en_proceso") && (
                      <div className="fila" style={{ gap: 6, flexDirection: "column", alignItems: "stretch" }}>
                        {haceCompras && ["gasto", "factura_recibida"].includes(r.categoria) && (
                          <Link className="boton primario" href={`/e/${id}/compras/nueva?recepcion=${r.id}`}>Registrar compra con este documento</Link>
                        )}
                        {r.estado === "nuevo" && (
                          <Formulario accion={cambiarEstadoRecepcion.bind(null, id, r.id, "en_proceso")} boton="Marcar en proceso" className="fila"><span /></Formulario>
                        )}
                        <Formulario accion={cambiarEstadoRecepcion.bind(null, id, r.id, "procesado")} boton="Marcar procesado" className="fila">
                          <input name="respuesta" placeholder="Respuesta para el cliente (opcional)" aria-label="Respuesta para el cliente" />
                        </Formulario>
                        <Formulario accion={cambiarEstadoRecepcion.bind(null, id, r.id, "descartado")} boton="Descartar" className="fila">
                          <input name="respuesta" placeholder="Motivo (lo verá el cliente)" aria-label="Motivo del descarte" />
                        </Formulario>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={procesa ? 5 : 4}>{filtro === "pendientes" ? "No hay documentos por procesar." : "No hay documentos."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
