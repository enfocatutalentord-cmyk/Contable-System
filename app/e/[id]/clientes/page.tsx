import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { listarRetenciones, TIPOS_INGRESO } from "@/lib/fiscal";
import { TIPOS_IDENTIFICACION } from "@/lib/permisos";
import { NOMBRE_NCF, TIPOS_FACTURA } from "@/lib/ventas";
import { guardarCliente } from "../ventas-acciones";

type Cliente = { id: string; nombre: string; rnc: string | null; tipo_identificacion: string | null; ncf_predeterminado: string | null; tipo_ingreso: string; retenciones: string[]; email: string | null; telefono: string | null; direccion: string | null; dias_credito: number; activo: boolean; saldo: string };

export default async function Clientes({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ editar?: string; q?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const q = (sp.q ?? "").trim();
  const { clientes, retenciones } = await conEmpresa(id, async (tx) => ({
    retenciones: (await listarRetenciones(tx)).filter((r) => r.activo),
    clientes: await tx<Cliente[]>`
    SELECT c.*, COALESCE((SELECT sum(s.saldo * f.tasa) FROM saldos_factura s JOIN facturas f ON f.id = s.factura_id
                           WHERE f.cliente_id = c.id AND NOT f.anulada), 0)::numeric(18,2)::text AS saldo
      FROM clientes c
     WHERE ${q} = '' OR c.nombre ILIKE ${"%" + q + "%"} OR c.rnc = ${q.replace(/-/g, "")}
     ORDER BY c.activo DESC, c.nombre`,
  }));
  const nombreRetencion = new Map(retenciones.map((r) => [r.id, r.nombre]));
  const editable = puede(permisos, "registrar");
  const enEdicion = editable ? clientes.find((c) => c.id === sp.editar) : undefined;

  return (
    <>
      <h1>Clientes</h1>
      <p className="sub">
        Personas y empresas a las que les facturas. Para crédito fiscal (B01), régimen especial (B14) y gubernamental (B15)
        el cliente necesita RNC o cédula. Las retenciones habituales se sugieren al registrar sus cobros.
      </p>
      {editable && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>{enEdicion ? `Editar ${enEdicion.nombre}` : "Nuevo cliente"}</h2>
          <Formulario key={enEdicion?.id ?? "nuevo"} accion={guardarCliente.bind(null, id)} boton="Guardar cliente" className="fila">
            {enEdicion && <input type="hidden" name="id" value={enEdicion.id} />}
            <label style={{ flex: "2 1 260px" }}>Nombre o razón social<input name="nombre" defaultValue={enEdicion?.nombre} required /></label>
            <label>Identificación
              <select name="tipo_identificacion" defaultValue={enEdicion?.tipo_identificacion ?? "rnc"}>
                {Object.entries(TIPOS_IDENTIFICACION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label style={{ flex: "1 1 150px" }}>Número<input name="rnc" defaultValue={enEdicion?.rnc ?? ""} placeholder="Opcional para consumo (B02)" /></label>
            <label>Comprobante habitual
              <select name="ncf_predeterminado" defaultValue={enEdicion?.ncf_predeterminado ?? ""}>
                <option value="">Según tenga RNC o no</option>
                {TIPOS_FACTURA.map((t) => <option key={t} value={t}>{t} · {NOMBRE_NCF[t]}</option>)}
              </select>
            </label>
            <label>Tipo de ingreso (607)
              <select name="tipo_ingreso" defaultValue={enEdicion?.tipo_ingreso ?? "01"}>
                {Object.entries(TIPOS_INGRESO).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
              </select>
            </label>
            <label style={{ width: 130 }}>Días de crédito<input name="dias_credito" type="number" min={0} max={365} defaultValue={enEdicion?.dias_credito ?? 30} /></label>
            <label style={{ flex: "1 1 200px" }}>Correo<input name="email" type="email" defaultValue={enEdicion?.email ?? ""} /></label>
            <label style={{ flex: "1 1 150px" }}>Teléfono<input name="telefono" defaultValue={enEdicion?.telefono ?? ""} /></label>
            <label style={{ flex: "2 1 260px" }}>Dirección<input name="direccion" defaultValue={enEdicion?.direccion ?? ""} /></label>
            {retenciones.length > 0 && (
              <fieldset style={{ border: 0, padding: 0, margin: 0, flex: "1 1 100%" }}>
                <legend className="sub" style={{ margin: 0 }}>Retenciones que este cliente suele hacerte al pagar</legend>
                <div className="casillas">
                  {retenciones.map((r) => (
                    <label key={r.id} className="casilla">
                      <input type="checkbox" name="retenciones" value={r.id} defaultChecked={enEdicion?.retenciones.includes(r.id)} /> {r.nombre}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {enEdicion && (
              <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <input type="checkbox" name="activo" defaultChecked={enEdicion.activo} style={{ minHeight: 0 }} /> Activo
              </label>
            )}
          </Formulario>
          {enEdicion && <p><Link href={`/e/${id}/clientes`}>Cancelar</Link></p>}
        </div>
      )}
      <form className="fila" style={{ marginBottom: 12 }}>
        <label style={{ flex: "1 1 260px" }}>Buscar<input name="q" defaultValue={q} placeholder="Nombre o RNC" /></label>
        <button>Buscar</button>
      </form>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cliente</th><th>Identificación</th><th>Comprobante</th><th>Retiene</th><th>Crédito</th><th className="num">Saldo (DOP)</th><th /></tr></thead>
          <tbody>
            {clientes.map((c) => (
              <tr key={c.id} style={c.activo ? undefined : { opacity: 0.55 }}>
                <td>{c.nombre}{!c.activo && " (inactivo)"}{c.email && <div className="sub" style={{ margin: 0 }}>{c.email}</div>}</td>
                <td>{c.rnc && <>{TIPOS_IDENTIFICACION[c.tipo_identificacion ?? "rnc"]} {c.rnc}</>}</td>
                <td>{c.ncf_predeterminado ?? (c.rnc ? "B01" : "B02")}</td>
                <td>{c.retenciones.map((r) => nombreRetencion.get(r)).filter(Boolean).join(", ") || "—"}</td>
                <td>{c.dias_credito ? `${c.dias_credito} días` : "Contado"}</td>
                <td className="num">{verMonto(c.saldo)}</td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  <Link href={`/e/${id}/cxc/estado?cliente=${c.id}`}>Estado de cuenta</Link>
                  {editable && <> · <Link href={`/e/${id}/clientes?editar=${c.id}`}>Editar</Link></>}
                </td>
              </tr>
            ))}
            {clientes.length === 0 && <tr><td colSpan={7}>No hay clientes todavía.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
