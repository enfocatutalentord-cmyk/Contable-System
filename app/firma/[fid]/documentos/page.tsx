import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoFirma } from "@/lib/acceso";
import { TIPOS_GASTO } from "@/lib/compras";
import { conEmpresa } from "@/lib/db";
import { clientesDeFirma } from "@/lib/firma";
import { CATEGORIAS, ESTADOS, listarRecepciones } from "@/lib/recepciones";
import { descartarDocumento, procesarDocumento } from "../../documentos-acciones";

export const metadata = { title: "Documentos recibidos · Empire Tax’N Legal" };

const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });
const ES_FACTURA = ["application/pdf", "image/jpeg", "image/png"];

// Bandeja de la firma: lo que han subido todos los clientes y falta procesar, el más antiguo primero. Rediseño R4 (n.º 12): cada
// documento se procesa aquí mismo: se abre, se completa y se aprueba para el 606 o el 607 (o se descarta con el motivo).
export default async function DocumentosFirma({ params, searchParams }: {
  params: Promise<{ fid: string }>; searchParams: Promise<{ hecho?: string; borrador?: string; cliente?: string }>;
}) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  const todos = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => !c.propia);
  const clientes = sp.cliente ? todos.filter((c) => c.id === sp.cliente) : todos;
  const porCliente = await Promise.all(clientes.map((c) => conEmpresa(c.id, (tx) => listarRecepciones(tx, "pendientes"))));
  const filas = clientes.flatMap((c, i) => porCliente[i].map((r) => ({ ...r, cliente: c }))).sort((a, b) => a.subido_en.getTime() - b.subido_en.getTime());
  const borrador = sp.borrador && /^\/e\/[0-9a-f-]{36}\/(compras|facturas)\/[0-9a-f-]{36}$/.test(sp.borrador) ? sp.borrador : null;
  return (
    <>
      <h1>Documentos recibidos</h1>
      <p className="sub">
        Lo que tus clientes han subido y todavía falta procesar, el más antiguo primero. Ábrelo, completa la factura y apruébala: queda
        lista para el 606 (gasto) o el 607 (venta), con el archivo adjunto. Si no sirve, descártalo con el motivo; el cliente lo ve.
      </p>
      {(sp.hecho === "gasto" || sp.hecho === "ingreso") && (
        <p className="exito" role="status">
          Listo: quedó el borrador de la {sp.hecho === "gasto" ? "compra (606)" : "venta (607)"}.{" "}
          {borrador && <Link href={borrador}>Revisarlo y {sp.hecho === "gasto" ? "registrarlo" : "emitirlo"}</Link>}
        </p>
      )}
      {sp.hecho === "descartado" && <p className="exito" role="status">Documento descartado. El cliente ve el motivo.</p>}
      <form className="fila" style={{ marginBottom: 12 }} aria-label="Elegir cliente">
        <label style={{ flex: "2 1 240px" }}>Cliente
          <select name="cliente" defaultValue={sp.cliente ?? ""}>
            <option value="">Todos los clientes</option>
            {todos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <button>Ver</button>
      </form>

      {filas.length === 0 && <p className="sub">No hay documentos por procesar.</p>}
      {filas.map((r) => {
        const archivo = `/e/${r.cliente.id}/recepcion/${r.id}`;
        const factura = ES_FACTURA.includes(r.tipo) && r.categoria !== "estado_bancario" && r.categoria !== "contrato";
        return (
          <section key={r.id} className="tarjeta" style={{ marginBottom: 12 }}>
            <div className="entre">
              <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{r.cliente.nombre} · {CATEGORIAS[r.categoria]}</h2>
              <span className="sub">{ESTADOS[r.estado]}</span>
            </div>
            <p className="sub" style={{ margin: "4px 0 8px" }}>
              <a href={archivo} target="_blank" rel="noopener">{r.nombre}</a> · subido por {r.quien ?? "—"} el {fechaHora(r.subido_en)}
              {r.cliente.responsable && <> · responsable {r.cliente.responsable}</>}
              {r.nota && <><br />«{r.nota}»</>}
            </p>
            {factura ? (
              <details>
                <summary>Completar y aprobar para el 606 o el 607</summary>
                <Formulario accion={procesarDocumento.bind(null, fid, r.cliente.id, r.id)} boton="Aprobar">
                  <div className="fila">
                    <label>Es
                      <select name="tipo" defaultValue="gasto">
                        <option value="gasto">Un gasto o compra (606)</option>
                        <option value="ingreso">Una venta del cliente (607)</option>
                      </select>
                    </label>
                    <label style={{ flex: "1 1 150px" }}>RNC o cédula de la otra parte<input name="rnc" inputMode="numeric" /></label>
                    <label style={{ flex: "2 1 200px" }}>Nombre<input name="nombre" maxLength={200} /></label>
                  </div>
                  <div className="fila">
                    <label style={{ flex: "1 1 160px" }}>NCF<input name="ncf" required placeholder="B0100000001" /></label>
                    <label>Fecha<input type="date" name="fecha" required /></label>
                    <label style={{ width: 140 }}>Subtotal<input name="subtotal" inputMode="decimal" required /></label>
                    <label style={{ width: 140 }}>ITBIS<input name="itbis" inputMode="decimal" defaultValue="0.00" /></label>
                  </div>
                  <div className="fila">
                    <label style={{ flex: "2 1 240px" }}>Tipo de gasto del 606 (si es gasto)
                      <select name="tipo_gasto" defaultValue="02">{Object.entries(TIPOS_GASTO).map(([k, t]) => <option key={k} value={k}>{k} · {t}</option>)}</select>
                    </label>
                    <label>Es
                      <select name="clase" defaultValue="servicio"><option value="servicio">Servicio</option><option value="bien">Bien</option></select>
                    </label>
                  </div>
                  <p className="sub" style={{ margin: 0 }}>Queda como factura del cliente (revisada: RNC, NCF, repetidas, crédito fiscal) y como borrador de compra o de venta con el archivo.</p>
                </Formulario>
              </details>
            ) : (
              <p style={{ margin: 0 }}><Link href={`/e/${r.cliente.id}/recepcion`}>Procesarlo en el cliente</Link>{r.categoria === "estado_bancario" && " (estado de cuenta del banco)"}</p>
            )}
            <details style={{ marginTop: 8 }}>
              <summary>Descartar (no sirve)</summary>
              <Formulario accion={descartarDocumento.bind(null, fid, r.cliente.id, r.id)} boton="Descartar" className="fila">
                <label style={{ flex: "1 1 260px" }}>Motivo (lo ve el cliente)<input name="respuesta" required minLength={3} maxLength={500} placeholder="Ej.: la foto está borrosa" /></label>
              </Formulario>
            </details>
          </section>
        );
      })}
    </>
  );
}
