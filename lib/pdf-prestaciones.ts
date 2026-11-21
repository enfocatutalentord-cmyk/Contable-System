import { DECISIONES, FUENTE, REGLAS, TERMINACIONES, type Entrada, type Resultado } from "./prestaciones.ts";
import { armarPdf } from "./exportar.ts";
import { limpiar } from "./pdf-analisis.ts";
import { deCentavos, verFecha, verMonto } from "./montos.ts";

const VERDE = "#003D19", DORADO = "#B88A40";

// Hoja de cálculo de prestaciones laborales: el empleado, cada concepto con su artículo y su fórmula, el total y las reglas aplicadas.
export function docPrestaciones(p: { empresa: string; rnc: string | null; entrada: Entrada; resultado: Resultado; preparadoPor: string; logo: string | null }) {
  const { entrada: e, resultado: r } = p;
  const h2 = (t: string) => ({ text: t, bold: true, fontSize: 12, color: VERDE, margin: [0, 14, 0, 4] });
  const cab = (t: string, alinear = "left") => ({ text: t, bold: true, color: "#ffffff", fillColor: VERDE, alignment: alinear });
  const linea = { hLineWidth: (i: number) => (i === 1 ? 0.8 : 0.3), vLineWidth: () => 0, hLineColor: (i: number) => (i === 1 ? DORADO : "#cccccc"), paddingTop: () => 3, paddingBottom: () => 3 };
  const dato = (k: string, v: string) => [{ text: k, bold: true }, { text: limpiar(v) }];

  const contenido = [
    { columns: [
      ...(p.logo ? [{ image: p.logo, fit: [110, 60], width: 110 }] : []),
      { stack: [{ text: limpiar(p.empresa), bold: true, fontSize: 16 }, ...(p.rnc ? [{ text: `RNC ${p.rnc}`, color: "#555555" }] : [])], margin: [p.logo ? 14 : 0, 6, 0, 0] },
    ] },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 548, y2: 0, lineWidth: 2, lineColor: DORADO }], margin: [0, 10, 0, 8] },
    { text: "Cálculo de prestaciones laborales", bold: true, fontSize: 20, color: VERDE },
    { text: `${limpiar(e.nombre)} · ${TERMINACIONES[e.terminacion].nombre}`, margin: [0, 2, 0, 6] },
    { table: { widths: [130, "*"], body: [
      dato("Fecha de ingreso", verFecha(e.ingreso)), dato("Último día trabajado", verFecha(e.termino)), dato("Antigüedad", r.antiguedad),
      dato("Salario mensual", `RD$${verMonto(deCentavos(e.sueldo))}`), dato("Salario diario (÷ 23.83)", `RD$${verMonto(r.salarioDiario)}`),
      ...(e.promedio !== null ? [dato("Promedio del último año", `RD$${verMonto(deCentavos(e.promedio))}`), dato("Salario diario con el promedio", `RD$${verMonto(r.salarioDiarioPromedio)}`)] : []),
    ] }, layout: "noBorders" },
    h2("Cálculo"),
    { table: { headerRows: 1, widths: ["auto", 62, 26, "*", "auto"], body: [
      [cab("Concepto"), cab("Artículos"), cab("Días", "right"), cab("Cómo se calcula"), cab("RD$", "right")],
      ...r.conceptos.map((c) => [
        { text: c.nombre, bold: true },
        { text: c.articulos, fontSize: 7 },
        { text: c.dias === null ? "" : String(c.dias), alignment: "right" },
        { stack: [{ text: limpiar(c.formula) }, ...(c.nota ? [{ text: limpiar(c.nota), italics: true, color: "#666666", fontSize: 7 }] : [])] },
        { text: verMonto(c.monto), alignment: "right" },
      ]),
      [{ text: "Total", bold: true, colSpan: 4 }, {}, {}, {}, { text: verMonto(r.total), bold: true, alignment: "right" }],
    ] }, layout: linea },
    { text: `Plazo de pago (Art. 86): hasta el ${verFecha(r.fechaLimite)}. Cada día de retraso suma un día de salario (RD$${verMonto(r.recargoDiario)}).`, margin: [0, 8, 0, 0] },
    ...(r.advertencias.length ? [h2("Para tener en cuenta"), { ul: r.advertencias.map((x) => ({ text: limpiar(x), color: "#8a5a00" })), margin: [0, 0, 0, 0] }] : []),
    { unbreakable: true, stack: [
      h2("Reglas aplicadas"),
      { ul: REGLAS.map((x) => ({ text: [{ text: `${x.articulo} · ${x.titulo}: `, bold: true }, limpiar(x.texto)], fontSize: 8, margin: [0, 0, 0, 2] })) },
    ] },
    { unbreakable: true, stack: [
      h2("Cómo se resolvieron los puntos dudosos"),
      { ul: DECISIONES.map((x) => ({ text: limpiar(x), fontSize: 8, margin: [0, 0, 0, 2] })) },
      { text: `Fuente: ${FUENTE}.`, fontSize: 7, color: "#666666", margin: [0, 6, 0, 0] },
    ] },
    { columns: [
      { stack: [{ text: "", margin: [0, 40, 0, 0] }, { canvas: [{ type: "line", x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.6 }] }, { text: limpiar(`Preparado por ${p.preparadoPor}`), bold: true, margin: [0, 4, 0, 0] }, { text: "Empire Tax & Legal", color: "#444444" }] },
    ], margin: [0, 10, 0, 0], unbreakable: true },
  ];

  return {
    nombre: `prestaciones-${e.nombre.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "empleado"}-${e.termino}.pdf`,
    doc: {
      pageSize: "LETTER", pageMargins: [32, 40, 32, 44], defaultStyle: { font: "Helvetica", fontSize: 9 },
      info: { title: limpiar(`Prestaciones laborales · ${e.nombre}`), creator: "Empire Tax & Legal" }, content: contenido,
      footer: (actual: number, total: number) => ({ columns: [{ text: "Empire Tax & Legal", color: VERDE }, { text: `Página ${actual} de ${total}`, alignment: "right", color: "#666666" }], margin: [32, 10, 32, 0], fontSize: 7 }),
    },
  };
}

export async function pdfPrestaciones(p: Parameters<typeof docPrestaciones>[0]) {
  const { nombre, doc } = docPrestaciones(p);
  return { nombre, datos: new Uint8Array(await armarPdf(doc)) };
}
