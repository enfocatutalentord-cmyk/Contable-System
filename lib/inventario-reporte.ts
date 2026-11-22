import { deTexto, ESCALA, verCantidad } from "./inventario.ts";
import type { Tx } from "./db.ts";
import { armarPdf, type Tabla } from "./exportar.ts";
import { deCentavos, verFecha, verMonto } from "./montos.ts";
import { limpiar, logoDe } from "./pdf-analisis.ts";

// Prioridad 3 · P3m · Reporte de diferencias del conteo de inventario: por artículo lo que decía el listado del cliente, lo contado y la diferencia en cantidad y, si el listado trae
// costo, en pesos (diferencia × costo). Los códigos que se contaron y no estaban en el listado salen aparte, sin valorar. Solo de un conteo cerrado (así no se ve la existencia
// mientras se cuenta). Todo en enteros (bigint), sin floats.

const E4 = 10n ** BigInt(ESCALA);

// cantidad (4 decimales) × costo (4 decimales) = pesos con 8 decimales → centavos, redondeando medio centavo hacia afuera del cero.
export function valorEnCentavos(cantidad: bigint, costo: bigint): bigint {
  const bruto = cantidad * costo, base = E4 * E4 / 100n; // 10^6
  const a = bruto < 0n ? -bruto : bruto;
  const r = (a + base / 2n) / base;
  return bruto < 0n ? -r : r;
}

export type FilaDiferencia = {
  codigo: string; barras: string; nombre: string; unidad: string; existencia: bigint; contado: bigint; diferencia: bigint; lecturas: number;
  costo: bigint | null; valor: bigint | null; // valor de la diferencia en centavos (negativo = faltante); null si no hay costo
  tipo: "faltante" | "sobrante" | "igual";
};
export type ResumenDiferencias = {
  articulos: number; iguales: number; faltantes: number; sobrantes: number; sinContar: number; sinCosto: number; // sinCosto: con diferencia y sin costo (no se valoran)
  unidadesFaltantes: bigint; unidadesSobrantes: bigint; valorFaltante: bigint; valorSobrante: bigint; valorNeto: bigint; // en centavos; faltante en negativo
  valorListado: bigint; valorContado: bigint; // de los artículos con costo
  conCosto: boolean;
};
export type SinListadoReporte = { codigo: string; cantidad: bigint; lecturas: number };
export type ReporteConteo = {
  id: string; numero: number; nombre: string; ubicacion: string; fecha: string; notas: string; cerrado_por: string | null; cerrado_en: Date | null; creado_por: string;
  filas: FilaDiferencia[]; sinListado: SinListadoReporte[]; resumen: ResumenDiferencias;
};

// Las diferencias de más peso primero (por valor en pesos); lo que no tiene costo, después, por cantidad.
export function ordenarDiferencias(filas: FilaDiferencia[]): FilaDiferencia[] {
  const abs = (n: bigint) => (n < 0n ? -n : n);
  return [...filas].sort((a, b) => {
    if ((a.valor === null) !== (b.valor === null)) return a.valor === null ? 1 : -1;
    const va = a.valor === null ? abs(a.diferencia) : abs(a.valor), vb = b.valor === null ? abs(b.diferencia) : abs(b.valor);
    return va === vb ? a.codigo.localeCompare(b.codigo, "es", { numeric: true }) : va > vb ? -1 : 1;
  });
}

export function armarDiferencias(
  articulos: { codigo: string; barras: string; nombre: string; unidad: string; existencia: bigint; contado: bigint; lecturas: number; costo: bigint | null }[],
): { filas: FilaDiferencia[]; resumen: ResumenDiferencias } {
  const filas: FilaDiferencia[] = articulos.map((a) => {
    const diferencia = a.contado - a.existencia;
    return { ...a, diferencia, valor: a.costo === null ? null : valorEnCentavos(diferencia, a.costo), tipo: diferencia === 0n ? "igual" : diferencia < 0n ? "faltante" : "sobrante" };
  });
  const r: ResumenDiferencias = {
    articulos: filas.length, iguales: 0, faltantes: 0, sobrantes: 0, sinContar: filas.filter((f) => f.lecturas === 0).length, sinCosto: 0,
    unidadesFaltantes: 0n, unidadesSobrantes: 0n, valorFaltante: 0n, valorSobrante: 0n, valorNeto: 0n, valorListado: 0n, valorContado: 0n,
    conCosto: filas.some((f) => f.costo !== null),
  };
  for (const f of filas) {
    if (f.costo !== null) { r.valorListado += valorEnCentavos(f.existencia, f.costo); r.valorContado += valorEnCentavos(f.contado, f.costo); }
    if (f.tipo === "igual") { r.iguales++; continue; }
    if (f.tipo === "faltante") { r.faltantes++; r.unidadesFaltantes += -f.diferencia; if (f.valor !== null) r.valorFaltante += f.valor; }
    else { r.sobrantes++; r.unidadesSobrantes += f.diferencia; if (f.valor !== null) r.valorSobrante += f.valor; }
    if (f.valor === null) r.sinCosto++;
  }
  r.valorNeto = r.valorFaltante + r.valorSobrante;
  return { filas, resumen: r };
}

export async function reporteConteo(tx: Tx, id: string): Promise<ReporteConteo | { error: string } | null> {
  const [c] = await tx<{ id: string; numero: number; nombre: string; ubicacion: string; fecha: string; notas: string; estado: string; cerrado_por: string | null; cerrado_en: Date | null; creado_por: string }[]>`
    SELECT c.id, c.numero, c.nombre, c.ubicacion, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.notas, c.estado, k.nombre AS cerrado_por, c.cerrado_en, u.nombre AS creado_por
      FROM conteos_inventario c JOIN usuarios u ON u.id = c.creado_por LEFT JOIN usuarios k ON k.id = c.cerrado_por WHERE c.id = ${id}`;
  if (!c) return null;
  if (c.estado !== "cerrado") return { error: "El reporte sale cuando el conteo está cerrado: así no se ve lo que dice el listado mientras se cuenta." };
  const arts = await tx<{ codigo: string; barras: string; nombre: string; unidad: string; existencia: string; contado: string; lecturas: number; costo: string | null }[]>`
    SELECT a.codigo, a.barras, a.nombre, a.unidad, a.existencia::text AS existencia, COALESCE(l.contado, 0)::text AS contado, COALESCE(l.n, 0) AS lecturas, a.costo::text AS costo
      FROM conteo_articulos a
      LEFT JOIN (SELECT articulo_id, sum(cantidad) AS contado, count(*)::int AS n FROM conteo_lecturas WHERE conteo_id = ${id} AND NOT anulada GROUP BY articulo_id) l ON l.articulo_id = a.id
     WHERE a.conteo_id = ${id} ORDER BY a.orden`;
  const sin = await tx<{ codigo: string; cantidad: string; lecturas: number }[]>`
    SELECT min(codigo_leido) AS codigo, sum(cantidad)::text AS cantidad, count(*)::int AS lecturas
      FROM conteo_lecturas WHERE conteo_id = ${id} AND NOT anulada AND articulo_id IS NULL GROUP BY codigo_norm HAVING sum(cantidad) <> 0 ORDER BY min(codigo_leido)`;
  const { filas, resumen } = armarDiferencias(arts.map((a) => ({ ...a, existencia: deTexto(a.existencia), contado: deTexto(a.contado), costo: a.costo === null ? null : deTexto(a.costo) })));
  return { ...c, filas, sinListado: sin.map((s) => ({ ...s, cantidad: deTexto(s.cantidad) })), resumen };
}

const enPesos = (c: bigint) => verMonto(deCentavos(c));
const con = (n: bigint) => (n > 0n ? "+" : "") + verCantidad(n);
const num = (n: bigint) => Number(n) / Number(E4); // para las celdas de Excel (el valor exacto ya salió de los bigint)
const pesos = (c: bigint | null) => (c === null ? null : deCentavos(c));
const nombreTipo = { faltante: "Faltante", sobrante: "Sobrante", igual: "Igual" } as const;

// Lo que se ve en el encabezado y el pie de los dos formatos.
export function lineasResumen(r: ResumenDiferencias): string[] {
  const l = [
    `${r.articulos} artículos en el listado: ${r.iguales} sin diferencia, ${r.faltantes} con faltante y ${r.sobrantes} con sobrante${r.sinContar ? ` (${r.sinContar === 1 ? "1 no se contó" : `${r.sinContar} no se contaron`})` : ""}.`,
    `Faltan ${verCantidad(r.unidadesFaltantes)} y sobran ${verCantidad(r.unidadesSobrantes)} unidades.`,
  ];
  if (r.conCosto) {
    l.push(`En pesos: faltante RD$${enPesos(-r.valorFaltante)}, sobrante RD$${enPesos(r.valorSobrante)}, diferencia neta ${r.valorNeto < 0n ? "-" : ""}RD$${enPesos(r.valorNeto < 0n ? -r.valorNeto : r.valorNeto)}.`);
    if (r.sinCosto) l.push(`${r.sinCosto} artículo${r.sinCosto > 1 ? "s" : ""} con diferencia no tiene${r.sinCosto > 1 ? "n" : ""} costo en el listado y no se valora${r.sinCosto > 1 ? "n" : ""}.`);
  } else {
    l.push("El listado no trae costo: no se valoran las diferencias en pesos.");
  }
  return l;
}

// Excel del reporte. Por defecto solo los artículos con diferencia; con `todos`, también los iguales.
export function tablaInventario(rep: ReporteConteo, empresa: string, generado: string, todos = false): Tabla {
  const filas = ordenarDiferencias(rep.filas.filter((f) => todos || f.tipo !== "igual"));
  const conPesos = rep.resumen.conCosto;
  return {
    titulo: "Diferencias de inventario", empresa, generado, horizontal: true,
    detalle: `${rep.nombre}${rep.ubicacion ? ` · ${rep.ubicacion}` : ""} · conteo del ${verFecha(rep.fecha)} · ${lineasResumen(rep.resumen).join(" ")}`,
    columnas: [
      { titulo: "Código", ancho: 16 }, { titulo: "Artículo", ancho: 34 }, { titulo: "Unidad", ancho: 10 }, { titulo: "Listado", num: true }, { titulo: "Contado", num: true }, { titulo: "Diferencia", num: true },
      { titulo: "Resultado", ancho: 12 }, ...(conPesos ? [{ titulo: "Costo", num: true }, { titulo: "Valor de la diferencia", num: true }] : []),
    ],
    filas: [
      ...filas.map((f) => [f.codigo, f.nombre, f.unidad, num(f.existencia), num(f.contado), num(f.diferencia), f.lecturas === 0 && f.tipo === "faltante" ? "Sin contar" : nombreTipo[f.tipo],
        ...(conPesos ? [pesos(f.costo === null ? null : f.costo / 100n), pesos(f.valor)] : [])]),
      ...rep.sinListado.map((s) => [s.codigo, "(No está en el listado del cliente)", "", 0, num(s.cantidad), num(s.cantidad), "Sobrante sin listado", ...(conPesos ? [null, null] : [])]),
    ],
    totales: conPesos ? ["Total valorado", "", "", null, null, null, "", null, pesos(rep.resumen.valorNeto)] : undefined,
  };
}

// PDF del reporte para entregar al cliente: su logo, el resumen, las diferencias y la línea de firmas.
export function docInventario(rep: ReporteConteo, p: { empresa: string; rnc: string | null; firma: string; preparadoPor: string; logo: string | null }, todos = false) {
  const VERDE = "#003D19", DORADO = "#B88A40";
  const t = (s: string) => limpiar(s);
  const r = rep.resumen;
  const filas = ordenarDiferencias(rep.filas.filter((f) => todos || f.tipo !== "igual"));
  const cab = (x: string, alinear = "left") => ({ text: x, bold: true, color: "#ffffff", fillColor: VERDE, alignment: alinear, fontSize: 8 });
  const der = (x: string, extra: object = {}) => ({ text: x, alignment: "right", ...extra });
  const layout = { hLineWidth: (i: number) => (i === 1 ? 0.8 : 0.3), vLineWidth: () => 0, hLineColor: (i: number) => (i === 1 ? DORADO : "#cccccc"), paddingTop: () => 2, paddingBottom: () => 2 };
  const h2 = (x: string) => ({ text: x, bold: true, fontSize: 12, color: VERDE, margin: [0, 14, 0, 3] });
  const colorDif = (f: FilaDiferencia) => (f.tipo === "faltante" ? "#b3261e" : f.tipo === "sobrante" ? "#8a5a00" : "#1b6b3a");

  const cuerpo = [
    [cab("Código"), cab("Artículo"), cab("Listado", "right"), cab("Contado", "right"), cab("Diferencia", "right"), ...(r.conCosto ? [cab("Costo", "right"), cab("Valor", "right")] : [])],
    ...filas.map((f) => [
      { text: t(f.codigo), fontSize: 8 }, { text: t(f.nombre + (f.unidad ? ` (${f.unidad})` : "")), fontSize: 8 },
      der(verCantidad(f.existencia), { fontSize: 8 }), der(f.lecturas === 0 ? "sin contar" : verCantidad(f.contado), { fontSize: 8 }),
      der(f.tipo === "igual" ? "0" : con(f.diferencia), { fontSize: 8, bold: f.tipo !== "igual", color: colorDif(f) }),
      ...(r.conCosto ? [der(f.costo === null ? "—" : enPesos(f.costo / 100n), { fontSize: 8 }), der(f.valor === null ? "—" : `${f.valor < 0n ? "-" : ""}${enPesos(f.valor < 0n ? -f.valor : f.valor)}`, { fontSize: 8, color: colorDif(f) })] : []),
    ]),
    ...(r.conCosto ? [[{ text: "Diferencia neta valorada", bold: true, colSpan: 6 }, {}, {}, {}, {}, {}, der(`${r.valorNeto < 0n ? "-" : ""}${enPesos(r.valorNeto < 0n ? -r.valorNeto : r.valorNeto)}`, { bold: true })]] : []),
  ];

  const contenido = [
    { columns: [
      ...(p.logo ? [{ image: p.logo, fit: [110, 60], width: 110 }] : []),
      { stack: [{ text: t(p.empresa), bold: true, fontSize: 16 }, ...(p.rnc ? [{ text: `RNC ${p.rnc}`, color: "#555555" }] : [])], margin: [p.logo ? 14 : 0, 6, 0, 0] },
    ] },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 548, y2: 0, lineWidth: 2, lineColor: DORADO }], margin: [0, 10, 0, 8] },
    { text: "Diferencias de inventario", bold: true, fontSize: 20, color: VERDE },
    { text: t(`${rep.nombre}${rep.ubicacion ? ` · ${rep.ubicacion}` : ""}`), fontSize: 12, margin: [0, 2, 0, 0] },
    { text: `Conteo n.º ${rep.numero} del ${verFecha(rep.fecha)} · cerrado${rep.cerrado_por ? ` por ${t(rep.cerrado_por)}` : ""}`, color: "#555555", margin: [0, 2, 0, 0] },

    h2("Resumen"),
    ...lineasResumen(r).map((l) => ({ text: t(l), lineHeight: 1.25, margin: [0, 1, 0, 0] })),
    ...(r.conCosto ? [{ text: `Valor del listado RD$${enPesos(r.valorListado)} · valor contado RD$${enPesos(r.valorContado)} (solo artículos con costo).`, color: "#555555", margin: [0, 3, 0, 0] }] : []),
    ...(r.sinContar ? [{ text: `Ojo: ${r.sinContar} artículo${r.sinContar > 1 ? "s no se contaron" : " no se contó"} (quedan como faltante total). Confirma que no quedó mercancía sin contar.`, color: "#8a5a00", margin: [0, 3, 0, 0] }] : []),

    h2(todos ? "Todos los artículos" : "Artículos con diferencia"),
    ...(filas.length ? [{ table: { headerRows: 1, widths: r.conCosto ? [48, "*", 42, 42, 46, 44, 54] : [60, "*", 52, 52, 56], body: cuerpo }, layout }] : [{ text: "No hay diferencias: todo lo contado coincide con el listado.", color: "#1b6b3a" }]),

    ...(rep.sinListado.length ? [
      h2("Códigos contados que no están en el listado"),
      { text: "Se contaron pero no existen en el listado del cliente: pueden ser mercancía que su sistema no tiene o un código mal escaneado. No se valoran.", color: "#555555", margin: [0, 0, 0, 3] },
      { table: { headerRows: 1, widths: ["*", 80, 70], body: [[cab("Código"), cab("Cantidad", "right"), cab("Lecturas", "right")], ...rep.sinListado.map((s) => [{ text: t(s.codigo), fontSize: 8 }, der(verCantidad(s.cantidad), { fontSize: 8 }), der(String(s.lecturas), { fontSize: 8 })])] }, layout },
    ] : []),
    ...(rep.notas.trim() ? [h2("Notas"), { text: t(rep.notas), lineHeight: 1.25 }] : []),

    { unbreakable: true, margin: [0, 36, 0, 0], columns: [
      { stack: [{ canvas: [{ type: "line", x1: 0, y1: 0, x2: 230, y2: 0, lineWidth: 0.7 }] }, { text: "Contado por", bold: true, margin: [0, 3, 0, 0] }, { text: t(p.firma), color: "#555555" }] },
      { stack: [{ canvas: [{ type: "line", x1: 0, y1: 0, x2: 230, y2: 0, lineWidth: 0.7 }] }, { text: "Recibido por el cliente", bold: true, margin: [0, 3, 0, 0] }, { text: t(p.empresa), color: "#555555" }] },
    ] },
    { text: t(`Preparado por ${p.preparadoPor} · ${p.firma} · Empire Tax & Legal`), italics: true, color: "#666666", margin: [0, 12, 0, 0], fontSize: 8 },
  ];

  const doc = {
    pageSize: "LETTER", pageMargins: [32, 40, 32, 44], defaultStyle: { font: "Helvetica", fontSize: 9 },
    info: { title: t(`Diferencias de inventario · ${p.empresa} · ${rep.nombre}`), creator: "Empire Tax & Legal" }, content: contenido,
    footer: (actual: number, total: number) => ({ columns: [{ text: "Empire Tax & Legal", color: VERDE }, { text: `Página ${actual} de ${total}`, alignment: "right", color: "#666666" }], margin: [32, 10, 32, 0], fontSize: 7 }),
  };
  return { nombre: `diferencias-inventario-${p.rnc ?? "cliente"}-n${rep.numero}.pdf`, doc };
}

export async function pdfInventario(tx: Tx, p: { empresaId: string; empresa: string; rnc: string | null; firma: string; preparadoPor: string; rep: ReporteConteo; todos?: boolean }) {
  const { nombre, doc } = docInventario(p.rep, { empresa: p.empresa, rnc: p.rnc, firma: p.firma, preparadoPor: p.preparadoPor, logo: await logoDe(tx, p.empresaId) }, p.todos);
  return { nombre, datos: new Uint8Array(await armarPdf(doc)) };
}
