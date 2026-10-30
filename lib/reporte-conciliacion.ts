import { createHash } from "node:crypto";
import { ErrorContable } from "./asientos.ts";
import { cuentaBancaria, type CuentaBancaria } from "./bancos.ts";
import type { Tx } from "./db";
import { periodoDe } from "./formatos-dgii.ts";
import { aCentavos, deCentavos } from "./montos.ts";

// Reporte de conciliación bancaria del mes (Fase 5, parte 3), con la forma clásica que usan QuickBooks Online
// («Reconciliation report») y Xero («Bank reconciliation summary»): saldo del estado de cuenta más lo que está en libros y
// el banco todavía no refleja (depósitos y pagos en tránsito) contra el saldo en libros más lo que el banco refleja y
// libros no (movimientos sin registrar, registrados después del cierre o excluidos). Las dos cifras ajustadas deben dar igual.

export type PartidaLibros = { id: string; fecha: string; numero: number; concepto: string; documento: string | null; referencia: string | null; monto: bigint };
export type PartidaBanco = { id: string; fecha: string; descripcion: string; referencia: string | null; monto: bigint; motivo: string };

export type Reporte = {
  cuenta: CuentaBancaria; periodo: string; inicio: string; fin: string; comparable: boolean;
  saldoBanco: bigint; saldoLibros: bigint;
  depositosTransito: PartidaLibros[]; pagosTransito: PartidaLibros[];
  bancoNoLibros: PartidaBanco[];
  apertura: { libros: bigint; banco: bigint; diferencia: bigint };
  bancoAjustado: bigint; librosAjustado: bigint; diferencia: bigint;
  pendientesMes: number; huella: string;
  cierre: { cerrado_en: Date; quien: string | null; huella: string; saldo_banco: string; saldo_libros: string } | null;
};

const suma = (xs: { monto: bigint }[]) => xs.reduce((s, x) => s + x.monto, 0n);

export async function reporteConciliacion(tx: Tx, cuentaBancariaId: string, periodo: string): Promise<Reporte> {
  const p = periodoDe(periodo);
  if (!p) throw new ErrorContable("Mes no válido");
  const cuenta = await cuentaBancaria(tx, cuentaBancariaId);
  const fin = p.fin;
  const [s] = await tx<{ banco: string; libros: string; antes: string }[]>`
    SELECT (b.saldo_inicial + COALESCE((SELECT sum(m.monto) FROM movimientos_banco m WHERE m.cuenta_bancaria_id = b.id AND m.fecha <= ${fin}), 0))::numeric(18,2)::text AS banco,
           COALESCE((SELECT sum(l.debe - l.haber) FROM lineas_asiento l JOIN asientos a ON a.id = l.asiento_id
                      WHERE l.cuenta_id = b.cuenta_id AND a.estado = 'contabilizado' AND a.fecha <= ${fin}), 0)::numeric(18,2)::text AS libros,
           COALESCE((SELECT sum(l.debe - l.haber) FROM lineas_asiento l JOIN asientos a ON a.id = l.asiento_id
                      WHERE l.cuenta_id = b.cuenta_id AND a.estado = 'contabilizado' AND a.fecha < b.fecha_inicial), 0)::numeric(18,2)::text AS antes
      FROM cuentas_bancarias b WHERE b.id = ${cuentaBancariaId}`;

  // Movimientos del banco hasta el cierre que libros no explica al cierre: por conciliar, excluidos, o conciliados con
  // registros de fecha posterior.
  const movs = await tx<{ id: string; fecha: string; descripcion: string; referencia: string | null; monto: string; estado: string; motivo_exclusion: string | null; ultima: string | null }[]>`
    SELECT m.id, to_char(m.fecha, 'YYYY-MM-DD') AS fecha, m.descripcion, m.referencia, m.monto::text, m.estado, m.motivo_exclusion,
           (SELECT to_char(max(a.fecha), 'YYYY-MM-DD') FROM conciliaciones_banco c JOIN lineas_asiento l ON l.id = c.linea_id
              JOIN asientos a ON a.id = l.asiento_id WHERE c.movimiento_id = m.id) AS ultima
      FROM movimientos_banco m WHERE m.cuenta_bancaria_id = ${cuentaBancariaId} AND m.fecha <= ${fin}
     ORDER BY m.fecha, m.orden`;
  const bancoNoLibros: PartidaBanco[] = [];
  let pendientesMes = 0;
  for (const m of movs) {
    const base = { id: m.id, fecha: m.fecha, descripcion: m.descripcion, referencia: m.referencia, monto: aCentavos(m.monto) };
    if (m.estado === "pendiente") { pendientesMes++; bancoNoLibros.push({ ...base, motivo: "Por conciliar" }); }
    else if (m.estado === "excluido") bancoNoLibros.push({ ...base, motivo: `Excluido: ${m.motivo_exclusion ?? ""}` });
    else if (m.ultima && m.ultima > fin) bancoNoLibros.push({ ...base, motivo: `Registrado el ${m.ultima.split("-").reverse().join("/")}` });
  }

  // Lo registrado en libros desde la fecha inicial hasta el cierre que el banco no refleja al cierre.
  const lineas = await tx<{ id: string; fecha: string; numero: number; concepto: string; referencia: string | null; neto: string; cobro: number | null; pago: number | null; cliente: string | null; proveedor: string | null }[]>`
    SELECT l.id, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.numero, a.concepto, COALESCE(co.referencia, pa.referencia, a.referencia) AS referencia,
           (l.debe - l.haber)::text AS neto, co.numero AS cobro, pa.numero AS pago, cl.nombre AS cliente, pr.nombre AS proveedor
      FROM cuentas_bancarias b
      JOIN lineas_asiento l ON l.cuenta_id = b.cuenta_id
      JOIN asientos a ON a.id = l.asiento_id
      LEFT JOIN cobros co ON co.asiento_id = a.id LEFT JOIN clientes cl ON cl.id = co.cliente_id
      LEFT JOIN pagos pa ON pa.asiento_id = a.id LEFT JOIN proveedores pr ON pr.id = pa.proveedor_id
     WHERE b.id = ${cuentaBancariaId} AND a.estado = 'contabilizado' AND a.fecha >= b.fecha_inicial AND a.fecha <= ${fin}
       AND NOT EXISTS (
         SELECT 1 FROM conciliaciones_banco c JOIN movimientos_banco m ON m.id = c.movimiento_id
          WHERE c.linea_id = l.id AND m.fecha <= ${fin}
            AND NOT EXISTS (SELECT 1 FROM conciliaciones_banco c2 JOIN lineas_asiento l2 ON l2.id = c2.linea_id JOIN asientos a2 ON a2.id = l2.asiento_id
                             WHERE c2.movimiento_id = m.id AND a2.fecha > ${fin}))
     ORDER BY a.fecha, a.numero`;
  const partidas: PartidaLibros[] = lineas.map((l) => ({
    id: l.id, fecha: l.fecha, numero: l.numero, concepto: l.concepto, referencia: l.referencia, monto: aCentavos(l.neto),
    documento: l.cobro !== null ? `Cobro ${l.cobro} · ${l.cliente}` : l.pago !== null ? `Pago ${l.pago} · ${l.proveedor}` : null,
  }));
  const depositosTransito = partidas.filter((x) => x.monto > 0n);
  const pagosTransito = partidas.filter((x) => x.monto < 0n);

  const saldoBanco = aCentavos(s.banco), saldoLibros = aCentavos(s.libros);
  const apertura = { libros: aCentavos(s.antes), banco: aCentavos(cuenta.saldo_inicial), diferencia: aCentavos(s.antes) - aCentavos(cuenta.saldo_inicial) };
  const bancoAjustado = saldoBanco + suma(partidas);
  const librosAjustado = saldoLibros + suma(bancoNoLibros) - apertura.diferencia;
  const huella = createHash("sha256").update(JSON.stringify([
    deCentavos(saldoBanco), deCentavos(saldoLibros), partidas.map((x) => [x.id, deCentavos(x.monto)]), bancoNoLibros.map((x) => [x.id, x.motivo, deCentavos(x.monto)]),
  ])).digest("hex");
  const [cierre] = await tx<NonNullable<Reporte["cierre"]>[]>`
    SELECT c.cerrado_en, u.nombre AS quien, c.huella, c.saldo_banco::text, c.saldo_libros::text
      FROM cierres_conciliacion c LEFT JOIN usuarios u ON u.id = c.cerrado_por
     WHERE c.cuenta_bancaria_id = ${cuentaBancariaId} AND c.periodo = ${periodo}`;
  return {
    cuenta, periodo, inicio: p.inicio, fin, comparable: cuenta.moneda === "DOP",
    saldoBanco, saldoLibros, depositosTransito, pagosTransito, bancoNoLibros, apertura,
    bancoAjustado, librosAjustado, diferencia: bancoAjustado - librosAjustado, pendientesMes, huella, cierre: cierre ?? null,
  };
}

// Cerrar la conciliación del mes: sin movimientos por conciliar hasta el cierre y con diferencia cero.
export async function cerrarConciliacion(tx: Tx, d: { cuentaBancariaId: string; periodo: string; usuarioId: string }) {
  const r = await reporteConciliacion(tx, d.cuentaBancariaId, d.periodo);
  if (r.cierre) throw new ErrorContable("Ese mes ya está cerrado");
  if (!r.comparable) throw new ErrorContable("Las cuentas en dólares se revisan en el reporte; el cierre compara saldos en pesos");
  if (r.pendientesMes > 0) throw new ErrorContable(`Quedan ${r.pendientesMes} movimiento${r.pendientesMes > 1 ? "s" : ""} por conciliar hasta el ${r.fin.split("-").reverse().join("/")}.`);
  if (r.diferencia !== 0n) throw new ErrorContable(`La conciliación tiene una diferencia de ${deCentavos(r.diferencia)}: revísala antes de cerrar.`);
  const [ultimo] = await tx<{ f: string | null }[]>`SELECT to_char(max(fecha), 'YYYY-MM-DD') AS f FROM movimientos_banco WHERE cuenta_bancaria_id = ${d.cuentaBancariaId}`;
  if (!ultimo.f || ultimo.f < r.inicio) throw new ErrorContable("Importa primero el estado de cuenta de ese mes.");
  const resumen = {
    depositosTransito: deCentavos(suma(r.depositosTransito)), pagosTransito: deCentavos(suma(r.pagosTransito)),
    bancoNoLibros: deCentavos(suma(r.bancoNoLibros)), apertura: deCentavos(r.apertura.diferencia),
  };
  await tx`INSERT INTO cierres_conciliacion (empresa_id, cuenta_bancaria_id, periodo, saldo_banco, saldo_libros, partidas, huella, cerrado_por)
           VALUES (empresa_actual(), ${d.cuentaBancariaId}, ${d.periodo}, ${deCentavos(r.saldoBanco)}, ${deCentavos(r.saldoLibros)},
                   ${tx.json(resumen)}, ${r.huella}, ${d.usuarioId})`;
  return r;
}

export async function reabrirConciliacion(tx: Tx, d: { cuentaBancariaId: string; periodo: string }) {
  const r = await tx`DELETE FROM cierres_conciliacion WHERE cuenta_bancaria_id = ${d.cuentaBancariaId} AND periodo = ${d.periodo}`;
  if (r.count === 0) throw new ErrorContable("Ese mes no está cerrado");
}

export async function cierresDe(tx: Tx, cuentaBancariaId: string) {
  return tx<{ periodo: string; saldo_banco: string; cerrado_en: Date; quien: string | null }[]>`
    SELECT c.periodo, c.saldo_banco::text, c.cerrado_en, u.nombre AS quien
      FROM cierres_conciliacion c LEFT JOIN usuarios u ON u.id = c.cerrado_por
     WHERE c.cuenta_bancaria_id = ${cuentaBancariaId} ORDER BY c.periodo DESC LIMIT 24`;
}
