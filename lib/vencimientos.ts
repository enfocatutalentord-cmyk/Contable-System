import type { Tx } from "./db";

// Prioridad 2.2 (P2c.4): documentos del cliente que vencen. La ficha ya guardaba el registro mercantil, el nombre comercial (ONAPI) y la asamblea;
// aquí va cualquier otro (certificado de la DGII, contrato de alquiler, poder, firma digital, permisos…) con sus días de aviso. Las alertas salen
// solas (`alertasDeEmpresa`) y se van al renovar la fecha.

export const SUGERIDOS = [
  "Certificación de cumplimiento (DGII)", "Certificado de registro mercantil", "Estatutos sociales", "Contrato de alquiler", "Poder o representación", "Firma digital",
  "Permiso o licencia", "Póliza de seguro", "Certificado de la Cámara de Comercio",
];
export const AVISO_DIAS = 60;

export type Vencimiento = { id: string; nombre: string; vence: string; avisar_dias: number; documento_id: string | null; documento: string | null; nota: string | null };
export type EstadoVencimiento = "vencido" | "por_vencer" | "vigente";

const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);

export function estadoDe(vence: string, avisarDias: number, hoy: string): EstadoVencimiento {
  const n = dias(hoy, vence);
  return n < 0 ? "vencido" : n <= avisarDias ? "por_vencer" : "vigente";
}

export const faltanDias = (vence: string, hoy: string) => dias(hoy, vence);

export class ErrorVencimiento extends Error {}

export type DatosVencimiento = { nombre: string; vence: string; avisar_dias: number; documento_id: string | null; nota: string | null };

const esFecha = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const esUuidTexto = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function leerVencimiento(fd: FormData): DatosVencimiento {
  const t = (c: string, max: number) => String(fd.get(c) ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const nombre = t("nombre", 200), vence = t("vence", 10), aviso = t("avisar_dias", 4), documento = t("documento_id", 40), nota = t("nota", 500);
  if (!nombre) throw new ErrorVencimiento("Escribe qué documento es.");
  if (!esFecha(vence)) throw new ErrorVencimiento("Escribe la fecha en que vence.");
  const avisar = aviso === "" ? AVISO_DIAS : Number(aviso);
  if (!Number.isInteger(avisar) || avisar < 0 || avisar > 365) throw new ErrorVencimiento("Los días de aviso van de 0 a 365.");
  if (documento && !esUuidTexto(documento)) throw new ErrorVencimiento("El archivo elegido no es válido.");
  return { nombre, vence, avisar_dias: avisar, documento_id: documento || null, nota: nota || null };
}

export const listarVencimientos = (tx: Tx) => tx<Vencimiento[]>`
  SELECT v.id, v.nombre, to_char(v.vence, 'YYYY-MM-DD') AS vence, v.avisar_dias, v.documento_id, d.nombre AS documento, v.nota
    FROM vencimientos_empresa v LEFT JOIN documentos d ON d.id = v.documento_id AND NOT d.eliminado
   WHERE v.activo ORDER BY v.vence, v.nombre`;

// Archivos del expediente que se pueden ligar a un vencimiento.
export const archivosDelExpediente = (tx: Tx, empresaId: string) => tx<{ id: string; nombre: string; carpeta: string | null }[]>`
  SELECT id, nombre, carpeta FROM documentos WHERE entidad = 'expediente' AND entidad_id = ${empresaId} AND NOT eliminado ORDER BY carpeta, nombre LIMIT 300`;
