import Link from "next/link";
import { exigirPermiso } from "@/lib/acceso";
import { ACCIONES, describir, historial, nombresHistorial, TABLAS } from "@/lib/auditoria";
import { conEmpresa } from "@/lib/db";
import { fechaValida } from "@/lib/reportes";

export default async function Historial({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ desde?: string; hasta?: string; usuario?: string; tabla?: string; accion?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  await exigirPermiso(id, "auditoria");
  const filtros = {
    desde: fechaValida(sp.desde) ? sp.desde : undefined,
    hasta: fechaValida(sp.hasta) ? sp.hasta : undefined,
    usuario: /^[0-9a-f-]{36}$/i.test(sp.usuario ?? "") ? sp.usuario : undefined,
    tabla: TABLAS[sp.tabla ?? ""] ? sp.tabla : undefined,
    accion: sp.accion && sp.accion in ACCIONES ? sp.accion : undefined,
  };
  const { cambios, usuarios, nombres } = await conEmpresa(id, async (tx) => ({
    cambios: await historial(tx, filtros, 300),
    nombres: await nombresHistorial(tx),
    usuarios: await tx<{ id: string; nombre: string }[]>`
      SELECT DISTINCT u.id, u.nombre FROM auditoria h JOIN usuarios u ON u.id = h.usuario_id ORDER BY u.nombre`,
  }));
  const qs = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v) as [string, string][]).toString();
  const enlace = (c: (typeof cambios)[number]) => {
    const asiento = c.tabla === "asientos" ? c.registro_id : c.tabla === "lineas_asiento" ? c.padre_id : null;
    if (asiento && c.accion !== "delete") return `/e/${id}/asientos/${asiento}`;
    if (c.tabla === "facturas" && c.accion !== "delete") return `/e/${id}/facturas/${c.registro_id}`;
    return null;
  };

  return (
    <>
      <h1>Historial de cambios</h1>
      <p className="sub">
        Todo lo que se crea, modifica o elimina en esta empresa: quién, cuándo, qué había antes y qué quedó después.
        Nadie puede editar ni borrar este historial.
      </p>
      <form className="fila" style={{ marginBottom: 16 }}>
        <label>Desde<input type="date" name="desde" defaultValue={filtros.desde} /></label>
        <label>Hasta<input type="date" name="hasta" defaultValue={filtros.hasta} /></label>
        <label>Usuario
          <select name="usuario" defaultValue={filtros.usuario ?? ""}>
            <option value="">Todos</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </label>
        <label>Qué
          <select name="tabla" defaultValue={filtros.tabla ?? ""}>
            <option value="">Todo</option>
            {Object.entries(TABLAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Acción
          <select name="accion" defaultValue={filtros.accion ?? ""}>
            <option value="">Todas</option>
            {Object.entries(ACCIONES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button>Filtrar</button>
        <a className="boton" href={`/e/${id}/exportar/historial?formato=xlsx&${qs}`}>Excel</a>
        <a className="boton" href={`/e/${id}/exportar/historial?formato=pdf&${qs}`}>PDF</a>
      </form>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Detalle</th></tr></thead>
          <tbody>
            {cambios.map((c) => {
              const href = enlace(c);
              const que = `${ACCIONES[c.accion]} ${(TABLAS[c.tabla] ?? c.tabla).toLowerCase()}`;
              return (
                <tr key={c.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{c.fecha.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" })}</td>
                  <td>{c.usuario ?? "Sistema"}</td>
                  <td>{href ? <Link href={href}>{que}</Link> : que}</td>
                  <td>{describir(c, nombres).map((x, i) => <div key={i}>{x}</div>)}</td>
                </tr>
              );
            })}
            {cambios.length === 0 && <tr><td colSpan={4}>Sin cambios con esos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
      {cambios.length === 300 && <p className="sub">Se muestran los 300 más recientes; usa los filtros para acotar.</p>}
    </>
  );
}
