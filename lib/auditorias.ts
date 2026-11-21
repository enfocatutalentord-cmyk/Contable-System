import type { Tx } from "./db.ts";

// Prioridad 3 · P3j · Auditoría: plan y hallazgos. Cada auditoría es de un cliente: objetivo, alcance, período auditado, fechas de trabajo y equipo; una lista de
// pasos que se marcan; y hallazgos con situación, criterio, causa, efecto y recomendación, cada uno con sus fotos y archivos de prueba (en «documentos», entidad
// 'auditoria'). No se sigue ningún estándar (NIA) a menos que la firma lo escriba en el alcance. El informe final en PDF llega con la P3k.

export class ErrorAuditoria extends Error {}

export const ESTADOS: Record<string, string> = { planificada: "Planificada", en_curso: "En curso", en_informe: "En informe", cerrada: "Cerrada" };
// De qué estado a cuáles se puede pasar: hacia adelante o un paso atrás. Cerrar y reabrir piden permisos propios.
export const TRANSICIONES: Record<string, string[]> = {
  planificada: ["en_curso"], en_curso: ["planificada", "en_informe"], en_informe: ["en_curso", "cerrada"], cerrada: ["en_informe"],
};
export const ESTADOS_PASO: Record<string, string> = { pendiente: "Pendiente", hecho: "Hecho", no_aplica: "No aplica" };
export const RIESGOS: Record<string, string> = { alto: "Alto", medio: "Medio", bajo: "Bajo" };
export const ESTADOS_HALLAZGO: Record<string, string> = { abierto: "Abierto", en_seguimiento: "En seguimiento", resuelto: "Resuelto", aceptado: "Riesgo aceptado" };

// Los cinco campos de un hallazgo, con la pregunta que cada uno responde.
export const CAMPOS_HALLAZGO = [
  { clave: "situacion", nombre: "Situación", ayuda: "Qué se encontró." },
  { clave: "criterio", nombre: "Criterio", ayuda: "Qué debería ser: la norma, la política, el contrato o la buena práctica." },
  { clave: "causa", nombre: "Causa", ayuda: "Por qué pasó." },
  { clave: "efecto", nombre: "Efecto", ayuda: "Qué consecuencia tiene o puede tener, en pesos si se puede." },
  { clave: "recomendacion", nombre: "Recomendación", ayuda: "Qué se sugiere hacer." },
] as const;
export type ClaveCampo = (typeof CAMPOS_HALLAZGO)[number]["clave"];

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").replace(/\r\n?/g, "\n").trim();

function fechaOpcional(valor: string, nombre: string): string | null {
  if (!valor) return null;
  const d = new Date(`${valor}T00:00:00Z`);
  if (!FECHA.test(valor) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== valor) throw new ErrorAuditoria(`Revisa la fecha: ${nombre}.`);
  return valor;
}

export type DatosAuditoria = {
  nombre: string; objetivo: string; alcance: string; periodoDesde: string | null; periodoHasta: string | null;
  inicio: string | null; fin: string | null; responsable: string | null; equipo: string[];
};

// Lo que se escribe al crear o cambiar el plan de una auditoría.
export function leerAuditoria(fd: FormData): DatosAuditoria {
  const nombre = texto(fd, "nombre").replace(/\s+/g, " ");
  if (nombre.length < 3 || nombre.length > 150) throw new ErrorAuditoria("Escribe el nombre de la auditoría (entre 3 y 150 letras).");
  const objetivo = texto(fd, "objetivo"), alcance = texto(fd, "alcance");
  if (objetivo.length > 2000 || alcance.length > 2000) throw new ErrorAuditoria("El objetivo y el alcance pueden tener hasta 2,000 letras cada uno.");
  const periodoDesde = fechaOpcional(texto(fd, "periodo_desde"), "período auditado, desde");
  const periodoHasta = fechaOpcional(texto(fd, "periodo_hasta"), "período auditado, hasta");
  const inicio = fechaOpcional(texto(fd, "inicio"), "inicio del trabajo");
  const fin = fechaOpcional(texto(fd, "fin"), "fin del trabajo");
  if (periodoDesde && periodoHasta && periodoDesde > periodoHasta) throw new ErrorAuditoria("El período auditado termina antes de empezar.");
  if (inicio && fin && inicio > fin) throw new ErrorAuditoria("El trabajo termina antes de empezar.");
  const responsable = texto(fd, "responsable") || null;
  if (responsable && !UUID.test(responsable)) throw new ErrorAuditoria("Elige el responsable de la lista.");
  const equipo = [...new Set(fd.getAll("equipo").map(String).filter(Boolean))];
  if (equipo.some((u) => !UUID.test(u))) throw new ErrorAuditoria("Elige el equipo de la lista.");
  return { nombre, objetivo, alcance, periodoDesde, periodoHasta, inicio, fin, responsable, equipo };
}

// Pasos escritos uno por línea.
export function leerPasosTexto(t: string): string[] {
  const lista = t.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (lista.length > 40) throw new ErrorAuditoria("Hasta 40 pasos a la vez.");
  if (lista.some((l) => l.length > 300)) throw new ErrorAuditoria("Cada paso puede tener hasta 300 letras.");
  return lista;
}

export type DatosHallazgo = { titulo: string; situacion: string; criterio: string; causa: string; efecto: string; recomendacion: string; riesgo: string; pasoId: string | null };

export function leerHallazgo(fd: FormData): DatosHallazgo {
  const titulo = texto(fd, "titulo").replace(/\s+/g, " ");
  if (titulo.length < 3 || titulo.length > 150) throw new ErrorAuditoria("Escribe el título del hallazgo (entre 3 y 150 letras).");
  const campos = Object.fromEntries(CAMPOS_HALLAZGO.map((c) => [c.clave, texto(fd, c.clave)])) as Record<ClaveCampo, string>;
  for (const c of CAMPOS_HALLAZGO) if (campos[c.clave].length > 3000) throw new ErrorAuditoria(`${c.nombre}: hasta 3,000 letras.`);
  const riesgo = texto(fd, "riesgo") || "medio";
  if (!(riesgo in RIESGOS)) throw new ErrorAuditoria("Elige el riesgo: alto, medio o bajo.");
  const pasoId = texto(fd, "paso") || null;
  if (pasoId && !UUID.test(pasoId)) throw new ErrorAuditoria("Elige el paso de la lista.");
  return { titulo, ...campos, riesgo, pasoId };
}

// Los campos del hallazgo que siguen vacíos (el informe los necesita todos).
export const camposFaltantes = (h: Partial<Record<ClaveCampo, string>>): string[] => CAMPOS_HALLAZGO.filter((c) => !(h[c.clave] ?? "").trim()).map((c) => c.nombre);

export type Evidencia = { id: string; nombre: string; tipo: string; tamano: number; descripcion: string | null; entidad_id: string };
export type Paso = { id: string; orden: number; descripcion: string; estado: string; nota: string; responsable_id: string | null; responsable: string | null; quien: string | null; hecho_en: Date | null };
export type Hallazgo = {
  id: string; numero: number; paso_id: string | null; paso: string | null; titulo: string; situacion: string; criterio: string; causa: string; efecto: string;
  recomendacion: string; riesgo: string; estado: string; respuesta: string; creado_en: Date; evidencias: Evidencia[];
};
export type Auditoria = {
  id: string; empresa_id: string; numero: number; nombre: string; objetivo: string; alcance: string; periodo_desde: string | null; periodo_hasta: string | null;
  fecha_inicio: string | null; fecha_fin: string | null; responsable_id: string | null; responsable: string | null; equipo: string[]; estado: string;
  creado_en: Date; cerrada_en: Date | null; cerrada_por: string | null;
};
export type DetalleAuditoria = Auditoria & { equipo_nombres: string[]; pasos: Paso[]; hallazgos: Hallazgo[]; evidencias: Evidencia[] };
export type FilaAuditoria = Auditoria & { pasos: number; pasos_hechos: number; hallazgos: number; hallazgos_abiertos: number; altos_abiertos: number };

export const listarAuditorias = (tx: Tx) => tx<FilaAuditoria[]>`
  SELECT a.id, a.empresa_id, a.numero, a.nombre, a.objetivo, a.alcance, to_char(a.periodo_desde, 'YYYY-MM-DD') AS periodo_desde, to_char(a.periodo_hasta, 'YYYY-MM-DD') AS periodo_hasta,
         to_char(a.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, to_char(a.fecha_fin, 'YYYY-MM-DD') AS fecha_fin, a.responsable_id, u.nombre AS responsable, a.equipo::text[] AS equipo,
         a.estado, a.creado_en, a.cerrada_en, NULL::text AS cerrada_por,
         (SELECT count(*)::int FROM auditoria_pasos p WHERE p.auditoria_id = a.id) AS pasos,
         (SELECT count(*)::int FROM auditoria_pasos p WHERE p.auditoria_id = a.id AND p.estado <> 'pendiente') AS pasos_hechos,
         (SELECT count(*)::int FROM auditoria_hallazgos h WHERE h.auditoria_id = a.id) AS hallazgos,
         (SELECT count(*)::int FROM auditoria_hallazgos h WHERE h.auditoria_id = a.id AND h.estado IN ('abierto', 'en_seguimiento')) AS hallazgos_abiertos,
         (SELECT count(*)::int FROM auditoria_hallazgos h WHERE h.auditoria_id = a.id AND h.estado IN ('abierto', 'en_seguimiento') AND h.riesgo = 'alto') AS altos_abiertos
    FROM auditorias a LEFT JOIN usuarios u ON u.id = a.responsable_id
   ORDER BY (a.estado = 'cerrada'), a.fecha_fin NULLS LAST, a.creado_en DESC`;

const evidenciasDe = (tx: Tx, ids: string[]) => ids.length ? tx<Evidencia[]>`
  SELECT id, nombre, tipo, tamano, descripcion, entidad_id FROM documentos
   WHERE entidad = 'auditoria' AND entidad_id IN ${tx(ids)} AND NOT eliminado ORDER BY subido_en` : Promise.resolve([] as Evidencia[]);

export async function detalleAuditoria(tx: Tx, id: string): Promise<DetalleAuditoria | null> {
  const [a] = await tx<Auditoria[]>`
    SELECT a.id, a.empresa_id, a.numero, a.nombre, a.objetivo, a.alcance, to_char(a.periodo_desde, 'YYYY-MM-DD') AS periodo_desde, to_char(a.periodo_hasta, 'YYYY-MM-DD') AS periodo_hasta,
           to_char(a.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, to_char(a.fecha_fin, 'YYYY-MM-DD') AS fecha_fin, a.responsable_id, u.nombre AS responsable, a.equipo::text[] AS equipo,
           a.estado, a.creado_en, a.cerrada_en, c.nombre AS cerrada_por
      FROM auditorias a LEFT JOIN usuarios u ON u.id = a.responsable_id LEFT JOIN usuarios c ON c.id = a.cerrada_por WHERE a.id = ${id}`;
  if (!a) return null;
  const equipo_nombres = a.equipo.length ? (await tx<{ nombre: string }[]>`SELECT nombre FROM usuarios WHERE id IN ${tx(a.equipo)} ORDER BY nombre`).map((x) => x.nombre) : [];
  const pasos = await tx<Paso[]>`
    SELECT p.id, p.orden, p.descripcion, p.estado, p.nota, p.responsable_id, r.nombre AS responsable, q.nombre AS quien, p.hecho_en
      FROM auditoria_pasos p LEFT JOIN usuarios r ON r.id = p.responsable_id LEFT JOIN usuarios q ON q.id = p.hecho_por
     WHERE p.auditoria_id = ${id} ORDER BY p.orden, p.creado_en`;
  const hallazgos = await tx<Hallazgo[]>`
    SELECT h.id, h.numero, h.paso_id, p.descripcion AS paso, h.titulo, h.situacion, h.criterio, h.causa, h.efecto, h.recomendacion, h.riesgo, h.estado, h.respuesta, h.creado_en,
           '[]'::json AS evidencias
      FROM auditoria_hallazgos h LEFT JOIN auditoria_pasos p ON p.id = h.paso_id WHERE h.auditoria_id = ${id} ORDER BY h.numero`;
  const todas = await evidenciasDe(tx, [id, ...hallazgos.map((h) => h.id)]);
  for (const h of hallazgos) h.evidencias = todas.filter((e) => e.entidad_id === h.id);
  return { ...a, equipo_nombres, pasos, hallazgos, evidencias: todas.filter((e) => e.entidad_id === id) };
}

export async function crearAuditoria(tx: Tx, d: DatosAuditoria & { empresaId: string; usuarioId: string; pasos: string[] }): Promise<string> {
  const [{ numero }] = await tx<{ numero: number }[]>`SELECT COALESCE(max(numero), 0) + 1 AS numero FROM auditorias WHERE empresa_id = ${d.empresaId}`;
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO auditorias (empresa_id, numero, nombre, objetivo, alcance, periodo_desde, periodo_hasta, fecha_inicio, fecha_fin, responsable_id, equipo, creado_por)
    VALUES (${d.empresaId}, ${numero}, ${d.nombre}, ${d.objetivo}, ${d.alcance}, ${d.periodoDesde}, ${d.periodoHasta}, ${d.inicio}, ${d.fin}, ${d.responsable},
            ${d.equipo}::uuid[], ${d.usuarioId})
    RETURNING id`;
  let orden = 0;
  for (const p of d.pasos) {
    await tx`INSERT INTO auditoria_pasos (empresa_id, auditoria_id, orden, descripcion, creado_por) VALUES (${d.empresaId}, ${id}, ${orden++}, ${p}, ${d.usuarioId})`;
  }
  return id;
}

export async function guardarAuditoria(tx: Tx, id: string, d: DatosAuditoria) {
  const r = await tx`
    UPDATE auditorias SET nombre = ${d.nombre}, objetivo = ${d.objetivo}, alcance = ${d.alcance}, periodo_desde = ${d.periodoDesde}, periodo_hasta = ${d.periodoHasta},
                          fecha_inicio = ${d.inicio}, fecha_fin = ${d.fin}, responsable_id = ${d.responsable}, equipo = ${d.equipo}::uuid[]
     WHERE id = ${id}`;
  if (!r.count) throw new ErrorAuditoria("Esa auditoría no existe.");
}

// Cambia el estado de la auditoría. Cerrarla pide que no queden pasos pendientes y que todos los hallazgos tengan sus cinco campos.
export async function cambiarEstadoAuditoria(tx: Tx, id: string, estado: string, usuarioId: string) {
  if (!(estado in ESTADOS)) throw new ErrorAuditoria("Elige el estado.");
  const [a] = await tx<{ estado: string }[]>`SELECT estado FROM auditorias WHERE id = ${id} FOR UPDATE`;
  if (!a) throw new ErrorAuditoria("Esa auditoría no existe.");
  if (!TRANSICIONES[a.estado]?.includes(estado)) throw new ErrorAuditoria(`Una auditoría «${ESTADOS[a.estado]}» no pasa a «${ESTADOS[estado]}».`);
  if (estado === "cerrada") {
    const [{ pendientes }] = await tx<{ pendientes: number }[]>`SELECT count(*)::int AS pendientes FROM auditoria_pasos WHERE auditoria_id = ${id} AND estado = 'pendiente'`;
    if (pendientes) throw new ErrorAuditoria(`Quedan ${pendientes} paso${pendientes > 1 ? "s" : ""} pendiente${pendientes > 1 ? "s" : ""}: márcalos como hechos o «No aplica» antes de cerrar.`);
    const incompletos = (await tx<({ numero: number } & Record<ClaveCampo, string>)[]>`
      SELECT numero, situacion, criterio, causa, efecto, recomendacion FROM auditoria_hallazgos WHERE auditoria_id = ${id} ORDER BY numero`)
      .filter((h) => camposFaltantes(h).length);
    if (incompletos.length) throw new ErrorAuditoria(`Hay hallazgos con campos vacíos (${incompletos.map((h) => `n.º ${h.numero}`).join(", ")}): complétalos antes de cerrar.`);
  }
  await tx`UPDATE auditorias SET estado = ${estado}, cerrada_por = ${estado === "cerrada" ? usuarioId : null}, cerrada_en = ${estado === "cerrada" ? new Date() : null} WHERE id = ${id}`;
}

export async function agregarPasos(tx: Tx, d: { empresaId: string; auditoriaId: string; usuarioId: string; pasos: string[]; responsable: string | null }) {
  if (!d.pasos.length) throw new ErrorAuditoria("Escribe el paso.");
  const [{ orden }] = await tx<{ orden: number }[]>`SELECT COALESCE(max(orden), -1) + 1 AS orden FROM auditoria_pasos WHERE auditoria_id = ${d.auditoriaId}`;
  let o = orden;
  for (const p of d.pasos) {
    await tx`INSERT INTO auditoria_pasos (empresa_id, auditoria_id, orden, descripcion, responsable_id, creado_por) VALUES (${d.empresaId}, ${d.auditoriaId}, ${o++}, ${p}, ${d.responsable}, ${d.usuarioId})`;
  }
}

export async function marcarPaso(tx: Tx, d: { id: string; auditoriaId: string; estado: string; nota: string; usuarioId: string }) {
  if (!(d.estado in ESTADOS_PASO)) throw new ErrorAuditoria("Elige el estado del paso.");
  if (d.nota.length > 1000) throw new ErrorAuditoria("La nota puede tener hasta 1,000 letras.");
  if (d.estado === "no_aplica" && d.nota.trim().length < 3) throw new ErrorAuditoria("«No aplica»: escribe en la nota por qué.");
  const hecho = d.estado !== "pendiente";
  const r = await tx`
    UPDATE auditoria_pasos SET estado = ${d.estado}, nota = ${d.nota}, hecho_por = ${hecho ? d.usuarioId : null}, hecho_en = ${hecho ? new Date() : null}
     WHERE id = ${d.id} AND auditoria_id = ${d.auditoriaId}`;
  if (!r.count) throw new ErrorAuditoria("Ese paso no existe.");
}

export async function quitarPaso(tx: Tx, id: string, auditoriaId: string) {
  const [p] = await tx<{ estado: string }[]>`SELECT estado FROM auditoria_pasos WHERE id = ${id} AND auditoria_id = ${auditoriaId}`;
  if (!p) throw new ErrorAuditoria("Ese paso no existe.");
  if (p.estado !== "pendiente") throw new ErrorAuditoria("Un paso ya hecho no se quita: déjalo como está o márcalo «No aplica» con su nota.");
  await tx`DELETE FROM auditoria_pasos WHERE id = ${id}`;
}

async function pasoValido(tx: Tx, auditoriaId: string, pasoId: string | null) {
  if (!pasoId) return;
  const [p] = await tx`SELECT 1 FROM auditoria_pasos WHERE id = ${pasoId} AND auditoria_id = ${auditoriaId}`;
  if (!p) throw new ErrorAuditoria("Ese paso no es de esta auditoría.");
}

export async function crearHallazgo(tx: Tx, d: DatosHallazgo & { empresaId: string; auditoriaId: string; usuarioId: string }): Promise<string> {
  await pasoValido(tx, d.auditoriaId, d.pasoId);
  const [{ numero }] = await tx<{ numero: number }[]>`SELECT COALESCE(max(numero), 0) + 1 AS numero FROM auditoria_hallazgos WHERE auditoria_id = ${d.auditoriaId}`;
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO auditoria_hallazgos (empresa_id, auditoria_id, numero, paso_id, titulo, situacion, criterio, causa, efecto, recomendacion, riesgo, creado_por)
    VALUES (${d.empresaId}, ${d.auditoriaId}, ${numero}, ${d.pasoId}, ${d.titulo}, ${d.situacion}, ${d.criterio}, ${d.causa}, ${d.efecto}, ${d.recomendacion}, ${d.riesgo}, ${d.usuarioId})
    RETURNING id`;
  return id;
}

export async function guardarHallazgo(tx: Tx, d: DatosHallazgo & { id: string; auditoriaId: string }) {
  await pasoValido(tx, d.auditoriaId, d.pasoId);
  const r = await tx`
    UPDATE auditoria_hallazgos SET paso_id = ${d.pasoId}, titulo = ${d.titulo}, situacion = ${d.situacion}, criterio = ${d.criterio}, causa = ${d.causa}, efecto = ${d.efecto},
                                   recomendacion = ${d.recomendacion}, riesgo = ${d.riesgo}, actualizado_en = now()
     WHERE id = ${d.id} AND auditoria_id = ${d.auditoriaId}`;
  if (!r.count) throw new ErrorAuditoria("Ese hallazgo no existe.");
}

export async function estadoDeHallazgo(tx: Tx, d: { id: string; auditoriaId: string; estado: string; respuesta: string }) {
  if (!(d.estado in ESTADOS_HALLAZGO)) throw new ErrorAuditoria("Elige el estado del hallazgo.");
  if (d.respuesta.length > 2000) throw new ErrorAuditoria("La respuesta puede tener hasta 2,000 letras.");
  if ((d.estado === "resuelto" || d.estado === "aceptado") && d.respuesta.trim().length < 3) {
    throw new ErrorAuditoria(d.estado === "resuelto" ? "Resuelto: escribe cómo se resolvió." : "Riesgo aceptado: escribe quién lo acepta y por qué.");
  }
  const r = await tx`UPDATE auditoria_hallazgos SET estado = ${d.estado}, respuesta = ${d.respuesta}, actualizado_en = now() WHERE id = ${d.id} AND auditoria_id = ${d.auditoriaId}`;
  if (!r.count) throw new ErrorAuditoria("Ese hallazgo no existe.");
}

// Retira un archivo de prueba (queda marcado como eliminado, no se borra). No se puede en una auditoría cerrada.
export async function retirarEvidencia(tx: Tx, documentoId: string, usuarioId: string) {
  const [d] = await tx<{ estado: string | null }[]>`
    SELECT COALESCE(a.estado, ah.estado) AS estado
      FROM documentos d
      LEFT JOIN auditorias a ON a.id = d.entidad_id
      LEFT JOIN auditoria_hallazgos h ON h.id = d.entidad_id LEFT JOIN auditorias ah ON ah.id = h.auditoria_id
     WHERE d.id = ${documentoId} AND d.entidad = 'auditoria' AND NOT d.eliminado`;
  if (!d) throw new ErrorAuditoria("Ese archivo ya no está.");
  if (d.estado === "cerrada") throw new ErrorAuditoria("La auditoría está cerrada: reábrela para retirar archivos.");
  await tx`UPDATE documentos SET eliminado = true, eliminado_por = ${usuarioId}, eliminado_en = now() WHERE id = ${documentoId} AND entidad = 'auditoria'`;
}
