import { armarAnalisis, GRUPOS, NOMBRES_GRUPO, observacionesDe, PREGUNTA_GRUPO, verCambio, verRazon, type Comparativo, type Valor, COMPARATIVOS } from "./analisis-financiero.ts";
import type { Tx } from "./db";
import { armarPdf } from "./exportar.ts";
import { imagenLegible } from "./imagenes-pdf.ts";
import { verFecha } from "./montos.ts";

const VERDE = "#003D19", DORADO = "#B88A40";

// El logo del cliente, el de su ficha (PNG o JPG), como imagen para el PDF. Sin logo, o con un logo dañado, el informe sale sin él.
export async function logoDe(tx: Tx, empresaId: string): Promise<string | null> {
  const [l] = await tx<{ tipo: string; contenido: Buffer }[]>`
    SELECT tipo, contenido FROM documentos WHERE entidad = 'empresa' AND entidad_id = ${empresaId} AND descripcion = 'logo' AND NOT eliminado
     ORDER BY subido_en DESC LIMIT 1`;
  if (!l || (l.tipo !== "image/png" && l.tipo !== "image/jpeg")) return null;
  // El tipo se aceptó al subirlo por sus primeros bytes: una imagen dañada hace fallar al generador de PDF sin remedio, así que aquí se comprueba que se pueda leer (sin logo, el PDF sale sin él).
  if (!imagenLegible(l.tipo, l.contenido)) return null;
  return `data:${l.tipo};base64,${Buffer.from(l.contenido).toString("base64")}`;
}

// La letra estándar del PDF solo dibuja Latin-1 y unos pocos signos más: lo demás (emojis, el signo menos de Unicode) se cambia para que no salga garabateado.
export const limpiar = (t: string) => t.replaceAll("−", "-").replace(/[^\n\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC\u2122]/g, "?");

const texto = (v: Valor, kind: Parameters<typeof verRazon>[0]) => ("num" in v ? verRazon(kind, v.num) : "—");

// Informe de análisis financiero para el cliente: su logo, las razones por grupo con su fórmula, el comparativo y lo que la firma escribió.
export async function docAnalisis(tx: Tx, p: { empresaId: string; empresa: string; rnc: string | null; desde: string; hasta: string; comparar: Comparativo; preparadoPor: string }) {
  const [analisis, obs, logo] = await Promise.all([armarAnalisis(tx, p.desde, p.hasta, p.comparar), observacionesDe(tx, p.desde, p.hasta), logoDe(tx, p.empresaId)]);
  const dos = analisis.columnas.length === 2;
  const h2 = (t: string) => ({ text: t, bold: true, fontSize: 12, color: VERDE, margin: [0, 14, 0, 2] });
  const cabecera = (t: string, alinear = "right") => ({ text: t, bold: true, color: "#ffffff", fillColor: VERDE, alignment: alinear });

  const grupos = GRUPOS.map((g) => {
    const razones = analisis.razones.filter((r) => r.grupo === g);
    const t = obs.textos[g];
    // Cada grupo va completo en una página: el título no se queda solo al pie.
    return { unbreakable: true, stack: [
      h2(NOMBRES_GRUPO[g]),
      { text: PREGUNTA_GRUPO[g], italics: true, color: "#666666", margin: [0, 0, 0, 4] },
      {
        table: {
          headerRows: 1, widths: ["*", ...analisis.columnas.map(() => "auto"), ...(dos ? ["auto"] : [])],
          body: [
            [cabecera("Razón", "left"), ...analisis.columnas.map((c) => cabecera(c.titulo)), ...(dos ? [cabecera("Cambio")] : [])],
            ...razones.map((r) => [
              { stack: [{ text: r.nombre, bold: true }, { text: limpiar(r.formula), fontSize: 7, color: "#555555" }] },
              ...r.valores.map((v) => ({ text: texto(v, r.kind), alignment: "right" })),
              ...(dos ? [{ text: "num" in r.valores[0] && "num" in r.valores[1] ? verCambio(r.kind, r.valores[0].num, r.valores[1].num) : "—", alignment: "right" }] : []),
            ]),
          ],
        },
        layout: { hLineWidth: (i: number) => (i === 1 ? 0.8 : 0.3), vLineWidth: () => 0, hLineColor: (i: number) => (i === 1 ? DORADO : "#cccccc"), paddingTop: () => 3, paddingBottom: () => 3 },
      },
      ...(t.observaciones ? [{ text: [{ text: "Observaciones: ", bold: true }, limpiar(t.observaciones)], margin: [0, 6, 0, 0], lineHeight: 1.2 }] : []),
      ...(t.sugerencias ? [{ text: [{ text: "Sugerencias: ", bold: true }, limpiar(t.sugerencias)], margin: [0, 4, 0, 0], lineHeight: 1.2 }] : []),
    ] };
  });

  const avisos = [
    ...(analisis.sinBalance.length ? [`Faltan los saldos del balance al ${analisis.sinBalance.join(" y al ")}: las razones que los usan no se calcularon.`] : []),
    ...(analisis.noCuadra.length ? [`El balance de ${analisis.noCuadra.join(" y de ")} no cuadra: revisar antes de usar estas razones.`] : []),
  ];

  const contenido = [
    { columns: [
      ...(logo ? [{ image: logo, fit: [110, 60], width: 110 }] : []),
      { stack: [{ text: limpiar(p.empresa), bold: true, fontSize: 16 }, ...(p.rnc ? [{ text: `RNC ${p.rnc}`, color: "#555555" }] : [])], margin: [logo ? 14 : 0, 6, 0, 0] },
    ] },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 548, y2: 0, lineWidth: 2, lineColor: DORADO }], margin: [0, 10, 0, 8] },
    { text: "Análisis financiero", bold: true, fontSize: 20, color: VERDE },
    { text: `Del ${verFecha(p.desde)} al ${verFecha(p.hasta)} · ${COMPARATIVOS[p.comparar]}`, margin: [0, 2, 0, 0] },
    ...avisos.map((a) => ({ text: a, color: "#8a5a00", margin: [0, 6, 0, 0] })),
    ...grupos,
    ...(obs.textos.general ? [{ unbreakable: true, stack: [h2("Conclusión"), { text: limpiar(obs.textos.general), lineHeight: 1.25 }] }] : []),
    { text: "Cómo leer este informe", bold: true, color: VERDE, margin: [0, 16, 0, 2] },
    { text: "Los saldos del balance son los del cierre de cada período, no promedios. La rentabilidad y las rotaciones son del período, sin llevarlas a un año: para compararlas, usa períodos del mismo largo. Cada razón muestra su fórmula; si falta un dato, no se calcula y se muestra «—».", color: "#555555", fontSize: 8, lineHeight: 1.2 },
    { text: limpiar(`Preparado por ${p.preparadoPor} · Empire Tax & Legal`), italics: true, color: "#666666", margin: [0, 10, 0, 0], fontSize: 8 },
  ];

  const doc = {
    pageSize: "LETTER", pageMargins: [32, 40, 32, 44], defaultStyle: { font: "Helvetica", fontSize: 9 },
    info: { title: limpiar(`Análisis financiero · ${p.empresa}`), creator: "Empire Tax & Legal" }, content: contenido,
    footer: (actual: number, total: number) => ({ columns: [{ text: "Empire Tax & Legal", color: VERDE }, { text: `Página ${actual} de ${total}`, alignment: "right", color: "#666666" }], margin: [32, 10, 32, 0], fontSize: 7 }),
  };
  return { nombre: `analisis-financiero-${p.rnc ?? "cliente"}-${p.hasta}.pdf`, doc };
}

// El PDF ya armado.
export async function pdfAnalisis(tx: Tx, p: Parameters<typeof docAnalisis>[1]) {
  const { nombre, doc } = await docAnalisis(tx, p);
  return { nombre, datos: new Uint8Array(await armarPdf(doc)) };
}
