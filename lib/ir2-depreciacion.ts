import type { Aviso } from "./formatos-dgii.ts";
import { repartir } from "./formatos-dgii.ts";
import { porTasa, type Columna, type Seccion } from "./it1.ts";

// IR-2 2026, parte 3 (entrega 2): depreciación fiscal y ajuste por inflación, con los textos y las fórmulas del Excel
// oficial «IR-2, Vers. 2026» (leído sin ejecutar macros).
// - Anexo D, sección III (casillas 9 a 33): categorías 2 y 3 de uso propio (25 % y 15 %), en arrendamiento y de la
//   Ley 392-07 (50 % y 30 %). Claves «D9b» (categoría 2) y «D9c» (categoría 3).
// - Anexo D-1 (categoría 1, edificaciones): casillas 1 a 7 («U1»…) y el detalle de adquisiciones (8–17), mejoras (18–27)
//   y retiros (28–37) con fecha, valor, base depreciable, proporción no depreciada y depreciación («U8f», «U8v», «U8b»,
//   «U8p», «U8d»; costo final «U8c» = valor − depreciación).
// - Anexo D-2 (ajuste fiscal por inflación): patrimonio fiscal 1–35 («T1»…; «T35p» = porcentaje ajustado) y su
//   distribución entre los activos no monetarios 37–49 (monto «T37», % «T37m», distribución «T37a»).

const m = (clave: string, editable = false): Columna => ({ clave, tipo: "monto", editable });
const n = (clave: string, editable = false): Columna => ({ clave, tipo: "cantidad", editable });
const pct = (clave: string, editable = false): Columna => ({ clave, tipo: "porcentaje", editable });
const vacia = (clave: string): Columna => ({ clave: `${clave}x`, tipo: "monto", editable: false });

// Sección III del anexo D: [casilla, texto, editable, tasa categoría 2, tasa categoría 3].
type FilaIII = [number, string, boolean];
const USO_PROPIO: FilaIII[] = [
  [9, "Balance inicial (viene de la casilla 16 del anexo D del año anterior)", true], [10, "Ajuste fiscal (ver D-2)", false],
  [11, "Adiciones imponibles (50 % de las adiciones)", true], [12, "Retiros", true],
  [13, "Base ajustada por inflación (9+10+11−12)", false], [14, "Depreciación", false],
  [15, "Adición no depreciada (50 % de las adiciones del período)", true], [16, "Costo fiscal al final del período (13−14+15)", false],
];
const ARRENDAMIENTO: FilaIII[] = [
  [17, "Balance inicial (viene de la casilla 24 del anexo D del año anterior)", true], [18, "Ajuste fiscal (ver D-2)", true],
  [19, "Adiciones imponibles (50 % de las adiciones)", true], [20, "Retiros", true],
  [21, "Base ajustada por inflación (17+18+19−20)", false], [22, "Depreciación", false],
  [23, "Adición no depreciada (50 % de las adiciones del año)", true], [24, "Total costo fiscal al final del período (21−22+23)", false],
];
const LEY_392: FilaIII[] = [
  [25, "Balance inicial (viene de la casilla 32 del anexo D del año anterior)", true], [26, "Ajuste fiscal (ver D-2)", true],
  [27, "Adiciones imponibles (50 % de las adiciones)", true], [28, "Retiros", true],
  [29, "Base ajustada por inflación (25+26+27−28)", false], [30, "Depreciación", false],
  [31, "Adición no depreciada (50 % de las adiciones del año)", true], [32, "Total costo fiscal al final del período (29−30+31)", false],
];
const filasIII = (fs: FilaIII[]) => fs.map(([c, texto, e]) => ({ n: c, texto, columnas: [m(`D${c}b`, e), m(`D${c}c`, e)] }));
const CATEGORIAS = ["Categoría 2", "Categoría 3"];

export const SECCIONES_DEPRECIACION: Seccion[] = [
  { hoja: "D", titulo: "III. Depreciación de activo fijo · A) De uso propio", encabezados: CATEGORIAS, renglones: filasIII(USO_PROPIO) },
  { hoja: "D", titulo: "III. B) En arrendamiento", encabezados: CATEGORIAS, renglones: filasIII(ARRENDAMIENTO) },
  { hoja: "D", titulo: "III. C) Activos adquiridos amparados por la Ley 392-07", encabezados: CATEGORIAS, renglones: [
    ...filasIII(LEY_392),
    { n: 33, texto: "Total costo fiscal (16+24+32)", columnas: [m("D33b"), m("D33c")] },
  ] },
];

const DETALLE_D1 = ["Fecha (AAAAMMDD)", "Valor", "Base depreciable", "Proporción no depreciada", "Depreciación", "Costo final del período (valor − depreciación)"];
const filasDetalle = (desde: number, titulo: string, sub: string): Seccion => ({
  hoja: "D1", titulo, encabezados: DETALLE_D1, renglones: [
    ...Array.from({ length: 10 }, (_, i) => {
      const r = desde + i;
      return { n: r, texto: `${titulo.split(") ")[1]} ${i + 1}`, columnas: [n(`U${r}f`, true), m(`U${r}v`, true), m(`U${r}b`, true), m(`U${r}p`, true), m(`U${r}d`, true), m(`U${r}c`)] };
    }),
    { n: "", texto: "Sub-total", columnas: [vacia(`U${sub}f`), m(`U${sub}v`), m(`U${sub}b`), m(`U${sub}p`), m(`U${sub}d`), m(`U${sub}c`)] },
  ],
});

export const SECCIONES_D1: Seccion[] = [
  { hoja: "D1", titulo: "I. Cálculo de la depreciación del balance inicial (categoría 1)", encabezados: ["Monto"], renglones: [
    { n: 1, texto: "Balance inicial (viene de la casilla 38 del anexo D-2)", columnas: [m("U1")] },
    { n: 2, texto: "Ajuste fiscal (distribución de la casilla 38 del anexo D-2)", columnas: [m("U2")] },
    { n: 3, texto: "Balance inicial ajustado (1+2)", columnas: [m("U3")] },
    { n: 4, texto: "Retiro (después del ajuste)", columnas: [m("U4", true)] },
    { n: 5, texto: "Base depreciable (3−4)", columnas: [m("U5")] },
    { n: 6, texto: "Depreciación", columnas: [m("U6", true)] },
    { n: 7, texto: "Costo fiscal al final del período (5−6)", columnas: [m("U7")] },
  ] },
  filasDetalle(8, "II. Detalle de activo fijo · A) Adquisiciones", "A"),
  filasDetalle(18, "II. B) Mejoras capitalizables", "B"),
  filasDetalle(28, "II. C) Retiros", "C"),
  { hoja: "D1", titulo: "Total (depreciación: 6 + adquisiciones + mejoras + retiros)", encabezados: ["Depreciación", "Costo final del período"], renglones: [
    { n: "", texto: "Total", columnas: [m("UTd"), m("UTc")] },
  ] },
];

// Anexo D-2. Signo con que cada casilla entra en el saldo de activos fiscales (26).
const ACTIVOS_D2: [number, string, 1n | -1n][] = [
  [1, "Total activos (registrados en libros al inicio del ejercicio)", 1n], [2, "Provisiones y reservas (no admitidas a los fines fiscales)", 1n],
  [3, "Impuesto sobre la renta diferido", -1n], [4, "Cuentas por cobrar no relacionadas con el giro del negocio", -1n],
  [5, "Costo del terreno (valor en libros)", -1n], [6, "Costo de las acciones (valor en libros)", -1n], [7, "Costo edificio (valor en libros)", -1n],
  [8, "Costo construcción en proceso (valor en libros)", -1n], [9, "Costo activos en construcción (valor en libros)", -1n],
  [10, "Costo activos fijos categoría 2 (valor en libros)", -1n], [11, "Costo activos fijos categoría 3 (valor en libros)", -1n],
  [12, "Costo activos fijos categoría 2 (dados en arrendamiento, por su valor en libros)", -1n],
  [13, "Costo activos fijos categoría 3 (dados en arrendamiento, por su valor en libros)", -1n], [14, "Otros activos (valor en libros)", -1n],
  [15, "Costo fiscal categoría 1", 1n], [16, "Costo fiscal categoría 2", 1n], [17, "Costo fiscal activo en construcción", 1n],
  [18, "Costo fiscal categoría 3", 1n], [19, "Costo fiscal categoría 2 (dados en arrendamiento)", 1n],
  [20, "Costo fiscal categoría 3 (dados en arrendamiento)", 1n], [21, "Costo fiscal terrenos", 1n], [22, "Costo fiscal de las acciones", 1n],
  [23, "Reevaluación de activos", -1n], [24, "Mejoras en propiedades arrendadas", -1n], [25, "Costo fiscal de otros activos", 1n],
];
// Activos no monetarios (37–48) y la casilla del D-2 de la que viene cada uno (37 inventario, a mano).
const NO_MONETARIOS: [number, string, number | null][] = [
  [37, "Inventario", null], [38, "Activos categoría 1 (viene de la casilla 15)", 15], [39, "Activos categoría 2 (viene de la casilla 16)", 16],
  [40, "Activos categoría 3 (viene de la casilla 18)", 18], [41, "Costo fiscal categoría 2 (dados en arrendamiento) (viene de la casilla 19)", 19],
  [42, "Costo fiscal categoría 3 (dados en arrendamiento) (viene de la casilla 20)", 20], [43, "Costo fiscal de los terrenos (viene de la casilla 21)", 21],
  [44, "Costo fiscal mejoras en propiedad arrendadas (viene de la casilla 24)", 24], [45, "Costo construcción en proceso (viene de la casilla 8)", 8],
  [46, "Activos en construcción (viene de la casilla 17)", 17], [47, "Inversiones en acciones (viene de la casilla 22)", 22],
  [48, "Costo fiscal otros activos no monetarios (viene de la casilla 25)", 25],
];

export const SECCIONES_D2: Seccion[] = [
  { hoja: "D2", titulo: "1. Determinación del patrimonio fiscal", encabezados: ["%", "Monto"], renglones: [
    ...ACTIVOS_D2.map(([c, texto, signo]) => ({ n: c, texto: `${texto} (${signo > 0n ? "+" : "−"})`, columnas: [vacia(`T${c}e`), m(`T${c}`, true)] })),
    { n: 26, texto: "Saldo activos fiscales", columnas: [vacia("T26e"), m("T26")] },
    { n: 27, texto: "Total pasivos (registrados en libros al inicio del ejercicio)", columnas: [vacia("T27e"), m("T27", true)] },
    { n: 28, texto: "Impuesto sobre la renta diferido (−)", columnas: [vacia("T28e"), m("T28", true)] },
    { n: 29, texto: "Provisiones y reservas (no admitidas a los fines fiscales) (−)", columnas: [vacia("T29e"), m("T29", true)] },
    { n: 30, texto: "Otros pasivos (−)", columnas: [vacia("T30e"), m("T30", true)] },
    { n: 31, texto: "Saldo de los pasivos (27−28−29−30)", columnas: [vacia("T31e"), m("T31")] },
    { n: 32, texto: "Patrimonio fiscal (26−31)", columnas: [vacia("T32e"), m("T32")] },
    { n: 33, texto: "Saldo fiscal activos no monetarios (casilla 49)", columnas: [vacia("T33e"), m("T33")] },
    { n: 34, texto: "Base ajuste por inflación (valor menor de las casillas 32 y 33)", columnas: [vacia("T34e"), m("T34")] },
    { n: 35, texto: "Ajuste fiscal patrimonial (porcentaje ajustado)", columnas: [pct("T35p", true), m("T35")] },
  ] },
  { hoja: "D2", titulo: "2. Distribución del ajuste fiscal patrimonial · 36. Activos no monetarios (valor fiscal)", encabezados: ["Monto", "%", "Distribución del ajuste"], renglones: [
    ...NO_MONETARIOS.map(([c, texto, de]) => ({ n: c, texto, columnas: [m(`T${c}`, de === null), pct(`T${c}m`), m(`T${c}a`)] })),
    { n: 49, texto: "Total activos no monetarios", columnas: [m("T49"), pct("T49m"), m("T49a")] },
  ] },
];

// Sugerencias desde el A-1 al inicio del ejercicio (= cierre anterior) y desde el IR-2 anterior presentado.
export function sugerirDepreciacion(s: Record<string, bigint>, origen: Record<string, string>, a1Inicio: Record<string, bigint>,
  pc: (k: string) => bigint, anterior: string | null) {
  const a = (c: string) => a1Inicio[c] ?? 0n;
  const desdeA1: [string, bigint, string][] = [
    ["T1", a("6"), "casilla 6"], ["T3", a("4.2"), "casilla 4.2"], ["T5", a("2.5") + a("2.6"), "casillas 2.5 y 2.6"], ["T6", a("3.2"), "casilla 3.2"],
    ["T7", a("2.1") + a("2.2") - a("5.1") - a("5.2"), "casillas 2.1 + 2.2 − 5.1 − 5.2"], ["T10", a("2.3") - a("5.3"), "casillas 2.3 − 5.3"],
    ["T11", a("2.4") - a("5.4"), "casillas 2.4 − 5.4"], ["T27", a("7") + a("8") + a("9"), "casillas 7 + 8 + 9"],
    ["T37", ["1.5", "1.6", "1.7", "1.8"].reduce((t, c) => t + a(c), 0n), "inventarios 1.5 a 1.8"],
  ];
  for (const [k, x, t] of desdeA1) if (x) { s[k] = x; origen[k] = `Anexo A-1 al inicio del ejercicio, ${t}`; }
  if (!anterior) return;
  const desdePrev: [string, string, string][] = [
    ["D9b", "D16b", "casilla 16"], ["D9c", "D16c", "casilla 16"], ["D17b", "D24b", "casilla 24"], ["D17c", "D24c", "casilla 24"],
    ["D25b", "D32b", "casilla 32"], ["D25c", "D32c", "casilla 32"],
    ["T15", "UTc", "anexo D-1, costo final total"], ["T16", "D16b", "anexo D, casilla 16, categoría 2"], ["T18", "D16c", "anexo D, casilla 16, categoría 3"],
    ["T19", "D24b", "anexo D, casilla 24, categoría 2"], ["T20", "D24c", "anexo D, casilla 24, categoría 3"],
  ];
  for (const [k, de, t] of desdePrev) {
    const x = pc(de);
    if (x) { s[k] = x; origen[k] = `IR-2 del ejercicio ${anterior.slice(0, 4)} (presentado), ${t}`; }
  }
}

// Cálculo en el orden del formulario: D-2 (ajuste por inflación), D-1 (categoría 1) y la sección III del anexo D.
// Las adiciones no depreciadas (15, 23, 31) se sugieren iguales a las adiciones imponibles: las dos son el 50 %.
export function calcularDepreciacion(v: Record<string, bigint>, sugeridos: Record<string, bigint>, escrito: (k: string) => boolean, avisos: Aviso[]) {
  const g = (k: string) => v[k] ?? 0n;
  const sugerir = (k: string, x: bigint) => { sugeridos[k] = x; if (!escrito(k)) v[k] = x; };

  // D-2.
  v.T26 = ACTIVOS_D2.reduce((t, [c, , signo]) => t + signo * g(`T${c}`), 0n);
  v.T31 = g("T27") - g("T28") - g("T29") - g("T30");
  v.T32 = v.T26 - v.T31;
  for (const [c, , de] of NO_MONETARIOS) if (de !== null) v[`T${c}`] = g(`T${de}`);
  const montos = NO_MONETARIOS.map(([c]) => g(`T${c}`));
  v.T49 = montos.reduce((t, x) => t + x, 0n);
  v.T33 = v.T49;
  v.T34 = v.T33 > v.T32 ? v.T32 : v.T33;
  v.T35 = porTasa(v.T34, g("T35p"));
  // % = monto ÷ total (en centésimas de punto, como las demás tasas) y la distribución, sin perder centavos.
  const negativos = montos.some((x) => x < 0n);
  if (negativos) avisos.push({ nivel: "aviso", texto: "Anexo D-2: hay activos no monetarios en negativo; revisa las casillas 37 a 48." });
  const reparto = v.T49 > 0n && !negativos
    ? (v.T35 < 0n ? repartir(-v.T35, montos).map((x) => -x) : repartir(v.T35, montos))
    : montos.map(() => 0n);
  NO_MONETARIOS.forEach(([c], i) => {
    v[`T${c}m`] = v.T49 > 0n ? (montos[i] * 10_000n + v.T49 / 2n) / v.T49 : 0n;
    v[`T${c}a`] = reparto[i];
  });
  v.T49m = NO_MONETARIOS.reduce((t, [c]) => t + g(`T${c}m`), 0n);
  v.T49a = reparto.reduce((t, x) => t + x, 0n);
  if (v.T35 !== 0n && v.T49 <= 0n) avisos.push({ nivel: "aviso", texto: "Anexo D-2: hay ajuste patrimonial pero no hay activos no monetarios entre los que repartirlo." });

  // D-1, categoría 1.
  v.U1 = g("T38");
  v.U2 = g("T38a");
  v.U3 = v.U1 + v.U2;
  v.U5 = v.U3 - g("U4");
  // Categoría 1: 5 % anual (art. 287 del Código Tributario).
  sugerir("U6", porTasa(v.U5 > 0n ? v.U5 : 0n, 500n));
  v.U7 = v.U5 - g("U6");
  for (const [desde, sub] of [[8, "A"], [18, "B"], [28, "C"]] as const) {
    for (const col of ["v", "b", "p", "d", "c"]) v[`U${sub}${col}`] = 0n;
    for (let r = desde; r < desde + 10; r++) {
      v[`U${r}c`] = g(`U${r}v`) - g(`U${r}d`);
      for (const col of ["v", "b", "p", "d", "c"]) v[`U${sub}${col}`] += g(`U${r}${col}`);
    }
  }
  v.UTd = g("U6") + v.UAd + v.UBd + v.UCd;
  v.UTc = v.U7 + v.UAc + v.UBc + v.UCc;

  // Anexo D, sección III. Tasas del Excel: uso propio 25 % y 15 %; arrendamiento y Ley 392-07, 50 % y 30 %.
  v.D10b = g("T39a"); v.D10c = g("T40a");
  sugerir("D18b", g("T41a")); sugerir("D18c", g("T42a"));
  for (const [col, tasas] of [["b", [2500n, 5000n, 5000n]], ["c", [1500n, 3000n, 3000n]]] as const) {
    const k = (c: number) => `D${c}${col}`;
    [[9, tasas[0]], [17, tasas[1]], [25, tasas[2]]].forEach(([ini, tasa]) => {
      const i = Number(ini);
      sugerir(k(i + 6), g(k(i + 2))); // adición no depreciada = adición imponible
      v[k(i + 4)] = g(k(i)) + g(k(i + 1)) + g(k(i + 2)) - g(k(i + 3));
      v[k(i + 5)] = porTasa(v[k(i + 4)], tasa as bigint);
      v[k(i + 7)] = v[k(i + 4)] - v[k(i + 5)] + g(k(i + 6));
    });
    v[k(33)] = g(k(16)) + g(k(24)) + g(k(32));
  }
}
