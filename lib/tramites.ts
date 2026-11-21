import { db, type Tx } from "./db.ts";
import { sumarLaborables } from "./dias-laborables.ts";

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

// ───── Prioridad 1.5 del prompt de Patricia (20-nov-2026): seguimiento de trámites ─────
// Estados, notas con fecha, pendientes que se tachan, tiempos en días laborables y plantillas por firma.

export const ETAPAS: Record<string, string> = {
  pendiente: "Pendiente", en_proceso: "En proceso", en_espera: "En espera de respuesta", completado: "Completado",
};
export type Etapa = "pendiente" | "en_proceso" | "en_espera" | "completado";
export const esEtapa = (v: string): v is Etapa => v in ETAPAS;

export type PasoPlantilla = { texto: string; dia: number | null };
export type PlantillaTramite = { id: string; nombre: string; institucion: string; dias_estimados: number; pasos: PasoPlantilla[] };

// «Pasos» escritos uno por línea, con su día laborable opcional después de «|»: «Depositar los documentos | 2».
export function leerPasos(texto: string): PasoPlantilla[] {
  return texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 30).map((l) => {
    const [t, d] = l.split("|").map((x) => x.trim());
    const dia = d && /^\d{1,3}$/.test(d) ? Math.min(Number(d), 365) : null;
    return { texto: (t ?? "").slice(0, 300), dia };
  }).filter((p) => p.texto);
}
export const pasosATexto = (pasos: PasoPlantilla[]) => pasos.map((p) => (p.dia === null ? p.texto : `${p.texto} | ${p.dia}`)).join("\n");

export const feriadosDe = async (firmaId: string): Promise<Set<string>> =>
  new Set((await db()<{ f: string }[]>`SELECT to_char(fecha, 'YYYY-MM-DD') AS f FROM feriados WHERE firma_id = ${firmaId}`).map((r) => r.f));

export const plantillasDe = (firmaId: string) => db()<PlantillaTramite[]>`
  SELECT id, nombre, institucion, dias_estimados, pasos FROM plantillas_tramite WHERE firma_id = ${firmaId} ORDER BY nombre`;

// La primera vez que se crea un trámite con un nombre se guarda como plantilla; «Guardar como plantilla» la pone al día.
export async function guardarPlantilla(firmaId: string, usuarioId: string, p: { nombre: string; institucion: string; dias: number; pasos: PasoPlantilla[] }) {
  const [r] = await db()<{ id: string }[]>`
    INSERT INTO plantillas_tramite (firma_id, nombre, institucion, dias_estimados, pasos, creado_por)
    VALUES (${firmaId}, ${p.nombre}, ${p.institucion}, ${p.dias}, ${db().json(p.pasos as never)}, ${usuarioId})
    ON CONFLICT (firma_id, nombre) DO UPDATE SET institucion = EXCLUDED.institucion, dias_estimados = EXCLUDED.dias_estimados,
                                                pasos = EXCLUDED.pasos, actualizado = now()
    RETURNING id`;
  return r.id;
}

function esperaDe(desde: string, motivo: string | null, dias: number | null, feriados: Set<string>) {
  if (!motivo || motivo.length < 3) throw new ErrorTramite("En espera: escribe el motivo (qué se espera y de quién).");
  if (!dias || dias < 1 || dias > 365) throw new ErrorTramite("En espera: escribe cuántos días laborables se espera.");
  return { motivo: motivo.slice(0, 300), dias, hasta: sumarLaborables(desde, dias, feriados) };
}

export async function crearTramiteNuevo(tx: Tx, d: {
  empresaId: string; usuarioId: string; nombre: string; institucion: string; fecha: string; dias: number; etapa: Etapa;
  esperaMotivo: string | null; esperaDias: number | null; responsable: string | null; pasos: PasoPlantilla[]; plantillaId: string | null; feriados: Set<string>;
}): Promise<string> {
  const plazo = sumarLaborables(d.fecha, d.dias, d.feriados);
  const espera = d.etapa === "en_espera" ? esperaDe(d.fecha, d.esperaMotivo, d.esperaDias, d.feriados) : null;
  const completado = d.etapa === "completado";
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO tramites (empresa_id, institucion, tipo, fecha, plazo, responsable_id, creado_por, etapa, dias_estimados, plantilla_id,
                          espera_motivo, espera_dias, espera_desde, espera_hasta, estado, cerrado_por, cerrado_en)
    VALUES (${d.empresaId}, ${d.institucion}, ${d.nombre}, ${d.fecha}, ${plazo}, ${d.responsable}, ${d.usuarioId}, ${d.etapa}, ${d.dias}, ${d.plantillaId},
            ${espera?.motivo ?? null}, ${espera?.dias ?? null}, ${espera ? d.fecha : null}, ${espera?.hasta ?? null},
            ${completado ? "cerrado" : "abierto"}, ${completado ? d.usuarioId : null}, ${completado ? new Date() : null})
    RETURNING id`;
  let orden = 0;
  for (const p of d.pasos) {
    await tx`INSERT INTO pendientes_tramite (empresa_id, tramite_id, orden, texto, dia, vence, creado_por)
             VALUES (${d.empresaId}, ${id}, ${orden++}, ${p.texto}, ${p.dia}, ${p.dia === null ? null : sumarLaborables(d.fecha, p.dia, d.feriados)}, ${d.usuarioId})`;
  }
  return id;
}

// Lo que se le cuenta al cliente de su trámite (P2e.3): el estado en palabras suyas y una frase de detalle.
export const ESTADO_PARA_CLIENTE: Record<string, string> = {
  pendiente: "ya lo registramos", en_proceso: "lo estamos trabajando", en_espera: "estamos esperando respuesta", completado: "quedó listo",
};
export function detalleParaCliente(t: { etapa: string; espera_motivo: string | null; espera_hasta: string | null; respuesta: string | null }): string {
  const fecha = (f: string) => f.split("-").reverse().join("/");
  if (t.etapa === "pendiente") return "Lo iniciaremos en los próximos días y le avisamos cada avance.";
  if (t.etapa === "en_proceso") return "Ya estamos trabajando en él y le avisamos en cuanto haya novedades.";
  if (t.etapa === "en_espera") return `Estamos esperando ${t.espera_motivo ? t.espera_motivo.charAt(0).toLowerCase() + t.espera_motivo.slice(1) : "la respuesta de la institución"}${t.espera_hasta ? `; contamos con una respuesta hacia el ${fecha(t.espera_hasta)}` : ""}.`;
  return `Ya terminó.${t.respuesta ? ` ${t.respuesta.trim()}` : ""}`.slice(0, 500);
}

export async function cambiarEtapa(tx: Tx, d: {
  id: string; etapa: Etapa; esperaMotivo: string | null; esperaDias: number | null; usuarioId: string; hoy: string; feriados: Set<string>; respuesta: string | null;
}) {
  const [t] = await tx<{ estado: string; etapa: string }[]>`SELECT estado, etapa FROM tramites WHERE id = ${d.id} FOR UPDATE`;
  if (!t) throw new ErrorTramite("Ese trámite no existe.");
  if (t.etapa === d.etapa && d.etapa !== "en_espera") throw new ErrorTramite(`El trámite ya está «${ETAPAS[d.etapa]}».`);
  const espera = d.etapa === "en_espera" ? esperaDe(d.hoy, d.esperaMotivo, d.esperaDias, d.feriados) : null;
  if (d.etapa === "completado") {
    await tx`UPDATE tramites SET etapa = 'completado', estado = 'cerrado', respuesta = COALESCE(${d.respuesta}, respuesta),
                                 cerrado_por = ${d.usuarioId}, cerrado_en = now() WHERE id = ${d.id}`;
  } else {
    await tx`UPDATE tramites SET etapa = ${d.etapa}, estado = 'abierto', cerrado_por = NULL, cerrado_en = NULL,
                                 espera_motivo = ${espera?.motivo ?? null}, espera_dias = ${espera?.dias ?? null},
                                 espera_desde = ${espera ? d.hoy : null}, espera_hasta = ${espera?.hasta ?? null}
              WHERE id = ${d.id}`;
  }
  // Cada cambio de estado queda en la cronología del trámite.
  const fecha = (f: string) => f.split("-").reverse().join("/");
  const texto = `Estado: ${ETAPAS[d.etapa]}${espera ? ` · ${espera.motivo} (se espera hasta el ${fecha(espera.hasta)})` : ""}${d.respuesta ? ` · ${d.respuesta}` : ""}`;
  await tx`INSERT INTO notas_tramite (empresa_id, tramite_id, fecha, texto, creado_por)
           SELECT empresa_id, id, ${d.hoy}, ${texto.slice(0, 1000)}, ${d.usuarioId} FROM tramites WHERE id = ${d.id}`;
}

export type NotaTramite = { id: string; fecha: string; texto: string; autor: string; creado: Date };
export type PendienteTramite = { id: string; texto: string; dia: number | null; vence: string | null; hecho: boolean; quien: string | null; hecho_en: Date | null };
export type DetalleTramite = Tramite & {
  etapa_avisada: Etapa | null; etapa: Etapa; espera_motivo: string | null; espera_hasta: string | null; dias_estimados: number | null; plantilla_id: string | null;
  notas: NotaTramite[]; pendientes: PendienteTramite[];
};

export async function detalleTramite(tx: Tx, id: string): Promise<DetalleTramite | null> {
  const [t] = await tx<DetalleTramite[]>`
    SELECT t.id, t.empresa_id, t.institucion, t.tipo, t.numero, t.descripcion, to_char(t.fecha, 'YYYY-MM-DD') AS fecha, to_char(t.plazo, 'YYYY-MM-DD') AS plazo,
           t.estado, t.respuesta, t.responsable_id, u.nombre AS responsable, t.cerrado_en, t.etapa, t.etapa_avisada, t.espera_motivo,
           to_char(t.espera_hasta, 'YYYY-MM-DD') AS espera_hasta, t.dias_estimados, t.plantilla_id,
           COALESCE((SELECT json_agg(json_build_object('id', d.id, 'nombre', d.nombre, 'descripcion', d.descripcion) ORDER BY d.subido_en)
                       FROM documentos d WHERE d.entidad = 'tramite' AND d.entidad_id = t.id AND NOT d.eliminado), '[]') AS volantes
      FROM tramites t LEFT JOIN usuarios u ON u.id = t.responsable_id WHERE t.id = ${id}`;
  if (!t) return null;
  t.notas = await tx<NotaTramite[]>`
    SELECT n.id, to_char(n.fecha, 'YYYY-MM-DD') AS fecha, n.texto, u.nombre AS autor, n.creado
      FROM notas_tramite n JOIN usuarios u ON u.id = n.creado_por WHERE n.tramite_id = ${id} ORDER BY n.creado DESC`;
  t.pendientes = await tx<PendienteTramite[]>`
    SELECT p.id, p.texto, p.dia, to_char(p.vence, 'YYYY-MM-DD') AS vence, p.hecho, u.nombre AS quien, p.hecho_en
      FROM pendientes_tramite p LEFT JOIN usuarios u ON u.id = p.hecho_por WHERE p.tramite_id = ${id} ORDER BY p.orden, p.creado`;
  return t;
}

export type FilaTramite = Tramite & {
  etapa_avisada: Etapa | null; etapa: Etapa; espera_hasta: string | null; espera_motivo: string | null; pendientes: number; hechos: number; proximo: string | null; proximo_vence: string | null;
};

// Para la lista de la firma: estado, plazo, cuántos pendientes van hechos y el próximo paso.
export const resumenTramites = (tx: Tx, abiertos: boolean) => tx<FilaTramite[]>`
  SELECT t.id, t.empresa_id, t.institucion, t.tipo, t.numero, t.descripcion, to_char(t.fecha, 'YYYY-MM-DD') AS fecha, to_char(t.plazo, 'YYYY-MM-DD') AS plazo,
         t.estado, t.respuesta, t.responsable_id, u.nombre AS responsable, t.cerrado_en, t.etapa, t.etapa_avisada, t.espera_motivo,
         to_char(t.espera_hasta, 'YYYY-MM-DD') AS espera_hasta, '[]'::json AS volantes,
         (SELECT count(*)::int FROM pendientes_tramite p WHERE p.tramite_id = t.id) AS pendientes,
         (SELECT count(*)::int FROM pendientes_tramite p WHERE p.tramite_id = t.id AND p.hecho) AS hechos,
         (SELECT p.texto FROM pendientes_tramite p WHERE p.tramite_id = t.id AND NOT p.hecho ORDER BY p.vence NULLS LAST, p.orden LIMIT 1) AS proximo,
         (SELECT to_char(p.vence, 'YYYY-MM-DD') FROM pendientes_tramite p WHERE p.tramite_id = t.id AND NOT p.hecho ORDER BY p.vence NULLS LAST, p.orden LIMIT 1) AS proximo_vence
    FROM tramites t LEFT JOIN usuarios u ON u.id = t.responsable_id
   WHERE (NOT ${abiertos} OR t.estado = 'abierto')
   ORDER BY t.estado, t.plazo`;
