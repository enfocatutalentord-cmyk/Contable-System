import Link from "next/link";
import { accesoFirma } from "@/lib/acceso";
import { ESTADOS_GESTION, leerFiltrosBitacora, listarGestiones, listarNotificaciones, moverMes, nombreMes, porVencer, TIPOS_GESTION, TIPOS_NOTIFICACION } from "@/lib/bitacora";
import { conEmpresa } from "@/lib/db";
import { clientesDeFirma, equipoDe } from "@/lib/firma";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";

export const metadata = { title: "Bitácora de la firma · Empire Tax’N Legal" };

// Bitácora de toda la firma (bloque 3a): las gestiones del mes de todos los clientes y las notificaciones de pago abiertas.
export default async function BitacoraFirma({ params, searchParams }: {
  params: Promise<{ fid: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  const hoy = hoyISO();
  const f = leerFiltrosBitacora(sp, hoy);
  const [clientes, equipo] = await Promise.all([clientesDeFirma(fid, usuario.id, firma.administrador), equipoDe(fid)]);
  const nombres = new Map(equipo.map((p) => [p.id, p.nombre]));
  const datos = await Promise.all(clientes.map((c) => conEmpresa(c.id, async (tx) => ({
    gestiones: await listarGestiones(tx, f, nombres), notificaciones: (await listarNotificaciones(tx)).filter((n) => n.estado !== "pagada"),
  }))));
  const gestiones = clientes.flatMap((c, i) => datos[i].gestiones.map((g) => ({ ...g, cliente: c }))).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const notificaciones = clientes.flatMap((c, i) => datos[i].notificaciones.map((n) => ({ ...n, cliente: c }))).sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite));
  const consulta = (m: string) => `/firma/${fid}/bitacora?${new URLSearchParams({ ...f, mes: m }).toString()}`;

  return (
    <>
      <h1>Bitácora de la firma</h1>
      <p className="sub">Las gestiones de todos los clientes en el mes y las notificaciones de pago que faltan por enviar o pagar.</p>

      {notificaciones.length > 0 && (
        <>
          <h2>Notificaciones de pago abiertas</h2>
          <div className="tabla-envoltura" style={{ marginBottom: 24 }}>
            <table>
              <thead><tr><th>Cliente</th><th>De</th><th>Mes</th><th className="num">Monto</th><th>Fecha límite</th><th>Estado</th></tr></thead>
              <tbody>
                {notificaciones.map((n) => {
                  const alerta = porVencer(n, hoy);
                  return (
                    <tr key={n.id}>
                      <td><Link href={`/e/${n.cliente.id}/notificaciones`}><strong>{n.cliente.nombre}</strong></Link></td>
                      <td>{TIPOS_NOTIFICACION[n.tipo]}</td>
                      <td>{n.periodo.slice(4)}/{n.periodo.slice(0, 4)}</td>
                      <td className="num">{verMonto(n.monto)}</td>
                      <td style={alerta ? { color: "var(--peligro)", fontWeight: 600 } : undefined}>{verFecha(n.fecha_limite)}{alerta === "vencida" ? " · vencida" : alerta ? " · por vencer" : ""}</td>
                      <td>{n.estado === "pendiente" ? "Por enviar" : "Enviada, sin pago"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <nav className="fila" style={{ marginBottom: 12, alignItems: "center" }} aria-label="Mes">
        <Link className="boton" href={consulta(moverMes(f.mes, -1))}>← {nombreMes(moverMes(f.mes, -1))}</Link>
        <strong style={{ textTransform: "capitalize" }}>{nombreMes(f.mes)}</strong>
        <Link className="boton" href={consulta(moverMes(f.mes, 1))}>{nombreMes(moverMes(f.mes, 1))} →</Link>
      </nav>
      <form className="fila" style={{ marginBottom: 12 }} aria-label="Filtros">
        <input type="hidden" name="mes" value={f.mes} />
        <label>Tipo<select name="tipo" defaultValue={f.tipo}><option value="">Todos</option>{Object.entries(TIPOS_GESTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Estado<select name="estado" defaultValue={f.estado}><option value="">Todos</option>{Object.entries(ESTADOS_GESTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Responsable<select name="responsable" defaultValue={f.responsable}><option value="">Todos</option>{equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
        <button>Filtrar</button>
      </form>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Fecha</th><th>Cliente</th><th>Tipo</th><th>Qué se hizo</th><th>Responsable</th><th>Entrega</th><th>Estado</th></tr></thead>
          <tbody>
            {gestiones.map((g) => (
              <tr key={g.id}>
                <td>{verFecha(g.fecha)}</td>
                <td><Link href={`/e/${g.cliente.id}/bitacora?mes=${f.mes}`}>{g.cliente.nombre}</Link></td>
                <td>{TIPOS_GESTION[g.tipo]}</td>
                <td>{g.descripcion}</td>
                <td>{g.responsable ?? "—"}</td>
                <td style={g.entrega && g.entrega < hoy && g.estado !== "hecha" ? { color: "var(--peligro)" } : undefined}>{g.entrega ? verFecha(g.entrega) : "—"}</td>
                <td>{ESTADOS_GESTION[g.estado]}</td>
              </tr>
            ))}
            {gestiones.length === 0 && <tr><td colSpan={7}>No hay gestiones en este mes con esos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
