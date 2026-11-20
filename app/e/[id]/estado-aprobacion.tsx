import { Formulario } from "@/app/formulario";
import { EVENTOS, type Aprobacion, type EventoAprobacion } from "@/lib/aprobaciones";
import { aprobarAccion, devolverAccion } from "./aprobaciones-acciones";

const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" });

// El estado de aprobación de un borrador (Prioridad 2.1): esperando, devuelto con lo que hay que corregir y su historial. Quien tiene el
// permiso «aprobar» (y no lo preparó) ve los botones Aprobar y Devolver.
export function EstadoAprobacion({ empresaId, aprobacion, historial, puedeAprobar, usuarioId }: {
  empresaId: string; aprobacion: Aprobacion | null; historial: EventoAprobacion[]; puedeAprobar: boolean; usuarioId: string;
}) {
  if (!aprobacion) return null;
  const mia = aprobacion.solicitadoPorId === usuarioId;
  return (
    <div className="tarjeta" style={{ marginBottom: 16, borderLeft: `4px solid ${aprobacion.estado === "devuelta" ? "var(--peligro)" : "var(--dorado)"}` }}>
      {aprobacion.estado === "pendiente" && (
        <>
          <strong>Esperando aprobación</strong>
          <p className="sub" style={{ margin: "4px 0" }}>{aprobacion.solicitadoPor} lo pidió el {fechaHora(aprobacion.solicitadoEn)}; no se emite ni se registra hasta que lo apruebe otra persona.</p>
          {puedeAprobar && !mia && (
            <div className="fila" style={{ alignItems: "flex-start", marginTop: 8 }}>
              <Formulario accion={aprobarAccion.bind(null, empresaId, aprobacion.id)} boton="Aprobar" className="fila"><></></Formulario>
              <Formulario accion={devolverAccion.bind(null, empresaId, aprobacion.id)} boton="Devolver" className="fila">
                <label style={{ flex: "1 1 280px" }}>Qué hay que corregir<input name="motivo" required maxLength={1000} placeholder="Ej.: el cliente es otro" /></label>
              </Formulario>
            </div>
          )}
          {mia && <p className="sub">Lo preparaste tú: lo aprueba otra persona.</p>}
        </>
      )}
      {aprobacion.estado === "devuelta" && (
        <>
          <strong style={{ color: "var(--peligro)" }}>Devuelto para corregir</strong>
          <p style={{ margin: "4px 0" }}>{aprobacion.motivo}</p>
          <p className="sub" style={{ margin: 0 }}>Lo devolvió {aprobacion.resueltoPor} el {aprobacion.resueltoEn && fechaHora(aprobacion.resueltoEn)}. Corrígelo y vuelve a pedir la aprobación.</p>
        </>
      )}
      {aprobacion.estado === "aprobada" && <strong>Aprobado por {aprobacion.resueltoPor}{aprobacion.resueltoEn && ` el ${fechaHora(aprobacion.resueltoEn)}`}</strong>}
      {aprobacion.vecesDevuelta > 0 && <p className="sub" style={{ margin: "4px 0 0" }}>Se ha devuelto {aprobacion.vecesDevuelta} {aprobacion.vecesDevuelta === 1 ? "vez" : "veces"}.</p>}
      {historial.length > 1 && (
        <details style={{ marginTop: 8 }}>
          <summary className="sub">Historial</summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {historial.map((h, i) => <li key={i}>{fechaHora(h.cuando)} · {h.quien}: {EVENTOS[h.evento] ?? h.evento}{h.nota && ` — ${h.nota}`}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
