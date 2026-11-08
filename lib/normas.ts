import { conEmpresa, db, type Tx } from "./db";
import { agrupar, avisosDeNormas, FORMATOS_CALENDARIO, type AvisoNorma, type Concepto, type FilaTasa, type Prorroga } from "./normas-reglas.ts";

export * from "./normas-reglas.ts";

export type Empresa = { id: string; nombre: string; propia: boolean };

// Todas las empresas de la firma, la propia incluida (también lleva tasas).
export const empresasDeFirma = (firmaId: string) => db()<Empresa[]>`
  SELECT e.id, e.nombre, e.id = f.empresa_propia_id AS propia FROM empresas e JOIN firmas f ON f.id = e.firma_id
   WHERE e.firma_id = ${firmaId} ORDER BY (e.id = f.empresa_propia_id) DESC, e.nombre`;

const filasDe = (tx: Tx) => tx<FilaTasa[]>`
  SELECT 'impuesto' AS clase, nombre, tipo, tasa::text AS tasa, vigente_desde::text AS desde, vigente_hasta::text AS hasta, activo FROM impuestos
  UNION ALL
  SELECT 'retencion', nombre, impuesto, tasa::text, vigente_desde::text, vigente_hasta::text, activo FROM retenciones`;

export async function tasasDeFirma(empresas: { id: string; nombre: string }[]): Promise<Concepto[]> {
  const listas = await Promise.all(empresas.map(async (e) => ({ empresa: { id: e.id, nombre: e.nombre }, filas: await conEmpresa(e.id, filasDe) })));
  return agrupar(listas);
}

export type Dia = { formato: string; dia: number; norma: string | null; cambiado_por: string | null; cambiado_en: Date | null };
export type Revision = { id: string; fecha: string; revisado: string; hubo_cambios: boolean; archivo_nombre: string | null; por: string | null };

export async function normasDeFirma(firmaId: string) {
  const [calendario, prorrogas, revisiones, historial, [firma]] = await Promise.all([
    db()<Dia[]>`SELECT formato, dia, norma, cambiado_por, cambiado_en FROM calendario_fiscal WHERE firma_id = ${firmaId}`,
    db()<Prorroga[]>`SELECT id, formato, periodo, vence::text, motivo, creado_por FROM prorrogas_fiscales WHERE firma_id = ${firmaId} ORDER BY periodo DESC, formato`,
    db()<Revision[]>`SELECT r.id, r.fecha::text, r.revisado, r.hubo_cambios, r.archivo_nombre, u.nombre AS por
                       FROM revisiones_normas r LEFT JOIN usuarios u ON u.id = r.por WHERE r.firma_id = ${firmaId} ORDER BY r.fecha DESC, r.creado DESC`,
    db()<{ fecha: Date; que: string; por: string | null }[]>`
      SELECT h.fecha, h.que, u.nombre AS por FROM historial_normas h LEFT JOIN usuarios u ON u.id = h.por WHERE h.firma_id = ${firmaId} ORDER BY h.fecha DESC LIMIT 60`,
    db()<{ responsable_id: string | null; responsable: string | null }[]>`
      SELECT f.responsable_normas_id AS responsable_id, u.nombre AS responsable FROM firmas f LEFT JOIN usuarios u ON u.id = f.responsable_normas_id WHERE f.id = ${firmaId}`,
  ]);
  const orden = (f: string) => FORMATOS_CALENDARIO.indexOf(f as (typeof FORMATOS_CALENDARIO)[number]);
  return { calendario: calendario.sort((a, b) => orden(a.formato) - orden(b.formato)), prorrogas, revisiones, historial, ...firma };
}

export const anotar = (firmaId: string, usuarioId: string, que: string) =>
  db()`INSERT INTO historial_normas (firma_id, por, que) VALUES (${firmaId}, ${usuarioId}, ${que.slice(0, 1000)})`;

// Avisos para el Inicio y las Alertas de la firma; los ven los administradores (y quien sea responsable de las normas).
export async function avisosNormasDeFirma(firmaId: string, hoy: string, usuarioId: string, administrador: boolean): Promise<AvisoNorma[]> {
  const [f] = await db()<{ responsable_id: string | null; responsable: string | null; ultima: string | null }[]>`
    SELECT f.responsable_normas_id AS responsable_id, u.nombre AS responsable,
           (SELECT max(fecha)::text FROM revisiones_normas WHERE firma_id = f.id) AS ultima
      FROM firmas f LEFT JOIN usuarios u ON u.id = f.responsable_normas_id WHERE f.id = ${firmaId}`;
  if (!f || (!administrador && f.responsable_id !== usuarioId)) return [];
  const [empresas, prorrogas] = await Promise.all([
    empresasDeFirma(firmaId),
    db()<Prorroga[]>`SELECT id, formato, periodo, vence::text, motivo, creado_por FROM prorrogas_fiscales WHERE firma_id = ${firmaId} AND vence >= ${hoy}`,
  ]);
  const conceptos = await tasasDeFirma(empresas);
  return avisosDeNormas({ firmaId, hoy, conceptos, prorrogas, ultimaRevision: f.ultima, responsable: f.responsable });
}
