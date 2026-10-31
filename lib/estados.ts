import type { TipoCuenta } from "./catalogo-rd.ts";
import type { Tx } from "./db";
import { saldosPorCuenta, ultimoDiaMes, type CuentaSaldo } from "./reportes.ts";

// Estados financieros (Fase 7, parte 1): estado de resultados y estado de situación financiera según la NIIF para PYMES
// (Sección 3: juego completo), con los comparativos de QuickBooks Online («Comparison») y Xero (períodos anteriores y
// meses en columnas). Todo sale de los asientos contabilizados y del catálogo: no se guarda nada aparte.

export type Columna = { titulo: string; desde: string; hasta: string };
export type Fila = {
  tipo: "seccion" | "cuenta" | "subtotal" | "total";
  texto: string;
  cuentaId?: string;
  valores: bigint[];
};
export type Estado = { columnas: Columna[]; filas: Fila[]; base?: bigint[]; cuadra?: boolean[]; sinVariacion?: boolean };
export type Comparar = "ninguno" | "anterior" | "anio" | "meses";
export const COMPARAR: Record<Comparar, string> = {
  ninguno: "Sin comparar", anterior: "Período anterior", anio: "Mismo período del año pasado", meses: "Mes por mes",
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fecha = (a: number, m: number, d: number) => {
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate(); // m de 1 a 12
  return `${a}-${String(m).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
};
const partes = (f: string) => f.split("-").map(Number) as [number, number, number];
const sumarMeses = (f: string, n: number, alFinal = false) => {
  const [a, m, d] = partes(f);
  const total = a * 12 + (m - 1) + n;
  const [na, nm] = [Math.floor(total / 12), (total % 12) + 1];
  return alFinal ? ultimoDiaMes(fecha(na, nm, 1)) : fecha(na, nm, d);
};
const esInicioDeMes = (f: string) => f.endsWith("-01");
const esFinDeMes = (f: string) => ultimoDiaMes(f) === f;
const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const sumarDias = (f: string, n: number) => new Date(Date.parse(f) + n * 86400000).toISOString().slice(0, 10);
const mesesEntre = (desde: string, hasta: string) => {
  const [a1, m1] = partes(desde), [a2, m2] = partes(hasta);
  return (a2 * 12 + m2) - (a1 * 12 + m1) + 1;
};
export const verFechaCorta = (f: string) => `${partes(f)[2]} ${MESES[partes(f)[1] - 1]} ${partes(f)[0]}`;
const tituloRango = (desde: string, hasta: string) => {
  if (esInicioDeMes(desde) && esFinDeMes(hasta)) {
    const n = mesesEntre(desde, hasta);
    const [a, m] = partes(desde), [a2, m2] = partes(hasta);
    if (n === 1) return `${MESES[m - 1]} ${a}`;
    return a === a2 ? `${MESES[m - 1]}–${MESES[m2 - 1]} ${a}` : `${MESES[m - 1]} ${a}–${MESES[m2 - 1]} ${a2}`;
  }
  return `${verFechaCorta(desde)} – ${verFechaCorta(hasta)}`;
};

// Columnas del estado de resultados: el período elegido y, según la comparación, el anterior, el del año pasado o un mes
// por columna (hasta 12, más el total).
export function columnasResultados(desde: string, hasta: string, comparar: Comparar): Columna[] {
  const actual = { titulo: tituloRango(desde, hasta), desde, hasta };
  if (comparar === "anterior") {
    let d: string, h: string;
    if (esInicioDeMes(desde) && esFinDeMes(hasta)) {
      const n = mesesEntre(desde, hasta);
      d = sumarMeses(desde, -n); h = sumarMeses(hasta, -n, true);
    } else {
      const n = dias(desde, hasta) + 1;
      d = sumarDias(desde, -n); h = sumarDias(hasta, -n);
    }
    return [actual, { titulo: tituloRango(d, h), desde: d, hasta: h }];
  }
  if (comparar === "anio") {
    const d = sumarMeses(desde, -12), h = esFinDeMes(hasta) ? sumarMeses(hasta, -12, true) : sumarMeses(hasta, -12);
    return [actual, { titulo: tituloRango(d, h), desde: d, hasta: h }];
  }
  if (comparar === "meses") {
    const n = Math.min(12, mesesEntre(desde, hasta));
    const cols: Columna[] = [];
    for (let i = 0; i < n; i++) {
      const ini = i === 0 ? desde : sumarMeses(`${desde.slice(0, 7)}-01`, i);
      const fin = i === n - 1 ? hasta : sumarMeses(`${desde.slice(0, 7)}-01`, i, true);
      cols.push({ titulo: tituloRango(`${ini.slice(0, 7)}-01`, ultimoDiaMes(ini)), desde: ini, hasta: fin });
    }
    return n > 1 ? [...cols, { titulo: "Total", desde, hasta: cols[cols.length - 1].hasta }] : cols;
  }
  return [actual];
}

// Columnas del estado de situación financiera: fechas de corte.
export function columnasBalance(corte: string, comparar: Comparar, mesCierre: number): Columna[] {
  const col = (h: string) => ({ titulo: `Al ${verFechaCorta(h)}`, desde: h, hasta: h });
  if (comparar === "anterior") return [col(corte), col(esFinDeMes(corte) ? sumarMeses(corte, -1, true) : sumarMeses(corte, -1))];
  if (comparar === "anio") return [col(corte), col(esFinDeMes(corte) ? sumarMeses(corte, -12, true) : sumarMeses(corte, -12))];
  if (comparar === "meses") {
    const inicio = inicioEjercicio(corte, mesCierre);
    const n = Math.min(12, mesesEntre(inicio, corte));
    return Array.from({ length: n }, (_, i) => (i === n - 1 ? col(corte) : col(sumarMeses(inicio, i, true))));
  }
  return [col(corte)];
}

// Primer día del ejercicio fiscal que contiene la fecha (el ejercicio termina el último día del mes de cierre).
export function inicioEjercicio(f: string, mesCierre: number): string {
  const [a, m] = partes(f);
  const anio = m > mesCierre ? a : a - 1;
  return mesCierre === 12 ? `${a}-01-01` : fecha(anio, mesCierre + 1, 1);
}

// ───────────── Estado de resultados ─────────────

type Seccion = { clave: string; titulo: string; tipo: TipoCuenta; signo: 1n | -1n; incluye: (codigo: string) => boolean };
const SECCIONES_ER: Seccion[] = [
  { clave: "ingresos", titulo: "Ingresos operacionales", tipo: "ingreso", signo: -1n, incluye: (c) => c.startsWith("41") },
  { clave: "costo", titulo: "Costo de ventas", tipo: "costo", signo: 1n, incluye: () => true },
  { clave: "gastos", titulo: "Gastos operacionales", tipo: "gasto", signo: 1n, incluye: (c) => c.startsWith("61") },
  { clave: "otros_ingresos", titulo: "Otros ingresos", tipo: "ingreso", signo: -1n, incluye: (c) => !c.startsWith("41") },
  { clave: "financieros", titulo: "Gastos financieros", tipo: "gasto", signo: 1n, incluye: (c) => c.startsWith("62") },
  { clave: "otros_gastos", titulo: "Otros gastos", tipo: "gasto", signo: 1n, incluye: (c) => !/^6[123]/.test(c) },
  { clave: "isr", titulo: "Impuesto sobre la renta", tipo: "gasto", signo: 1n, incluye: (c) => c.startsWith("63") },
];

type Agrupar = "cuentas" | "grupos";

// Cuentas (o subgrupos de 4 dígitos) de una sección, con su valor por columna y el signo natural de la sección.
function lineasDe(sec: Seccion, porColumna: CuentaSaldo[][], valor: (c: CuentaSaldo) => bigint, agrupar: Agrupar, nombres: Map<string, { id: string; nombre: string }>) {
  const mapa = new Map<string, Fila>();
  porColumna.forEach((saldos, i) => {
    for (const c of saldos) {
      if (!c.de_detalle || c.tipo !== sec.tipo || !sec.incluye(c.codigo)) continue;
      const clave = agrupar === "grupos" && c.codigo.length > 4 ? c.codigo.slice(0, 4) : c.codigo;
      const ref = agrupar === "grupos" ? nombres.get(clave) : { id: c.id, nombre: c.nombre };
      let f = mapa.get(clave);
      if (!f) {
        f = { tipo: "cuenta", texto: `${clave} ${ref?.nombre ?? c.nombre}`, cuentaId: ref?.id ?? c.id, valores: porColumna.map(() => 0n) };
        mapa.set(clave, f);
      }
      f.valores[i] += sec.signo * valor(c);
    }
  });
  return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, f]) => f).filter((f) => f.valores.some((v) => v !== 0n));
}

const sumar = (a: bigint[], b: bigint[], signo = 1n) => a.map((v, i) => v + signo * b[i]);

export async function estadoResultados(tx: Tx, columnas: Columna[], agrupar: Agrupar): Promise<Estado> {
  const porColumna = await Promise.all(columnas.map((c) => saldosPorCuenta(tx, c.desde, c.hasta, true)));
  const nombres = new Map(porColumna[0].map((c) => [c.codigo, { id: c.id, nombre: c.nombre }]));
  const cero = columnas.map(() => 0n);
  const totales: Record<string, bigint[]> = {};
  const bloques: Record<string, Fila[]> = {};
  for (const sec of SECCIONES_ER) {
    const lineas = lineasDe(sec, porColumna, (c) => c.debe - c.haber, agrupar, nombres);
    bloques[sec.clave] = lineas;
    totales[sec.clave] = lineas.reduce((t, f) => sumar(t, f.valores), cero);
  }
  const filas: Fila[] = [];
  const seccion = (clave: string, siempre = false) => {
    const sec = SECCIONES_ER.find((s) => s.clave === clave)!;
    if (!siempre && bloques[clave].length === 0) return;
    filas.push({ tipo: "seccion", texto: sec.titulo, valores: cero });
    filas.push(...bloques[clave]);
    filas.push({ tipo: "subtotal", texto: `Total ${sec.titulo.toLowerCase()}`, valores: totales[clave] });
  };
  const t = totales;
  seccion("ingresos", true);
  seccion("costo");
  const bruta = sumar(t.ingresos, t.costo, -1n);
  filas.push({ tipo: "total", texto: "Utilidad bruta", valores: bruta });
  seccion("gastos", true);
  const operacion = sumar(bruta, t.gastos, -1n);
  filas.push({ tipo: "total", texto: "Utilidad en operaciones", valores: operacion });
  seccion("otros_ingresos");
  seccion("financieros");
  seccion("otros_gastos");
  const antes = sumar(sumar(sumar(operacion, t.otros_ingresos), t.financieros, -1n), t.otros_gastos, -1n);
  filas.push({ tipo: "total", texto: "Utilidad antes del impuesto sobre la renta", valores: antes });
  seccion("isr");
  filas.push({ tipo: "total", texto: "Utilidad (pérdida) neta del período", valores: sumar(antes, t.isr, -1n) });
  return { columnas, filas, base: t.ingresos };
}

// ───────────── Estado de situación financiera ─────────────

export async function balanceGeneral(tx: Tx, columnas: Columna[], agrupar: Agrupar, mesCierre: number): Promise<Estado> {
  const porColumna = await Promise.all(columnas.map((c) => saldosPorCuenta(tx, c.hasta, c.hasta)));
  // Resultado del ejercicio en curso: ingresos − costos − gastos desde el inicio del ejercicio hasta el corte.
  const delEjercicio = await Promise.all(columnas.map((c) => saldosPorCuenta(tx, inicioEjercicio(c.hasta, mesCierre), c.hasta)));
  const nombres = new Map(porColumna[0].map((c) => [c.codigo, { id: c.id, nombre: c.nombre }]));
  const cero = columnas.map(() => 0n);
  const sec = (clave: string, titulo: string, tipo: TipoCuenta, signo: 1n | -1n, incluye: (c: string) => boolean): Seccion => ({ clave, titulo, tipo, signo, incluye });
  const bloque = (s: Seccion) => {
    const lineas = lineasDe(s, porColumna, (c) => c.final, agrupar, nombres);
    return { s, lineas, total: lineas.reduce((t, f) => sumar(t, f.valores), cero) };
  };
  const ac = bloque(sec("ac", "Activos corrientes", "activo", 1n, (c) => c.startsWith("11")));
  const anc = bloque(sec("anc", "Activos no corrientes", "activo", 1n, (c) => !c.startsWith("11")));
  const pc = bloque(sec("pc", "Pasivos corrientes", "pasivo", -1n, (c) => c.startsWith("21")));
  const pnc = bloque(sec("pnc", "Pasivos no corrientes", "pasivo", -1n, (c) => !c.startsWith("21")));
  const pat = bloque(sec("pat", "Patrimonio", "patrimonio", -1n, () => true));
  const resultado = (saldos: CuentaSaldo[], campo: "final" | "mov") => saldos
    .filter((c) => c.de_detalle && (c.tipo === "ingreso" || c.tipo === "costo" || c.tipo === "gasto"))
    .reduce((s, c) => s - (campo === "final" ? c.final : c.debe - c.haber), 0n);
  const totalResultados = porColumna.map((s) => resultado(s, "final"));
  const ejercicio = delEjercicio.map((s) => resultado(s, "mov"));
  const anteriores = totalResultados.map((v, i) => v - ejercicio[i]);

  const filas: Fila[] = [];
  const poner = (b: ReturnType<typeof bloque>) => {
    if (!b.lineas.length) return;
    filas.push({ tipo: "seccion", texto: b.s.titulo, valores: cero }, ...b.lineas, { tipo: "subtotal", texto: `Total ${b.s.titulo.toLowerCase()}`, valores: b.total });
  };
  poner(ac); poner(anc);
  const activo = sumar(ac.total, anc.total);
  filas.push({ tipo: "total", texto: "Total activos", valores: activo });
  poner(pc); poner(pnc);
  const pasivo = sumar(pc.total, pnc.total);
  filas.push({ tipo: "total", texto: "Total pasivos", valores: pasivo });
  filas.push({ tipo: "seccion", texto: "Patrimonio", valores: cero }, ...pat.lineas);
  if (anteriores.some((v) => v !== 0n)) filas.push({ tipo: "cuenta", texto: "Resultados de ejercicios anteriores sin cerrar", valores: anteriores });
  filas.push({ tipo: "cuenta", texto: "Resultado del ejercicio en curso", valores: ejercicio });
  const patrimonio = sumar(pat.total, totalResultados);
  filas.push({ tipo: "subtotal", texto: "Total patrimonio", valores: patrimonio });
  const pyp = sumar(pasivo, patrimonio);
  filas.push({ tipo: "total", texto: "Total pasivos y patrimonio", valores: pyp });
  return { columnas, filas, cuadra: activo.map((v, i) => v === pyp[i]) };
}

// Variación entre las dos primeras columnas (monto y %), para los comparativos de dos períodos.
export function variacion(valores: bigint[]): { monto: bigint; pct: string } {
  const monto = valores[0] - valores[1];
  if (valores[1] === 0n) return { monto, pct: "" };
  const abs = valores[1] < 0n ? -valores[1] : valores[1];
  return { monto, pct: porcentaje(monto, abs) };
}

// a ÷ b en %, con un decimal y redondeo, sin floats.
export function porcentaje(a: bigint, b: bigint): string {
  if (b === 0n) return "";
  const neg = (a < 0n) !== (b < 0n);
  const [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  const decimas = (x * 1000n + y / 2n) / y;
  return `${neg && decimas > 0n ? "-" : ""}${decimas / 10n}.${decimas % 10n} %`;
}
