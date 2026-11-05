import type { Tx } from "./db";

// Bloque 5, entrega 5a: trámites ante la DGII, la TSS, la Cámara de Comercio u ONAPI (Fase 2, sección 7) y la lista de pasos de
// una empresa nueva (Documento maestro, sección 5).

export const INSTITUCIONES: Record<string, string> = { dgii: "DGII", tss: "TSS", camara: "Cámara de Comercio", onapi: "ONAPI", otra: "Otra institución" };

// Trámites que nombran los documentos de Empire; se puede escribir otro.
export const TIPOS_TRAMITE: Record<string, string[]> = {
  dgii: ["Declaración rectificativa", "Acuerdo de pago", "Cambio de datos", "Solicitud de comprobantes (NCF)", "Cambio de correo",
    "Cambio de representante", "Cese de operaciones", "Descargo", "Solicitud de determinación de oficio"],
  tss: ["Cambio de representante", "Registro de empleador", "Acuerdo de pago"],
  camara: ["Registro mercantil", "Renovación del registro mercantil", "Modificación de estatutos"],
  onapi: ["Registro de nombre comercial", "Renovación de nombre comercial"],
  otra: [],
};

export const PLAZO_DIAS = 30; // si el volante no trae plazo
export const AVISO_DIAS = 5;  // alerta antes de que venza

export const sumarDias = (f: string, n: number) => { const d = new Date(`${f}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export class ErrorTramite extends Error {}

export type Tramite = {
  id: string; empresa_id: string; institucion: string; tipo: string; numero: string | null; descripcion: string | null; fecha: string; plazo: string;
  estado: "abierto" | "cerrado"; respuesta: string | null; responsable_id: string | null; responsable: string | null; cerrado_en: Date | null;
  volantes: { id: string; nombre: string; descripcion: string | null }[];
};

export const listarTramites = (tx: Tx, abiertos = false) => tx<Tramite[]>`
  SELECT t.id, t.empresa_id, t.institucion, t.tipo, t.numero, t.descripcion, to_char(t.fecha, 'YYYY-MM-DD') AS fecha, to_char(t.plazo, 'YYYY-MM-DD') AS plazo,
         t.estado, t.respuesta, t.responsable_id, u.nombre AS responsable, t.cerrado_en,
         COALESCE((SELECT json_agg(json_build_object('id', d.id, 'nombre', d.nombre, 'descripcion', d.descripcion) ORDER BY d.subido_en)
                     FROM documentos d WHERE d.entidad = 'tramite' AND d.entidad_id = t.id AND NOT d.eliminado), '[]') AS volantes
    FROM tramites t LEFT JOIN usuarios u ON u.id = t.responsable_id
   WHERE (NOT ${abiertos} OR t.estado = 'abierto')
   ORDER BY t.estado, t.plazo`;

export function leerTramite(fd: FormData) {
  const institucion = String(fd.get("institucion") ?? "");
  const tipo = String(fd.get("tipo") ?? "").trim().replace(/\s+/g, " ");
  const numero = String(fd.get("numero") ?? "").trim() || null;
  const descripcion = String(fd.get("descripcion") ?? "").trim() || null;
  const fecha = String(fd.get("fecha") ?? "");
  const plazo = String(fd.get("plazo") ?? "").trim() || (/^\d{4}-\d{2}-\d{2}$/.test(fecha) ? sumarDias(fecha, PLAZO_DIAS) : "");
  const responsable = String(fd.get("responsable") ?? "") || null;
  if (!(institucion in INSTITUCIONES)) throw new ErrorTramite("Elige la institución.");
  if (!tipo || tipo.length > 120) throw new ErrorTramite("Escribe el tipo de trámite.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{4}-\d{2}-\d{2}$/.test(plazo)) throw new ErrorTramite("Revisa la fecha y el plazo.");
  if (plazo < fecha) throw new ErrorTramite("El plazo no puede ser antes de la fecha del trámite.");
  if ((numero?.length ?? 0) > 60 || (descripcion?.length ?? 0) > 1000) throw new ErrorTramite("El número o la descripción son muy largos.");
  return { institucion, tipo, numero, descripcion, fecha, plazo, responsable };
}

export async function cerrarTramite(tx: Tx, id: string, respuesta: string | null, usuarioId: string) {
  const r = await tx`UPDATE tramites SET estado = 'cerrado', respuesta = ${respuesta}, cerrado_por = ${usuarioId}, cerrado_en = now()
                      WHERE id = ${id} AND estado = 'abierto'`;
  if (!r.count) throw new ErrorTramite("Ese trámite ya está cerrado.");
}

// ───── Empresa nueva ─────
export const PASOS: string[] = [
  "Nombre comercial en ONAPI (certificado)",
  "Estatutos (por Formalízate o con el formato del sistema)",
  "Acta de asamblea constitutiva y nómina de socios",
  "Registro mercantil",
  "RNC",
  "Oficina Virtual de la DGII",
  "Solicitud de comprobantes (NCF o e-CF)",
  "Registro en TSS y Ministerio de Trabajo (si tendrá empleados)",
  "Cuenta bancaria",
];
export const ESTADOS_PASO: Record<string, string> = { pendiente: "Pendiente", en_proceso: "En proceso", hecho: "Hecho", no_aplica: "No aplica" };

export type Paso = { paso: number; estado: string; fecha: string | null; responsable_id: string | null; responsable: string | null;
  documento_id: string | null; documento: string | null; nota: string | null };

export const listarPasos = (tx: Tx) => tx<Paso[]>`
  SELECT p.paso, p.estado, to_char(p.fecha, 'YYYY-MM-DD') AS fecha, p.responsable_id, u.nombre AS responsable, p.documento_id, d.nombre AS documento, p.nota
    FROM pasos_constitucion p LEFT JOIN usuarios u ON u.id = p.responsable_id LEFT JOIN documentos d ON d.id = p.documento_id AND NOT d.eliminado
   ORDER BY p.paso`;

export async function abrirConstitucion(tx: Tx, empresaId: string) {
  await tx`UPDATE empresas SET en_constitucion = true WHERE id = ${empresaId}`;
  for (let i = 1; i <= PASOS.length; i++) {
    await tx`INSERT INTO pasos_constitucion (empresa_id, paso) VALUES (${empresaId}, ${i}) ON CONFLICT DO NOTHING`;
  }
}
