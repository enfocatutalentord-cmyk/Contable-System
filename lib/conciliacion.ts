import { normal } from "./archivos-banco.ts";
import { ErrorContable, insertarAsiento } from "./asientos.ts";
import { aPesos, leerTasa } from "./calculos.ts";
import type { Tx } from "./db";
import { aCentavos, deCentavos } from "./montos.ts";

// Conciliación bancaria (Fase 5, parte 2, migración 019). Cada movimiento del banco se explica con una o varias líneas
// de asiento de la cuenta contable del banco (cobros, pagos, asientos), como «match» de Xero y QuickBooks; si no hay nada
// registrado se registra desde el movimiento (comisiones, impuesto a las transferencias, transferencias entre cuentas).
// Las sugerencias y las reglas no concilian nada solas: una persona confirma.

export type LineaLibro = {
  id: string; asiento_id: string; numero: number; fecha: string; concepto: string; referencia: string | null; origen: string;
  neto: string;                // en pesos, debe − haber (positivo = entró al banco)
  monto: bigint | null;        // en la moneda de la cuenta bancaria; null si no se puede saber (cuenta en dólares)
  documento: string | null;    // «Cobro 12 · Cliente SRL»
  ref_doc: string | null;
};

const ORIGENES: Record<string, string> = { cobro: "Cobro", pago: "Pago", banco: "Desde el banco", manual: "Asiento" };

// Líneas de la cuenta del banco que todavía no están conciliadas, desde la fecha en que empieza la conciliación (lo
// anterior ya está en el saldo inicial).
export async function lineasPendientes(tx: Tx, cuentaBancariaId: string): Promise<LineaLibro[]> {
  const filas = await tx<(Omit<LineaLibro, "monto" | "documento"> & {
    moneda_cuenta: string; cobro: number | null; cliente: string | null; cobro_moneda: string | null; recibido: string | null;
    pago: number | null; proveedor: string | null; pago_moneda: string | null; pagado: string | null;
  })[]>`
    SELECT l.id, a.id AS asiento_id, a.numero, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.concepto, a.referencia, a.origen,
           (l.debe - l.haber)::text AS neto, b.moneda AS moneda_cuenta,
           co.numero AS cobro, cl.nombre AS cliente, co.moneda AS cobro_moneda, co.recibido::text AS recibido,
           pa.numero AS pago, pr.nombre AS proveedor, pa.moneda AS pago_moneda, pa.pagado::text AS pagado,
           COALESCE(co.referencia, pa.referencia) AS ref_doc
      FROM cuentas_bancarias b
      JOIN lineas_asiento l ON l.cuenta_id = b.cuenta_id
      JOIN asientos a ON a.id = l.asiento_id
      LEFT JOIN cobros co ON co.asiento_id = a.id LEFT JOIN clientes cl ON cl.id = co.cliente_id
      LEFT JOIN pagos pa ON pa.asiento_id = a.id LEFT JOIN proveedores pr ON pr.id = pa.proveedor_id
     WHERE b.id = ${cuentaBancariaId} AND a.estado = 'contabilizado' AND a.fecha >= b.fecha_inicial
       AND NOT EXISTS (SELECT 1 FROM conciliaciones_banco c WHERE c.linea_id = l.id)
     ORDER BY a.fecha, a.numero`;
  return filas.map((f) => {
    const neto = aCentavos(f.neto);
    let monto: bigint | null = neto;
    if (f.moneda_cuenta === "USD") {
      // En una cuenta en dólares solo se sabe el monto en dólares de los cobros y pagos en dólares.
      const usd = f.cobro_moneda === "USD" ? f.recibido : f.pago_moneda === "USD" ? f.pagado : null;
      monto = usd === null ? null : neto < 0n ? -aCentavos(usd) : aCentavos(usd);
    }
    const documento = f.cobro !== null ? `Cobro ${f.cobro} · ${f.cliente}` : f.pago !== null ? `Pago ${f.pago} · ${f.proveedor}` : null;
    return {
      id: f.id, asiento_id: f.asiento_id, numero: f.numero, fecha: f.fecha, concepto: f.concepto, referencia: f.referencia,
      origen: ORIGENES[f.origen] ?? f.origen, neto: f.neto, monto, documento, ref_doc: f.ref_doc,
    };
  });
}

export type Regla = {
  id: string; cuenta_bancaria_id: string | null; nombre: string; textos: string; direccion: "entra" | "sale" | "ambas";
  monto_desde: string | null; monto_hasta: string | null; cuenta_id: string; cuenta: string; concepto: string; activa: boolean;
};

export async function listarReglas(tx: Tx): Promise<Regla[]> {
  return tx<Regla[]>`
    SELECT r.id, r.cuenta_bancaria_id, r.nombre, r.textos, r.direccion, r.monto_desde::text, r.monto_hasta::text, r.cuenta_id,
           c.codigo || ' · ' || c.nombre AS cuenta, r.concepto, r.activa
      FROM reglas_banco r JOIN cuentas c ON c.id = r.cuenta_id
     ORDER BY r.activa DESC, r.creado`;
}

export type MovimientoPendiente = { id: string; fecha: string; descripcion: string; referencia: string | null; monto: bigint; cuenta_bancaria_id: string };

export function aplicaRegla(r: Regla, m: MovimientoPendiente): boolean {
  if (!r.activa || (r.cuenta_bancaria_id && r.cuenta_bancaria_id !== m.cuenta_bancaria_id)) return false;
  if ((r.direccion === "entra" && m.monto < 0n) || (r.direccion === "sale" && m.monto > 0n)) return false;
  const abs = m.monto < 0n ? -m.monto : m.monto;
  if (r.monto_desde !== null && abs < aCentavos(r.monto_desde)) return false;
  if (r.monto_hasta !== null && abs > aCentavos(r.monto_hasta)) return false;
  const desc = normal(`${m.descripcion} ${m.referencia ?? ""}`);
  return r.textos.split(",").map(normal).filter(Boolean).some((t) => desc.includes(t));
}

// ───────────── Sugerencias ─────────────

export type Sugerencia =
  | { tipo: "lineas"; lineas: LineaLibro[]; confianza: "alta" | "media"; motivo: string }
  | { tipo: "regla"; regla: Regla };

const dias = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
const refDe = (s: string | null) => normal(s).replace(/[^a-z0-9]/g, "");
const coincideReferencia = (m: MovimientoPendiente, l: LineaLibro) => {
  const r = refDe(m.referencia);
  if (r.length < 3) return false;
  return [l.referencia, l.ref_doc].some((x) => {
    const y = refDe(x);
    return y.length >= 3 && (y.includes(r) || r.includes(y));
  });
};

// Busca hasta 4 líneas (las más cercanas en fecha, del mismo signo) que sumen exactamente el monto: un depósito que junta
// varios cobros, o un pago que salda varias compras con transferencias separadas.
function combinar(objetivo: bigint, candidatas: LineaLibro[]): LineaLibro[] | null {
  const c = candidatas.slice(0, 14);
  const usar: LineaLibro[] = [];
  const buscar = (desde: number, resto: bigint): boolean => {
    if (resto === 0n) return usar.length >= 2;
    if (usar.length === 4) return false;
    for (let i = desde; i < c.length; i++) {
      const v = c[i].monto!;
      if (objetivo > 0n ? v > resto : v < resto) continue;
      usar.push(c[i]);
      if (buscar(i + 1, resto - v)) return true;
      usar.pop();
    }
    return false;
  };
  return buscar(0, objetivo) ? [...usar] : null;
}

// Una sugerencia por movimiento, sin repetir líneas entre movimientos: primero lo de monto exacto (mejor si la referencia
// coincide y la fecha está cerca), luego combinaciones de varias líneas y, si no hay nada registrado, la primera regla.
export function sugerir(movimientos: MovimientoPendiente[], lineas: LineaLibro[], reglas: Regla[]): Map<string, Sugerencia> {
  const libres = new Set(lineas.filter((l) => l.monto !== null).map((l) => l.id));
  const res = new Map<string, Sugerencia>();
  const orden = [...movimientos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  for (const m of orden) {
    const exactas = lineas
      .filter((l) => libres.has(l.id) && l.monto === m.monto && dias(l.fecha, m.fecha) <= 30)
      .map((l) => ({ l, puntos: (coincideReferencia(m, l) ? 100 : 0) - dias(l.fecha, m.fecha) }))
      .sort((a, b) => b.puntos - a.puntos);
    if (exactas.length) {
      const { l, puntos } = exactas[0];
      const ref = coincideReferencia(m, l);
      res.set(m.id, {
        tipo: "lineas", lineas: [l], confianza: ref || puntos >= -3 ? "alta" : "media",
        motivo: ref ? "Mismo monto y misma referencia" : `Mismo monto, ${dias(l.fecha, m.fecha) === 0 ? "misma fecha" : `${dias(l.fecha, m.fecha)} día${dias(l.fecha, m.fecha) === 1 ? "" : "s"} de diferencia`}`,
      });
      libres.delete(l.id);
    }
  }
  for (const m of orden) {
    if (res.has(m.id)) continue;
    const candidatas = lineas
      .filter((l) => libres.has(l.id) && l.monto !== null && (l.monto > 0n) === (m.monto > 0n) && dias(l.fecha, m.fecha) <= 10)
      .sort((a, b) => dias(a.fecha, m.fecha) - dias(b.fecha, m.fecha));
    const combo = combinar(m.monto, candidatas);
    if (combo) {
      res.set(m.id, { tipo: "lineas", lineas: combo, confianza: "media", motivo: `${combo.length} registros que suman el monto` });
      combo.forEach((l) => libres.delete(l.id));
      continue;
    }
    const regla = reglas.find((r) => aplicaRegla(r, m));
    if (regla) res.set(m.id, { tipo: "regla", regla });
  }
  return res;
}

// ───────────── Acciones ─────────────

type Mov = { id: string; fecha: string; monto: string; estado: string; cuenta_bancaria_id: string; cuenta_id: string; moneda: string; descripcion: string; referencia: string | null };

async function movimiento(tx: Tx, id: string): Promise<Mov> {
  const [m] = await tx<Mov[]>`
    SELECT m.id, to_char(m.fecha, 'YYYY-MM-DD') AS fecha, m.monto::text, m.estado, m.cuenta_bancaria_id, b.cuenta_id, b.moneda,
           m.descripcion, m.referencia
      FROM movimientos_banco m JOIN cuentas_bancarias b ON b.id = m.cuenta_bancaria_id
     WHERE m.id = ${id} FOR UPDATE OF m`;
  if (!m) throw new ErrorContable("Movimiento no encontrado");
  return m;
}

// Concilia el movimiento con las líneas elegidas: tienen que sumar exactamente su monto (en la moneda de la cuenta).
export async function conciliar(tx: Tx, d: { movimientoId: string; lineaIds: string[]; usuarioId: string }) {
  const m = await movimiento(tx, d.movimientoId);
  if (m.estado !== "pendiente") throw new ErrorContable("Ese movimiento ya no está por conciliar");
  if (d.lineaIds.length === 0) throw new ErrorContable("Elige al menos un registro");
  const disponibles = new Map((await lineasPendientes(tx, m.cuenta_bancaria_id)).map((l) => [l.id, l]));
  let suma = 0n;
  const elegidas = d.lineaIds.map((id) => {
    const l = disponibles.get(id);
    if (!l) throw new ErrorContable("Uno de los registros ya está conciliado o no es de esta cuenta");
    if (l.monto === null) throw new ErrorContable("Ese asiento no tiene el monto en dólares: concílialo desde un cobro o pago en dólares, o registra el movimiento desde el banco");
    suma += l.monto;
    return l;
  });
  const objetivo = aCentavos(m.monto);
  if (suma !== objetivo) {
    throw new ErrorContable(`Los registros elegidos suman ${deCentavos(suma)} y el movimiento es de ${deCentavos(objetivo)}.`);
  }
  for (const l of elegidas) {
    await tx`INSERT INTO conciliaciones_banco (movimiento_id, linea_id, empresa_id, monto) VALUES (${m.id}, ${l.id}, empresa_actual(), ${deCentavos(l.monto!)})`;
  }
  await tx`UPDATE movimientos_banco SET estado = 'conciliado', conciliado_por = ${d.usuarioId}, conciliado_en = now() WHERE id = ${m.id}`;
}

// Registra desde el movimiento un asiento contra otra cuenta (comisión, impuesto, transferencia entre cuentas propias,
// ingreso o gasto sin documento) y lo concilia. En una cuenta en dólares se pide la tasa para llevarlo a pesos.
export async function registrarDesdeMovimiento(tx: Tx, d: {
  empresaId: string; movimientoId: string; cuentaId: string; concepto: string; tasa: string | null; usuarioId: string;
}) {
  const m = await movimiento(tx, d.movimientoId);
  if (m.estado !== "pendiente") throw new ErrorContable("Ese movimiento ya no está por conciliar");
  if (d.cuentaId === m.cuenta_id) throw new ErrorContable("Elige una cuenta distinta a la del banco");
  const monto = aCentavos(m.monto);
  const abs = monto < 0n ? -monto : monto;
  let pesos = abs;
  if (m.moneda === "USD") {
    const t = d.tasa ? leerTasa(d.tasa) : null;
    if (!t) throw new ErrorContable("Escribe la tasa del dólar de ese día");
    pesos = aPesos(abs, t);
  }
  const banco = { cuentaId: m.cuenta_id, debe: monto > 0n ? pesos : 0n, haber: monto < 0n ? pesos : 0n, descripcion: m.descripcion.slice(0, 200) };
  const otra = { cuentaId: d.cuentaId, debe: monto < 0n ? pesos : 0n, haber: monto > 0n ? pesos : 0n, descripcion: d.concepto };
  const { id } = await insertarAsiento(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, fecha: m.fecha, concepto: d.concepto, referencia: m.referencia, origen: "banco",
    lineas: [banco, otra], juntar: false,
  });
  const [l] = await tx<{ id: string }[]>`SELECT id FROM lineas_asiento WHERE asiento_id = ${id} AND cuenta_id = ${m.cuenta_id}`;
  await tx`INSERT INTO conciliaciones_banco (movimiento_id, linea_id, empresa_id, monto) VALUES (${m.id}, ${l.id}, empresa_actual(), ${m.monto})`;
  await tx`UPDATE movimientos_banco SET estado = 'conciliado', conciliado_por = ${d.usuarioId}, conciliado_en = now() WHERE id = ${m.id}`;
  return id;
}

// Desconcilia: el movimiento vuelve a «por conciliar». Si su asiento se registró desde el banco, se anula (existía solo
// por ese movimiento); los cobros, pagos y asientos quedan como estaban, listos para conciliarse de nuevo.
export async function desconciliar(tx: Tx, d: { movimientoId: string; usuarioId: string }) {
  const m = await movimiento(tx, d.movimientoId);
  if (m.estado !== "conciliado") throw new ErrorContable("Ese movimiento no está conciliado");
  const delBanco = await tx<{ id: string }[]>`
    SELECT DISTINCT a.id FROM conciliaciones_banco c JOIN lineas_asiento l ON l.id = c.linea_id JOIN asientos a ON a.id = l.asiento_id
     WHERE c.movimiento_id = ${m.id} AND a.origen = 'banco'`;
  await tx`DELETE FROM conciliaciones_banco WHERE movimiento_id = ${m.id}`;
  for (const a of delBanco) {
    await tx`UPDATE asientos SET estado = 'anulado', anulado_por = ${d.usuarioId}, anulado_en = now(),
                    motivo_anulacion = 'Movimiento del banco desconciliado' WHERE id = ${a.id}`;
  }
  await tx`UPDATE movimientos_banco SET estado = 'pendiente', conciliado_por = NULL, conciliado_en = NULL WHERE id = ${m.id}`;
  return delBanco.length;
}

export async function excluir(tx: Tx, d: { movimientoId: string; motivo: string; usuarioId: string }) {
  const m = await movimiento(tx, d.movimientoId);
  if (m.estado !== "pendiente") throw new ErrorContable("Ese movimiento ya no está por conciliar");
  await tx`UPDATE movimientos_banco SET estado = 'excluido', motivo_exclusion = ${d.motivo}, conciliado_por = ${d.usuarioId}, conciliado_en = now()
            WHERE id = ${m.id}`;
}

export async function reincluir(tx: Tx, movimientoId: string) {
  const m = await movimiento(tx, movimientoId);
  if (m.estado !== "excluido") throw new ErrorContable("Ese movimiento no está excluido");
  await tx`UPDATE movimientos_banco SET estado = 'pendiente', motivo_exclusion = NULL, conciliado_por = NULL, conciliado_en = NULL WHERE id = ${m.id}`;
}

// Lo conciliado de un movimiento, para mostrarlo.
export async function detalleConciliado(tx: Tx, movimientoIds: string[]) {
  if (!movimientoIds.length) return new Map<string, { asiento_id: string; asiento: number; concepto: string; documento: string | null; origen: string }[]>();
  const filas = await tx<{ movimiento_id: string; asiento_id: string; numero: number; concepto: string; origen: string; cobro: number | null; pago: number | null }[]>`
    SELECT c.movimiento_id, a.id AS asiento_id, a.numero, a.concepto, a.origen, co.numero AS cobro, pa.numero AS pago
      FROM conciliaciones_banco c JOIN lineas_asiento l ON l.id = c.linea_id JOIN asientos a ON a.id = l.asiento_id
      LEFT JOIN cobros co ON co.asiento_id = a.id LEFT JOIN pagos pa ON pa.asiento_id = a.id
     WHERE c.movimiento_id = ANY(${movimientoIds}) ORDER BY a.numero`;
  const res = new Map<string, { asiento_id: string; asiento: number; concepto: string; documento: string | null; origen: string }[]>();
  for (const f of filas) {
    const lista = res.get(f.movimiento_id) ?? [];
    lista.push({ asiento_id: f.asiento_id, asiento: f.numero, concepto: f.concepto, origen: f.origen, documento: f.cobro !== null ? `Cobro ${f.cobro}` : f.pago !== null ? `Pago ${f.pago}` : null });
    res.set(f.movimiento_id, lista);
  }
  return res;
}

// Reglas sugeridas: comisiones y cargos del banco, e impuesto a cheques y transferencias (0.15 %; 0.20 % desde el
// 3-jul-2026 por la Ley 30-26). Solo se crean si el catálogo tiene las cuentas 620101 y 620104 activas.
export const REGLAS_SUGERIDAS = [
  { nombre: "Comisiones y cargos del banco", textos: "comision, cargo por servicio, manejo de cuenta, mantenimiento, cargo mensual", codigo: "620101", concepto: "Comisiones bancarias" },
  { nombre: "Impuesto a cheques y transferencias (DGII)", textos: "impuesto, 0.15%, 0.20%, 0.15 %, 0.20 %, dgii, ley 288", codigo: "620104", concepto: "Impuesto a cheques y transferencias" },
];

// Datos del movimiento para registrar desde él un cobro o un pago (fecha, referencia y cuenta contable del banco).
export async function datosParaDocumento(tx: Tx, movimientoId: string) {
  const [m] = await tx<{ fecha: string; referencia: string | null; cuenta_id: string; monto: string; estado: string }[]>`
    SELECT to_char(m.fecha, 'YYYY-MM-DD') AS fecha, m.referencia, b.cuenta_id, m.monto::text, m.estado
      FROM movimientos_banco m JOIN cuentas_bancarias b ON b.id = m.cuenta_bancaria_id WHERE m.id = ${movimientoId}`;
  return m && m.estado === "pendiente" ? m : null;
}

// Después de registrar un cobro o pago desde un movimiento: si su línea en la cuenta del banco da el monto, se concilia.
// Devuelve la cuenta bancaria si quedó conciliado.
export async function conciliarDocumento(tx: Tx, d: { movimientoId: string; asientoId: string; usuarioId: string }): Promise<string | null> {
  const m = await movimiento(tx, d.movimientoId);
  if (m.estado !== "pendiente") return null;
  const lineas = (await lineasPendientes(tx, m.cuenta_bancaria_id)).filter((l) => l.asiento_id === d.asientoId);
  if (!lineas.length || lineas.some((l) => l.monto === null) || lineas.reduce((s, l) => s + l.monto!, 0n) !== aCentavos(m.monto)) return null;
  await conciliar(tx, { movimientoId: m.id, lineaIds: lineas.map((l) => l.id), usuarioId: d.usuarioId });
  return m.cuenta_bancaria_id;
}
