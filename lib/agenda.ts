import type { Tx } from "./db";

// Prioridad 3 · P3c: agenda de citas. Reuniones con clientes y prospectos, ligadas a su ficha: hora, lugar o enlace, asistentes del equipo y notas.
// Se pueden mover y cancelar (no se borran) y marcar como realizadas. El recordatorio sale por WhatsApp con el mensaje «Confirmación de cita».

export const MODALIDADES: Record<string, string> = { presencial: "Presencial", virtual: "Virtual", llamada: "Llamada" };
export const ESTADOS_CITA: Record<string, string> = { programada: "Programada", realizada: "Realizada", cancelada: "Cancelada" };
export const DURACIONES = [15, 30, 45, 60, 90, 120, 180, 240];

export class ErrorAgenda extends Error {
  code = "P0001"; // mensajeError lo muestra tal cual
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// «martes 24 de noviembre»
export function fechaLarga(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}
// «14:30» → «2:30 p. m.»
export function verHora(hora: string): string {
  const h = Number(hora.slice(0, 2)), m = hora.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "a. m." : "p. m."}`;
}
// La hora en que termina («15:30» con 90 minutos → «17:00»).
export function terminaA(hora: string, minutos: number): string {
  const t = Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5)) + minutos;
  const m = t % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const esFecha = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const esHora = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const esUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export type DatosCita = {
  titulo: string; fecha: string; hora: string; duracion: number; modalidad: string; lugar: string | null; asistentes: string[]; notas: string | null;
};

const t = (fd: FormData, c: string, max: number) => String(fd.get(c) ?? "").trim().replace(/[ \t]+/g, " ").slice(0, max);

function leerFechaHora(fd: FormData, hoy: string): { fecha: string; hora: string } {
  const fecha = t(fd, "fecha", 10), hora = t(fd, "hora", 5);
  if (!esFecha(fecha)) throw new ErrorAgenda("Escribe la fecha de la cita.");
  if (fecha < hoy) throw new ErrorAgenda("La fecha no puede ser anterior a hoy.");
  if (!esHora(hora)) throw new ErrorAgenda("Escribe la hora de la cita.");
  return { fecha, hora };
}

export function leerCita(fd: FormData, hoy: string): DatosCita {
  const titulo = t(fd, "titulo", 200) || "Reunión";
  const { fecha, hora } = leerFechaHora(fd, hoy);
  const duracion = Number(t(fd, "duracion", 4) || 60);
  if (!Number.isInteger(duracion) || duracion < 5 || duracion > 720) throw new ErrorAgenda("La duración va de 5 a 720 minutos.");
  const modalidad = t(fd, "modalidad", 20) || "presencial";
  if (!(modalidad in MODALIDADES)) throw new ErrorAgenda("Elige si es presencial, virtual o llamada.");
  const asistentes = [...new Set(fd.getAll("asistentes").map(String).filter(Boolean))];
  if (asistentes.length > 20 || asistentes.some((a) => !esUuid(a))) throw new ErrorAgenda("Elige los asistentes de la lista.");
  const lugar = t(fd, "lugar", 300), notas = String(fd.get("notas") ?? "").trim().slice(0, 2000);
  return { titulo, fecha, hora, duracion, modalidad, lugar: lugar || null, asistentes, notas: notas || null };
}

export const leerMovimiento = (fd: FormData, hoy: string) => leerFechaHora(fd, hoy);

export type Cita = {
  id: string; empresa_id: string; titulo: string; fecha: string; hora: string; duracion_min: number; modalidad: string; lugar: string | null;
  asistentes: string[]; notas: string | null; estado: string; motivo_cancelacion: string | null; movida_veces: number; recordatorio_enviado: string | null;
};

// Las citas de una empresa entre dos fechas (cualquiera puede faltar), por fecha y hora. Corre en conEmpresa.
export const listarCitas = (tx: Tx, desde: string | null, hasta: string | null) => tx<Cita[]>`
  SELECT id, empresa_id, titulo, to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(hora, 'HH24:MI') AS hora, duracion_min, modalidad, lugar,
         asistentes::text[] AS asistentes, notas, estado, motivo_cancelacion, movida_veces,
         to_char(recordatorio_enviado AT TIME ZONE 'America/Santo_Domingo', 'DD/MM/YYYY HH24:MI') AS recordatorio_enviado
    FROM citas WHERE (${desde}::date IS NULL OR fecha >= ${desde}::date) AND (${hasta}::date IS NULL OR fecha <= ${hasta}::date)
   ORDER BY fecha, hora, creado`;

export async function crearCita(tx: Tx, d: { empresaId: string; usuarioId: string } & DatosCita): Promise<string> {
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO citas (empresa_id, titulo, fecha, hora, duracion_min, modalidad, lugar, asistentes, notas, creado_por)
    VALUES (${d.empresaId}, ${d.titulo}, ${d.fecha}, ${d.hora}, ${d.duracion}, ${d.modalidad}, ${d.lugar}, ${d.asistentes}::uuid[], ${d.notas}, ${d.usuarioId})
    RETURNING id`;
  return id;
}

// Mover una cita programada a otra fecha u hora: hay que avisarle de nuevo al cliente, así que el recordatorio vuelve a quedar pendiente.
export async function moverCita(tx: Tx, d: { citaId: string; usuarioId: string; fecha: string; hora: string }) {
  const r = await tx`
    UPDATE citas SET fecha = ${d.fecha}, hora = ${d.hora}, movida_veces = movida_veces + 1, recordatorio_enviado = NULL, modificado_por = ${d.usuarioId}, modificado = now()
     WHERE id = ${d.citaId} AND estado = 'programada'`;
  if (!r.count) throw new ErrorAgenda("Solo se mueven las citas programadas.");
}

export async function cancelarCita(tx: Tx, d: { citaId: string; usuarioId: string; motivo: string | null }) {
  const motivo = d.motivo?.trim().slice(0, 300) || null;
  const r = await tx`
    UPDATE citas SET estado = 'cancelada', motivo_cancelacion = ${motivo}, modificado_por = ${d.usuarioId}, modificado = now()
     WHERE id = ${d.citaId} AND estado = 'programada'`;
  if (!r.count) throw new ErrorAgenda("Solo se cancelan las citas programadas.");
}

// Marcarla realizada, con lo que se habló o se acordó (se agrega a las notas).
export async function realizarCita(tx: Tx, d: { citaId: string; usuarioId: string; resultado: string | null }) {
  const resultado = d.resultado?.trim().slice(0, 1500) || null;
  const r = await tx`
    UPDATE citas SET estado = 'realizada', notas = CASE WHEN ${resultado}::text IS NULL THEN notas ELSE left(COALESCE(notas || E'\n', '') || 'Resultado: ' || ${resultado}, 2000) END,
                     modificado_por = ${d.usuarioId}, modificado = now()
     WHERE id = ${d.citaId} AND estado = 'programada'`;
  if (!r.count) throw new ErrorAgenda("Solo se marcan realizadas las citas programadas.");
}
