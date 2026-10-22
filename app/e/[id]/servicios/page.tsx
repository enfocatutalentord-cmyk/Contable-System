import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { listarImpuestos } from "@/lib/fiscal";
import { guardarServicio } from "../ventas-acciones";

type Servicio = {
  id: string; nombre: string; precio: string; impuesto_id: string | null; impuesto_adicional_id: string | null;
  cuenta_ingreso_id: string | null; activo: boolean; cuenta: string | null;
};

export default async function Servicios({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ editar?: string }>;
}) {
  const { id } = await params;
  const { editar } = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const { servicios, ingresos, impuestos } = await conEmpresa(id, async (tx) => ({
    impuestos: (await listarImpuestos(tx)).filter((i) => i.activo),
    servicios: await tx<Servicio[]>`
      SELECT s.id, s.nombre, s.precio::text, s.impuesto_id, s.impuesto_adicional_id, s.cuenta_ingreso_id, s.activo,
             c.codigo || ' · ' || c.nombre AS cuenta
        FROM servicios s LEFT JOIN cuentas c ON c.id = s.cuenta_ingreso_id ORDER BY s.activo DESC, s.nombre`,
    ingresos: (await listarCuentas(tx)).filter((c) => c.tipo === "ingreso" && c.de_detalle && c.activa),
  }));
  const editable = puede(permisos, "registrar");
  const nombreImpuesto = new Map(impuestos.map((i) => [i.id, i.nombre]));
  const principales = impuestos.filter((i) => i.tipo === "itbis" || i.tipo === "exento");
  const adicionales = impuestos.filter((i) => i.tipo !== "itbis" && i.tipo !== "exento");
  const enEdicion = editable ? servicios.find((s) => s.id === editar) : undefined;

  return (
    <>
      <h1>Productos y servicios</h1>
      <p className="sub">Lo que vendes, con su precio e impuestos de la configuración, para llenar las facturas más rápido.</p>
      {editable && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>{enEdicion ? `Editar ${enEdicion.nombre}` : "Nuevo producto o servicio"}</h2>
          <Formulario key={enEdicion?.id ?? "nuevo"} accion={guardarServicio.bind(null, id)} boton="Guardar" className="fila">
            {enEdicion && <input type="hidden" name="id" value={enEdicion.id} />}
            <label style={{ flex: "2 1 260px" }}>Nombre<input name="nombre" defaultValue={enEdicion?.nombre} required /></label>
            <label style={{ width: 150 }}>Precio (sin impuestos)<input name="precio" inputMode="decimal" defaultValue={enEdicion?.precio ?? ""} required /></label>
            <label>ITBIS
              <select name="impuesto" defaultValue={enEdicion?.impuesto_id ?? principales[0]?.id} required>
                {principales.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
              </select>
            </label>
            {adicionales.length > 0 && (
              <label>Otro cargo
                <select name="impuesto_adicional" defaultValue={enEdicion?.impuesto_adicional_id ?? ""}>
                  <option value="">Ninguno</option>
                  {adicionales.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
                </select>
              </label>
            )}
            <label style={{ flex: "1 1 240px" }}>Cuenta de ingreso
              <select name="cuenta_ingreso" defaultValue={enEdicion?.cuenta_ingreso_id ?? ""}>
                <option value="">La de Configuración de ventas (ingresos por servicios)</option>
                {ingresos.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
              </select>
            </label>
            {enEdicion && (
              <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <input type="checkbox" name="activo" defaultChecked={enEdicion.activo} style={{ minHeight: 0 }} /> Activo
              </label>
            )}
          </Formulario>
          {enEdicion && <p><Link href={`/e/${id}/servicios`}>Cancelar</Link></p>}
        </div>
      )}
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Producto o servicio</th><th className="num">Precio</th><th>Impuestos</th><th>Cuenta</th>{editable && <th />}</tr></thead>
          <tbody>
            {servicios.map((s) => (
              <tr key={s.id} style={s.activo ? undefined : { opacity: 0.55 }}>
                <td>{s.nombre}{!s.activo && " (inactivo)"}</td>
                <td className="num">{verMonto(s.precio)}</td>
                <td>{[s.impuesto_id, s.impuesto_adicional_id].filter(Boolean).map((i) => nombreImpuesto.get(i!) ?? "—").join(" + ") || "Sin impuesto: edítalo"}</td>
                <td>{s.cuenta ?? "La de Configuración de ventas"}</td>
                {editable && <td className="num"><Link href={`/e/${id}/servicios?editar=${s.id}`}>Editar</Link></td>}
              </tr>
            ))}
            {servicios.length === 0 && <tr><td colSpan={5}>Todavía no hay productos ni servicios.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
