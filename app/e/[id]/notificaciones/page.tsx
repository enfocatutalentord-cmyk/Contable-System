import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { ESTADOS_NOTIFICACION, listarNotificaciones, porVencer, TIPOS_NOTIFICACION } from "@/lib/bitacora";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { cambiarEstadoNotificacion, registrarNotificacion } from "../bitacora-acciones";

const periodoVisible = (p: string) => `${p.slice(4)}/${p.slice(0, 4)}`;

// Notificaciones de pago de la TSS y la DGII (bloque 3a): se suben, se envían al cliente y se marca el pago. Avisa cuando faltan
// 3 días o menos y no consta el pago. Leer solo el PDF llega cuando haya ejemplos reales.
export default async function Notificaciones({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { empresa, permisos } = await accesoEmpresa(id);
  const hoy = hoyISO();
  const lista = await conEmpresa(id, listarNotificaciones);
  const registra = puede(permisos, "registrar");
  const mesAnterior = (() => { const d = new Date(`${hoy}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const alertas = lista.filter((n) => porVencer(n, hoy));

  return (
    <>
      <h1>Notificaciones de pago</h1>
      <p className="sub">
        Las notificaciones de la TSS y de la DGII de {empresa.nombre}. Se suben aquí, quedan pendientes de enviar al cliente y, cuando
        se envían, queda en la bitácora con fecha, hora y quién. Si faltan 3 días o menos para la fecha límite y no consta el pago, avisa.
      </p>
      {alertas.length > 0 && (
        <p className="aviso">
          {alertas.map((n) => `${TIPOS_NOTIFICACION[n.tipo]} de ${periodoVisible(n.periodo)}: ${porVencer(n, hoy) === "vencida" ? "venció" : "vence"} el ${verFecha(n.fecha_limite)} sin pago registrado`).join(" · ")}.
        </p>
      )}
      {registra && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Subir una notificación</h2>
          <Formulario accion={registrarNotificacion.bind(null, id)} boton="Registrar notificación" className="fila">
            <label>De
              <select name="tipo" defaultValue="tss">
                {Object.entries(TIPOS_NOTIFICACION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Mes<input type="month" name="periodo" defaultValue={mesAnterior} required /></label>
            <label style={{ width: 150 }}>Monto<input name="monto" inputMode="decimal" required /></label>
            <label>Fecha límite<input type="date" name="fecha_limite" required /></label>
            <label style={{ flex: "2 1 220px" }}>Concepto<input name="concepto" maxLength={200} placeholder="Ej.: Seguridad social de octubre" /></label>
            <label style={{ flex: "1 1 240px" }}>Notificación (PDF, JPG o PNG)<input type="file" name="archivo" accept="application/pdf,image/jpeg,image/png" /></label>
          </Formulario>
        </div>
      )}
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>De</th><th>Mes</th><th>Concepto</th><th className="num">Monto</th><th>Fecha límite</th><th>Estado</th>{registra && <th />}</tr></thead>
          <tbody>
            {lista.map((n) => {
              const alerta = porVencer(n, hoy);
              return (
                <tr key={n.id} style={n.estado === "pagada" ? { opacity: 0.65 } : undefined}>
                  <td>{TIPOS_NOTIFICACION[n.tipo]}</td>
                  <td>{periodoVisible(n.periodo)}</td>
                  <td>
                    {n.concepto ?? "—"}
                    {n.documento_id && <div><a href={`/e/${id}/documentos/${n.documento_id}`} target="_blank" rel="noreferrer">{n.documento}</a></div>}
                  </td>
                  <td className="num">{verMonto(n.monto)}</td>
                  <td style={alerta ? { color: "var(--peligro)", fontWeight: 600 } : undefined}>
                    {verFecha(n.fecha_limite)}{alerta === "vencida" ? " · vencida" : alerta === "por_vencer" ? " · por vencer" : ""}
                  </td>
                  <td>
                    {ESTADOS_NOTIFICACION[n.estado]}
                    {n.enviada_en && <div className="sub" style={{ margin: 0 }}>enviada {n.enviada_en.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" })}</div>}
                  </td>
                  {registra && (
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      {n.estado === "pendiente" && <Formulario accion={cambiarEstadoNotificacion.bind(null, id, n.id, "enviada")} boton="Marcar enviada" className="fila"><span /></Formulario>}
                      {n.estado !== "pagada" && <Formulario accion={cambiarEstadoNotificacion.bind(null, id, n.id, "pagada")} boton="Pagada" className="fila"><span /></Formulario>}
                      {n.estado === "enviada" && <Formulario accion={cambiarEstadoNotificacion.bind(null, id, n.id, "pendiente")} boton="No se envió" className="fila"><span /></Formulario>}
                    </td>
                  )}
                </tr>
              );
            })}
            {lista.length === 0 && <tr><td colSpan={7}>Todavía no hay notificaciones.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
