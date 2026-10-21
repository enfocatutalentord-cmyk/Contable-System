import type { Tx } from "./db";
import { aCentavos } from "./montos";
import { saldoNatural, saldosPorCuenta, type CuentaSaldo } from "./reportes";

export type LineaDiario = {
  numero: number; fecha: string; concepto: string; referencia: string | null;
  codigo: string; cuenta: string; descripcion: string | null; debe: string; haber: string;
};

export async function libroDiario(tx: Tx, desde: string, hasta: string): Promise<LineaDiario[]> {
  return tx<LineaDiario[]>`
    SELECT a.numero, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.concepto, a.referencia,
           c.codigo, c.nombre AS cuenta, l.descripcion, l.debe::text, l.haber::text
      FROM asientos a JOIN lineas_asiento l ON l.asiento_id = a.id JOIN cuentas c ON c.id = l.cuenta_id
     WHERE NOT a.anulado AND a.fecha BETWEEN ${desde} AND ${hasta}
     ORDER BY a.fecha, a.numero, l.orden`;
}

export type Mayor = {
  cuenta: CuentaSaldo;
  inicial: bigint; // saldo natural
  movimientos: { numero: number; fecha: string; concepto: string; descripcion: string | null; debe: string; haber: string; saldo: bigint }[];
  final: bigint;
};

// Mayor de una cuenta (de detalle o de grupo, en cuyo caso junta todas sus subcuentas).
export async function libroMayor(tx: Tx, cuentaId: string, desde: string, hasta: string): Promise<Mayor | null> {
  const saldos = await saldosPorCuenta(tx, desde, hasta);
  const cuenta = saldos.find((c) => c.id === cuentaId);
  if (!cuenta) return null;
  const filas = await tx<{ numero: number; fecha: string; concepto: string; descripcion: string | null; debe: string; haber: string }[]>`
    SELECT a.numero, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.concepto, l.descripcion, l.debe::text, l.haber::text
      FROM lineas_asiento l JOIN asientos a ON a.id = l.asiento_id JOIN cuentas c ON c.id = l.cuenta_id
     WHERE NOT a.anulado AND a.fecha BETWEEN ${desde} AND ${hasta}
       AND (c.id = ${cuentaId} OR (${!cuenta.de_detalle} AND c.codigo LIKE ${cuenta.codigo + "%"}))
     ORDER BY a.fecha, a.numero, l.orden`;
  const inicial = saldoNatural(cuenta.tipo, cuenta.inicial);
  let saldo = inicial;
  const movimientos = filas.map((f) => {
    saldo += saldoNatural(cuenta.tipo, aCentavos(f.debe) - aCentavos(f.haber));
    return { ...f, saldo };
  });
  return { cuenta, inicial, movimientos, final: saldoNatural(cuenta.tipo, cuenta.final) };
}

export type FilaBalanza = CuentaSaldo & { saldoDeudor: bigint; saldoAcreedor: bigint; inicialDeudor: bigint; inicialAcreedor: bigint };

// Balanza de comprobación: saldo inicial, movimientos y saldo final, en columnas deudor/acreedor.
export async function balanza(tx: Tx, desde: string, hasta: string, nivelMax: number, conCeros: boolean) {
  const saldos = await saldosPorCuenta(tx, desde, hasta);
  const filas: FilaBalanza[] = saldos
    .filter((c) => c.nivel <= nivelMax || (c.de_detalle && nivelMax >= 4))
    .filter((c) => conCeros || c.inicial !== 0n || c.debe !== 0n || c.haber !== 0n)
    .map((c) => ({
      ...c,
      inicialDeudor: c.inicial > 0n ? c.inicial : 0n,
      inicialAcreedor: c.inicial < 0n ? -c.inicial : 0n,
      saldoDeudor: c.final > 0n ? c.final : 0n,
      saldoAcreedor: c.final < 0n ? -c.final : 0n,
    }));
  // Los totales salen de las cuentas de detalle, para no contar dos veces los grupos.
  const detalle = saldos.filter((c) => c.de_detalle);
  const suma = (f: (c: CuentaSaldo) => bigint) => detalle.reduce((s, c) => s + f(c), 0n);
  const totales = {
    inicialDeudor: suma((c) => (c.inicial > 0n ? c.inicial : 0n)),
    inicialAcreedor: suma((c) => (c.inicial < 0n ? -c.inicial : 0n)),
    debe: suma((c) => c.debe),
    haber: suma((c) => c.haber),
    saldoDeudor: suma((c) => (c.final > 0n ? c.final : 0n)),
    saldoAcreedor: suma((c) => (c.final < 0n ? -c.final : 0n)),
  };
  return { filas, totales };
}
