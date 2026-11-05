import type { Tx } from "./db";
import { aCentavos, deCentavos, leerMonto } from "./montos.ts";

// Bloque 3, entrega 3a: bitácora de gestiones (Documento maestro, sección 8) y notificaciones de pago (TSS y DGII).

export const TIPOS_GESTION: Record<string, string> = {
  factura: "Factura emitida", carta: "Carta o certificación", declaracion: "Declaración presentada",
  notificacion: "Notificación DGII o TSS atendida", solicitud: "Solicitud del cliente", tramite: "Trámite",
  llamada: "Llamada o reunión", mensaje: "Mensaje enviado", documento: "Documento del cliente", otro: "Otra gestión",
};
export const ESTADOS_GESTION: Record<string, string> = { pendiente: "Pendiente", en_proceso: "En proceso", hecha: "Hecha" };
export const ORIGENES: Record<string, string> = {
  manual: "Anotada", factura: "Del sistema", declaracion: "Del sistema", recepcion: "Del sistema", notificacion: "Del sistema",
};

export class ErrorBitacora extends Error {}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`; // m = AAAA-MM
export const moverMes = (m: string, n: number) => {
  const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export type GestionEntrada = {
  fecha: string; tipo: string; descripcion: string; responsableId: string | null; entrega: string | null; estado: string;
};

export function leerGestion(fd: FormData, hoy: string): GestionEntrada {
  const fecha = texto(fd, "fecha") || hoy;
  const tipo = texto(fd, "tipo");
  const descripcion = texto(fd, "descripcion").replace(/\s+/g, " ");
  const responsable = texto(fd, "responsable");
  const entrega = texto(fd, "entrega");
  const estado = texto(fd, "estado") || "hecha";
  if (!FECHA.test(fecha) || (entrega && !FECHA.test(entrega))) throw new ErrorBitacora("Revisa las fechas.");
  if (!(tipo in TIPOS_GESTION)) throw new ErrorBitacora("Elige el tipo de gestión.");
  if (!descripcion) throw new ErrorBitacora("Escribe qué se hizo.");
  if (descripcion.length > 1000) throw new ErrorBitacora("La descripción va hasta 1,000 caracteres.");
  if (responsable && !UUID.test(responsable)) throw new ErrorBitacora("Elige el responsable de la lista.");
  if (!(estado in ESTADOS_GESTION)) throw new ErrorBitacora("Elige el estado.");
  return { fecha, tipo, descripcion, responsableId: responsable || null, entrega: entrega || null, estado };
}

export type FiltrosBitacora = { mes: string; tipo: string; estado: string; responsable: string };

export function leerFiltrosBitacora(sp: Record<string, string | undefined>, hoy: string): FiltrosBitacora {
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes ?? "") ? sp.mes! : hoy.slice(0, 7);
  return {
    mes, tipo: sp.tipo && sp.tipo in TIPOS_GESTION ? sp.tipo : "", estado: sp.estado && sp.estado in ESTADOS_GESTION ? sp.estado : "",
    responsable: UUID.test(sp.responsable ?? "") ? sp.responsable! : "",
  };
}

export type Gestion = {
  id: string; fecha: string; tipo: string; descripcion: string; responsable_id: string | null; responsable: string | null;
  entrega: string | null; estado: string; origen: string; documento_id: string | null;
};

// Las gestiones del mes con los filtros. El nombre del responsable sale de la firma (lo pasa quien llama).
export async function listarGestiones(tx: Tx, f: FiltrosBitacora, nombres: Map<string, string>): Promise<Gestion[]> {
  const desde = `${f.mes}-01`;
  const filas = await tx<Omit<Gestion, "responsable">[]>`
    SELECT g.id, to_char(g.fecha, 'YYYY-MM-DD') AS fecha, g.tipo, g.descripcion, g.responsable_id, to_char(g.entrega, 'YYYY-MM-DD') AS entrega,
           g.estado, g.origen,
           (SELECT d.id FROM documentos d WHERE d.entidad = 'gestion' AND d.entidad_id = g.id AND NOT d.eliminado ORDER BY d.subido_en DESC LIMIT 1) AS documento_id
      FROM gestiones g
     WHERE g.fecha >= ${desde}::date AND g.fecha < (${desde}::date + interval '1 month')
       AND (${f.tipo} = '' OR g.tipo = ${f.tipo}) AND (${f.estado} = '' OR g.estado = ${f.estado})
       AND (${f.responsable} = '' OR g.responsable_id::text = ${f.responsable})
     ORDER BY g.fecha DESC, g.creado DESC`;
  return filas.map((g) => ({ ...g, responsable: g.responsable_id ? nombres.get(g.responsable_id) ?? "—" : null }));
}

// Pendientes abiertos (cualquier mes), para el resumen del cliente y de la firma.
export const gestionesAbiertas = (tx: Tx) => tx<{ n: number; vencidas: number }[]>`
  SELECT count(*)::int AS n, count(*) FILTER (WHERE entrega < current_date)::int AS vencidas FROM gestiones WHERE estado <> 'hecha'`;

// ───── Notificaciones de pago ─────

export const TIPOS_NOTIFICACION: Record<string, string> = { tss: "TSS", dgii: "DGII" };
export const ESTADOS_NOTIFICACION: Record<string, string> = { pendiente: "Pendiente de enviar", enviada: "Enviada al cliente", pagada: "Pagada" };
export const DIAS_ALERTA = 3; // aviso cuando faltan 3 días o menos y no consta el pago

export type NotificacionEntrada = { tipo: string; periodo: string; concepto: string | null; monto: string; fechaLimite: string };

export function leerNotificacion(fd: FormData): NotificacionEntrada {
  const tipo = texto(fd, "tipo");
  const periodo = texto(fd, "periodo").replace("-", "");
  const monto = leerMonto(texto(fd, "monto"));
  const fechaLimite = texto(fd, "fecha_limite");
  const concepto = texto(fd, "concepto") || null;
  if (!(tipo in TIPOS_NOTIFICACION)) throw new ErrorBitacora("Elige si es de la TSS o de la DGII.");
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(periodo)) throw new ErrorBitacora("Elige el mes al que corresponde.");
  if (monto === null) throw new ErrorBitacora("El monto no es válido.");
  if (!FECHA.test(fechaLimite)) throw new ErrorBitacora("Escribe la fecha límite de pago.");
  if (concepto && concepto.length > 200) throw new ErrorBitacora("El concepto va hasta 200 caracteres.");
  return { tipo, periodo, concepto, monto: deCentavos(aCentavos(monto)), fechaLimite };
}

export type Notificacion = {
  id: string; tipo: string; periodo: string; concepto: string | null; monto: string; fecha_limite: string; estado: string;
  enviada_en: Date | null; pagada_en: Date | null; documento_id: string | null; documento: string | null;
};

export const listarNotificaciones = (tx: Tx) => tx<Notificacion[]>`
  SELECT n.id, n.tipo, n.periodo, n.concepto, n.monto::text, to_char(n.fecha_limite, 'YYYY-MM-DD') AS fecha_limite, n.estado,
         n.enviada_en, n.pagada_en, d.id AS documento_id, d.nombre AS documento
    FROM notificaciones_pago n
    LEFT JOIN LATERAL (SELECT id, nombre FROM documentos WHERE entidad = 'notificacion' AND entidad_id = n.id AND NOT eliminado
                        ORDER BY subido_en DESC LIMIT 1) d ON true
   ORDER BY n.estado = 'pagada', n.fecha_limite, n.creado`;

// Por vencer: sin pago y con la fecha límite a 3 días o menos (o ya pasada).
export function porVencer(n: Pick<Notificacion, "estado" | "fecha_limite">, hoy: string): "vencida" | "por_vencer" | null {
  if (n.estado === "pagada") return null;
  if (n.fecha_limite < hoy) return "vencida";
  const limite = new Date(`${hoy}T00:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() + DIAS_ALERTA);
  return n.fecha_limite <= limite.toISOString().slice(0, 10) ? "por_vencer" : null;
}

const PASOS: Record<string, string[]> = { pendiente: ["enviada", "pagada"], enviada: ["pagada", "pendiente"], pagada: ["enviada"] };

export async function cambiarNotificacion(tx: Tx, id: string, estado: string, usuarioId: string) {
  const [n] = await tx<{ estado: string }[]>`SELECT estado FROM notificaciones_pago WHERE id = ${id} FOR UPDATE`;
  if (!n) throw new ErrorBitacora("La notificación no existe.");
  if (!(PASOS[n.estado] ?? []).includes(estado)) throw new ErrorBitacora("Ese cambio de estado no es posible.");
  if (estado === "enviada") await tx`UPDATE notificaciones_pago SET estado = 'enviada', enviada_por = ${usuarioId}, enviada_en = now(), pagada_por = NULL, pagada_en = NULL WHERE id = ${id}`;
  else if (estado === "pagada") await tx`UPDATE notificaciones_pago SET estado = 'pagada', pagada_por = ${usuarioId}, pagada_en = now() WHERE id = ${id}`;
  else await tx`UPDATE notificaciones_pago SET estado = 'pendiente', enviada_por = NULL, enviada_en = NULL WHERE id = ${id}`;
}
