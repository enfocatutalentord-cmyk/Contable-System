import { createHash } from "node:crypto";
import type { Tx } from "./db";
import { inicioEjercicio } from "./estados.ts";
import type { Aviso, Periodo } from "./formatos-dgii.ts";
import { anexoA1, anexoB1, b1ConCostoD, comprasDeBienes, inventarioDe } from "./ir2.ts";
import { porTasa, type Columna, type Resultado, type Seccion } from "./it1.ts";
import { aCentavos, deCentavos, hoyISO, leerMonto, verMonto } from "./montos.ts";

// IR-2 2026, parte 2: anexo G (ajustes fiscales), anexo E (pérdidas de años anteriores, distribución de beneficios,
// pérdidas de capital e ingresos sujetos a anticipos) y la liquidación del formulario IR-2 (casillas A, B y 1 a 33), con
// los textos y las fórmulas del Excel oficial «IR-2, Vers. 2026» (leído sin ejecutar macros), sector manufactura,
// comercio y agropecuaria. El período del borrador es el mes en que termina el ejercicio (AAAAMM).
// Claves: «G1.1» = renglón 1.1 del anexo G; «G3.1p» / «G3.1n» = distribución positiva / negativa; «E2b» = pérdida al
// inicio (columna b) de la fila 2 del anexo E; «E15» = casilla 15 del anexo E; «I12» = casilla 12 del IR-2; «IA», «IB».

const m = (clave: string, editable = false): Columna => ({ clave, tipo: "monto", editable });
const n = (clave: string, editable = false): Columna => ({ clave, tipo: "cantidad", editable });
const pct = (clave: string, editable = false): Columna => ({ clave, tipo: "porcentaje", editable });
const vacia = (clave: string): Columna => ({ clave: `${clave}x`, tipo: "monto", editable: false });

export const AJUSTES_POSITIVOS = [
  "Impuestos no deducibles", "Exceso en depreciación", "Ajustes por fiscalización de ejercicios anteriores",
  "Exceso provisión cuentas incobrables", "Exceso donaciones a instituciones de bien público", "Pérdida de capital no compensable del ejercicio",
  "Diferencia cambiaria", "Ajustes positivos por reembolsos (Ley 392-07 y Norma 2-08)", "Ajustes de precios de transferencia",
  "Gastos intereses no deducibles", "Otros gastos no admitidos", "Ajustes de inventarios", "Gastos sin comprobantes con valor fiscal",
  "Impuestos sobre la renta diferido", "Provisiones no admitidas", "Pasivo no sustentado", "Otros ajustes",
];
export const AJUSTES_NEGATIVOS = [
  "Deficiencia en depreciación", "Ajustes de inventario (viene de la casilla 37 del anexo D2)", "Diferencia cambiaria", "Otros ajustes",
];
export const DISTRIBUCION = [
  "Ingresos de operaciones netos", "Ingresos financieros", "Ingresos extraordinarios", "Otros ingresos", "Costo de venta",
  "Gastos de personal", "Gastos por trabajos, suministros y servicios", "Arrendamientos", "Gastos de activos fijos",
  "Gastos de representación", "Gastos financieros", "Gastos extraordinarios", "Otros gastos",
];
export const FILAS_PERDIDAS = 5;

// Parte 3. Anexo D: «D1» = casilla 1; «Dtipo» = tipo de inventario (1 periódico, 2 perpetuo, 3 otros). Impuesto a los
// activos (hoja «Activo» del Excel): «X1» = casilla 1. Del sector manufactura, comercio y agropecuaria solo se usan las
// casillas 1 a 9 y la liquidación 34 a 45.
export const TIPOS_INVENTARIO = ["Periódico", "Perpetuo", "Otros"];
const SECCIONES_D: Seccion[] = [
  { hoja: "D", titulo: "I. Empresa y II. Local (datos informativos)", encabezados: ["Valor"], renglones: [
    { n: 1, texto: "Número de funcionarios", columnas: [n("D1", true)] },
    { n: 2, texto: "Sueldo promedio anual de los funcionarios RD$", columnas: [m("D2", true)] },
    { n: 3, texto: "Número de empleados", columnas: [n("D3", true)] },
    { n: 4, texto: "Sueldo promedio anual de los empleados RD$", columnas: [m("D4", true)] },
    { n: 5, texto: "Superficie total (m²)", columnas: [n("D5", true)] },
    { n: 6, texto: "Número de locales propios", columnas: [n("D6", true)] },
    { n: 7, texto: "Número de establecimientos", columnas: [n("D7", true)] },
    { n: 8, texto: "Importe anual del alquiler RD$", columnas: [m("D8", true)] },
  ] },
  { hoja: "D", titulo: "IV. Costo de venta", encabezados: ["Monto"], renglones: [
    { n: "Tipo", texto: "Tipo de inventario (1 = periódico, 2 = perpetuo, 3 = otros)", columnas: [n("Dtipo", true)] },
    { n: 34, texto: "Inventario inicial (+)", columnas: [m("D34", true)] },
    { n: 35, texto: "Compras locales del ejercicio (+)", columnas: [m("D35", true)] },
    { n: 36, texto: "Compras en el exterior del ejercicio (+)", columnas: [m("D36", true)] },
    { n: 37, texto: "ITBIS llevado al costo (+)", columnas: [m("D37", true)] },
    { n: 38, texto: "Inventario final (−)", columnas: [m("D38", true)] },
    { n: 39, texto: "Costo de venta", columnas: [m("D39")] },
  ] },
  { hoja: "D", titulo: "V. Costo de venta (manufactura)", encabezados: ["Monto"], renglones: [
    { n: 40, texto: "Inventario inicial materia prima (+)", columnas: [m("D40", true)] },
    { n: 41, texto: "Inventario inicial productos en proceso (+)", columnas: [m("D41", true)] },
    { n: 42, texto: "Compras materia prima local (+)", columnas: [m("D42", true)] },
    { n: 43, texto: "Compras materia prima exterior (+)", columnas: [m("D43", true)] },
    { n: 44, texto: "Sueldos y salarios (+)", columnas: [m("D44", true)] },
    { n: 45, texto: "Depreciación (+)", columnas: [m("D45", true)] },
    { n: 46, texto: "Otros gastos indirectos (+)", columnas: [m("D46", true)] },
    { n: 47, texto: "Inventario final materia prima (−)", columnas: [m("D47", true)] },
    { n: 48, texto: "Inventario final productos en proceso (−)", columnas: [m("D48", true)] },
    { n: 49, texto: "Costos de producción", columnas: [m("D49")] },
    { n: 50, texto: "Inventario inicial productos terminados (+)", columnas: [m("D50", true)] },
    { n: 51, texto: "Inventario final productos terminados (−)", columnas: [m("D51", true)] },
    { n: 52, texto: "Costos de venta", columnas: [m("D52")] },
  ] },
];
const SECCIONES_X: Seccion[] = [
  { hoja: "X", titulo: "Determinación de los activos imponibles (manufactura, comercio, agropecuaria, hoteles y afines)", encabezados: ["Monto"], renglones: [
    { n: 1, texto: "Total activos (viene de la casilla 6 del anexo A-1)", columnas: [m("X1")] },
    { n: 2, texto: "Activos fijos edificaciones explotaciones agropecuarias (casilla 2.2 del anexo A-1) (+)", columnas: [m("X2")] },
    { n: 3, texto: "Activos fijos terrenos rurales (casilla 2.6 del anexo A-1) (+)", columnas: [m("X3")] },
    { n: 4, texto: "Inversiones en acciones (casilla 3.2 del anexo A-1) (+)", columnas: [m("X4")] },
    { n: 5, texto: "Impuesto diferido o anticipado (casilla 4.2 del anexo A-1) (+)", columnas: [m("X5")] },
    { n: 6, texto: "Activos exentos inversiones bonos de Hacienda (+)", columnas: [m("X6", true)] },
    { n: 7, texto: "Total activos exentos (2+3+4+5+6)", columnas: [m("X7")] },
    { n: 8, texto: "Depreciación acumulada activos fijos, edificaciones agropecuarias (casilla 5.2 del anexo A-1) (+)", columnas: [m("X8")] },
    { n: 9, texto: "Activos fijos netos (1−7+8)", columnas: [m("X9")] },
  ] },
  { hoja: "X", titulo: "Liquidación", encabezados: ["Monto"], renglones: [
    { n: 34, texto: "Activos imponibles (viene de la casilla 9)", columnas: [m("X34")] },
    { n: 35, texto: "Menos monto de revaluación de activos (−)", columnas: [m("X35", true)] },
    { n: 36, texto: "Menos exclusión temporal de activos autorizados (−)", columnas: [m("X36", true)] },
    { n: 37, texto: "Exenciones por leyes especiales y/o contratos (Ley 11-92, título V, artículo 406) (−)", columnas: [m("X37", true)] },
    { n: 38, texto: "Base para el cálculo del impuesto sobre los activos (34−35−36−37)", columnas: [m("X38")] },
    { n: 39, texto: "Impuesto a los activos (1 % sobre el monto de la casilla 38)", columnas: [m("X39")] },
    { n: 40, texto: "Crédito por impuesto liquidado del ISR (viene de la casilla 12 del IR-2) (−)", columnas: [m("X40")] },
    { n: 41, texto: "Diferencia a pagar (39−40 si es positivo)", columnas: [m("X41")] },
    { n: 42, texto: "Pago a cuenta (−)", columnas: [m("X42", true)] },
    { n: 43, texto: "Créditos autorizados (−)", columnas: [m("X43", true)] },
    { n: 44, texto: "Saldo a favor", columnas: [m("X44")] },
    { n: 45, texto: "Total a pagar (41−42−43)", columnas: [m("X45")] },
  ] },
];

export const SECCIONES_IR2: Seccion[] = [
  ...SECCIONES_D,
  { hoja: "G", titulo: "I. Detalle de los ajustes · 1. Positivos", encabezados: ["Monto"], renglones: [
    ...AJUSTES_POSITIVOS.map((texto, i) => ({ n: `1.${i + 1}`, texto, columnas: [m(`G1.${i + 1}`, true)] })),
    { n: "1", texto: "Total ajustes positivos", columnas: [m("G1")] },
  ] },
  { hoja: "G", titulo: "I. Detalle de los ajustes · 2. Negativos", encabezados: ["Monto"], renglones: [
    ...AJUSTES_NEGATIVOS.map((texto, i) => ({ n: `2.${i + 1}`, texto, columnas: [m(`G2.${i + 1}`, true)] })),
    { n: "2", texto: "Total ajustes negativos", columnas: [m("G2")] },
  ] },
  { hoja: "G", titulo: "II. Distribución de los ajustes", encabezados: ["Ajustes positivos", "Ajustes negativos"], renglones: [
    ...DISTRIBUCION.map((texto, i) => ({ n: `3.${i + 1}`, texto, columnas: [m(`G3.${i + 1}p`, true), m(`G3.${i + 1}n`, true)] })),
    { n: "3", texto: "Totales (deben ser iguales a los totales 1 y 2)", columnas: [m("G3p"), m("G3n")] },
  ] },
  { hoja: "E", titulo: "A. Pérdidas de años anteriores", encabezados: [
    "(a) Año de la pérdida", "(b) Pérdida al inicio del período", "(c) Índice de inflación (%)", "(d) Ajuste por inflación (b × c)",
    "(e) Pérdida ajustada por inflación (b + d)", "(f) Períodos por compensar", "(g) Pérdida a compensar (e ÷ f)",
    "(h) Renta neta imponible antes de la pérdida (casilla 7 del IR-2)", "(i) % de la renta neta imponible", "(j) Límite de pérdida a compensar (h × i)",
    "(k) Pérdida compensable en el período (menor de g y j)", "(l) Pérdida pendiente de compensar (e − g)",
  ], renglones: [
    ...Array.from({ length: FILAS_PERDIDAS }, (_, i) => {
      const r = i + 1;
      return { n: r, texto: `Pérdida ${r}`, columnas: [
        n(`E${r}a`, true), m(`E${r}b`, true), pct(`E${r}c`, true), m(`E${r}d`), m(`E${r}e`), n(`E${r}f`, true), m(`E${r}g`),
        m(`E${r}h`), pct(`E${r}i`, true), m(`E${r}j`), m(`E${r}k`), m(`E${r}l`),
      ] };
    }),
    { n: 6, texto: "Total", columnas: [vacia("E6a"), vacia("E6b"), vacia("E6c"), m("E6d"), m("E6e"), vacia("E6f"), m("E6g"),
      vacia("E6h"), vacia("E6i"), vacia("E6j"), m("E6k"), m("E6l")] },
  ] },
  { hoja: "E", titulo: "B. Distribución de los beneficios", encabezados: ["Monto"], renglones: [
    { n: 7, texto: "A dividendos", columnas: [m("E7", true)] },
    { n: 8, texto: "A reservas", columnas: [m("E8", true)] },
    { n: 9, texto: "Utilidades no distribuidas", columnas: [m("E9", true)] },
    { n: 10, texto: "Total (7+8+9)", columnas: [m("E10")] },
  ] },
  { hoja: "E", titulo: "C. Saldo de pérdidas de capital", encabezados: ["Monto"], renglones: [
    { n: 11, texto: "Pérdida de capital pendiente de compensar de ejercicios anteriores", columnas: [m("E11", true)] },
    { n: 12, texto: "Ganancia de capital del ejercicio que se compensan", columnas: [m("E12", true)] },
    { n: 13, texto: "Pérdida de capital del ejercicio", columnas: [m("E13", true)] },
    { n: 14, texto: "Saldo de pérdida de capital a compensar en ejercicios futuros", columnas: [m("E14", true)] },
  ] },
  { hoja: "E", titulo: "D. Ingresos brutos sujetos al pago de anticipos", encabezados: ["Monto"], renglones: [
    { n: 15, texto: "Total de ingresos (como aparece en el estado de resultados, casilla 4 del B-1)", columnas: [m("E15")] },
    { n: 16, texto: "Ganancia de capital en libros (−)", columnas: [m("E16", true)] },
    { n: 17, texto: "Ganancias de bienes depreciables en libros (−) (casilla 3.1 del B-1)", columnas: [m("E17")] },
    { n: 18, texto: "Dividendos (−) (casilla 2.3 del B-1)", columnas: [m("E18")] },
    { n: 19, texto: "Intereses exentos (−)", columnas: [m("E19", true)] },
    { n: 20, texto: "Menos ingresos o partidas no imputables a los fines fiscales (16+17+18+19)", columnas: [m("E20")] },
    { n: 21, texto: "Costo de venta (comisiones, ventas de bienes de terceros o por márgenes regulados por el Estado) (−)", columnas: [m("E21", true)] },
    { n: 22, texto: "Base imponible (15−20−21)", columnas: [m("E22")] },
  ] },
  { hoja: "I", titulo: "II. Determinación de la renta neta imponible o pérdida fiscal", encabezados: ["Monto"], renglones: [
    { n: "A", texto: "Ingresos (viene de la casilla total de ingresos, anexo B-1)", columnas: [m("IA")] },
    { n: "B", texto: "Ingresos brutos sujetos al pago de anticipos (viene del anexo E)", columnas: [m("IB")] },
    { n: 1, texto: "Beneficio o pérdida neta antes del impuesto (viene del anexo B-1)", columnas: [m("I1")] },
    { n: 2, texto: "Ajustes positivos (viene del anexo G) (+)", columnas: [m("I2")] },
    { n: 3, texto: "Exención Ley de Incentivos (−)", columnas: [m("I3", true)] },
    { n: 4, texto: "Dividendos ganados en otras compañías (−) (casilla 2.3 del B-1)", columnas: [m("I4")] },
    { n: 5, texto: "Ajustes negativos (viene del anexo G) (−)", columnas: [m("I5")] },
    { n: 6, texto: "Total ajustes fiscales (2−3−4−5)", columnas: [m("I6")] },
    { n: 7, texto: "Renta neta imponible antes de la pérdida y de la Ley 392-07 (1 ± 6)", columnas: [m("I7")] },
    { n: 8, texto: "Pérdidas años anteriores que se compensan (total de la columna k del anexo E) (−)", columnas: [m("I8")] },
    { n: 9, texto: "Renta neta imponible después de la pérdida y antes de la Ley 392-07 (7−8)", columnas: [m("I9")] },
    { n: 10, texto: "Deducción por inversión (Ley 392-07) (−)", columnas: [m("I10", true)] },
    { n: 11, texto: "Renta neta imponible después de la pérdida y de la Ley 392-07 (9−10)", columnas: [m("I11")] },
  ] },
  { hoja: "I", titulo: "III. Liquidación", encabezados: ["%", "Monto"], renglones: [
    { n: 12, texto: "Impuesto liquidado (27 % o 30 % de la casilla 11)", columnas: [pct("I12p"), m("I12")] },
    { n: 13, texto: "Anticipos pagados (−)", columnas: [vacia("I13a"), m("I13", true)] },
    { n: 14, texto: "Retenciones entidades del Estado (viene del formato de envío 623) (−)", columnas: [vacia("I14a"), m("I14", true)] },
    { n: 15, texto: "Crédito por inversión (art. 34 de la Ley 108-10) (−)", columnas: [vacia("I15a"), m("I15", true)] },
    { n: 16, texto: "Crédito por energía renovable (−)", columnas: [vacia("I16a"), m("I16", true)] },
    { n: 17, texto: "Crédito retenciones por intereses bancarios (−)", columnas: [vacia("I17a"), m("I17", true)] },
    { n: 18, texto: "Crédito por retenciones de ganancia de capital (−)", columnas: [vacia("I18a"), m("I18", true)] },
    { n: 19, texto: "Crédito por impuestos pagados en el exterior (−)", columnas: [vacia("I19a"), m("I19", true)] },
    { n: 20, texto: "Crédito fiscal (art. 39 de la Ley 108-10) (Ley 253-12) (−)", columnas: [vacia("I20a"), m("I20", true)] },
    { n: 21, texto: "Compensaciones autorizadas y otros pagos (−)", columnas: [vacia("I21a"), m("I21", true)] },
    { n: 22, texto: "Saldo a favor del ejercicio anterior no compensado (−)", columnas: [vacia("I22a"), m("I22", true)] },
    { n: 23, texto: "Diferencia a pagar (12 menos 13 a 22, si es positivo)", columnas: [vacia("I23a"), m("I23")] },
    { n: 24, texto: "Saldo a favor (12 menos 13 a 22, si es negativo)", columnas: [vacia("I24a"), m("I24")] },
    { n: 25, texto: "Mora por declaración tardía (10 % de la casilla 23 el primer mes y 4 % progresivo por cada mes o fracción)", columnas: [pct("I25p", true), m("I25")] },
    { n: 26, texto: "Mora en pagos de anticipos (sobre el monto mensual de anticipos no pagados)", columnas: [vacia("I26a"), m("I26", true)] },
    { n: 27, texto: "Total recargos (25+26)", columnas: [vacia("I27a"), m("I27")] },
    { n: 28, texto: "Sanciones", columnas: [vacia("I28a"), m("I28", true)] },
    { n: 29, texto: "Interés indemnizatorio por declaración tardía (% sobre la casilla 23)", columnas: [pct("I29p", true), m("I29")] },
    { n: 30, texto: "Interés indemnizatorio sobre anticipos (sobre el monto mensual de anticipos no pagados)", columnas: [vacia("I30a"), m("I30", true)] },
    { n: 31, texto: "Total a pagar (23+27+28+29+30)", columnas: [vacia("I31a"), m("I31")] },
    { n: 32, texto: "Saldo a compensar en activo/anticipo (−)", columnas: [vacia("I32a"), m("I32", true)] },
    { n: 33, texto: "Nuevo saldo a favor (24−27−29−30, si es mayor de RD$200)", columnas: [vacia("I33a"), m("I33")] },
  ] },
  ...SECCIONES_X,
];
export const EDITABLES_IR2 = new Set(SECCIONES_IR2.flatMap((s) => s.renglones.flatMap((r) => r.columnas.filter((c) => c.editable).map((c) => c.clave))));

// Ingresos desde los que se aplica el 30 % (casilla 12): RD$1,000,000,000 de la casilla A, como en el Excel oficial.
export const UMBRAL_30 = 100_000_000_000n;
const UMBRAL_SALDO = 20_000n; // casilla 33: solo si pasa de RD$200

// Ejercicio del borrador: termina el último día del mes del período.
export const ejercicioDe = (p: Periodo) => ({ inicio: inicioEjercicio(p.fin, Number(p.periodo.slice(4))), fin: p.fin });
export const periodoIr2Anterior = (periodo: string) => `${Number(periodo.slice(0, 4)) - 1}${periodo.slice(4)}`;
// Se presenta dentro de los 120 días siguientes al cierre del ejercicio (art. 299 del Código Tributario).
export function venceIr2(p: Periodo): string {
  const d = new Date(`${p.fin}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 120);
  return d.toISOString().slice(0, 10);
}

// Porcentaje de la renta que se puede compensar según la antigüedad de la pérdida (art. 287 literal k del Código
// Tributario): los tres primeros años sin límite, el cuarto el 80 % y el quinto el 70 %.
export function porcentajePerdida(anioEjercicio: number, anioPerdida: number): bigint {
  const edad = anioEjercicio - anioPerdida;
  return edad === 4 ? 8000n : edad === 5 ? 7000n : 10000n;
}

// Recargo sugerido si se presenta tarde: 10 % el primer mes y 4 % por cada mes o fracción siguiente (art. 252 CT).
export function recargoSugerido(vence: string, hoy: string): bigint {
  if (hoy <= vence) return 0n;
  const [a1, m1, d1] = vence.split("-").map(Number);
  const [a2, m2, d2] = hoy.split("-").map(Number);
  let meses = (a2 - a1) * 12 + (m2 - m1);
  if (d2 > d1) meses += 1;
  return BigInt(1000 + 400 * Math.max(meses - 1, 0));
}

export async function calcularIr2(tx: Tx, p: Periodo, manuales: Record<string, string>): Promise<Resultado> {
  const { inicio, fin } = ejercicioDe(p);
  const anio = Number(fin.slice(0, 4));
  const s: Record<string, bigint> = {};
  const origen: Record<string, string> = {};
  const avisos: Aviso[] = [];
  const b1 = (await anexoB1(tx, inicio, fin)).valores;
  const mesCierre = Number(p.periodo.slice(4));
  const a1 = (await anexoA1(tx, fin, mesCierre)).valores;

  // Anexo D, costo de venta: inventarios del A-1 al cierre anterior y al de este ejercicio, y las compras de bienes.
  const finAnterior = new Date(Date.parse(`${inicio}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  s.D34 = inventarioDe(await anexoA1(tx, finAnterior, mesCierre));
  s.D38 = inventarioDe({ valores: a1, detalle: {}, sinCasilla: [] });
  const compras = await comprasDeBienes(tx, inicio, fin);
  s.D35 = compras.locales; s.D36 = compras.exterior; s.D37 = compras.itbisAlCosto;
  origen.D34 = `Inventarios del anexo A-1 (1.5 a 1.8) al ${finAnterior.split("-").reverse().join("/")}`;
  origen.D38 = `Inventarios del anexo A-1 (1.5 a 1.8) al ${fin.split("-").reverse().join("/")}`;
  origen.D35 = "Líneas de bienes de compras registradas a proveedores locales, cargadas a cuentas de inventario o de costo, sin impuestos";
  origen.D36 = "Igual que la 35, de proveedores del exterior o con comprobante B17";
  origen.D37 = "ITBIS de esas líneas llevado al costo";

  // Del ejercicio anterior presentado: saldo a favor (33) y pérdidas pendientes de compensar.
  const anterior = periodoIr2Anterior(p.periodo);
  const [prev] = await tx<{ casillas: Record<string, string> | null }[]>`SELECT casillas FROM envios_dgii WHERE formato = 'IR-2' AND periodo = ${anterior}`;
  const pc = (k: string) => (prev?.casillas?.[k] ? aCentavos(prev.casillas[k]) : 0n);
  if (prev?.casillas) {
    s.I22 = pc("I33");
    origen.I22 = `Casilla 33 del IR-2 del ejercicio ${anterior.slice(0, 4)} (presentado)`;
    const arrastre: { a: bigint; b: bigint; f: bigint }[] = [];
    for (let r = 1; r <= FILAS_PERDIDAS; r++) {
      const pendiente = pc(`E${r}l`), periodos = pc(`E${r}f`) / 100n;
      if (pendiente > 0n && periodos > 1n) arrastre.push({ a: pc(`E${r}a`), b: pendiente, f: (periodos - 1n) * 100n });
    }
    if (pc("I9") < 0n) arrastre.push({ a: BigInt(anio - 1) * 100n, b: -pc("I9"), f: 500n });
    arrastre.slice(0, FILAS_PERDIDAS).forEach((x, i) => {
      const r = i + 1;
      s[`E${r}a`] = x.a; s[`E${r}b`] = x.b; s[`E${r}f`] = x.f;
      origen[`E${r}b`] = `Pérdida pendiente del IR-2 del ejercicio ${anterior.slice(0, 4)} (presentado)`;
    });
    if (arrastre.length > FILAS_PERDIDAS) avisos.push({ nivel: "aviso", texto: "Hay más pérdidas pendientes que filas en el anexo E; revisa cuáles siguen vigentes." });
  }
  // Retenciones de ISR que nos hicieron en los cobros del ejercicio (las de entidades del Estado van en la casilla 14).
  const [ret] = await tx<{ total: string }[]>`
    SELECT COALESCE(sum(round(retencion_isr * tasa, 2)), 0)::text AS total FROM cobros
     WHERE NOT anulado AND retencion_isr > 0 AND fecha BETWEEN ${inicio} AND ${fin}`;
  s.I14 = aCentavos(ret.total);
  if (s.I14) origen.I14 = "Retenciones de ISR hechas por los clientes en los cobros del ejercicio";

  // Lo escrito a mano manda; lo demás, lo sugerido.
  const v: Record<string, bigint> = { ...s };
  const escrito = (k: string) => manuales[k] !== undefined && leerMonto(manuales[k]) !== null;
  for (const [k, txt] of Object.entries(manuales)) {
    if (!EDITABLES_IR2.has(k)) continue;
    const x = leerMonto(txt);
    if (x !== null) v[k] = aCentavos(x);
  }
  const g = (k: string) => v[k] ?? 0n;
  const suma = (ks: string[]) => ks.reduce((t, k) => t + g(k), 0n);
  const sugeridos: Record<string, bigint> = {};

  // Anexo G.
  v.G1 = suma(AJUSTES_POSITIVOS.map((_, i) => `G1.${i + 1}`));
  v.G2 = suma(AJUSTES_NEGATIVOS.map((_, i) => `G2.${i + 1}`));
  v.G3p = suma(DISTRIBUCION.map((_, i) => `G3.${i + 1}p`));
  v.G3n = suma(DISTRIBUCION.map((_, i) => `G3.${i + 1}n`));
  if (v.G1 !== v.G3p) avisos.push({ nivel: "error", texto: "Anexo G: el total de la distribución de los ajustes positivos (casilla 3) debe coincidir con el total del detalle de los ajustes positivos (casilla 1)." });
  if (v.G2 !== v.G3n) avisos.push({ nivel: "error", texto: "Anexo G: el total de la distribución de los ajustes negativos (casilla 3) debe coincidir con el total del detalle de los ajustes negativos (casilla 2)." });

  // Anexo D, costo de venta (fórmulas del Excel): 39 = 34+35+36+37−38; manufactura 49 = 40..46−47−48 y 52 = 49+50−51.
  v.D39 = suma(["D34", "D35", "D36", "D37"]) - g("D38");
  v.D49 = suma(["D40", "D41", "D42", "D43", "D44", "D45", "D46"]) - g("D47") - g("D48");
  v.D52 = v.D49 + g("D50") - g("D51");
  const manufactura = ["D40", "D41", "D42", "D43", "D44", "D45", "D46", "D47", "D48", "D50", "D51"].some((k) => g(k) !== 0n);
  // El costo de venta del B-1 (casilla 5) viene del anexo D; si no coincide con las cuentas de costo, manda el anexo D
  // y se avisa (decisión de Joannie, 4-nov-2026).
  v.DCV = manufactura ? v.D52 : v.D39;
  const costoContable = b1["5"] ?? 0n;
  const tipo = g("Dtipo");
  if (![0n, 100n, 200n, 300n].includes(tipo)) avisos.push({ nivel: "error", texto: "Anexo D: el tipo de inventario es 1 (periódico), 2 (perpetuo) o 3 (otros)." });
  else if (tipo === 0n && v.DCV !== 0n) avisos.push({ nivel: "aviso", texto: "Anexo D: falta elegir el tipo de inventario (1 periódico, 2 perpetuo o 3 otros)." });
  if (v.DCV < 0n) avisos.push({ nivel: "aviso", texto: "Anexo D: el costo de venta da negativo; revisa los inventarios y las compras." });
  if (v.DCV !== costoContable) {
    avisos.push({ nivel: "aviso", texto: `El costo de venta del anexo D (RD$${verMonto(v.DCV)}) no coincide con las cuentas de costo de la contabilidad (RD$${verMonto(costoContable)}); diferencia de RD$${verMonto(v.DCV - costoContable)}. El B-1 y la casilla 1 usan el del anexo D; revisa los inventarios y las compras.` });
  }

  // Renta neta imponible antes de las pérdidas.
  v.IA = b1["4"] ?? 0n;
  origen.IA = "Casilla 4 del anexo B-1";
  v.I1 = b1ConCostoD(b1, v.DCV)["14"];
  origen.I1 = "Casilla 14 del anexo B-1, con el costo de venta del anexo D";
  v.I2 = v.G3p;
  v.I4 = b1["2.3"] ?? 0n;
  v.I5 = v.G3n;
  v.I6 = v.I2 - g("I3") - v.I4 - v.I5;
  v.I7 = v.I1 + v.I6;

  // Anexo E, A: pérdidas de años anteriores.
  const tot = { d: 0n, e: 0n, g: 0n, k: 0n, l: 0n };
  for (let r = 1; r <= FILAS_PERDIDAS; r++) {
    const k = (c: string) => `E${r}${c}`;
    const anioPerdida = Number(g(k("a")) / 100n);
    if (anioPerdida > 0) {
      // Sugerencias que dependen del año escrito: % de la renta por antigüedad y períodos que le quedan.
      if (!escrito(k("i"))) v[k("i")] = porcentajePerdida(anio, anioPerdida);
      if (!escrito(k("f")) && v[k("f")] === undefined) v[k("f")] = BigInt(Math.max(6 - (anio - anioPerdida), 0)) * 100n;
      sugeridos[k("i")] = porcentajePerdida(anio, anioPerdida);
      if (s[k("f")] === undefined) sugeridos[k("f")] = BigInt(Math.max(6 - (anio - anioPerdida), 0)) * 100n;
      if (g(k("b")) !== 0n && (anio - anioPerdida < 1 || anio - anioPerdida > 5)) {
        avisos.push({ nivel: "error", texto: `Anexo E, pérdida ${r}: la pérdida de ${anioPerdida} no se puede compensar en ${anio} (solo las de los cinco ejercicios anteriores).` });
      }
    } else if (g(k("b")) !== 0n) {
      avisos.push({ nivel: "error", texto: `Anexo E, pérdida ${r}: falta el año de la pérdida.` });
    }
    v[k("d")] = porTasa(g(k("b")), g(k("c")));
    v[k("e")] = g(k("b")) + v[k("d")];
    const periodos = g(k("f")) / 100n;
    v[k("g")] = periodos === 0n ? 0n : (v[k("e")] * 2n + periodos) / (periodos * 2n);
    v[k("h")] = g(k("b")) !== 0n ? v.I7 : 0n;
    // Con renta negativa no hay límite que compensar (el Excel daría un límite negativo).
    v[k("j")] = porTasa(v[k("h")] > 0n ? v[k("h")] : 0n, g(k("i")));
    v[k("k")] = v[k("g")] < v[k("j")] ? v[k("g")] : v[k("j")];
    v[k("l")] = v[k("e")] - v[k("g")];
    tot.d += v[k("d")]; tot.e += v[k("e")]; tot.g += v[k("g")]; tot.k += v[k("k")]; tot.l += v[k("l")];
  }
  Object.assign(v, { E6d: tot.d, E6e: tot.e, E6g: tot.g, E6k: tot.k, E6l: tot.l });

  // Anexo E, B a D.
  v.E10 = suma(["E7", "E8", "E9"]);
  v.E15 = v.IA;
  v.E17 = b1["3.1"] ?? 0n;
  v.E18 = b1["2.3"] ?? 0n;
  v.E20 = g("E16") + v.E17 + v.E18 + g("E19");
  v.E22 = v.E15 - v.E20 - g("E21");
  v.IB = v.E22;

  // Renta neta imponible y liquidación.
  v.I8 = v.E6k;
  v.I9 = v.I7 - v.I8;
  v.I11 = v.I9 - g("I10");
  v.I12p = v.IA >= UMBRAL_30 ? 3000n : 2700n;
  v.I12 = v.I11 > 0n ? porTasa(v.I11, v.I12p) : 0n;
  const creditos = suma(Array.from({ length: 10 }, (_, i) => `I${13 + i}`));
  const dif = v.I12 - creditos;
  v.I23 = dif > 0n ? dif : 0n;
  v.I24 = dif < 0n ? -dif : 0n;
  // Recargo por declaración tardía: sugerido a la fecha de hoy; una vez presentado queda el que se presentó, para que
  // el paso de los meses no cambie la declaración.
  const vence = venceIr2(p);
  const [actual] = await tx<{ casillas: Record<string, string> | null }[]>`SELECT casillas FROM envios_dgii WHERE formato = 'IR-2' AND periodo = ${p.periodo}`;
  const recargo = actual?.casillas?.I25p !== undefined ? aCentavos(actual.casillas.I25p) : recargoSugerido(vence, hoyISO());
  sugeridos.I25p = v.I23 > 0n ? recargo : 0n;
  if (!escrito("I25p")) v.I25p = sugeridos.I25p;
  v.I25 = porTasa(v.I23, g("I25p"));
  v.I27 = v.I25 + g("I26");
  v.I29 = porTasa(v.I23, g("I29p"));
  const total = v.I23 - v.I24 + v.I27 + g("I28") + v.I29 + g("I30");
  v.I31 = total > 0n ? total : 0n;
  const saldo = v.I24 - v.I27 - v.I29 - g("I30");
  v.I33 = saldo > UMBRAL_SALDO ? saldo - g("I32") : 0n;

  // Impuesto a los activos (hoja «Activo» del Excel): 1 % de los activos imponibles menos el ISR liquidado (casilla 12).
  const sinNegativo = (x: bigint) => (x > 0n ? x : 0n);
  v.X1 = a1["6"] ?? 0n; v.X2 = a1["2.2"] ?? 0n; v.X3 = a1["2.6"] ?? 0n; v.X4 = a1["3.2"] ?? 0n; v.X5 = a1["4.2"] ?? 0n;
  v.X8 = a1["5.2"] ?? 0n;
  origen.X1 = `Casilla 6 del anexo A-1 al ${fin.split("-").reverse().join("/")}`;
  v.X7 = suma(["X2", "X3", "X4", "X5", "X6"]);
  v.X9 = sinNegativo(v.X1 + v.X8 - v.X7);
  v.X34 = v.X9;
  v.X38 = sinNegativo(v.X34 - suma(["X35", "X36", "X37"]));
  v.X39 = porTasa(v.X38, 100n);
  v.X40 = v.I12;
  v.X41 = sinNegativo(v.X39 - v.X40);
  const pagosActivos = suma(["X42", "X43"]);
  v.X44 = sinNegativo(pagosActivos - v.X41);
  v.X45 = sinNegativo(v.X41 - pagosActivos);

  for (const k of EDITABLES_IR2) if (sugeridos[k] === undefined) sugeridos[k] = s[k] ?? 0n;
  if (v.I8 > 0n && v.I7 > 0n && v.I8 > v.I7) avisos.push({ nivel: "aviso", texto: "Las pérdidas que se compensan (casilla 8) pasan de la renta neta imponible (casilla 7): revisa el anexo E." });
  if (fin > hoyISO()) avisos.push({ nivel: "aviso", texto: "El ejercicio todavía no ha terminado: las cifras pueden cambiar." });
  if (!actual && v.I23 > 0n && recargo > 0n && !escrito("I25p")) {
    avisos.push({ nivel: "aviso", texto: `El plazo venció el ${vence.split("-").reverse().join("/")}: la casilla 25 trae el recargo de ${deCentavos(recargo)} % si se presenta hoy (10 % el primer mes y 4 % por cada mes o fracción); cámbialo si se presentará otro día. El interés indemnizatorio (casilla 29) se escribe a mano.` });
  }
  avisos.push({ nivel: "aviso", texto: "Los ajustes fiscales (anexo G), las pérdidas de años sin IR-2 presentado aquí, los anticipos pagados (13) y los créditos se escriben a mano. La depreciación fiscal del anexo D (D-1 y D-2) y los anexos H-1 y H-2 llegan en las próximas entregas." });
  const huella = createHash("sha256").update(JSON.stringify(Object.entries(v).sort(), (_, x) => (typeof x === "bigint" ? x.toString() : x))).digest("hex");
  return { valores: v, sugeridos, origen, avisos, huella };
}
