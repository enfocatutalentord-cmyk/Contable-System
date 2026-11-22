import { CAMPOS_HALLAZGO, detalleAuditoria, ESTADOS, ESTADOS_HALLAZGO, ESTADOS_PASO, RIESGOS, type DetalleAuditoria } from "./auditorias.ts";
import type { Tx } from "./db";
import { armarPdf } from "./exportar.ts";
import { verFecha } from "./montos.ts";
import { imagenLegible } from "./imagenes-pdf.ts";
import { limpiar, logoDe } from "./pdf-analisis.ts";

export { imagenLegible };

// Prioridad 3 · P3k · Informe final de auditoría en PDF: el logo del cliente, el objetivo y el alcance, un resumen de hallazgos, los pasos que se hicieron, cada hallazgo
// con sus cinco campos y sus fotos, y la línea de firmas de la firma. Si la auditoría todavía no está cerrada, sale marcado como borrador.

const VERDE = "#003D19", DORADO = "#B88A40";
const COLOR_RIESGO: Record<string, string> = { alto: "#b3261e", medio: "#8a5a00", bajo: "#1b6b3a" };
export const MAX_FOTOS_POR_HALLAZGO = 6;
const MAX_CARGA_FOTOS = 16 * 1024 * 1024; // tope de fotos (en base64) dentro de un mismo informe

export type ParametrosAuditoria = {
  empresa: string; rnc: string | null; firma: string; preparadoPor: string;
  logo: string | null; imagenes: Map<string, string>; // id del documento → imagen en base64
};

const rango = (a: string | null, b: string | null) => (a || b ? `${a ? verFecha(a) : "…"} al ${b ? verFecha(b) : "…"}` : "sin fechas");
const t = (s: string) => limpiar(s);

export function docAuditoria(a: DetalleAuditoria, p: ParametrosAuditoria) {
  const borrador = a.estado !== "cerrada";
  const h2 = (x: string) => ({ text: x, bold: true, fontSize: 12, color: VERDE, margin: [0, 14, 0, 3] });
  const cab = (x: string, alinear = "left") => ({ text: x, bold: true, color: "#ffffff", fillColor: VERDE, alignment: alinear });
  const layout = { hLineWidth: (i: number) => (i === 1 ? 0.8 : 0.3), vLineWidth: () => 0, hLineColor: (i: number) => (i === 1 ? DORADO : "#cccccc"), paddingTop: () => 3, paddingBottom: () => 3 };

  const porRiesgo = (r: string) => a.hallazgos.filter((h) => h.riesgo === r).length;
  const abiertos = a.hallazgos.filter((h) => h.estado === "abierto" || h.estado === "en_seguimiento").length;
  const pasosHechos = a.pasos.filter((s) => s.estado === "hecho").length;
  const pasosNoAplica = a.pasos.filter((s) => s.estado === "no_aplica").length;

  const datos = [
    ["Número", `Auditoría n.º ${a.numero}`],
    ["Estado", `${ESTADOS[a.estado]}${a.cerrada_en && a.cerrada_por ? ` · ${a.cerrada_por}, ${a.cerrada_en.toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo" })}` : ""}`],
    ["Período auditado", rango(a.periodo_desde, a.periodo_hasta)],
    ["Trabajo de campo", rango(a.fecha_inicio, a.fecha_fin)],
    ["Responsable", a.responsable ?? "Sin asignar"],
    ["Equipo", a.equipo_nombres.length ? a.equipo_nombres.join(", ") : "—"],
  ];

  // Fotos de un hallazgo: las que se pueden dibujar (hasta el tope por hallazgo y por informe) y cuáles quedaron sin dibujar.
  let carga = 0;
  const fotosDe = (ev: { id: string; nombre: string }[]) => {
    const columnas: { image: string; fit: number[]; margin: number[] }[] = [];
    const usadas = new Set<string>();
    for (const e of ev) {
      const img = p.imagenes.get(e.id);
      if (!img || columnas.length >= MAX_FOTOS_POR_HALLAZGO || carga + img.length > MAX_CARGA_FOTOS) continue;
      carga += img.length;
      columnas.push({ image: img, fit: [240, 170], margin: [0, 0, 8, 6] });
      usadas.add(e.id);
    }
    return { columnas, sinDibujar: ev.filter((e) => !usadas.has(e.id)) };
  };

  const hallazgos = a.hallazgos.map((h) => {
    const { columnas: fotos, sinDibujar } = fotosDe(h.evidencias);
    return { stack: [
      { text: t(`Hallazgo ${h.numero} · ${h.titulo}`), bold: true, fontSize: 11, margin: [0, 12, 0, 1], keepWithNext: true },
      { text: [{ text: `Riesgo ${RIESGOS[h.riesgo].toLowerCase()}`, bold: true, color: COLOR_RIESGO[h.riesgo] }, `  ·  ${ESTADOS_HALLAZGO[h.estado]}${h.paso ? `  ·  Paso del plan: ${t(h.paso)}` : ""}`], color: "#555555", margin: [0, 0, 0, 3], keepWithNext: true },
      ...CAMPOS_HALLAZGO.filter((c) => h[c.clave].trim()).map((c) => ({ text: [{ text: `${c.nombre}: `, bold: true }, t(h[c.clave])], margin: [0, 2, 0, 0], lineHeight: 1.2 })),
      ...(h.respuesta.trim() ? [{ text: [{ text: "Respuesta o cierre: ", bold: true }, t(h.respuesta)], margin: [0, 2, 0, 0], lineHeight: 1.2 }] : []),
      ...(fotos.length ? [{ text: "Pruebas", bold: true, margin: [0, 6, 0, 3] }, ...Array.from({ length: Math.ceil(fotos.length / 2) }, (_, i) => ({ columns: fotos.slice(i * 2, i * 2 + 2), columnGap: 0 }))] : []),
      ...(sinDibujar.length ? [{ text: `Otros archivos de prueba: ${sinDibujar.map((e) => t(e.nombre)).join(", ")}`, color: "#555555", fontSize: 8, margin: [0, 2, 0, 0] }] : []),
    ] };
  });

  const contenido = [
    { columns: [
      ...(p.logo ? [{ image: p.logo, fit: [110, 60], width: 110 }] : []),
      { stack: [{ text: t(p.empresa), bold: true, fontSize: 16 }, ...(p.rnc ? [{ text: `RNC ${p.rnc}`, color: "#555555" }] : [])], margin: [p.logo ? 14 : 0, 6, 0, 0] },
    ] },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 548, y2: 0, lineWidth: 2, lineColor: DORADO }], margin: [0, 10, 0, 8] },
    { text: "Informe de auditoría", bold: true, fontSize: 20, color: VERDE },
    { text: t(a.nombre), fontSize: 12, margin: [0, 2, 0, 0] },
    ...(borrador ? [{ text: `BORRADOR · la auditoría está «${ESTADOS[a.estado]}» y el informe puede cambiar.`, bold: true, color: "#8a5a00", margin: [0, 6, 0, 0] }] : []),
    { table: { widths: [110, "*"], body: datos.map(([k, v]) => [{ text: k, bold: true, color: "#555555" }, { text: t(v) }]) }, layout: "noBorders", margin: [0, 10, 0, 0] },

    h2("Objetivo"), { text: t(a.objetivo) || "Sin escribir.", lineHeight: 1.25 },
    h2("Alcance"), { text: t(a.alcance) || "Sin escribir.", lineHeight: 1.25 },

    h2("Resumen"),
    { text: `Se hicieron ${pasosHechos} de ${a.pasos.length} pasos del plan${pasosNoAplica ? ` (y ${pasosNoAplica} quedaron como «No aplica»)` : ""}. Hallazgos: ${a.hallazgos.length} en total, ${abiertos} abiertos o en seguimiento; ${porRiesgo("alto")} de riesgo alto, ${porRiesgo("medio")} medio y ${porRiesgo("bajo")} bajo.`, lineHeight: 1.25 },
    ...(a.hallazgos.length ? [{
      unbreakable: true, margin: [0, 6, 0, 0],
      table: { headerRows: 1, widths: [24, "*", 50, 90], body: [
        [cab("N.º"), cab("Hallazgo"), cab("Riesgo"), cab("Estado")],
        ...a.hallazgos.map((h) => [{ text: String(h.numero) }, { text: t(h.titulo) }, { text: RIESGOS[h.riesgo], color: COLOR_RIESGO[h.riesgo], bold: true }, { text: ESTADOS_HALLAZGO[h.estado] }]),
      ] },
      layout,
    }] : [{ text: "No hubo hallazgos.", color: "#555555", margin: [0, 4, 0, 0] }]),

    h2("Procedimientos realizados"),
    ...(a.pasos.length ? [{
      table: { headerRows: 1, widths: ["*", 62, 120], body: [
        [cab("Paso"), cab("Estado"), cab("Nota")],
        ...a.pasos.map((s) => [{ text: t(s.descripcion) }, { text: ESTADOS_PASO[s.estado] }, { text: t(s.nota) || "—", color: "#555555" }]),
      ] },
      layout,
    }] : [{ text: "El plan no tiene pasos.", color: "#555555" }]),

    ...(a.hallazgos.length ? [h2("Hallazgos y recomendaciones"), ...hallazgos] : []),

    ...(a.evidencias.length ? [h2("Otros archivos de la auditoría"), { text: a.evidencias.map((e) => t(e.nombre)).join(", "), color: "#555555" }] : []),

    // Línea de firmas: quien hizo la auditoría y quien la aprueba, con el nombre de la firma.
    { unbreakable: true, margin: [0, 36, 0, 0], stack: [
      { columns: [
        { stack: [{ canvas: [{ type: "line", x1: 0, y1: 0, x2: 230, y2: 0, lineWidth: 0.7 }] }, { text: "Auditor responsable", bold: true, margin: [0, 3, 0, 0] }, { text: t(a.responsable ?? ""), color: "#555555" }] },
        { stack: [{ canvas: [{ type: "line", x1: 0, y1: 0, x2: 230, y2: 0, lineWidth: 0.7 }] }, { text: "Aprobado por", bold: true, margin: [0, 3, 0, 0] }, { text: t(p.firma), color: "#555555" }] },
      ] },
    ] },
    { text: t(`Preparado por ${p.preparadoPor} · ${p.firma} · Empire Tax & Legal`), italics: true, color: "#666666", margin: [0, 12, 0, 0], fontSize: 8 },
  ];

  const doc = {
    pageSize: "LETTER", pageMargins: [32, 40, 32, 44], defaultStyle: { font: "Helvetica", fontSize: 9 },
    info: { title: t(`Informe de auditoría · ${p.empresa} · ${a.nombre}`), creator: "Empire Tax & Legal" }, content: contenido,
    footer: (actual: number, total: number) => ({ columns: [{ text: borrador ? "Empire Tax & Legal · BORRADOR" : "Empire Tax & Legal", color: VERDE }, { text: `Página ${actual} de ${total}`, alignment: "right", color: "#666666" }], margin: [32, 10, 32, 0], fontSize: 7 }),
  };
  return { nombre: `informe-auditoria-${p.rnc ?? "cliente"}-n${a.numero}${borrador ? "-borrador" : ""}.pdf`, doc };
}

// Carga la auditoría, el logo y las fotos del cliente (JPG o PNG) y arma el PDF.
export async function pdfAuditoria(tx: Tx, p: { empresaId: string; auditoriaId: string; empresa: string; rnc: string | null; firma: string; preparadoPor: string }) {
  const a = await detalleAuditoria(tx, p.auditoriaId);
  if (!a) return null;
  const ids = [a.id, ...a.hallazgos.map((h) => h.id)];
  const fotos = await tx<{ id: string; tipo: string; contenido: Buffer }[]>`
    SELECT id, tipo, contenido FROM documentos WHERE entidad = 'auditoria' AND entidad_id IN ${tx(ids)} AND NOT eliminado AND tipo IN ('image/png', 'image/jpeg') ORDER BY subido_en`;
  const imagenes = new Map(fotos.filter((f) => imagenLegible(f.tipo, f.contenido)).map((f) => [f.id, `data:${f.tipo};base64,${Buffer.from(f.contenido).toString("base64")}`]));
  const { nombre, doc } = docAuditoria(a, { empresa: p.empresa, rnc: p.rnc, firma: p.firma, preparadoPor: p.preparadoPor, logo: await logoDe(tx, p.empresaId), imagenes });
  return { nombre, datos: new Uint8Array(await armarPdf(doc)) };
}
