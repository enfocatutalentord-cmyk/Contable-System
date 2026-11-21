import type { Tx } from "./db";
import { columnasResultados, type Comparar } from "./estados.ts";
import { deCentavos, hoyISO, verMonto } from "./montos.ts";
import { fechaValida, saldosPorCuenta, ultimoDiaMes, type CuentaSaldo } from "./reportes.ts";

// Prioridad 3 · P3f · Análisis financiero. Razones de liquidez, endeudamiento, rentabilidad y actividad calculadas al momento con los mismos estados que
// ya salen para el cliente (`saldosPorCuenta`: su contabilidad si la lleva, o sus facturas, compras y saldos del balance si no). Nada se inventa: si falta
// el balance o el divisor es cero, la razón no se calcula y se dice por qué. Todo en centavos con bigint; nunca floats.

export type Kind = "veces" | "pct" | "dias" | "monto";
export const GRUPOS = ["liquidez", "endeudamiento", "rentabilidad", "actividad"] as const;
export type Grupo = (typeof GRUPOS)[number];
export const NOMBRES_GRUPO: Record<Grupo, string> = {
  liquidez: "Liquidez", endeudamiento: "Endeudamiento", rentabilidad: "Rentabilidad", actividad: "Actividad",
};
export const PREGUNTA_GRUPO: Record<Grupo, string> = {
  liquidez: "¿Puede pagar lo que debe a corto plazo?",
  endeudamiento: "¿Cuánto de lo que tiene se financia con deuda?",
  rentabilidad: "¿Cuánto gana por lo que vende y por lo que tiene?",
  actividad: "¿Qué tan rápido cobra y mueve lo que tiene?",
};

export type Comparativo = Extract<Comparar, "ninguno" | "anterior" | "anio">;
export const COMPARATIVOS: Record<Comparativo, string> = { ninguno: "Sin comparar", anterior: "Período anterior", anio: "Mismo período del año pasado" };

// Lo que sale de los estados para un período y su fecha de corte. Valores con su signo natural (positivo = lo normal).
export type Datos = {
  titulo: string; desde: string; hasta: string; dias: number;
  ingresos: bigint;        // ingresos operacionales (41)
  costo: bigint;           // costo de ventas
  utilidadBruta: bigint;
  utilidadNeta: bigint;    // después de todos los otros ingresos, gastos e impuesto
  activoCorriente: bigint; inventarios: bigint; cxc: bigint; activos: bigint;
  pasivoCorriente: bigint; pasivos: bigint; patrimonio: bigint;
  hayBalance: boolean;     // el balance tiene saldos a la fecha de corte
  cuadra: boolean;         // activos = pasivos + patrimonio
};

const MS_DIA = 86400000;
export const diasDelPeriodo = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / MS_DIA) + 1;

// Saldos de las cuentas de detalle con un prefijo de código, con el signo que se pida.
const suma = (cuentas: CuentaSaldo[], tipo: CuentaSaldo["tipo"], campo: (c: CuentaSaldo) => bigint, prefijos?: string[]) =>
  cuentas.filter((c) => c.de_detalle && c.tipo === tipo && (!prefijos || prefijos.some((p) => c.codigo.startsWith(p)))).reduce((s, c) => s + campo(c), 0n);

// Pura: arma los datos de un período desde los saldos del movimiento (estado de resultados) y los de la fecha de corte (situación financiera).
export function datosDeSaldos(titulo: string, desde: string, hasta: string, movimiento: CuentaSaldo[], corte: CuentaSaldo[]): Datos {
  const neto = (c: CuentaSaldo) => c.debe - c.haber;
  const ingresos = -suma(movimiento, "ingreso", neto, ["41"]);
  const ingresosTotales = -suma(movimiento, "ingreso", neto);
  const costo = suma(movimiento, "costo", neto);
  const gastos = suma(movimiento, "gasto", neto);
  const activos = suma(corte, "activo", (c) => c.final);
  const pasivos = -suma(corte, "pasivo", (c) => c.final);
  const cuentasPatrimonio = -suma(corte, "patrimonio", (c) => c.final);
  // Como en el estado de situación: el patrimonio suma lo que las cuentas de resultados tengan sin cerrar (ingresos − costos − gastos hasta el corte).
  const resultados = -(suma(corte, "ingreso", (c) => c.final) + suma(corte, "costo", (c) => c.final) + suma(corte, "gasto", (c) => c.final));
  const patrimonio = cuentasPatrimonio + resultados;
  return {
    titulo, desde, hasta, dias: diasDelPeriodo(desde, hasta),
    ingresos, costo, utilidadBruta: ingresos - costo, utilidadNeta: ingresosTotales - costo - gastos,
    activoCorriente: suma(corte, "activo", (c) => c.final, ["11"]),
    inventarios: suma(corte, "activo", (c) => c.final, ["1103"]),
    // Cuentas por cobrar a clientes menos la estimación de incobrables (no cuentan las de empleados ni la cuenta corriente de la socia).
    cxc: suma(corte, "activo", (c) => c.final, ["110201", "110203"]),
    activos,
    pasivoCorriente: -suma(corte, "pasivo", (c) => c.final, ["21"]),
    pasivos, patrimonio,
    hayBalance: activos !== 0n || pasivos !== 0n || cuentasPatrimonio !== 0n,
    cuadra: activos === pasivos + patrimonio,
  };
}

// ───────────── Formato sin floats ─────────────

const DECIMALES: Record<Kind, number> = { veces: 2, pct: 1, dias: 1, monto: 2 };

// a ÷ b multiplicado por `factor`, redondeado al entero más cercano (mitad lejos de cero).
function dividir(a: bigint, b: bigint, factor: bigint): bigint {
  const n = a * factor, signo = (n < 0n) !== (b < 0n) ? -1n : 1n;
  const [x, y] = [n < 0n ? -n : n, b < 0n ? -b : b];
  return signo * ((2n * x + y) / (2n * y));
}

function conDecimales(num: bigint, dec: number): string {
  const neg = num < 0n, abs = neg ? -num : num, esc = 10n ** BigInt(dec);
  return `${neg && abs !== 0n ? "-" : ""}${abs / esc}${dec ? `.${String(abs % esc).padStart(dec, "0")}` : ""}`;
}

export function verRazon(kind: Kind, num: bigint): string {
  if (kind === "monto") return verMonto(deCentavos(num));
  const t = conDecimales(num, DECIMALES[kind]);
  return kind === "pct" ? `${t} %` : kind === "dias" ? `${t} días` : t;
}

// El cambio entre dos períodos: en puntos si es un porcentaje, y con signo.
export function verCambio(kind: Kind, a: bigint, b: bigint): string {
  const d = a - b;
  if (d === 0n) return "0";
  const t = kind === "monto" ? verMonto(deCentavos(d)) : conDecimales(d, DECIMALES[kind]);
  const con = d > 0n && !t.startsWith("-") ? `+${t}` : t;
  return kind === "pct" ? `${con} pts` : kind === "dias" ? `${con} días` : con;
}

// ───────────── Las razones ─────────────

export type Valor = { num: bigint } | { motivo: string };
export type Razon = {
  clave: string; grupo: Grupo; nombre: string; kind: Kind;
  formula: string;      // con palabras, para que se vea de dónde sale
  mide: string;         // qué dice, sin juzgar
  valores: Valor[];     // uno por período
};

const FALTA_BALANCE = "Faltan los saldos del balance a esa fecha";

type Definicion = { clave: string; grupo: Grupo; nombre: string; kind: Kind; formula: string; mide: string; calcular: (d: Datos) => Valor };
const dato = (n: bigint): Valor => ({ num: n });
const no = (motivo: string): Valor => ({ motivo });
// Una razón de balance: sin balance no se calcula; el divisor tiene que ser mayor que cero.
const conBalance = (d: Datos, divisor: bigint, sinDivisor: string, f: () => bigint): Valor =>
  !d.hayBalance ? no(FALTA_BALANCE) : divisor > 0n ? dato(f()) : no(sinDivisor);

export const DEFINICIONES: Definicion[] = [
  { clave: "corriente", grupo: "liquidez", nombre: "Razón corriente", kind: "veces", formula: "Activos corrientes ÷ Pasivos corrientes",
    mide: "Cuántos pesos tiene en activos de corto plazo por cada peso que debe a corto plazo.",
    calcular: (d) => conBalance(d, d.pasivoCorriente, "No hay pasivos corrientes", () => dividir(d.activoCorriente, d.pasivoCorriente, 100n)) },
  { clave: "acida", grupo: "liquidez", nombre: "Prueba ácida", kind: "veces", formula: "(Activos corrientes − Inventarios) ÷ Pasivos corrientes",
    mide: "Lo mismo que la razón corriente, sin contar el inventario, que tarda más en convertirse en efectivo.",
    calcular: (d) => conBalance(d, d.pasivoCorriente, "No hay pasivos corrientes", () => dividir(d.activoCorriente - d.inventarios, d.pasivoCorriente, 100n)) },
  { clave: "capital", grupo: "liquidez", nombre: "Capital de trabajo", kind: "monto", formula: "Activos corrientes − Pasivos corrientes",
    mide: "Lo que le queda de corto plazo después de pagar lo que debe a corto plazo.",
    calcular: (d) => (d.hayBalance ? dato(d.activoCorriente - d.pasivoCorriente) : no(FALTA_BALANCE)) },

  { clave: "deuda_total", grupo: "endeudamiento", nombre: "Deuda total", kind: "monto", formula: "Total de pasivos",
    mide: "Todo lo que debe, a corto y a largo plazo.",
    calcular: (d) => (d.hayBalance ? dato(d.pasivos) : no(FALTA_BALANCE)) },
  { clave: "endeudamiento", grupo: "endeudamiento", nombre: "Endeudamiento", kind: "pct", formula: "Total de pasivos ÷ Total de activos",
    mide: "Qué parte de lo que tiene está financiada con deuda.",
    calcular: (d) => conBalance(d, d.activos, "No hay activos", () => dividir(d.pasivos, d.activos, 1000n)) },
  { clave: "deuda_patrimonio", grupo: "endeudamiento", nombre: "Deuda sobre patrimonio", kind: "veces", formula: "Total de pasivos ÷ Patrimonio",
    mide: "Cuántos pesos debe por cada peso que es de los dueños.",
    calcular: (d) => conBalance(d, d.patrimonio, "El patrimonio es cero o negativo", () => dividir(d.pasivos, d.patrimonio, 100n)) },

  { clave: "margen_bruto", grupo: "rentabilidad", nombre: "Margen bruto", kind: "pct", formula: "Utilidad bruta ÷ Ingresos operacionales",
    mide: "Lo que queda de cada peso vendido después de pagar el costo de lo vendido.",
    calcular: (d) => (d.ingresos > 0n ? dato(dividir(d.utilidadBruta, d.ingresos, 1000n)) : no("No hay ingresos en el período")) },
  { clave: "margen_neto", grupo: "rentabilidad", nombre: "Margen neto", kind: "pct", formula: "Utilidad neta ÷ Ingresos operacionales",
    mide: "Lo que queda de cada peso vendido después de todos los costos, gastos e impuesto.",
    calcular: (d) => (d.ingresos > 0n ? dato(dividir(d.utilidadNeta, d.ingresos, 1000n)) : no("No hay ingresos en el período")) },
  { clave: "roa", grupo: "rentabilidad", nombre: "Rendimiento sobre activos (ROA)", kind: "pct", formula: "Utilidad neta ÷ Total de activos",
    mide: "Cuánto gana el negocio por cada peso que tiene invertido en activos. Es del período, no llevado a un año.",
    calcular: (d) => conBalance(d, d.activos, "No hay activos", () => dividir(d.utilidadNeta, d.activos, 1000n)) },
  { clave: "roe", grupo: "rentabilidad", nombre: "Rendimiento sobre patrimonio (ROE)", kind: "pct", formula: "Utilidad neta ÷ Patrimonio",
    mide: "Cuánto ganan los dueños por cada peso que tienen en el negocio. Es del período, no llevado a un año.",
    calcular: (d) => conBalance(d, d.patrimonio, "El patrimonio es cero o negativo", () => dividir(d.utilidadNeta, d.patrimonio, 1000n)) },

  { clave: "dias_cobro", grupo: "actividad", nombre: "Días de cobro", kind: "dias", formula: "Cuentas por cobrar ÷ Ingresos operacionales × Días del período",
    mide: "En promedio, cuántos días pasan entre vender y cobrar.",
    calcular: (d) => (!d.hayBalance ? no(FALTA_BALANCE) : d.ingresos > 0n ? dato(dividir(d.cxc * BigInt(d.dias), d.ingresos, 10n)) : no("No hay ingresos en el período")) },
  { clave: "rotacion_inventario", grupo: "actividad", nombre: "Rotación de inventario", kind: "veces", formula: "Costo de ventas ÷ Inventarios",
    mide: "Cuántas veces se vendió y repuso el inventario en el período.",
    calcular: (d) => (!d.hayBalance ? no(FALTA_BALANCE) : d.inventarios <= 0n ? no("No tiene inventario") : d.costo > 0n ? dato(dividir(d.costo, d.inventarios, 100n)) : no("No hay costo de ventas en el período")) },
  { clave: "rotacion_activos", grupo: "actividad", nombre: "Rotación de activos", kind: "veces", formula: "Ingresos operacionales ÷ Total de activos",
    mide: "Cuántos pesos vende por cada peso que tiene en activos, en el período.",
    calcular: (d) => conBalance(d, d.activos, "No hay activos", () => dividir(d.ingresos, d.activos, 100n)) },
];

export function calcularRazones(columnas: Datos[]): Razon[] {
  return DEFINICIONES.map(({ calcular, ...r }) => ({ ...r, valores: columnas.map(calcular) }));
}

// ───────────── Del estado del cliente a las razones ─────────────

export type Analisis = {
  columnas: Datos[];
  razones: Razon[];
  sinBalance: string[];   // períodos cuyo corte no tiene saldos de balance
  noCuadra: string[];     // períodos cuyo balance no cuadra
  sinIngresos: boolean;   // el período elegido no tiene ingresos
};

export async function armarAnalisis(tx: Tx, desde: string, hasta: string, comparar: Comparativo): Promise<Analisis> {
  const cols = columnasResultados(desde, hasta, comparar);
  const columnas = await Promise.all(cols.map(async (c) => {
    const [movimiento, corte] = await Promise.all([saldosPorCuenta(tx, c.desde, c.hasta, true), saldosPorCuenta(tx, c.hasta, c.hasta)]);
    return datosDeSaldos(c.titulo, c.desde, c.hasta, movimiento, corte);
  }));
  return {
    columnas,
    razones: calcularRazones(columnas),
    sinBalance: columnas.filter((d) => !d.hayBalance).map((d) => d.titulo),
    noCuadra: columnas.filter((d) => d.hayBalance && !d.cuadra).map((d) => d.titulo),
    sinIngresos: columnas[0].ingresos <= 0n,
  };
}

export type FiltrosAnalisis = { desde: string; hasta: string; comparar: Comparativo };
export function leerFiltrosAnalisis(sp: Record<string, string | undefined>): FiltrosAnalisis {
  const hoy = hoyISO();
  const hasta = fechaValida(sp.hasta) ? sp.hasta : ultimoDiaMes(hoy);
  const desde = fechaValida(sp.desde) ? sp.desde : `${hoy.slice(0, 4)}-01-01`;
  return {
    desde: desde <= hasta ? desde : `${hasta.slice(0, 7)}-01`, hasta,
    comparar: sp.comparar === "anterior" || sp.comparar === "anio" ? sp.comparar : "ninguno",
  };
}

// ───────────── Observaciones y sugerencias de la firma ─────────────

export type TextoGrupo = { observaciones: string; sugerencias: string };
export type Textos = Record<Grupo, TextoGrupo> & { general: string };
export const MAX_TEXTO = 2000;

export const textosVacios = (): Textos => ({
  liquidez: { observaciones: "", sugerencias: "" }, endeudamiento: { observaciones: "", sugerencias: "" },
  rentabilidad: { observaciones: "", sugerencias: "" }, actividad: { observaciones: "", sugerencias: "" }, general: "",
});

// Lee el formulario: un campo «<grupo>_observaciones» y «<grupo>_sugerencias» por grupo, y «general». Texto plano, sin pasarse del límite.
export function leerTextos(fd: FormData): Textos | string {
  const t = textosVacios();
  const leer = (nombre: string, titulo: string): string => {
    const v = String(fd.get(nombre) ?? "").replace(/\r\n/g, "\n").trim();
    if (v.length > MAX_TEXTO) throw new Error(`${titulo}: pasa de ${MAX_TEXTO} letras.`);
    return v;
  };
  try {
    for (const g of GRUPOS) {
      t[g].observaciones = leer(`${g}_observaciones`, `${NOMBRES_GRUPO[g]} · observaciones`);
      t[g].sugerencias = leer(`${g}_sugerencias`, `${NOMBRES_GRUPO[g]} · sugerencias`);
    }
    t.general = leer("general", "Conclusión general");
  } catch (e) {
    return (e as Error).message;
  }
  return t;
}

// Lo guardado puede venir incompleto o de otra forma: se normaliza.
export function normalizarTextos(crudo: unknown): Textos {
  const t = textosVacios();
  if (!crudo || typeof crudo !== "object") return t;
  const o = crudo as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  for (const g of GRUPOS) {
    const x = o[g] as Record<string, unknown> | undefined;
    t[g] = { observaciones: s(x?.observaciones), sugerencias: s(x?.sugerencias) };
  }
  t.general = s(o.general);
  return t;
}

export const hayTextos = (t: Textos) => t.general !== "" || GRUPOS.some((g) => t[g].observaciones !== "" || t[g].sugerencias !== "");

export async function observacionesDe(tx: Tx, desde: string, hasta: string): Promise<{ textos: Textos; por: string | null; en: Date | null }> {
  const [f] = await tx<{ textos: unknown; por: string | null; en: Date }[]>`
    SELECT o.textos, u.nombre AS por, o.actualizado_en AS en
      FROM analisis_observaciones o LEFT JOIN usuarios u ON u.id = o.actualizado_por
     WHERE o.empresa_id = empresa_actual() AND o.desde = ${desde} AND o.hasta = ${hasta}`;
  return f ? { textos: normalizarTextos(f.textos), por: f.por, en: f.en } : { textos: textosVacios(), por: null, en: null };
}

export async function guardarObservaciones(tx: Tx, p: { empresaId: string; usuarioId: string; desde: string; hasta: string; textos: Textos }) {
  await tx`
    INSERT INTO analisis_observaciones (empresa_id, desde, hasta, textos, actualizado_por)
    VALUES (${p.empresaId}, ${p.desde}, ${p.hasta}, ${tx.json(p.textos as never)}, ${p.usuarioId})
    ON CONFLICT (empresa_id, desde, hasta) DO UPDATE SET textos = EXCLUDED.textos, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`;
}
