import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { TIPOS_GASTO } from "@/lib/compras";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { listarRetenciones } from "@/lib/fiscal";
import { verMonto } from "@/lib/montos";
import { puede, TIPOS_IDENTIFICACION } from "@/lib/permisos";
import { guardarProveedor } from "../compras-acciones";

type Proveedor = {
  id: string; nombre: string; rnc: string | null; tipo_identificacion: string | null; email: string | null; telefono: string | null;
  direccion: string | null; dias_credito: number; tipo_gasto: string | null; cuenta_gasto_id: string | null; retenciones: string[];
  del_exterior: boolean; activo: boolean; saldo: string;
};

export default async function Proveedores({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ editar?: string; q?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const q = (sp.q ?? "").trim();
  const { proveedores, retenciones, cuentas } = await conEmpresa(id, async (tx) => ({
    retenciones: (await listarRetenciones(tx)).filter((r) => r.activo),
    cuentas: (await listarCuentas(tx)).filter((c) => c.de_detalle && c.activa && ["gasto", "costo", "activo"].includes(c.tipo)),
    proveedores: await tx<Proveedor[]>`
      SELECT p.*, COALESCE((SELECT sum(s.saldo * c.tasa) FROM saldos_compra s JOIN compras c ON c.id = s.compra_id
                             WHERE c.proveedor_id = p.id AND NOT c.anulada), 0)::numeric(18,2)::text AS saldo
        FROM proveedores p
       WHERE ${q} = '' OR p.nombre ILIKE ${"%" + q + "%"} OR p.rnc = ${q.replace(/-/g, "")}
       ORDER BY p.activo DESC, p.nombre`,
  }));
  const nombreRetencion = new Map(retenciones.map((r) => [r.id, r.nombre]));
  const editable = puede(permisos, "registrar");
  const enEdicion = editable ? proveedores.find((p) => p.id === sp.editar) : undefined;

  return (
    <>
      <h1>Proveedores</h1>
      <p className="sub">
        A quién le compras. El tipo de gasto, la cuenta y las retenciones habituales se proponen en cada compra y pago.
        Para crédito fiscal (B01) el proveedor necesita RNC o cédula; para el comprobante de compras (B11), cédula.
      </p>
      {editable && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>{enEdicion ? `Editar ${enEdicion.nombre}` : "Nuevo proveedor"}</h2>
          <Formulario key={enEdicion?.id ?? "nuevo"} accion={guardarProveedor.bind(null, id)} boton="Guardar proveedor" className="fila">
            {enEdicion && <input type="hidden" name="id" value={enEdicion.id} />}
            <label style={{ flex: "2 1 260px" }}>Nombre o razón social<input name="nombre" defaultValue={enEdicion?.nombre} required /></label>
            <label>Identificación
              <select name="tipo_identificacion" defaultValue={enEdicion?.tipo_identificacion ?? "rnc"}>
                {Object.entries(TIPOS_IDENTIFICACION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label style={{ flex: "1 1 150px" }}>Número<input name="rnc" defaultValue={enEdicion?.rnc ?? ""} /></label>
            <label style={{ width: 130 }}>Días de crédito<input name="dias_credito" type="number" min={0} max={365} defaultValue={enEdicion?.dias_credito ?? 30} /></label>
            <label style={{ flex: "1 1 260px" }}>Tipo de gasto habitual (606)
              <select name="tipo_gasto" defaultValue={enEdicion?.tipo_gasto ?? ""}>
                <option value="">Elegir en cada compra</option>
                {Object.entries(TIPOS_GASTO).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
              </select>
            </label>
            <label style={{ flex: "1 1 260px" }}>Cuenta habitual
              <select name="cuenta_gasto" defaultValue={enEdicion?.cuenta_gasto_id ?? ""}>
                <option value="">La de Configuración de cuentas (otros gastos)</option>
                {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
              </select>
            </label>
            <label style={{ flex: "1 1 200px" }}>Correo<input name="email" type="email" defaultValue={enEdicion?.email ?? ""} /></label>
            <label style={{ flex: "1 1 150px" }}>Teléfono<input name="telefono" defaultValue={enEdicion?.telefono ?? ""} /></label>
            <label style={{ flex: "2 1 260px" }}>Dirección<input name="direccion" defaultValue={enEdicion?.direccion ?? ""} /></label>
            <label className="casilla"><input type="checkbox" name="del_exterior" defaultChecked={enEdicion?.del_exterior} /> Proveedor del exterior (no residente)</label>
            {retenciones.length > 0 && (
              <fieldset style={{ border: 0, padding: 0, margin: 0, flex: "1 1 100%" }}>
                <legend className="sub" style={{ margin: 0 }}>Retenciones que le haces habitualmente al pagarle</legend>
                <div className="casillas">
                  {retenciones.map((r) => (
                    <label key={r.id} className="casilla">
                      <input type="checkbox" name="retenciones" value={r.id} defaultChecked={enEdicion?.retenciones.includes(r.id)} /> {r.nombre}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {enEdicion && <label className="casilla"><input type="checkbox" name="activo" defaultChecked={enEdicion.activo} /> Activo</label>}
          </Formulario>
          {enEdicion && <p><Link href={`/e/${id}/proveedores`}>Cancelar</Link></p>}
        </div>
      )}
      <form className="fila" style={{ marginBottom: 12 }}>
        <label style={{ flex: "1 1 260px" }}>Buscar<input name="q" defaultValue={q} placeholder="Nombre o RNC" /></label>
        <button>Buscar</button>
      </form>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Proveedor</th><th>Identificación</th><th>Gasto 606</th><th>Le retenemos</th><th>Crédito</th><th className="num">Por pagar (DOP)</th><th /></tr></thead>
          <tbody>
            {proveedores.map((p) => (
              <tr key={p.id} className={p.activo ? undefined : "inactivo"}>
                <td>{p.nombre}{!p.activo && " (inactivo)"}{p.del_exterior && <span className="etiqueta-rol" style={{ marginLeft: 6 }}>exterior</span>}</td>
                <td>{p.rnc && <>{TIPOS_IDENTIFICACION[p.tipo_identificacion ?? "rnc"]} {p.rnc}</>}</td>
                <td>{p.tipo_gasto ?? "—"}</td>
                <td>{p.retenciones.map((r) => nombreRetencion.get(r)).filter(Boolean).join(", ") || "—"}</td>
                <td>{p.dias_credito ? `${p.dias_credito} días` : "Contado"}</td>
                <td className="num">{verMonto(p.saldo)}</td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  <Link href={`/e/${id}/cxp/estado?proveedor=${p.id}`}>Estado de cuenta</Link>
                  {editable && <> · <Link href={`/e/${id}/proveedores?editar=${p.id}`}>Editar</Link></>}
                </td>
              </tr>
            ))}
            {proveedores.length === 0 && <tr><td colSpan={7}>No hay proveedores todavía.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
