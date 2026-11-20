import type { Tx } from "./db.ts";
import { aCentavos, deCentavos } from "./montos.ts";
import type { GrupoIngreso } from "./presupuesto.ts";

// Prioridad 1.6 (parte 2): metas de ahorro, deudas, balance por banco e ingresos por cliente del presupuesto de Empire.
// Los aportes y los pagos nacen en «Registrar salidas» (cada uno con su asiento); aquí se ve lo que se quiere lograr y lo que se debe.

export class ErrorPresupuesto extends Error {}

// Meses que faltan de hoy a la fecha objetivo (al menos 1: el mes en curso cuenta).
export function mesesHasta(hoy: string, objetivo: string): number {
  const m = (Number(objetivo.slice(0, 4)) - Number(hoy.slice(0, 4))) * 12 + Number(objetivo.slice(5, 7)) - Number(hoy.slice(5, 7));
  return Math.max(1, m + 1);
}

// Aporte mensual para llegar a la meta (sube al centavo entero siguiente); 0 si ya se cumplió o no tiene fecha.
export function aporteNecesario(falta: bigint, hoy: string, objetivo: string | null): bigint {
  if (falta <= 0n || !objetivo) return 0n;
  const n = BigInt(mesesHasta(hoy, objetivo));
  return (falta + n - 1n) / n;
}

export type EstadoMeta = "Activa" | "Cumplida" | "Vencida" | "Quitada";
export const estadoMeta = (acumulado: bigint, meta: bigint, objetivo: string | null, hoy: string, activa: boolean): EstadoMeta =>
  !activa ? "Quitada" : acumulado >= meta ? "Cumplida" : objetivo && objetivo < hoy ? "Vencida" : "Activa";

export type Meta = {
  id: string; nombre: string; tipo: string; meta: bigint; objetivo: string | null; cuentaId: string | null; cuenta: string | null; activa: boolean;
  acumulado: bigint; falta: bigint; aporte: bigint; estado: EstadoMeta;
};

export async function listarMetas(tx: Tx, hoy: string): Promise<Meta[]> {
  const f = await tx<{ id: string; nombre: string; tipo: string; monto_meta: string; objetivo: string | null; cuenta_id: string | null; cuenta: string | null; activa: boolean; acumulado: string }[]>`
    SELECT m.id, m.nombre, m.tipo, m.monto_meta::text, to_char(m.fecha_objetivo, 'YYYY-MM-DD') AS objetivo, m.cuenta_id, c.codigo || ' · ' || c.nombre AS cuenta, m.activa,
           COALESCE((SELECT sum(s.monto) FROM salidas s WHERE s.meta_id = m.id AND NOT s.anulada), 0)::text AS acumulado
      FROM metas_ahorro m LEFT JOIN cuentas c ON c.id = m.cuenta_id ORDER BY m.activa DESC, m.fecha_objetivo NULLS LAST, m.nombre`;
  return f.map((x) => {
    const meta = aCentavos(x.monto_meta), acumulado = aCentavos(x.acumulado), falta = meta > acumulado ? meta - acumulado : 0n;
    return {
      id: x.id, nombre: x.nombre, tipo: x.tipo, meta, objetivo: x.objetivo, cuentaId: x.cuenta_id, cuenta: x.cuenta, activa: x.activa, acumulado, falta,
      aporte: x.activa ? aporteNecesario(falta, hoy, x.objetivo) : 0n, estado: estadoMeta(acumulado, meta, x.objetivo, hoy, x.activa),
    };
  });
}

export async function guardarMeta(tx: Tx, empresaId: string, d: { id?: string; nombre: string; tipo: string; meta: bigint; objetivo: string | null; cuentaId: string | null }) {
  const nombre = d.nombre.trim(), tipo = d.tipo.trim() || "Otro";
  if (!nombre) throw new ErrorPresupuesto("Escribe el nombre de la meta.");
  if (d.meta <= 0n) throw new ErrorPresupuesto("Escribe el monto de la meta.");
  if (d.id) {
    await tx`UPDATE metas_ahorro SET nombre = ${nombre}, tipo = ${tipo}, monto_meta = ${deCentavos(d.meta)}, fecha_objetivo = ${d.objetivo}, cuenta_id = ${d.cuentaId} WHERE id = ${d.id}`;
    return d.id;
  }
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO metas_ahorro (empresa_id, nombre, tipo, monto_meta, fecha_objetivo, cuenta_id)
    VALUES (${empresaId}, ${nombre}, ${tipo}, ${deCentavos(d.meta)}, ${d.objetivo}, ${d.cuentaId}) RETURNING id`;
  return id;
}

export const quitarMeta = (tx: Tx, id: string) => tx`UPDATE metas_ahorro SET activa = false WHERE id = ${id}`;

export const TIPOS_DEUDA = ["Tarjeta de crédito", "Préstamo personal", "Préstamo hipotecario", "Préstamo vehicular", "Financiamiento negocio", "Deuda personal/familiar", "Otro"];
export const TIPO_DEUDA_NEGOCIO = "Financiamiento negocio";
export const TIPOS_META = ["Fondo de emergencia", "Viajes", "Inversiones", "Vehículo", "Vivienda", "Educación", "Equipo/Negocio", "Otro"];

export type EstadoDeuda = "Al día" | "Saldada" | "Quitada";
export type Deuda = {
  id: string; acreedor: string; tipo: string; deNegocio: boolean; inicial: bigint; pagoMensual: bigint; cuentaPrestamo: string | null; cuentaInteres: string | null;
  pagado: bigint; intereses: bigint; capital: bigint; saldo: bigint; porcentaje: number; liquidacion: string | null; estado: EstadoDeuda; activa: boolean;
};

// Fecha estimada de liquidación (AAAA-MM): meses que faltan según el pago mensual objetivo, desde hoy.
export function fechaLiquidacion(saldo: bigint, pagoMensual: bigint, hoy: string): string | null {
  if (saldo <= 0n || pagoMensual <= 0n) return null;
  const n = Number((saldo + pagoMensual - 1n) / pagoMensual);
  return new Date(Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
}

export async function listarDeudas(tx: Tx, hoy: string): Promise<Deuda[]> {
  const f = await tx<{ id: string; acreedor: string; tipo: string; de_negocio: boolean; balance_inicial: string; pago_mensual: string; prestamo: string | null; interes: string | null; activa: boolean; pagado: string; intereses: string }[]>`
    SELECT d.id, d.acreedor, d.tipo, d.de_negocio, d.balance_inicial::text, d.pago_mensual::text, p.codigo || ' · ' || p.nombre AS prestamo, i.codigo || ' · ' || i.nombre AS interes, d.activa,
           COALESCE((SELECT sum(s.monto) FROM salidas s WHERE s.deuda_id = d.id AND NOT s.anulada), 0)::text AS pagado,
           COALESCE((SELECT sum(s.interes) FROM salidas s WHERE s.deuda_id = d.id AND NOT s.anulada), 0)::text AS intereses
      FROM deudas_presupuesto d LEFT JOIN cuentas p ON p.id = d.cuenta_prestamo_id LEFT JOIN cuentas i ON i.id = d.cuenta_interes_id
     ORDER BY d.activa DESC, d.acreedor`;
  return f.map((x) => {
    const inicial = aCentavos(x.balance_inicial), pagado = aCentavos(x.pagado), intereses = aCentavos(x.intereses), capital = pagado - intereses;
    const saldo = inicial > capital ? inicial - capital : 0n;
    const pagoMensual = aCentavos(x.pago_mensual);
    return {
      id: x.id, acreedor: x.acreedor, tipo: x.tipo, deNegocio: x.de_negocio, inicial, pagoMensual, cuentaPrestamo: x.prestamo, cuentaInteres: x.interes,
      pagado, intereses, capital, saldo, porcentaje: inicial > 0n ? Math.min(100, Number((capital * 1000n) / inicial) / 10) : 0,
      liquidacion: fechaLiquidacion(saldo, pagoMensual, hoy), estado: !x.activa ? "Quitada" : saldo <= 0n && inicial > 0n ? "Saldada" : "Al día", activa: x.activa,
    };
  });
}

export async function guardarDeuda(tx: Tx, empresaId: string, d: {
  id?: string; acreedor: string; tipo: string; inicial: bigint; pagoMensual: bigint; cuentaPrestamoId: string | null; cuentaInteresId: string | null;
}) {
  const acreedor = d.acreedor.trim(), tipo = d.tipo.trim();
  if (!acreedor) throw new ErrorPresupuesto("Escribe a quién se le debe.");
  if (!tipo) throw new ErrorPresupuesto("Elige el tipo de deuda.");
  const deNegocio = tipo === TIPO_DEUDA_NEGOCIO;
  if (deNegocio && (!d.cuentaPrestamoId || !d.cuentaInteresId)) throw new ErrorPresupuesto("Un financiamiento del negocio necesita la cuenta del préstamo y la de intereses.");
  const prestamo = deNegocio ? d.cuentaPrestamoId : null, interes = deNegocio ? d.cuentaInteresId : null;
  if (d.id) {
    await tx`UPDATE deudas_presupuesto SET acreedor = ${acreedor}, tipo = ${tipo}, de_negocio = ${deNegocio}, balance_inicial = ${deCentavos(d.inicial)},
             pago_mensual = ${deCentavos(d.pagoMensual)}, cuenta_prestamo_id = ${prestamo}, cuenta_interes_id = ${interes} WHERE id = ${d.id}`;
    return d.id;
  }
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO deudas_presupuesto (empresa_id, acreedor, tipo, de_negocio, balance_inicial, pago_mensual, cuenta_prestamo_id, cuenta_interes_id)
    VALUES (${empresaId}, ${acreedor}, ${tipo}, ${deNegocio}, ${deCentavos(d.inicial)}, ${deCentavos(d.pagoMensual)}, ${prestamo}, ${interes}) RETURNING id`;
  return id;
}

export const quitarDeuda = (tx: Tx, id: string) => tx`UPDATE deudas_presupuesto SET activa = false WHERE id = ${id}`;

export type CuentaSimple = { id: string; codigo: string; nombre: string };
// Cuentas para armar una meta (efectivo y ahorro) y un financiamiento (pasivo y gasto financiero).
export async function cuentasDePresupuesto(tx: Tx) {
  const ahorro = await tx<CuentaSimple[]>`SELECT id, codigo, nombre FROM cuentas WHERE de_detalle AND activa AND codigo LIKE '1101%' ORDER BY codigo`;
  const pasivos = await tx<CuentaSimple[]>`SELECT id, codigo, nombre FROM cuentas WHERE de_detalle AND activa AND (codigo LIKE '21%' OR codigo LIKE '22%') ORDER BY codigo`;
  const intereses = await tx<CuentaSimple[]>`SELECT id, codigo, nombre FROM cuentas WHERE de_detalle AND activa AND codigo LIKE '62%' ORDER BY codigo`;
  return { ahorro, pasivos, intereses };
}

export type SaldoBanco = { id: string; codigo: string; nombre: string; saldo: bigint; entradas: bigint; salidas: bigint };
// Balance de cada cuenta de efectivo según la contabilidad al fin del mes (lo que entró y salió en el mes y el saldo): es el mismo registro, visto por banco.
export async function saldosDeBancos(tx: Tx, desde: string, hasta: string): Promise<SaldoBanco[]> {
  const f = await tx<{ id: string; codigo: string; nombre: string; saldo: string; entradas: string; salidas: string }[]>`
    SELECT c.id, c.codigo, c.nombre,
           COALESCE(sum(l.debe - l.haber) FILTER (WHERE a.fecha <= ${hasta}), 0)::text AS saldo,
           COALESCE(sum(l.debe) FILTER (WHERE a.fecha BETWEEN ${desde} AND ${hasta}), 0)::text AS entradas,
           COALESCE(sum(l.haber) FILTER (WHERE a.fecha BETWEEN ${desde} AND ${hasta}), 0)::text AS salidas
      FROM cuentas c
      LEFT JOIN lineas_asiento l ON l.cuenta_id = c.id
      LEFT JOIN asientos a ON a.id = l.asiento_id AND a.estado = 'contabilizado'
     WHERE c.de_detalle AND c.activa AND (c.codigo LIKE '1101%' OR EXISTS (SELECT 1 FROM cuentas_bancarias b WHERE b.cuenta_id = c.id))
     GROUP BY c.id, c.codigo, c.nombre ORDER BY c.codigo`;
  return f.map((x) => ({ id: x.id, codigo: x.codigo, nombre: x.nombre, saldo: aCentavos(x.saldo), entradas: aCentavos(x.entradas), salidas: aCentavos(x.salidas) }));
}

export type IngresoCliente = { cliente: string; grupo: GrupoIngreso; cobrado: bigint };
// Detalle de ingresos del mes por cliente: lo cobrado en el mes, en el grupo de su factura (igualas, servicios o generales).
export async function ingresosPorCliente(tx: Tx, desde: string, hasta: string): Promise<IngresoCliente[]> {
  const f = await tx<{ cliente: string; grupo: GrupoIngreso; cobrado: string }[]>`
    SELECT cl.nombre AS cliente,
           CASE WHEN f.acuerdo_id IS NOT NULL THEN 'igualas'
                WHEN EXISTS (SELECT 1 FROM lineas_factura l JOIN unidades_negocio u ON u.id = l.unidad_id WHERE l.factura_id = f.id AND lower(u.nombre) LIKE 'firma contable%') THEN 'servicios'
                ELSE 'generales' END AS grupo,
           sum(a.monto)::text AS cobrado
      FROM cobros c JOIN aplicaciones_cobro a ON a.cobro_id = c.id JOIN facturas f ON f.id = a.factura_id JOIN clientes cl ON cl.id = f.cliente_id
     WHERE NOT c.anulado AND c.anticipo_id IS NULL AND c.fecha BETWEEN ${desde} AND ${hasta}
     GROUP BY cl.id, cl.nombre, 2 ORDER BY cl.nombre`;
  return f.map((x) => ({ cliente: x.cliente, grupo: x.grupo, cobrado: aCentavos(x.cobrado) }));
}
