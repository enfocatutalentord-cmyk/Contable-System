// Cuentas por pagar: compras pendientes, antigüedad por proveedor y estado de cuenta.
import { tramo } from "./cxc.ts";
import type { Tx } from "./db";
import { aCentavos } from "./montos.ts";
import { aPesos, tasaDeTexto } from "./ventas.ts";

export type CompraPendiente = {
  id: string; ncf: string; fecha: string; vence: string; moneda: string; tasa: string; proveedor_id: string; proveedor: string;
  total: string; itbis: string; subtotal: string; saldo: bigint; dias: number; saldoPesos: bigint;
};

// Compras con saldo pendiente a una fecha de corte (cuenta pagos y notas de crédito del proveedor hasta ese día).
export async function comprasPendientesAl(tx: Tx, corte: string, proveedorId?: string): Promise<CompraPendiente[]> {
  const filas = await tx<(Omit<CompraPendiente, "saldo" | "saldoPesos"> & { saldo: string })[]>`
    SELECT c.id, c.ncf, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, to_char(c.vence, 'YYYY-MM-DD') AS vence, c.moneda, c.tasa::text,
           c.proveedor_id, p.nombre AS proveedor, c.total::text, c.itbis::text, c.subtotal::text, (${corte}::date - c.vence) AS dias,
           (c.total
            - COALESCE((SELECT sum(a.monto) FROM aplicaciones_pago a JOIN pagos pa ON pa.id = a.pago_id
                         WHERE a.compra_id = c.id AND NOT pa.anulado AND pa.fecha <= ${corte}), 0)
            - COALESCE((SELECT sum(n.total) FROM compras n
                         WHERE n.compra_origen_id = c.id AND n.estado = 'registrada' AND NOT n.anulada AND n.fecha <= ${corte}), 0))::text AS saldo
      FROM compras c JOIN proveedores p ON p.id = c.proveedor_id
     WHERE c.tipo_comprobante NOT IN ('B04', 'E34') AND c.estado = 'registrada' AND NOT c.anulada AND c.fecha <= ${corte}
       AND (${proveedorId ?? null}::uuid IS NULL OR c.proveedor_id = ${proveedorId ?? null}::uuid)
     ORDER BY p.nombre, c.vence, c.ncf`;
  return filas
    .map((c) => {
      const saldo = aCentavos(c.saldo);
      return { ...c, saldo, saldoPesos: aPesos(saldo, tasaDeTexto(c.tasa)) };
    })
    .filter((c) => c.saldo > 0n);
}

export type FilaAntiguedadCxp = { proveedorId: string; proveedor: string; tramos: bigint[]; total: bigint; compras: CompraPendiente[] };

// Antigüedad de saldos por proveedor, en pesos al valor en libros (tasa de cada compra).
export async function antiguedadCxp(tx: Tx, corte: string) {
  const porProveedor = new Map<string, FilaAntiguedadCxp>();
  for (const c of await comprasPendientesAl(tx, corte)) {
    let fila = porProveedor.get(c.proveedor_id);
    if (!fila) {
      fila = { proveedorId: c.proveedor_id, proveedor: c.proveedor, tramos: [0n, 0n, 0n, 0n, 0n], total: 0n, compras: [] };
      porProveedor.set(c.proveedor_id, fila);
    }
    fila.tramos[tramo(c.dias)] += c.saldoPesos;
    fila.total += c.saldoPesos;
    fila.compras.push(c);
  }
  const filas = [...porProveedor.values()];
  const totales = [0, 1, 2, 3, 4].map((i) => filas.reduce((s, f) => s + f.tramos[i], 0n));
  return { filas, totales, total: totales.reduce((s, t) => s + t, 0n) };
}

export type MovimientoProveedor = {
  fecha: string; tipo: "compra" | "nota_credito" | "pago"; documento: string; enlace: string; detalle: string;
  cargo: bigint; abono: bigint; saldo: bigint;
};

// Estado de cuenta de un proveedor: lo que le debemos. Las compras suben el saldo; pagos y notas de crédito lo bajan.
export async function estadoCuentaProveedor(tx: Tx, empresaId: string, proveedorId: string, moneda: string, desde: string, hasta: string) {
  const [ini] = await tx<{ saldo: string }[]>`
    SELECT (COALESCE((SELECT sum(total) FROM compras WHERE proveedor_id = ${proveedorId} AND moneda = ${moneda} AND estado = 'registrada'
                       AND NOT anulada AND tipo_comprobante NOT IN ('B04', 'E34') AND fecha < ${desde}), 0)
          - COALESCE((SELECT sum(total) FROM compras WHERE proveedor_id = ${proveedorId} AND moneda = ${moneda} AND estado = 'registrada'
                       AND NOT anulada AND tipo_comprobante IN ('B04', 'E34') AND fecha < ${desde}), 0)
          - COALESCE((SELECT sum(a.monto) FROM aplicaciones_pago a JOIN pagos p ON p.id = a.pago_id
                       WHERE p.proveedor_id = ${proveedorId} AND p.moneda = ${moneda} AND NOT p.anulado AND p.fecha < ${desde}), 0))::text AS saldo`;
  const docs = await tx<{ fecha: string; nota: boolean; ncf: string; id: string; total: string; origen: string | null; vence: string }[]>`
    SELECT to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.tipo_comprobante IN ('B04', 'E34') AS nota, c.ncf, c.id, c.total::text,
           o.ncf AS origen, to_char(c.vence, 'YYYY-MM-DD') AS vence
      FROM compras c LEFT JOIN compras o ON o.id = c.compra_origen_id
     WHERE c.proveedor_id = ${proveedorId} AND c.moneda = ${moneda} AND c.estado = 'registrada' AND NOT c.anulada
       AND c.fecha BETWEEN ${desde} AND ${hasta}`;
  const pagos = await tx<{ fecha: string; numero: number; total: string; compras: string; referencia: string | null }[]>`
    SELECT to_char(p.fecha, 'YYYY-MM-DD') AS fecha, p.numero, sum(a.monto)::text AS total,
           string_agg(c.ncf, ', ' ORDER BY c.ncf) AS compras, p.referencia
      FROM pagos p JOIN aplicaciones_pago a ON a.pago_id = p.id JOIN compras c ON c.id = a.compra_id
     WHERE p.proveedor_id = ${proveedorId} AND p.moneda = ${moneda} AND NOT p.anulado AND p.fecha BETWEEN ${desde} AND ${hasta}
     GROUP BY p.id`;
  const base = `/e/${empresaId}`;
  const movs: Omit<MovimientoProveedor, "saldo">[] = [
    ...docs.map((d) => d.nota
      ? { fecha: d.fecha, tipo: "nota_credito" as const, documento: d.ncf, enlace: `${base}/compras/${d.id}`, detalle: `Nota de crédito a ${d.origen}`, cargo: 0n, abono: aCentavos(d.total) }
      : { fecha: d.fecha, tipo: "compra" as const, documento: d.ncf, enlace: `${base}/compras/${d.id}`, detalle: `Compra, vence ${d.vence}`, cargo: aCentavos(d.total), abono: 0n }),
    ...pagos.map((p) => ({
      fecha: p.fecha, tipo: "pago" as const, documento: `Pago ${p.numero}`, enlace: `${base}/pagos/${p.numero}`,
      detalle: `Pago de ${p.compras}${p.referencia ? ` · ${p.referencia}` : ""}`, cargo: 0n, abono: aCentavos(p.total),
    })),
  ];
  const orden = { compra: 0, nota_credito: 1, pago: 2 };
  movs.sort((a, b) => a.fecha.localeCompare(b.fecha) || orden[a.tipo] - orden[b.tipo] || a.documento.localeCompare(b.documento));
  const inicial = aCentavos(ini.saldo);
  let saldo = inicial;
  const movimientos = movs.map((m) => {
    saldo += m.cargo - m.abono;
    return { ...m, saldo };
  });
  return { inicial, movimientos, final: saldo };
}
