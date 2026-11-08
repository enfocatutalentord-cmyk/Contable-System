import { esDeudora, type TipoCuenta } from "./catalogo-rd.ts";
import type { Tx } from "./db";
import { aCentavos } from "./montos.ts";
import { CONCEPTOS_BALANCE, saldoContable } from "./saldos-registro.ts";

export type CuentaSaldo = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  nivel: number;
  de_detalle: boolean;
  inicial: bigint; // debe - haber antes de «desde»
  debe: bigint;
  haber: bigint;
  final: bigint; // debe - haber al cierre de «hasta»
};

// Saldos de todas las cuentas en un rango, con las cuentas de grupo sumando a sus hijas por código.
// Con `sinCierre`, no cuenta los asientos de cierre del ejercicio (el estado de resultados de un año cerrado sigue mostrando su
// utilidad). Con `unidad` (id o «sin»), solo las líneas de esa unidad de negocio (o las que no tienen unidad).
export async function saldosPorCuenta(tx: Tx, desde: string, hasta: string, sinCierre = false, unidad: string | null = null): Promise<CuentaSaldo[]> {
  if (!(await llevaContabilidad(tx))) return saldosDeRegistro(tx, desde, hasta, unidad);
  const sinUnidad = unidad === "sin";
  const unidadId = unidad && !sinUnidad ? unidad : null;
  const filas = await tx<
    { id: string; codigo: string; nombre: string; tipo: TipoCuenta; nivel: number; de_detalle: boolean; inicial: string; debe: string; haber: string }[]
  >`
    SELECT c.id, c.codigo, c.nombre, c.tipo, c.nivel, c.de_detalle,
           COALESCE(sum(l.debe - l.haber) FILTER (WHERE a.fecha < ${desde}), 0)::text AS inicial,
           COALESCE(sum(l.debe) FILTER (WHERE a.fecha BETWEEN ${desde} AND ${hasta}), 0)::text AS debe,
           COALESCE(sum(l.haber) FILTER (WHERE a.fecha BETWEEN ${desde} AND ${hasta}), 0)::text AS haber
      FROM cuentas c
      LEFT JOIN lineas_asiento l ON l.cuenta_id = c.id
                                AND (${unidad}::text IS NULL OR (${sinUnidad} AND l.unidad_id IS NULL) OR l.unidad_id = ${unidadId}::uuid)
      LEFT JOIN asientos a ON a.id = l.asiento_id AND a.estado = 'contabilizado' AND a.fecha <= ${hasta}
                           AND (NOT ${sinCierre} OR a.origen <> 'cierre')
     GROUP BY c.id
     ORDER BY c.codigo`;

  const cuentas: CuentaSaldo[] = filas.map((f) => ({
    ...f,
    inicial: aCentavos(f.inicial),
    debe: aCentavos(f.debe),
    haber: aCentavos(f.haber),
    final: 0n,
  }));
  // Las líneas de borradores y asientos anulados se unen con a = NULL; la consulta ya las deja fuera de los FILTER.
  return sumarAGrupos(cuentas);
}

// Las cuentas de grupo suman a sus hijas de detalle por código; el saldo final es inicial + debe − haber.
function sumarAGrupos(cuentas: CuentaSaldo[]): CuentaSaldo[] {
  const porCodigo = new Map(cuentas.map((c) => [c.codigo, c]));
  for (const c of cuentas) {
    if (!c.de_detalle) continue;
    for (const anc of ancestros(c.codigo)) {
      const p = porCodigo.get(anc);
      if (!p || p.de_detalle) continue;
      p.inicial += c.inicial;
      p.debe += c.debe;
      p.haber += c.haber;
    }
  }
  for (const c of cuentas) c.final = c.inicial + c.debe - c.haber;
  return cuentas;
}

function ancestros(codigo: string): string[] {
  const r: string[] = [];
  let c = codigo;
  while (c.length > 1) {
    c = c.length === 2 ? c.slice(0, 1) : c.slice(0, c.length - 2);
    r.push(c);
  }
  return r;
}

// Saldo con el signo de la naturaleza de la cuenta (positivo = saldo normal).
export function saldoNatural(tipo: TipoCuenta, debeMenosHaber: bigint): bigint {
  return esDeudora(tipo) ? debeMenosHaber : -debeMenosHaber;
}

export function primerDiaMes(fecha: string): string {
  return `${fecha.slice(0, 7)}-01`;
}

export function ultimoDiaMes(fecha: string): string {
  const [a, m] = fecha.split("-").map(Number);
  const d = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${fecha.slice(0, 7)}-${String(d).padStart(2, "0")}`;
}

export function fechaValida(f: string | undefined | null): f is string {
  return !!f && /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(f));
}

// ───────────── Clientes sin contabilidad (rediseño R5) ─────────────

// ¿La empresa en curso lleva contabilidad con asientos? (la propia siempre; un cliente, si lo tiene marcado en su ficha).
export async function llevaContabilidad(tx: Tx): Promise<boolean> {
  const [r] = await tx<{ si: boolean }[]>`SELECT empresa_lleva_contabilidad() AS si`;
  return r?.si ?? true;
}

export type Movimiento = { cuenta_id: string; codigo: string; fecha: string; debe: bigint; haber: bigint; origen: string; unidad_id: string | null };

// Ingresos, costos y gastos de las facturas emitidas y las compras registradas (en pesos), como si fueran líneas de asiento:
// la factura al haber de su cuenta de ingreso (la nota de crédito al debe); la compra al debe de su cuenta de costo o gasto, con el
// ITBIS que va al costo y los otros impuestos (la nota de crédito del proveedor al haber).
export async function movimientosDeRegistro(tx: Tx, desde: string, hasta: string): Promise<Movimiento[]> {
  const filas = await tx<{ cuenta_id: string; codigo: string; fecha: string; debe: string; haber: string; origen: string; unidad_id: string | null }[]>`
    SELECT c.id AS cuenta_id, c.codigo, to_char(f.fecha, 'YYYY-MM-DD') AS fecha,
           CASE WHEN f.tipo_ncf IN ('B04', 'E34') THEN round(l.subtotal * f.tasa, 2) ELSE 0 END::text AS debe,
           CASE WHEN f.tipo_ncf IN ('B04', 'E34') THEN 0 ELSE round(l.subtotal * f.tasa, 2) END::text AS haber, 'factura' AS origen, l.unidad_id
      FROM lineas_factura l JOIN facturas f ON f.id = l.factura_id JOIN cuentas c ON c.id = l.cuenta_ingreso_id
     WHERE f.estado = 'emitida' AND NOT f.anulada AND f.fecha BETWEEN ${desde} AND ${hasta} AND c.tipo IN ('ingreso', 'costo', 'gasto')
    UNION ALL
    SELECT c.id, c.codigo, to_char(p.fecha, 'YYYY-MM-DD'),
           CASE WHEN p.tipo_comprobante IN ('B04', 'E34') THEN 0 ELSE round((l.subtotal + l.otros + CASE WHEN p.itbis_al_costo THEN l.itbis ELSE 0 END) * p.tasa, 2) END::text,
           CASE WHEN p.tipo_comprobante IN ('B04', 'E34') THEN round((l.subtotal + l.otros + CASE WHEN p.itbis_al_costo THEN l.itbis ELSE 0 END) * p.tasa, 2) ELSE 0 END::text,
           'compra', l.unidad_id
      FROM lineas_compra l JOIN compras p ON p.id = l.compra_id JOIN cuentas c ON c.id = l.cuenta_id
     WHERE p.estado = 'registrada' AND NOT p.anulada AND p.fecha BETWEEN ${desde} AND ${hasta} AND c.tipo IN ('ingreso', 'costo', 'gasto')`;
  return filas.map((f) => ({ ...f, debe: aCentavos(f.debe), haber: aCentavos(f.haber) }));
}

const inicioDelEjercicio = (f: string, mesCierre: number) => {
  const a = Number(f.slice(0, 4)), m = Number(f.slice(5, 7));
  if (mesCierre === 12) return `${a}-01-01`;
  const anio = m > mesCierre ? a : a - 1;
  return `${anio}-${String(mesCierre + 1).padStart(2, "0")}-01`;
};

// Los mismos saldos que saldosPorCuenta, sin asientos: resultados de las facturas y compras (desde el inicio del ejercicio, porque
// los años anteriores vienen ya en «Resultados de años anteriores» del formulario) y balance del último corte del formulario.
async function saldosDeRegistro(tx: Tx, desde: string, hasta: string, unidad: string | null): Promise<CuentaSaldo[]> {
  const [{ mes_cierre }] = await tx<{ mes_cierre: number }[]>`SELECT mes_cierre FROM empresas WHERE id = empresa_actual()`;
  const filas = await tx<{ id: string; codigo: string; nombre: string; tipo: TipoCuenta; nivel: number; de_detalle: boolean }[]>`
    SELECT id, codigo, nombre, tipo, nivel, de_detalle FROM cuentas ORDER BY codigo`;
  const cuentas: CuentaSaldo[] = filas.map((f) => ({ ...f, inicial: 0n, debe: 0n, haber: 0n, final: 0n }));
  const porId = new Map(cuentas.map((c) => [c.id, c]));
  const porCodigo = new Map(cuentas.map((c) => [c.codigo, c]));

  const inicio = [desde, inicioDelEjercicio(hasta, mes_cierre)].sort()[0];
  for (const m of await movimientosDeRegistro(tx, inicio, hasta)) {
    if (unidad && (unidad === "sin" ? m.unidad_id !== null : m.unidad_id !== unidad)) continue;
    const c = porId.get(m.cuenta_id);
    if (!c) continue;
    if (m.fecha < desde) c.inicial += m.debe - m.haber;
    else { c.debe += m.debe; c.haber += m.haber; }
  }

  // Balance: el corte vigente antes de «desde» da el saldo inicial; el vigente a «hasta», el final. La diferencia es el movimiento.
  if (unidad === null) {
    const cortes = await tx<{ fecha: string; montos: Record<string, string> }[]>`
      SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, montos FROM saldos_registro WHERE fecha <= ${hasta} ORDER BY fecha DESC`;
    const alFinal = cortes[0] ?? null;
    const alInicio = cortes.find((x) => x.fecha < desde) ?? null;
    for (const k of CONCEPTOS_BALANCE) {
      const c = porCodigo.get(k.codigo);
      if (!c || !c.de_detalle) continue;
      const ini = saldoContable(k.lado, aCentavos(alInicio?.montos[k.clave] ?? "0"));
      const fin = saldoContable(k.lado, aCentavos(alFinal?.montos[k.clave] ?? "0"));
      c.inicial += ini;
      if (fin >= ini) c.debe += fin - ini; else c.haber += ini - fin;
    }
  }
  return sumarAGrupos(cuentas);
}
