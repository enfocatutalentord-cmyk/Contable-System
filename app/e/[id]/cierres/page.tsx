import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { ultimoDiaMes } from "@/lib/reportes";
import { fijarBloqueo } from "../acciones";

export default async function Cierres({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { empresa, rol } = await accesoEmpresa(id);
  const historial = await conEmpresa(id, (tx) => tx<{ accion: string; detalle: { antes: string | null; despues: string | null }; fecha: Date; nombre: string | null }[]>`
    SELECT b.accion, b.detalle, b.fecha, u.nombre FROM bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id
     WHERE b.accion IN ('periodo_cerrado', 'periodo_reabierto') ORDER BY b.fecha DESC LIMIT 24`);
  // Sugerencia: cerrar hasta el último día del mes anterior al actual (o al siguiente del bloqueo vigente).
  const hoy = new Date();
  const mesAnterior = ultimoDiaMes(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1)).toISOString().slice(0, 10));

  return (
    <>
      <h1>Cierres de período</h1>
      <p className="sub">
        Al cerrar un período, nadie puede registrar, cambiar ni anular asientos con fecha igual o anterior a la fecha de cierre.
        Así los reportes ya entregados (a la DGII, al banco, a los socios) no cambian.
      </p>
      <div className="tarjeta" style={{ marginBottom: 16 }}>
        <p style={{ marginTop: 0 }}>
          {empresa.fecha_bloqueo
            ? <>Período cerrado hasta el <strong>{verFecha(empresa.fecha_bloqueo)}</strong>.</>
            : <>No hay ningún período cerrado.</>}
        </p>
        {puede(rol, "cerrar") ? (
          <Formulario accion={fijarBloqueo.bind(null, id)} boton="Guardar fecha de cierre" className="fila">
            <label>Cerrar hasta<input type="date" name="fecha" defaultValue={empresa.fecha_bloqueo ?? mesAnterior} /></label>
          </Formulario>
        ) : (
          <p className="sub">Solo el dueño o el contador pueden cerrar períodos.</p>
        )}
        {puede(rol, "cerrar") && !puede(rol, "reabrir") && (
          <p className="sub" style={{ marginBottom: 0 }}>Puedes avanzar la fecha de cierre. Para reabrir un período cerrado hace falta el dueño.</p>
        )}
        {puede(rol, "reabrir") && (
          <p className="sub" style={{ marginBottom: 0 }}>Para reabrir, pon una fecha anterior o deja el campo vacío. Queda anotado quién lo hizo.</p>
        )}
      </div>
      <h2>Historial</h2>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th></tr></thead>
          <tbody>
            {historial.map((h, i) => (
              <tr key={i}>
                <td>{h.fecha.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" })}</td>
                <td>{h.nombre}</td>
                <td>
                  {h.accion === "periodo_reabierto" ? "Reabrió" : "Cerró"}:{" "}
                  {h.detalle.antes ? verFecha(h.detalle.antes) : "sin cierre"} → {h.detalle.despues ? verFecha(h.detalle.despues) : "sin cierre"}
                </td>
              </tr>
            ))}
            {historial.length === 0 && <tr><td colSpan={3}>Sin cambios todavía.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
