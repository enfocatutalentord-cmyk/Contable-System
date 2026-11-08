import { redondearDiv } from "./calculos.ts";
import { aCentavos, deCentavos, verFecha, verMonto } from "./montos.ts";

// Bloque 2, entrega 2b: igualas (Documento maestro, sección 4). El cálculo de cada mes es puro: monto vigente, tarifa especial
// con fecha, cuota de un acuerdo especial, 10 % de descuento por fidelidad el mes del aniversario y avisos (aniversario a 60
// días, fin de tarifa especial o de acuerdo a 30 días, aumento de 10 % por confirmar).

// Lista de Precios EMP-P01: iguala mínima de RD$4,000, salvo precios de emprendedor y declaraciones en cero.
export const IGUALA_MINIMA = 400000n; // centavos
export const igualaBajoMinimo = (monto: bigint, tipo: string, categoria: string | null) => tipo !== "cero" && categoria !== "emprendedor" && monto < IGUALA_MINIMA;

export const TIPOS_ACUERDO: Record<string, string> = {
  normal: "Normal", arranque: "Plan de Arranque", ajuste: "Ajuste gradual", especial: "Acuerdo especial", cero: "Declaración en cero",
};
export const SERVICIOS_INCLUIDOS: [string, string][] = [
  ["registro", "Registro contable mensual"], ["606_607_608", "606, 607 y 608"], ["it1", "IT-1"], ["ir17", "IR-17"], ["ir3", "IR-3"],
  ["tss", "TSS"], ["nomina", "Nómina"], ["anual", "Declaración anual"], ["asesoria", "Asesoría fiscal básica"],
];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export type AcuerdoCalculo = {
  tipo: string; monto: string; tarifa_especial: string | null; tarifa_hasta: string | null;
  cuota: string | null; deuda_hasta: string | null; inicio: string; dia_facturacion: number;
};
export type LineaIguala = { descripcion: string; precio: bigint; esIguala: boolean };
export type IgualaMes = { fecha: string; lineas: LineaIguala[]; total: bigint; aniversario: boolean; especial: boolean; nota: string | null };

const partes = (f: string) => f.split("-").map(Number) as [number, number, number];
const ultimoDia = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const iso = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const sumarDias = (f: string, n: number) => {
  const d = new Date(`${f}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const nombrePeriodo = (periodo: string) => `${MESES[Number(periodo.slice(4)) - 1]} ${periodo.slice(0, 4)}`;
export const periodoDe = (fecha: string) => fecha.slice(0, 4) + fecha.slice(5, 7);
export const esPeriodo = (p: string) => /^\d{4}(0[1-9]|1[0-2])$/.test(p);

// El día de facturación del mes (el 30 en febrero es el último día).
export function fechaFacturacion(periodo: string, dia: number): string {
  const a = Number(periodo.slice(0, 4)), m = Number(periodo.slice(4));
  return iso(a, m, Math.min(dia, ultimoDia(a, m)));
}

// El aniversario del contrato en un año (el 29 de febrero cae el 28 en años no bisiestos).
function aniversarioEn(inicio: string, anio: number): string {
  const [, m, d] = partes(inicio);
  return iso(anio, m, Math.min(d, ultimoDia(anio, m)));
}

// Lo que se factura en un período. null si el contrato todavía no había empezado.
export function igualaDelMes(a: AcuerdoCalculo, periodo: string): IgualaMes | null {
  const fecha = fechaFacturacion(periodo, a.dia_facturacion);
  if (periodo < periodoDe(a.inicio)) return null;
  const especial = !!(a.tarifa_especial !== null && a.tarifa_hasta && fecha <= a.tarifa_hasta);
  let base = aCentavos(especial ? a.tarifa_especial! : a.monto);
  const [ai, mi] = partes(a.inicio);
  const [af, mf] = partes(fecha);
  const aniversario = mf === mi && af > ai;
  let descripcion = `${a.tipo === "cero" ? "Declaración en cero" : "Iguala"} de ${nombrePeriodo(periodo)}`;
  let nota: string | null = especial ? (base === 0n ? "Mes gratis (Plan de Arranque)" : `Tarifa especial hasta el ${verFecha(a.tarifa_hasta!)}`) : null;
  if (aniversario && base > 0n) {
    const descuento = redondearDiv(base, 10n); // 10 % de descuento por fidelidad
    descripcion += ` · incluye 10 % de descuento por fidelidad (RD$${verMonto(deCentavos(descuento))}) por el aniversario con Empire`;
    base -= descuento;
    nota = "Mes del aniversario: 10 % de descuento por fidelidad";
  }
  const lineas: LineaIguala[] = base > 0n ? [{ descripcion, precio: base, esIguala: true }] : [];
  if (a.cuota && a.deuda_hasta && fecha <= a.deuda_hasta) {
    lineas.push({ descripcion: `Cuota del acuerdo especial de ${nombrePeriodo(periodo)}`, precio: aCentavos(a.cuota), esIguala: false });
  }
  return { fecha, lineas, total: lineas.reduce((s, l) => s + l.precio, 0n), aniversario, especial, nota };
}

export type AvisoIguala = { clave: "aniversario" | "aumento" | "tarifa" | "deuda"; texto: string; aniversario?: string; nuevo?: string };

// Avisos de un acuerdo a la fecha de hoy. `confirmados`: aniversarios cuyo aumento ya se aplicó.
export function avisosAcuerdo(a: AcuerdoCalculo, hoy: string, confirmados: string[]): AvisoIguala[] {
  const avisos: AvisoIguala[] = [];
  const [ai] = partes(a.inicio);
  const [ah] = partes(hoy);
  const esteAnio = aniversarioEn(a.inicio, ah);
  const proximo = esteAnio >= hoy ? esteAnio : aniversarioEn(a.inicio, ah + 1);
  if (Number(proximo.slice(0, 4)) > ai && proximo <= sumarDias(hoy, 60)) {
    avisos.push({ clave: "aniversario", texto: `Aniversario del contrato el ${verFecha(proximo)}: preparar el comunicado de ajuste. Ese mes la iguala lleva 10 % de descuento por fidelidad y el aumento de 10 % aplica desde el mes siguiente, si se confirma.` });
  }
  // El último aniversario ya cumplido (desde el primer año) sin aumento confirmado.
  const pasado = esteAnio <= hoy ? esteAnio : aniversarioEn(a.inicio, ah - 1);
  if (Number(pasado.slice(0, 4)) > ai && !confirmados.includes(pasado) && a.tipo !== "cero") {
    const actual = aCentavos(a.monto);
    const nuevo = deCentavos(actual + redondearDiv(actual, 10n));
    avisos.push({ clave: "aumento", aniversario: pasado, nuevo,
      texto: `Aumento de 10 % por el aniversario del ${verFecha(pasado)} pendiente de confirmar: de RD$${verMonto(a.monto)} a RD$${verMonto(nuevo)}.` });
  }
  if (a.tarifa_hasta && a.tarifa_hasta >= hoy && a.tarifa_hasta <= sumarDias(hoy, 30)) {
    avisos.push({ clave: "tarifa", texto: `La tarifa especial termina el ${verFecha(a.tarifa_hasta)}; después se factura la iguala normal de RD$${verMonto(a.monto)}.` });
  }
  if (a.deuda_hasta && a.deuda_hasta >= hoy && a.deuda_hasta <= sumarDias(hoy, 30)) {
    avisos.push({ clave: "deuda", texto: `El acuerdo especial termina el ${verFecha(a.deuda_hasta)}.` });
  }
  return avisos;
}

// ───── Facturas recurrentes ─────

export const FRECUENCIAS: Record<string, string> = {
  mensual: "Mensual", quincenal: "Quincenal", trimestral: "Trimestral", anual: "Anual", a_solicitud: "A solicitud",
};

// La fecha siguiente según la frecuencia (mensual y trimestral guardan el día; el 31 cae al último día del mes).
export function siguienteFecha(fecha: string, frecuencia: string, diaOriginal = Number(fecha.slice(8))): string {
  if (frecuencia === "quincenal") return sumarDias(fecha, 15);
  const meses = frecuencia === "trimestral" ? 3 : frecuencia === "anual" ? 12 : 1;
  const [a, m] = partes(fecha);
  const total = a * 12 + (m - 1) + meses;
  const na = Math.floor(total / 12), nm = (total % 12) + 1;
  return iso(na, nm, Math.min(diaOriginal, ultimoDia(na, nm)));
}
