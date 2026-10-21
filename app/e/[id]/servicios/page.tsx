import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { guardarServicio } from "../ventas-acciones";

type Servicio = { id: string; nombre: string; precio: string; tasa_itbis: string; cuenta_ingreso_id: string | null; activo: boolean; cuenta: string | null };

export default async function Servicios({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ editar?: string }>;
}) {
  const { id } = await params;
  const { editar } = await searchParams;
  const { rol } = await accesoEmpresa(id);
  const { servicios, ingresos } = await conEmpresa(id, async (tx) => ({
    servicios: await tx<Servicio[]>`
      SELECT s.id, s.nombre, s.precio::text, s.tasa_itbis::text, s.cuenta_ingreso_id, s.activo, c.codigo || ' · ' || c.nombre AS cuenta
        FROM servicios s LEFT JOIN cuentas c ON c.id = s.cuenta_ingreso_id ORDER BY s.activo DESC, s.nombre`,
    ingresos: (await listarCuentas(tx)).filter((c) => c.tipo === "ingreso" && c.de_detalle && c.activa),
  }));
  const editable = puede(rol, "registrar");
  const enEdicion = editable ? servicios.find((s) => s.id === editar) : undefined;

  return (
    <>
      <h1>Servicios</h1>
      <p className="sub">Lo que vendes, con su precio e ITBIS, para llenar las facturas más rápido.</p>
      {editable && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>{enEdicion ? `Editar ${enEdicion.nombre}` : "Nuevo servicio"}</h2>
          <Formulario key={enEdicion?.id ?? "nuevo"} accion={guardarServicio.bind(null, id)} boton="Guardar servicio" className="fila">
            {enEdicion && <input type="hidden" name="id" value={enEdicion.id} />}
            <label style={{ flex: "2 1 260px" }}>Nombre<input name="nombre" defaultValue={enEdicion?.nombre} required /></label>
            <label style={{ width: 150 }}>Precio (sin ITBIS)<input name="precio" inputMode="decimal" defaultValue={enEdicion?.precio ?? ""} required /></label>
            <label>ITBIS
              <select name="tasa_itbis" defaultValue={enEdicion ? String(Number(enEdicion.tasa_itbis)) : "18"}>
                <option value="18">18 %</option><option value="16">16 %</option><option value="0">Exento</option>
              </select>
            </label>
            <label style={{ flex: "1 1 240px" }}>Cuenta de ingreso
              <select name="cuenta_ingreso" defaultValue={enEdicion?.cuenta_ingreso_id ?? ""}>
                <option value="">La de Configuración (ingresos por servicios)</option>
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
          <thead><tr><th>Servicio</th><th className="num">Precio</th><th>ITBIS</th><th>Cuenta</th>{editable && <th />}</tr></thead>
          <tbody>
            {servicios.map((s) => (
              <tr key={s.id} style={s.activo ? undefined : { opacity: 0.55 }}>
                <td>{s.nombre}{!s.activo && " (inactivo)"}</td>
                <td className="num">{verMonto(s.precio)}</td>
                <td>{Number(s.tasa_itbis) ? `${Number(s.tasa_itbis)} %` : "Exento"}</td>
                <td>{s.cuenta ?? "Configuración"}</td>
                {editable && <td className="num"><Link href={`/e/${id}/servicios?editar=${s.id}`}>Editar</Link></td>}
              </tr>
            ))}
            {servicios.length === 0 && <tr><td colSpan={5}>No hay servicios todavía.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
