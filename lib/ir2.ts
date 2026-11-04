import { aPesos, tasaDeTexto } from "./calculos.ts";
import type { TipoCuenta } from "./catalogo-rd.ts";
import type { Tx } from "./db";
import { inicioEjercicio } from "./estados.ts";
import { aCentavos } from "./montos.ts";
import { saldosPorCuenta } from "./reportes.ts";

// IR-2 2026 (declaración jurada anual del ISR de sociedades), parte 1: anexos A-1 (balance general), B-1 (estado de
// resultados) y J (resumen de comprobantes) para manufactura, comercio, agropecuaria y hoteles. Casillas, textos y fórmulas
// copiados del Excel oficial «IR-2, Vers. 2026» (leído sin ejecutar macros): A-1 total activos = 1+2+3+4−5; total pasivos y
// patrimonio = 7+8+9+10; B-1 casilla 1 = 1.1+1.2−1.3−1.4+1.5; 4 = 1+2+3; 14 = 4−(5 a 13); 15 = 5..13+14.

export type Casilla = { c: string; texto: string; total?: boolean };
type Anexo = "A1" | "B1";

export const A1: Casilla[] = [
  { c: "1", texto: "ACTIVOS CORRIENTES", total: true },
  { c: "1.1", texto: "Cajas y bancos" }, { c: "1.2", texto: "Cuentas por cobrar a clientes" },
  { c: "1.3", texto: "Cuentas por cobrar a relacionados" }, { c: "1.4", texto: "Otras cuentas por cobrar" },
  { c: "1.5", texto: "Inventario de mercancías o productos terminados" }, { c: "1.6", texto: "Inventario de materia prima" },
  { c: "1.7", texto: "Inventario de productos en proceso" }, { c: "1.8", texto: "Otros inventarios" },
  { c: "1.9", texto: "Mercancías en tránsito" }, { c: "1.10", texto: "Gastos pagados por adelantado" },
  { c: "1.11", texto: "Otros activos corrientes" }, { c: "1.12", texto: "Dividendos a cuenta entregados en el ejercicio" },
  { c: "2", texto: "ACTIVOS FIJOS", total: true },
  { c: "2.1", texto: "Edificaciones (categoría 1)" }, { c: "2.2", texto: "Edificaciones de explotaciones agropecuarias (categoría 1)" },
  { c: "2.3", texto: "Automóviles y equipos (categoría 2)" }, { c: "2.4", texto: "Otros activos fijos depreciables (categoría 3)" },
  { c: "2.5", texto: "Otros activos fijos no depreciables (incluye terrenos urbanos)" },
  { c: "2.6", texto: "Otros activos fijos no depreciables (incluye terrenos rurales)" }, { c: "2.7", texto: "Revaluación de activos" },
  { c: "3", texto: "INVERSIONES", total: true },
  { c: "3.1", texto: "Depósitos" }, { c: "3.2", texto: "Acciones" }, { c: "3.3", texto: "Otras inversiones" },
  { c: "4", texto: "OTROS ACTIVOS", total: true },
  { c: "4.1", texto: "Otros activos no amortizables" }, { c: "4.2", texto: "Impuesto sobre la renta diferido o anticipado" },
  { c: "4.3", texto: "Otros activos amortizables" },
  { c: "5", texto: "PROVISIONES PARA RIESGOS Y GASTOS", total: true },
  { c: "5.1", texto: "Depreciación acumulada activos fijos (categoría 1)" },
  { c: "5.2", texto: "Depreciación acumulada activos fijos edificaciones agropecuarias" },
  { c: "5.3", texto: "Depreciación acumulada activos fijos (categoría 2)" }, { c: "5.4", texto: "Depreciación acumulada activos fijos (categoría 3)" },
  { c: "5.5", texto: "Para cuentas incobrables" }, { c: "5.6", texto: "Provisión de inventario" }, { c: "5.7", texto: "Otras provisiones" },
  { c: "6", texto: "TOTAL ACTIVOS", total: true },
  { c: "7", texto: "ACREEDORES A CORTO PLAZO", total: true },
  { c: "7.1", texto: "Préstamos" }, { c: "7.2", texto: "Cuentas por pagar" }, { c: "7.3", texto: "Impuestos por pagar" },
  { c: "7.4", texto: "Otras cuentas por pagar" }, { c: "7.5", texto: "Cobros anticipados" }, { c: "7.6", texto: "Aportes para futura capitalización" },
  { c: "8", texto: "ACREEDORES A LARGO PLAZO", total: true },
  { c: "8.1", texto: "Préstamos hipotecarios" }, { c: "8.2", texto: "Préstamos comerciales con instituciones financieras locales" },
  { c: "8.3", texto: "Préstamos comerciales con instituciones financieras del exterior" },
  { c: "8.4", texto: "Préstamos con entidades relacionadas locales" }, { c: "8.5", texto: "Préstamos con entidades relacionadas del exterior" },
  { c: "8.6", texto: "Préstamos con entidades acogidas a regímenes especiales" }, { c: "8.7", texto: "Préstamos con organismos internacionales" },
  { c: "8.8", texto: "Préstamos con accionistas" },
  { c: "9", texto: "OTROS PASIVOS" },
  { c: "10", texto: "PATRIMONIO", total: true },
  { c: "10.1", texto: "Capital suscrito y pagado" }, { c: "10.2", texto: "Reserva legal" }, { c: "10.3", texto: "Superávit revaluación de activos" },
  { c: "10.4", texto: "Beneficios (pérdidas) de ejercicios anteriores" }, { c: "10.5", texto: "Beneficio (pérdida) del ejercicio actual" },
  { c: "10.6", texto: "Otras reservas" },
  { c: "11", texto: "TOTAL PASIVOS Y PATRIMONIO", total: true },
];

export const B1: Casilla[] = [
  { c: "1", texto: "INGRESOS DE OPERACIONES NETOS", total: true },
  { c: "1.1", texto: "Ingresos ventas locales" }, { c: "1.2", texto: "Ingresos exportaciones" }, { c: "1.3", texto: "Devoluciones s/venta (−)" },
  { c: "1.4", texto: "Descuento s/venta (−)" }, { c: "1.5", texto: "Otros ingresos" },
  { c: "2", texto: "INGRESOS FINANCIEROS", total: true },
  { c: "2.1", texto: "Intereses percibidos por inversiones financieras en instituciones financieras" },
  { c: "2.2", texto: "Intereses percibidos por inversiones financieras de instituciones no financieras" }, { c: "2.3", texto: "Por dividendos" },
  { c: "2.4", texto: "Intereses por préstamos con entidades relacionadas" }, { c: "2.5", texto: "Intereses por préstamos con entidades no relacionadas" },
  { c: "2.6", texto: "Otros ingresos financieros" },
  { c: "3", texto: "INGRESOS EXTRAORDINARIOS", total: true },
  { c: "3.1", texto: "Por ventas de activos depreciables" }, { c: "3.2", texto: "Por ventas de bienes de capital" },
  { c: "3.3", texto: "Por diferencias positivas cambiarias" }, { c: "3.4", texto: "Ingresos correspondientes a otros ejercicios" },
  { c: "3.5", texto: "Otros ingresos extraordinarios" },
  { c: "4", texto: "TOTAL INGRESOS", total: true },
  { c: "5", texto: "COSTO DE VENTA" },
  { c: "6", texto: "GASTOS DE PERSONAL", total: true },
  { c: "6.1", texto: "Sueldos y salarios" }, { c: "6.2", texto: "Retribuciones complementarias" }, { c: "6.3", texto: "Seguros" },
  { c: "6.4", texto: "Aportación seguridad social" }, { c: "6.5", texto: "Aporte INFOTEP" }, { c: "6.6", texto: "Otros gastos de personal" },
  { c: "6.7", texto: "ITBIS pagado en proporcionalidad" },
  { c: "7", texto: "GASTOS POR TRABAJOS, SUMINISTROS Y SERVICIOS", total: true },
  { c: "7.1", texto: "Honorarios por servicios profesionales (personas físicas)" }, { c: "7.2", texto: "Honorarios por servicios profesionales (personas morales)" },
  { c: "7.3", texto: "Honorarios por servicios del exterior (Ley No. 392-07)" }, { c: "7.4", texto: "Honorarios por servicios del exterior (personas físicas y morales)" },
  { c: "7.5", texto: "Seguridad, mensajería, transportes y otros servicios (personas físicas)" },
  { c: "7.6", texto: "Seguridad, mensajería, transportes y otros servicios (personas morales)" },
  { c: "7.7", texto: "Otros gastos por trabajos, suministros y servicios" }, { c: "7.8", texto: "ITBIS pagado en proporcionalidad" },
  { c: "8", texto: "ARRENDAMIENTOS", total: true },
  { c: "8.1", texto: "De inmuebles (a personas físicas)" }, { c: "8.2", texto: "De inmuebles (a personas morales)" }, { c: "8.3", texto: "Otros arrendamientos" },
  { c: "8.4", texto: "ITBIS pagado en proporcionalidad" },
  { c: "9", texto: "GASTOS DE ACTIVOS FIJOS", total: true },
  { c: "9.1", texto: "Depreciación de activos fijos (categoría 1)" }, { c: "9.2", texto: "Depreciación de activos fijos (categoría 2)" },
  { c: "9.3", texto: "Depreciación de activos fijos (categoría 3)" }, { c: "9.4", texto: "Reparaciones de activos fijos (categoría 1)" },
  { c: "9.5", texto: "Reparaciones de activos fijos (categoría 2 y 3)" }, { c: "9.6", texto: "Mantenimiento de los activos fijos" },
  { c: "9.7", texto: "Amortización bienes intangibles" }, { c: "9.8", texto: "Amortización mejoras en propiedades arrendadas" },
  { c: "9.9", texto: "ITBIS pagado en proporcionalidad" },
  { c: "10", texto: "GASTOS DE REPRESENTACIÓN", total: true },
  { c: "10.1", texto: "Relaciones públicas" }, { c: "10.2", texto: "Publicidad" }, { c: "10.3", texto: "Viajes" }, { c: "10.4", texto: "Donaciones" },
  { c: "10.5", texto: "Donaciones a Proindustria (Ley No. 392-07)" }, { c: "10.6", texto: "Otros gastos de representación" },
  { c: "10.7", texto: "Promociones" }, { c: "10.8", texto: "ITBIS pagado en proporcionalidad" },
  { c: "11", texto: "OTRAS DEDUCCIONES ADMITIDAS", total: true },
  { c: "11.1", texto: "Primas de seguros" }, { c: "11.2", texto: "Cuotas y otras contribuciones" },
  { c: "11.4", texto: "Destrucción de inventario autorizado por DGII" },
  { c: "12", texto: "GASTOS FINANCIEROS", total: true },
  { c: "12.1", texto: "Por préstamos con instituciones financieras locales" }, { c: "12.2", texto: "Por préstamos con entidades del exterior" },
  { c: "12.3", texto: "Por préstamos con entidades relacionadas locales" }, { c: "12.4", texto: "Por préstamos con entidades relacionadas del exterior" },
  { c: "12.5", texto: "Por préstamos con personas físicas" }, { c: "12.6", texto: "Por préstamos con personas físicas relacionadas locales" },
  { c: "12.7", texto: "Por préstamos con personas físicas relacionadas en el exterior" },
  { c: "12.8", texto: "Por retención de impuesto a la emisión de cheques y pagos por transferencias" },
  { c: "12.9", texto: "Por préstamos con entidades acogidas a regímenes especiales" }, { c: "12.10", texto: "Otros gastos financieros" },
  { c: "13", texto: "GASTOS EXTRAORDINARIOS", total: true },
  { c: "13.1", texto: "Por pérdidas en ventas de activos depreciables" }, { c: "13.2", texto: "Por pérdidas en ventas de bienes de capital" },
  { c: "13.3", texto: "Pérdidas por cuentas incobrables" }, { c: "13.4", texto: "Provisión cuentas incobrables" },
  { c: "13.5", texto: "Por diferencias negativas cambiarias" }, { c: "13.6", texto: "Otros gastos extraordinarios" },
  { c: "13.7", texto: "Provisión de inventario" }, { c: "13.8", texto: "Otras provisiones" },
  { c: "14", texto: "BENEFICIO (PÉRDIDA) DEL EJERCICIO ANTES DE IMPUESTO SOBRE LA RENTA", total: true },
  { c: "15", texto: "TOTAL", total: true },
];

// Casillas a las que se asigna una cuenta (las de detalle, más 5 y 9, que no tienen subcasillas).
const asignable = (cs: Casilla[]) => cs.filter((x) => !x.total || x.c === "5" || x.c === "9").map((x) => x.c);
export const ASIGNABLES: Record<Anexo, string[]> = { A1: asignable(A1).filter((c) => c !== "5"), B1: asignable(B1) };
export const nombreCasilla = (clave: string) => {
  const [anexo, c] = clave.split(":") as [Anexo, string];
  const x = (anexo === "A1" ? A1 : B1).find((k) => k.c === c);
  return x ? `${anexo === "A1" ? "A-1" : "B-1"} ${c} ${x.texto}` : clave;
};
export const esCasillaIr2 = (v: string) => {
  const [anexo, c] = v.split(":");
  return (anexo === "A1" || anexo === "B1") && ASIGNABLES[anexo].includes(c);
};

// Casilla sugerida por el código y el nombre de la cuenta en el catálogo dominicano; la firma la cambia por cuenta.
// Categorías de depreciación del Código Tributario (art. 287): 1 edificaciones; 2 automóviles, equipos y muebles de
// oficina y computadoras; 3 los demás activos depreciables.
export function casillaSugerida(codigo: string, tipo: TipoCuenta, nombre: string): string | null {
  const n = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const a = (c: string) => `A1:${c}`, b = (c: string) => `B1:${c}`;
  if (tipo === "activo") {
    if (codigo.startsWith("1101")) return a("1.1");
    if (/incobrable/.test(n)) return a("5.5");
    if (/depreciacion acumulada/.test(n)) return a(/edificac/.test(n) ? "5.1" : "5.3");
    if (/amortizacion acumulada/.test(n)) return a("5.7");
    if (codigo.startsWith("1102")) return a(/client/.test(n) ? "1.2" : /relacionad/.test(n) ? "1.3" : "1.4");
    if (codigo.startsWith("1103") || /inventario/.test(n)) return a(/materia prima/.test(n) ? "1.6" : /proceso/.test(n) ? "1.7" : "1.5");
    if (/anticipad|adelantad/.test(n) && codigo.startsWith("11") && /gasto/.test(n)) return a("1.10");
    if (codigo.startsWith("11")) return a("1.11");
    if (/terreno/.test(n)) return a("2.5");
    if (/edificac/.test(n)) return a("2.1");
    if (/vehicul|automovil|mobiliario|equipo|computo|computador|muebles/.test(n)) return a("2.3");
    if (codigo.startsWith("1201")) return a("2.4");
    if (/software|licencia|intangible/.test(n)) return a("4.3");
    if (/deposito/.test(n)) return a("3.1");
    if (/accion/.test(n)) return a("3.2");
    return a("4.1");
  }
  if (tipo === "pasivo") {
    if (codigo.startsWith("2101")) return a("7.2");
    if (codigo.startsWith("2102")) return a("7.3");
    if (codigo.startsWith("2104") || (codigo.startsWith("21") && /prestamo/.test(n))) return a("7.1");
    if (/anticipo.*client|cobro.*anticipad/.test(n)) return a("7.5");
    if (codigo.startsWith("21")) return a("7.4");
    if (codigo.startsWith("22")) return a(/hipotec/.test(n) ? "8.1" : /accionista|socio/.test(n) ? "8.8" : "8.2");
    return a("9");
  }
  if (tipo === "patrimonio") {
    if (codigo.startsWith("3101")) return a("10.1");
    if (/reserva legal/.test(n)) return a("10.2");
    if (/revaluac/.test(n)) return a("10.3");
    if (/resultado del ejercicio|utilidad del ejercicio/.test(n)) return a("10.5");
    if (/resultados acumulados|ejercicios anteriores|utilidades retenidas/.test(n)) return a("10.4");
    return a("10.6");
  }
  if (tipo === "ingreso") {
    if (/devoluc|descuento/.test(n)) return b(/devoluc/.test(n) ? "1.3" : "1.4");
    if (/export/.test(n)) return b("1.2");
    if (/interes/.test(n)) return b("2.1");
    if (/dividend/.test(n)) return b("2.3");
    if (/cambiari/.test(n)) return b("3.3");
    if (codigo.startsWith("41")) return b("1.1");
    if (codigo.startsWith("4201")) return b("2.6");
    return b("3.5");
  }
  if (tipo === "costo") return b("5");
  // Gastos. El ISR del ejercicio no va en el B-1 (que llega al beneficio antes del impuesto).
  if (codigo.startsWith("63")) return null;
  if (/sueldo|salario/.test(n)) return b("6.1");
  if (/regalia|bonific|vacacion/.test(n)) return b("6.2");
  if (/tss|seguridad social/.test(n)) return b("6.4");
  if (/infotep/.test(n)) return b("6.5");
  if (codigo.startsWith("6101")) return b("6.6");
  if (/honorario/.test(n)) return b("7.2");
  if (/alquiler|arrendamiento/.test(n)) return b("8.2");
  if (/depreciacion/.test(n)) return b("9.2");
  if (/amortizacion/.test(n)) return b("9.7");
  if (/reparac/.test(n)) return b("9.5");
  if (/mantenimiento/.test(n)) return b("9.6");
  if (/publicidad|mercadeo/.test(n)) return b("10.2");
  if (/viaje/.test(n)) return b("10.3");
  if (/donac/.test(n)) return b("10.4");
  if (/representac|relaciones publicas/.test(n)) return b("10.1");
  if (/seguro/.test(n)) return b("11.1");
  if (/cheques y transferencias|0\.15|0\.20/.test(n)) return b("12.8");
  if (/interes/.test(n)) return b("12.1");
  if (/cambiari/.test(n)) return b("13.5");
  if (/incobrable/.test(n)) return b("13.3");
  if (codigo.startsWith("62")) return b("12.10");
  return b("7.7");
}

type Detalle = { cuentaId: string; codigo: string; nombre: string; monto: bigint };
export type Anexo1 = { valores: Record<string, bigint>; detalle: Record<string, Detalle[]>; sinCasilla: Detalle[] };

const sumar = (v: Record<string, bigint>, cs: string[]) => cs.reduce((t, c) => t + (v[c] ?? 0n), 0n);
const hijas = (cs: Casilla[], padre: string) => cs.filter((x) => x.c.startsWith(`${padre}.`)).map((x) => x.c);

async function casillasDeCuentas(tx: Tx) {
  const filas = await tx<{ id: string; codigo: string; nombre: string; tipo: TipoCuenta; casilla_ir2: string | null }[]>`
    SELECT id, codigo, nombre, tipo, casilla_ir2 FROM cuentas WHERE de_detalle`;
  return new Map(filas.map((f) => [f.id, f.casilla_ir2 ?? casillaSugerida(f.codigo, f.tipo, f.nombre)]));
}

// Anexo A-1 al cierre del ejercicio. Las provisiones (casilla 5) se muestran en positivo y se restan, como en el formulario.
export async function anexoA1(tx: Tx, fin: string, mesCierre: number): Promise<Anexo1> {
  const casillas = await casillasDeCuentas(tx);
  const saldos = await saldosPorCuenta(tx, fin, fin);
  const ejercicio = await saldosPorCuenta(tx, inicioEjercicio(fin, mesCierre), fin);
  const r: Anexo1 = { valores: {}, detalle: {}, sinCasilla: [] };
  const poner = (c: string, d: Detalle) => {
    r.valores[c] = (r.valores[c] ?? 0n) + d.monto;
    (r.detalle[c] ??= []).push(d);
  };
  let resultados = 0n;
  for (const s of saldos) {
    if (!s.de_detalle) continue;
    if (s.tipo === "ingreso" || s.tipo === "costo" || s.tipo === "gasto") { resultados -= s.final; continue; }
    if (s.final === 0n) continue;
    const casilla = casillas.get(s.id);
    const natural = s.tipo === "activo" ? s.final : -s.final;
    const d = { cuentaId: s.id, codigo: s.codigo, nombre: s.nombre, monto: natural };
    if (!casilla?.startsWith("A1:")) { r.sinCasilla.push(d); continue; }
    const c = casilla.slice(3);
    poner(c, c.startsWith("5.") ? { ...d, monto: -natural } : d);
  }
  // Resultados todavía sin cerrar: los del ejercicio a 10.5 y los de años anteriores a 10.4.
  const delEjercicio = -ejercicio.filter((s) => s.de_detalle && (s.tipo === "ingreso" || s.tipo === "costo" || s.tipo === "gasto"))
    .reduce((t, s) => t + s.debe - s.haber, 0n);
  if (delEjercicio) poner("10.5", { cuentaId: "", codigo: "", nombre: "Resultado del ejercicio sin cerrar", monto: delEjercicio });
  if (resultados - delEjercicio) poner("10.4", { cuentaId: "", codigo: "", nombre: "Resultados de ejercicios anteriores sin cerrar", monto: resultados - delEjercicio });
  const v = r.valores;
  for (const g of ["1", "2", "3", "4", "5", "7", "8", "10"]) v[g] = sumar(v, hijas(A1, g));
  v["6"] = v["1"] + v["2"] + v["3"] + v["4"] - v["5"];
  v["9"] ??= 0n;
  v["11"] = v["7"] + v["8"] + v["9"] + v["10"];
  return r;
}

// Anexo B-1 del ejercicio (sin los asientos de cierre). Devoluciones y descuentos en positivo, que se restan.
export async function anexoB1(tx: Tx, inicio: string, fin: string): Promise<Anexo1> {
  const casillas = await casillasDeCuentas(tx);
  const saldos = await saldosPorCuenta(tx, inicio, fin, true);
  const r: Anexo1 = { valores: {}, detalle: {}, sinCasilla: [] };
  for (const s of saldos) {
    if (!s.de_detalle || !(s.tipo === "ingreso" || s.tipo === "costo" || s.tipo === "gasto")) continue;
    const mov = s.debe - s.haber;
    if (mov === 0n) continue;
    const casilla = casillas.get(s.id);
    if (s.codigo.startsWith("63") && !casilla) continue; // ISR del ejercicio: no va en el B-1
    const c = casilla?.startsWith("B1:") ? casilla.slice(3) : null;
    const resta = c === "1.3" || c === "1.4";
    const monto = s.tipo === "ingreso" && !resta ? -mov : mov;
    const d = { cuentaId: s.id, codigo: s.codigo, nombre: s.nombre, monto };
    if (!c) { r.sinCasilla.push(d); continue; }
    r.valores[c] = (r.valores[c] ?? 0n) + monto;
    (r.detalle[c] ??= []).push(d);
  }
  const v = r.valores;
  const g = (c: string) => v[c] ?? 0n;
  for (const k of ["2", "3", "6", "7", "8", "9", "10", "11", "12", "13"]) v[k] = sumar(v, hijas(B1, k));
  v["5"] = g("5");
  v["1"] = g("1.1") + g("1.2") - g("1.3") - g("1.4") + g("1.5");
  v["4"] = v["1"] + v["2"] + v["3"];
  const gastos = ["5", "6", "7", "8", "9", "10", "11", "12", "13"].reduce((t, k) => t + g(k), 0n);
  v["14"] = v["4"] - gastos;
  v["15"] = gastos + v["14"];
  return r;
}

// B-1 con el costo de venta del anexo D en la casilla 5 (así lo pide el formulario), con 14 y 15 recalculadas.
export function b1ConCostoD(valores: Record<string, bigint>, costo: bigint): Record<string, bigint> {
  const v: Record<string, bigint> = { ...valores, "5": costo };
  const gastos = ["5", "6", "7", "8", "9", "10", "11", "12", "13"].reduce((t, k) => t + (v[k] ?? 0n), 0n);
  v["14"] = (v["4"] ?? 0n) - gastos;
  v["15"] = gastos + v["14"];
  return v;
}

// Inventarios del A-1 (casillas 1.5 a 1.8): el inicial y el final del costo de venta del anexo D.
export const INVENTARIOS = ["1.5", "1.6", "1.7", "1.8"];
export const inventarioDe = (a1: Anexo1) => INVENTARIOS.reduce((t, c) => t + (a1.valores[c] ?? 0n), 0n);

// Compras del ejercicio para el costo de venta (anexo D, casillas 35 a 37): solo las líneas de bienes cargadas a cuentas
// de inventario o de costo (decisión de Joannie, 4-nov-2026), sin impuestos y en pesos; las notas de crédito del
// proveedor restan. El ITBIS de esas líneas va a la 37 cuando se llevó al costo (B02, E32, B13, «ITBIS al costo» o
// empresa no contribuyente).
export async function comprasDeBienes(tx: Tx, inicio: string, fin: string) {
  const casillas = await casillasDeCuentas(tx);
  const tipos = new Map((await tx<{ id: string; tipo: TipoCuenta }[]>`SELECT id, tipo FROM cuentas WHERE de_detalle`).map((c) => [c.id, c.tipo]));
  const [{ contribuye_itbis }] = await tx<{ contribuye_itbis: boolean }[]>`SELECT contribuye_itbis FROM empresas`;
  const lineas = await tx<{ cuenta_id: string; subtotal: string; itbis: string; tasa: string; tipo: string; al_costo: boolean; exterior: boolean }[]>`
    SELECT l.cuenta_id, l.subtotal::text, l.itbis::text, c.tasa::text, c.tipo_comprobante AS tipo, c.itbis_al_costo AS al_costo,
           (p.del_exterior OR c.tipo_comprobante = 'B17') AS exterior
      FROM lineas_compra l JOIN compras c ON c.id = l.compra_id JOIN proveedores p ON p.id = c.proveedor_id
     WHERE c.estado = 'registrada' AND NOT c.anulada AND l.clase = 'bien' AND c.fecha BETWEEN ${inicio} AND ${fin}`;
  const r = { locales: 0n, exterior: 0n, itbisAlCosto: 0n };
  for (const l of lineas) {
    const casilla = casillas.get(l.cuenta_id);
    if (!(tipos.get(l.cuenta_id) === "costo" || INVENTARIOS.some((c) => casilla === `A1:${c}`))) continue;
    const signo = l.tipo === "B04" || l.tipo === "E34" ? -1n : 1n;
    const tasa = tasaDeTexto(l.tasa);
    const monto = signo * aPesos(aCentavos(l.subtotal), tasa);
    if (l.exterior) r.exterior += monto; else r.locales += monto;
    if (l.al_costo || !contribuye_itbis) r.itbisAlCosto += signo * aPesos(aCentavos(l.itbis), tasa);
  }
  return r;
}

// Anexo J: cantidad y monto (sin impuestos, en pesos) de los comprobantes del año, de lo registrado para el 607 y el 606.
export type FilaJ = { c: string; texto: string; cantidad: number; monto: bigint; resta?: boolean; total?: boolean };
export async function anexoJ(tx: Tx, inicio: string, fin: string): Promise<{ filas: FilaJ[]; avisos: string[] }> {
  const ventas = await tx<{ tipo: string; subtotal: string; tasa: string }[]>`
    SELECT tipo_ncf AS tipo, subtotal::text, tasa::text FROM facturas
     WHERE estado = 'emitida' AND NOT anulada AND fecha BETWEEN ${inicio} AND ${fin}`;
  const compras = await tx<{ tipo: string; subtotal: string; tasa: string }[]>`
    SELECT tipo_comprobante AS tipo, subtotal::text, tasa::text FROM compras
     WHERE estado = 'registrada' AND NOT anulada AND fecha BETWEEN ${inicio} AND ${fin}`;
  const avisos: string[] = [];
  const agrupar = (lista: typeof ventas, mapa: Record<string, string>, origen: string) => {
    const r: Record<string, { cantidad: number; monto: bigint }> = {};
    const otros = new Set<string>();
    for (const x of lista) {
      const c = mapa[x.tipo];
      if (!c) { otros.add(x.tipo); continue; }
      r[c] ??= { cantidad: 0, monto: 0n };
      r[c].cantidad++;
      r[c].monto += aPesos(aCentavos(x.subtotal), tasaDeTexto(x.tasa));
    }
    if (otros.size) avisos.push(`${origen}: los comprobantes ${[...otros].join(", ")} no tienen casilla en el anexo J; revisa dónde los reporta la contadora.`);
    return r;
  };
  const v = agrupar(ventas, { B01: "1.1", E31: "1.1", B02: "1.2", E32: "1.2", B03: "1.3", E33: "1.3", B04: "1.4", E34: "1.4", B12: "1.5", B14: "1.6", E44: "1.6", B15: "1.7", E45: "1.7" }, "Ventas");
  const c = agrupar(compras, { B01: "2.1", E31: "2.1", B03: "2.2", E33: "2.2", B04: "2.3", E34: "2.3", B15: "2.4", E45: "2.4", B14: "2.5", E44: "2.5", B11: "2.7", E41: "2.7", B13: "2.8", E43: "2.8" }, "Compras");
  const fila = (c: string, texto: string, d?: { cantidad: number; monto: bigint }, resta = false): FilaJ => ({ c, texto, cantidad: d?.cantidad ?? 0, monto: d?.monto ?? 0n, resta });
  const ventasF = [
    fila("1.1", "Comprobante válido para crédito fiscal", v["1.1"]), fila("1.2", "Comprobante consumidor final", v["1.2"]),
    fila("1.3", "Comprobantes nota de débito", v["1.3"]), fila("1.4", "Comprobantes nota de crédito (−)", v["1.4"], true),
    fila("1.5", "Comprobante registro único de ingresos", v["1.5"]), fila("1.6", "Comprobante registro regímenes especiales", v["1.6"]),
    fila("1.7", "Comprobantes gubernamentales", v["1.7"]), fila("1.8", "Otras operaciones que no requieren comprobantes"),
  ];
  const comprasF = [
    fila("2.1", "Comprobante válido para crédito fiscal", c["2.1"]), fila("2.2", "Comprobantes nota de débito", c["2.2"]),
    fila("2.3", "Comprobantes nota de crédito (−)", c["2.3"], true), fila("2.4", "Comprobantes gubernamentales", c["2.4"]),
    fila("2.5", "Comprobante registro regímenes especiales", c["2.5"]),
  ];
  const total = (fs: FilaJ[]) => fs.reduce((t, f) => ({ cantidad: t.cantidad + f.cantidad, monto: t.monto + (f.resta ? -f.monto : f.monto) }), { cantidad: 0, monto: 0n });
  const informales = [fila("2.7", "Comprobantes pago a proveedores informales", c["2.7"]), fila("2.8", "Comprobantes gastos menores", c["2.8"])];
  return {
    filas: [
      ...ventasF, { c: "1.9", texto: "Total montos de operaciones por ingresos", ...total(ventasF), total: true },
      ...comprasF, { c: "2.6", texto: "Total montos de gastos sustentados con comprobantes", ...total(comprasF), total: true },
      ...informales, { c: "2.9", texto: "Total montos de operaciones de gastos (2.7 + 2.8)", ...total(informales), total: true },
    ],
    avisos,
  };
}
