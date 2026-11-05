import { anularAsientoDeDocumento, ErrorContable, insertarAsiento } from "./asientos.ts";
import type { Tx } from "./db";
import type { Tabla } from "./exportar.ts";
import { CONCEPTOS_IR17 } from "./fiscal.ts";
import { aCentavos, deCentavos, verFecha } from "./montos.ts";

// Bloque 7, entrega 7a: cuenta corriente de la socia. Estado de cuenta (lo cargado y abonado, con su categoría) y, al cierre
// del ejercicio, la liquidación que decide Patricia: dividendos contra resultados acumulados (con la retención de ISR del
// IR-17, concepto 5) o dejar el saldo como cuenta por cobrar a la socia (Documento maestro, sección 3).

export const CUENTA_ACUMULADOS = "310301";   // Resultados acumulados
export const CUENTA_RETENCION = "210203";    // ISR retenido a terceros por pagar
// Tasa de los dividendos en centésimas de % (10 %): concepto 5 del formulario oficial IR-17-2026 (Ley 253-12).
export const TASA_DIVIDENDOS = CONCEPTOS_IR17[4][1];

const saldoHasta = async (tx: Tx, cuentaId: string, hasta: string) => {
  const [r] = await tx<{ s: string }[]>`
    SELECT COALESCE(sum(l.debe - l.haber), 0)::text AS s
      FROM lineas_asiento l JOIN asientos a ON a.id = l.asiento_id
     WHERE l.cuenta_id = ${cuentaId} AND a.estado = 'contabilizado' AND a.fecha <= ${hasta}`;
  return aCentavos(r.s);
};

// Saldo deudor (lo que la socia debe a la empresa) a una fecha.
export const saldoSocia = (tx: Tx, cuentaId: string, fecha: string) => saldoHasta(tx, cuentaId, fecha);

export type Movimiento = {
  fecha: string; numero: number; asiento_id: string; concepto: string; categoria: string | null; descripcion: string | null; cargo: bigint; abono: bigint; saldo: bigint;
};
export type EstadoSocia = { inicial: bigint; movimientos: Movimiento[]; cargos: bigint; abonos: bigint; final: bigint; porCategoria: [string, bigint][] };

export async function estadoDeCuenta(tx: Tx, cuentaId: string, desde: string, hasta: string, categoria: string | null = null): Promise<EstadoSocia> {
  const [ini] = await tx<{ s: string }[]>`
    SELECT COALESCE(sum(l.debe - l.haber), 0)::text AS s FROM lineas_asiento l JOIN asientos a ON a.id = l.asiento_id
     WHERE l.cuenta_id = ${cuentaId} AND a.estado = 'contabilizado' AND a.fecha < ${desde}`;
  const filas = await tx<{ fecha: string; numero: number; asiento_id: string; concepto: string; categoria: string | null; descripcion: string | null; debe: string; haber: string }[]>`
    SELECT to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.numero, a.id AS asiento_id, a.concepto, l.categoria_personal AS categoria, l.descripcion,
           l.debe::text, l.haber::text
      FROM lineas_asiento l JOIN asientos a ON a.id = l.asiento_id
     WHERE l.cuenta_id = ${cuentaId} AND a.estado = 'contabilizado' AND a.fecha BETWEEN ${desde} AND ${hasta}
     ORDER BY a.fecha, a.numero, l.orden`;
  const inicial = aCentavos(ini.s);
  let saldo = inicial, cargos = 0n, abonos = 0n;
  const cat = new Map<string, bigint>();
  const movimientos: Movimiento[] = [];
  for (const f of filas) {
    const cargo = aCentavos(f.debe), abono = aCentavos(f.haber);
    saldo += cargo - abono;
    if (categoria && (f.categoria ?? "Sin categoría") !== categoria) continue;
    cargos += cargo;
    abonos += abono;
    if (cargo > 0n) cat.set(f.categoria ?? "Sin categoría", (cat.get(f.categoria ?? "Sin categoría") ?? 0n) + cargo);
    movimientos.push({ ...f, cargo, abono, saldo });
  }
  return { inicial, movimientos, cargos, abonos, final: saldo, porCategoria: [...cat.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)) };
}

export function tablaEstadoSocia(e: EstadoSocia, d: { empresa: string; cuenta: string; desde: string; hasta: string; generado: string; categoria: string | null }): Tabla {
  return {
    titulo: `Estado de cuenta · ${d.cuenta}`,
    empresa: d.empresa,
    detalle: `Del ${verFecha(d.desde)} al ${verFecha(d.hasta)}${d.categoria ? ` · Categoría: ${d.categoria}` : ""}`,
    generado: d.generado,
    columnas: [{ titulo: "Fecha", ancho: 12 }, { titulo: "Asiento", ancho: 9 }, { titulo: "Concepto", ancho: 50 }, { titulo: "Categoría", ancho: 22 },
      { titulo: "Cargos", num: true }, { titulo: "Abonos", num: true }, { titulo: "Saldo", num: true }],
    filas: [
      ["", "", "Saldo al inicio", "", null, null, Number(deCentavos(e.inicial))],
      ...e.movimientos.map((m) => [verFecha(m.fecha), m.numero, m.concepto, m.categoria ?? "", m.cargo ? Number(deCentavos(m.cargo)) : null,
        m.abono ? Number(deCentavos(m.abono)) : null, d.categoria ? null : Number(deCentavos(m.saldo))]),
    ],
    totales: ["", "", "Totales", "", Number(deCentavos(e.cargos)), Number(deCentavos(e.abonos)), d.categoria ? null : Number(deCentavos(e.final))],
    negritas: [0],
    horizontal: true,
  };
}

// ───── Liquidación al cierre del ejercicio ─────

// Dividendo bruto para que, después de la retención, llegue exactamente el neto que se liquida de la cuenta corriente:
// bruto = neto ÷ (1 − tasa), redondeado al centavo; la retención es la diferencia.
export function brutoDeNeto(neto: bigint, tasa: bigint = TASA_DIVIDENDOS): { bruto: bigint; retencion: bigint } {
  const base = 10000n - tasa;
  const bruto = (neto * 10000n + base / 2n) / base;
  return { bruto, retencion: bruto - neto };
}

const cuentaPorCodigo = async (tx: Tx, codigo: string) => {
  const [c] = await tx<{ id: string; nombre: string }[]>`SELECT id, nombre FROM cuentas WHERE codigo = ${codigo} AND de_detalle AND activa`;
  return c ?? null;
};

// Ganancias acumuladas disponibles a una fecha (saldo acreedor de 310301).
export async function acumuladosDisponibles(tx: Tx, fecha: string): Promise<bigint | null> {
  const c = await cuentaPorCodigo(tx, CUENTA_ACUMULADOS);
  return c ? -(await saldoHasta(tx, c.id, fecha)) : null;
}

export type Liquidacion = {
  id: string; cuenta_id: string; fin_ejercicio: string; modo: "dividendos" | "cuenta_por_cobrar"; fecha: string; saldo: string; neto: string | null;
  bruto: string | null; tasa: string | null; retencion: string | null; asiento_id: string | null; asiento: number | null; nota: string | null; quien: string | null; creado: Date;
};

export const liquidacionesDe = (tx: Tx, cuentaId: string) => tx<Liquidacion[]>`
  SELECT l.id, l.cuenta_id, to_char(l.fin_ejercicio, 'YYYY-MM-DD') AS fin_ejercicio, l.modo, to_char(l.fecha, 'YYYY-MM-DD') AS fecha, l.saldo::text,
         l.neto::text, l.bruto::text, l.tasa::text, l.retencion::text, l.asiento_id, a.numero AS asiento, l.nota, u.nombre AS quien, l.creado
    FROM liquidaciones_socia l LEFT JOIN asientos a ON a.id = l.asiento_id LEFT JOIN usuarios u ON u.id = l.creado_por
   WHERE l.cuenta_id = ${cuentaId} AND NOT l.anulada ORDER BY l.fin_ejercicio DESC`;

export async function liquidar(tx: Tx, d: {
  empresaId: string; usuarioId: string; cuentaId: string; fin: string; hoy: string; modo: "dividendos" | "cuenta_por_cobrar"; fecha: string; neto: bigint | null; nota: string | null;
}): Promise<{ id: string; asiento: number | null }> {
  if (d.fin >= d.hoy) throw new ErrorContable("El ejercicio todavía no ha terminado.");
  const [cuenta] = await tx<{ nombre: string }[]>`SELECT nombre FROM cuentas WHERE id = ${d.cuentaId} AND codigo LIKE '1102%' AND nombre ILIKE 'Cuenta corriente%'`;
  if (!cuenta) throw new ErrorContable("Elige la cuenta corriente de una socia.");
  const [ya] = await tx`SELECT 1 FROM liquidaciones_socia WHERE cuenta_id = ${d.cuentaId} AND fin_ejercicio = ${d.fin} AND NOT anulada`;
  if (ya) throw new ErrorContable("Este ejercicio ya tiene su liquidación; deshazla primero si quieres cambiarla.");
  const saldo = await saldoSocia(tx, d.cuentaId, d.fin);
  if (saldo <= 0n) throw new ErrorContable(`La cuenta corriente no tiene saldo a cargo de la socia al ${verFecha(d.fin)}.`);
  if (d.modo === "cuenta_por_cobrar") {
    const [{ id }] = await tx<{ id: string }[]>`
      INSERT INTO liquidaciones_socia (empresa_id, cuenta_id, fin_ejercicio, modo, fecha, saldo, nota, creado_por)
      VALUES (${d.empresaId}, ${d.cuentaId}, ${d.fin}, 'cuenta_por_cobrar', ${d.fecha}, ${deCentavos(saldo)}, ${d.nota}, ${d.usuarioId}) RETURNING id`;
    return { id, asiento: null };
  }
  const neto = d.neto ?? saldo;
  if (neto <= 0n) throw new ErrorContable("Escribe cuánto se liquida.");
  if (neto > saldo) throw new ErrorContable(`No se puede liquidar más que el saldo de la cuenta corriente (RD$${deCentavos(saldo)}).`);
  if (d.fecha <= d.fin) throw new ErrorContable("La fecha de la liquidación debe ser posterior al fin del ejercicio.");
  const acumulados = await cuentaPorCodigo(tx, CUENTA_ACUMULADOS);
  const retenida = await cuentaPorCodigo(tx, CUENTA_RETENCION);
  if (!acumulados) throw new ErrorContable(`Falta la cuenta ${CUENTA_ACUMULADOS} «Resultados acumulados» en el catálogo.`);
  if (!retenida) throw new ErrorContable(`Falta la cuenta ${CUENTA_RETENCION} «ISR retenido a terceros por pagar» en el catálogo.`);
  const { bruto, retencion } = brutoDeNeto(neto);
  const disponible = -(await saldoHasta(tx, acumulados.id, d.fecha));
  if (bruto > disponible) {
    throw new ErrorContable(`Las ganancias acumuladas (RD$${deCentavos(disponible > 0n ? disponible : 0n)}) no alcanzan para un dividendo de RD$${deCentavos(bruto)}. `
      + "Pasa el resultado del ejercicio a resultados acumulados en Cierre del mes, liquida una parte o deja el saldo como cuenta por cobrar.");
  }
  const socia = cuenta.nombre.replace(/^Cuenta corriente\s*[–-]\s*/i, "");
  const asiento = await insertarAsiento(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, fecha: d.fecha, origen: "liquidacion", juntar: false,
    concepto: `Dividendos del ejercicio ${d.fin.slice(0, 4)} a ${socia}: liquidación de la cuenta corriente`,
    lineas: [
      { cuentaId: acumulados.id, debe: bruto, haber: 0n, descripcion: "Dividendo declarado" },
      { cuentaId: d.cuentaId, debe: 0n, haber: neto, descripcion: "Liquidación de la cuenta corriente" },
      { cuentaId: retenida.id, debe: 0n, haber: retencion, descripcion: `Retención de ISR sobre dividendos (${deCentavos(TASA_DIVIDENDOS).replace(/\.00$/, "")} %)` },
    ],
  });
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO liquidaciones_socia (empresa_id, cuenta_id, fin_ejercicio, modo, fecha, saldo, neto, bruto, tasa, retencion, asiento_id, nota, creado_por)
    VALUES (${d.empresaId}, ${d.cuentaId}, ${d.fin}, 'dividendos', ${d.fecha}, ${deCentavos(saldo)}, ${deCentavos(neto)}, ${deCentavos(bruto)},
            ${deCentavos(TASA_DIVIDENDOS)}, ${deCentavos(retencion)}, ${asiento.id}, ${d.nota}, ${d.usuarioId}) RETURNING id`;
  return { id, asiento: asiento.numero };
}

export async function deshacerLiquidacion(tx: Tx, id: string, usuarioId: string) {
  const [l] = await tx<{ asiento_id: string | null; anulada: boolean }[]>`SELECT asiento_id, anulada FROM liquidaciones_socia WHERE id = ${id} FOR UPDATE`;
  if (!l || l.anulada) throw new ErrorContable("La liquidación no existe o ya se deshizo");
  if (l.asiento_id) await anularAsientoDeDocumento(tx, l.asiento_id, usuarioId, "Se deshizo la liquidación de la cuenta corriente");
  await tx`UPDATE liquidaciones_socia SET anulada = true, anulada_por = ${usuarioId}, anulada_en = now() WHERE id = ${id}`;
}

// Dividendos de liquidaciones con fecha en el período, para la casilla 5 del IR-17 (monto sujeto = bruto).
export async function dividendosDelPeriodo(tx: Tx, inicio: string, fin: string): Promise<{ bruto: bigint; retencion: bigint }> {
  const [r] = await tx<{ bruto: string; retencion: string }[]>`
    SELECT COALESCE(sum(bruto), 0)::text AS bruto, COALESCE(sum(retencion), 0)::text AS retencion
      FROM liquidaciones_socia WHERE modo = 'dividendos' AND NOT anulada AND fecha BETWEEN ${inicio} AND ${fin}`;
  return { bruto: aCentavos(r.bruto), retencion: aCentavos(r.retencion) };
}
