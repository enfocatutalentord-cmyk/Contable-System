import type { Tx } from "./db";
import { aCentavos } from "./montos.ts";
import { aPesos, tasaDeTexto } from "./ventas.ts";

export type FacturaPendiente = {
  id: string; ncf: string; fecha: string; vence: string; moneda: string; tasa: string;
  cliente_id: string; cliente: string; total: string; saldo: bigint; dias: number; saldoPesos: bigint;
};

export const TRAMOS = ["Por vencer", "1-30 días", "31-60 días", "61-90 días", "Más de 90"] as const;

export function tramo(diasVencida: number): number {
  if (diasVencida <= 0) return 0;
  if (diasVencida <= 30) return 1;
  if (diasVencida <= 60) return 2;
  if (diasVencida <= 90) return 3;
  return 4;
}

// Facturas con saldo pendiente a una fecha de corte (cuenta cobros y notas de crédito hasta ese día).
export async function pendientesAl(tx: Tx, corte: string, clienteId?: string): Promise<FacturaPendiente[]> {
  const filas = await tx<(Omit<FacturaPendiente, "saldo" | "saldoPesos"> & { saldo: string })[]>`
    SELECT f.id, f.ncf, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, to_char(f.vence, 'YYYY-MM-DD') AS vence, f.moneda,
           f.tasa::text, f.cliente_id, c.nombre AS cliente, f.total::text,
           (${corte}::date - f.vence) AS dias,
           (f.total
            - COALESCE((SELECT sum(a.monto) FROM aplicaciones_cobro a JOIN cobros co ON co.id = a.cobro_id
                         WHERE a.factura_id = f.id AND NOT co.anulado AND co.fecha <= ${corte}), 0)
            - COALESCE((SELECT sum(n.total) FROM facturas n
                         WHERE n.factura_origen_id = f.id AND n.estado = 'emitida' AND NOT n.anulada AND n.fecha <= ${corte}), 0))::text AS saldo
      FROM facturas f JOIN clientes c ON c.id = f.cliente_id
     WHERE f.tipo_ncf <> 'B04' AND f.estado = 'emitida' AND NOT f.anulada AND f.fecha <= ${corte}
       AND (${clienteId ?? null}::uuid IS NULL OR f.cliente_id = ${clienteId ?? null}::uuid)
     ORDER BY c.nombre, f.vence, f.ncf`;
  return filas
    .map((f) => {
      const saldo = aCentavos(f.saldo);
      return { ...f, saldo, saldoPesos: aPesos(saldo, tasaDeTexto(f.tasa)) };
    })
    .filter((f) => f.saldo > 0n);
}

export type FilaAntiguedad = { clienteId: string; cliente: string; tramos: bigint[]; total: bigint; facturas: FacturaPendiente[] };

// Antigüedad de saldos por cliente, en pesos al valor en libros (tasa de cada factura).
export async function antiguedad(tx: Tx, corte: string) {
  const pendientes = await pendientesAl(tx, corte);
  const porCliente = new Map<string, FilaAntiguedad>();
  for (const f of pendientes) {
    let fila = porCliente.get(f.cliente_id);
    if (!fila) {
      fila = { clienteId: f.cliente_id, cliente: f.cliente, tramos: [0n, 0n, 0n, 0n, 0n], total: 0n, facturas: [] };
      porCliente.set(f.cliente_id, fila);
    }
    fila.tramos[tramo(f.dias)] += f.saldoPesos;
    fila.total += f.saldoPesos;
    fila.facturas.push(f);
  }
  const filas = [...porCliente.values()];
  const totales = [0, 1, 2, 3, 4].map((i) => filas.reduce((s, f) => s + f.tramos[i], 0n));
  return { filas, totales, total: totales.reduce((s, t) => s + t, 0n) };
}

export type MovimientoCuenta = {
  fecha: string; tipo: "factura" | "nota_credito" | "cobro"; documento: string; enlace: string; detalle: string;
  cargo: bigint; abono: bigint; saldo: bigint;
};

// Estado de cuenta de un cliente en una moneda: saldo inicial, facturas, notas de crédito y cobros.
export async function estadoCuenta(tx: Tx, empresaId: string, clienteId: string, moneda: string, desde: string, hasta: string) {
  const [ini] = await tx<{ saldo: string }[]>`
    SELECT (COALESCE((SELECT sum(total) FROM facturas WHERE cliente_id = ${clienteId} AND moneda = ${moneda}
                       AND estado = 'emitida' AND NOT anulada AND tipo_ncf <> 'B04' AND fecha < ${desde}), 0)
          - COALESCE((SELECT sum(total) FROM facturas WHERE cliente_id = ${clienteId} AND moneda = ${moneda}
                       AND estado = 'emitida' AND NOT anulada AND tipo_ncf = 'B04' AND fecha < ${desde}), 0)
          - COALESCE((SELECT sum(a.monto) FROM aplicaciones_cobro a JOIN cobros c ON c.id = a.cobro_id
                       WHERE c.cliente_id = ${clienteId} AND c.moneda = ${moneda} AND NOT c.anulado AND c.fecha < ${desde}), 0))::text AS saldo`;
  const docs = await tx<{ fecha: string; tipo: "factura" | "nota_credito"; ncf: string; id: string; total: string; origen: string | null; vence: string }[]>`
    SELECT to_char(f.fecha, 'YYYY-MM-DD') AS fecha, CASE WHEN f.tipo_ncf = 'B04' THEN 'nota_credito' ELSE 'factura' END AS tipo,
           f.ncf, f.id, f.total::text, o.ncf AS origen, to_char(f.vence, 'YYYY-MM-DD') AS vence
      FROM facturas f LEFT JOIN facturas o ON o.id = f.factura_origen_id
     WHERE f.cliente_id = ${clienteId} AND f.moneda = ${moneda} AND f.estado = 'emitida' AND NOT f.anulada AND f.fecha BETWEEN ${desde} AND ${hasta}`;
  const cobros = await tx<{ fecha: string; numero: number; total: string; facturas: string; referencia: string | null }[]>`
    SELECT to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.numero, sum(a.monto)::text AS total,
           string_agg(f.ncf, ', ' ORDER BY f.ncf) AS facturas, c.referencia
      FROM cobros c JOIN aplicaciones_cobro a ON a.cobro_id = c.id JOIN facturas f ON f.id = a.factura_id
     WHERE c.cliente_id = ${clienteId} AND c.moneda = ${moneda} AND NOT c.anulado AND c.fecha BETWEEN ${desde} AND ${hasta}
     GROUP BY c.id`;
  const base = `/e/${empresaId}`;
  const movs: Omit<MovimientoCuenta, "saldo">[] = [
    ...docs.map((d) => d.tipo === "factura"
      ? { fecha: d.fecha, tipo: d.tipo, documento: d.ncf, enlace: `${base}/facturas/${d.id}`, detalle: `Factura, vence ${d.vence}`, cargo: aCentavos(d.total), abono: 0n }
      : { fecha: d.fecha, tipo: d.tipo, documento: d.ncf, enlace: `${base}/facturas/${d.id}`, detalle: `Nota de crédito a ${d.origen}`, cargo: 0n, abono: aCentavos(d.total) }),
    ...cobros.map((c) => ({
      fecha: c.fecha, tipo: "cobro" as const, documento: `Recibo ${c.numero}`, enlace: `${base}/cobros/${c.numero}`,
      detalle: `Cobro a ${c.facturas}${c.referencia ? ` · ${c.referencia}` : ""}`, cargo: 0n, abono: aCentavos(c.total),
    })),
  ];
  const orden = { factura: 0, nota_credito: 1, cobro: 2 };
  movs.sort((a, b) => a.fecha.localeCompare(b.fecha) || orden[a.tipo] - orden[b.tipo] || a.documento.localeCompare(b.documento));
  const inicial = aCentavos(ini.saldo);
  let saldo = inicial;
  const movimientos: MovimientoCuenta[] = movs.map((m) => {
    saldo += m.cargo - m.abono;
    return { ...m, saldo };
  });
  return { inicial, movimientos, final: saldo };
}
