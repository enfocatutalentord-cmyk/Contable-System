import { Formulario } from "@/app/formulario";
import { ACCIONES, permisoSupervision, registroPlataforma } from "@/lib/plataforma";
import { darPermisoSupervision, quitarPermisoSupervision } from "../../acciones";

const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" });

// Supervisión de la plataforma, vista desde la firma: si la permite, por cuánto tiempo, y todo lo que la plataforma hizo
// con la firma (entradas con su motivo, permisos, suspensiones). Ley 172-13, art. 5: acceso autorizado y deber de secreto.
export async function SupervisionFirma({ fid }: { fid: string }) {
  const [permiso, registro] = await Promise.all([permisoSupervision(fid), registroPlataforma(fid)]);
  return (
    <section className="tarjeta" style={{ marginTop: 20 }} id="supervision">
      <h2 style={{ marginTop: 0 }}>Supervisión de la plataforma</h2>
      <p className="sub">
        Si necesitan ayuda, pueden permitir que la dueña de la plataforma vea los datos de la firma en <b>solo lectura</b>: no puede
        guardar, emitir, anular, descargar ni cambiar accesos. Cada entrada pide un motivo, dura una hora y queda abajo en el registro.
      </p>
      {permiso ? (
        <>
          <p className="exito">
            Permitida {permiso.hasta ? `hasta el ${fechaHora(permiso.hasta)}` : "hasta que se quite"} · la dio {permiso.quien ?? "—"} el {fechaHora(permiso.otorgado_en)}
          </p>
          <Formulario accion={quitarPermisoSupervision.bind(null, fid)} boton="Quitar el permiso" className="fila"><span /></Formulario>
        </>
      ) : (
        <Formulario accion={darPermisoSupervision.bind(null, fid)} boton="Permitir la supervisión" className="fila">
          <label>Por cuánto tiempo
            <select name="duracion" defaultValue="24h">
              <option value="24h">24 horas</option>
              <option value="7d">7 días</option>
              <option value="siempre">Hasta que lo quite</option>
            </select>
          </label>
        </Formulario>
      )}
      <h3>Registro</h3>
      {registro.length ? (
        <div className="tabla-envoltura">
          <table>
            <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Motivo o detalle</th></tr></thead>
            <tbody>
              {registro.map((r) => <tr key={r.id}><td>{fechaHora(r.en)}</td><td>{r.usuario_nombre}</td><td>{ACCIONES[r.accion] ?? r.accion}</td><td>{r.motivo ?? ""}</td></tr>)}
            </tbody>
          </table>
        </div>
      ) : <p className="sub">La plataforma no ha hecho nada con esta firma.</p>}
    </section>
  );
}
