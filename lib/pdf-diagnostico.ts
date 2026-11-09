import type { Tx } from "./db";
import { AREAS, NIVELES, type Diagnostico } from "./diagnostico.ts";
import { armarPdf } from "./exportar";
import { verFecha, verMonto } from "./montos.ts";

const VERDE = "#003D19", DORADO = "#B88A40";

// Informe de diagnóstico con la identidad de Empire (Documento maestro, sección 6): portada, resumen, hallazgos por área,
// recomendaciones y propuesta económica. Solo el aprobado.
export async function pdfDiagnostico(tx: Tx, fid: string): Promise<{ nombre: string; datos: Uint8Array<ArrayBuffer> } | null> {
  const [f] = await tx<{ diagnostico: Diagnostico | null; aprobado: Date | null; empresa: string; rnc: string | null }[]>`
    SELECT f.diagnostico, f.diagnostico_aprobado_en AS aprobado, e.nombre AS empresa, e.rnc FROM formularios f JOIN empresas e ON e.id = f.empresa_id
     WHERE f.id = ${fid} AND f.tipo = 'levantamiento'`;
  if (!f?.diagnostico || !f.aprobado) return null;
  const d = f.diagnostico, eco = d.economica!;
  const h2 = (t: string) => ({ text: t, bold: true, fontSize: 14, color: VERDE, margin: [0, 16, 0, 6] });
  const tabla = (widths: unknown[], cab: string[], filas: unknown[][]) => ({
    table: { headerRows: 1, widths, body: [cab.map((t) => ({ text: t, bold: true, color: "#ffffff", fillColor: VERDE })), ...filas] },
    layout: { hLineWidth: (i: number) => (i === 1 ? 0.8 : 0.3), vLineWidth: () => 0, hLineColor: (i: number) => (i === 1 ? DORADO : "#cccccc"), paddingTop: () => 4, paddingBottom: () => 4 },
  });
  const orden = (p: string) => Object.keys(NIVELES).indexOf(p);
  const areas = AREAS.map((a) => ({ a, h: d.hallazgos.filter((x) => x.area === a).sort((x, y) => orden(x.prioridad) - orden(y.prioridad)) })).filter((x) => x.h.length);
  const m = (v: string) => ({ text: verMonto(v), alignment: "right" });
  const contenido = [
    { canvas: [{ type: "rect", x: 0, y: 0, w: 548, h: 220, color: VERDE }, { type: "rect", x: 0, y: 220, w: 548, h: 5, color: DORADO }] },
    { text: "EMPIRE TAX’N LEGAL", bold: true, color: "#ffffff", fontSize: 13, characterSpacing: 2, absolutePosition: { x: 64, y: 90 } },
    { text: "Informe de diagnóstico", bold: true, color: "#ffffff", fontSize: 30, absolutePosition: { x: 64, y: 130 } },
    { text: "y propuesta de servicios", color: "#ffffff", fontSize: 16, absolutePosition: { x: 64, y: 172 } },
    { text: f.empresa, bold: true, fontSize: 20, margin: [16, 48, 0, 4] },
    ...(f.rnc ? [{ text: `RNC ${f.rnc}`, fontSize: 12, margin: [16, 0, 0, 4] }] : []),
    { text: verFecha(f.aprobado), fontSize: 12, color: "#666666", margin: [16, 0, 0, 0] },
    { text: "Documento confidencial, preparado para uso exclusivo del cliente.", italics: true, color: "#666666", margin: [16, 260, 0, 0] },
    { text: "Resumen", bold: true, fontSize: 14, color: VERDE, pageBreak: "before", margin: [0, 0, 0, 6] },
    { text: d.resumen, lineHeight: 1.3 },
    tabla(["*", "auto"], ["Situación financiera inicial", "RD$"], [
      ["Total de activos", m(eco.activos)], ["Total de pasivos", m(eco.pasivos)], ["Patrimonio", m(eco.patrimonio)],
      ...(eco.resultado ? [["Resultado mensual estimado", m(eco.resultado)]] : []), ...(eco.margen ? [["Margen de ganancia", { text: eco.margen, alignment: "right" }]] : []),
    ]),
    h2("Hallazgos y recomendaciones por área"),
    ...areas.flatMap(({ a, h }) => [
      { text: a, bold: true, fontSize: 11, margin: [0, 8, 0, 4] },
      tabla(["*", "*", 44], ["Hallazgo", "Recomendación", "Prioridad"], h.map((x) => [x.hallazgo, x.recomendacion, NIVELES[x.prioridad]])),
    ]),
    ...(areas.length ? [] : [{ text: "No se identificaron hallazgos." }]),
    h2("Propuesta económica"),
    ...(eco.lineas.length ? [tabla(["*", "auto"], ["Servicios iniciales", "RD$"], [...eco.lineas.map((l) => [l.descripcion, m(l.precio)]), [{ text: "Total", bold: true }, { ...m(eco.total), bold: true }]])] : []),
    ...(eco.iguala ? [{ text: [{ text: "Iguala mensual: ", bold: true }, `RD$${verMonto(eco.iguala)}. Cubre el cumplimiento fiscal básico; los demás servicios se cotizan aparte.`], margin: [0, 10, 0, 0] }] : []),
    { text: "Los precios no incluyen ITBIS. Si el servicio requiere comprobante con valor fiscal, se suma el 18 %.", italics: true, color: "#666666", margin: [0, 10, 0, 0] },
  ];
  const datos = await armarPdf({
    pageSize: "LETTER", pageMargins: [32, 40, 32, 40], defaultStyle: { font: "Helvetica", fontSize: 9 }, info: { title: `Diagnóstico · ${f.empresa}`, creator: "Empire Tax’N Legal" }, content: contenido,
    footer: (actual: number, total: number) => actual === 1 ? null : ({ columns: [{ text: "Empire Tax’N Legal", color: VERDE }, { text: `Página ${actual} de ${total}`, alignment: "right", color: "#666666" }], margin: [32, 10, 32, 0], fontSize: 7 }),
  });
  return { nombre: `diagnostico-${f.rnc ?? "cliente"}.pdf`, datos: new Uint8Array(datos) };
}
