import { armarMovimientos, leerTabla, sugerirFormato, type Formato, type Lectura, type TipoArchivo } from "./archivos-banco.ts";
import { ErrorContable } from "./asientos.ts";
import type { Tx } from "./db";
import { deCentavos } from "./montos.ts";

// Cuentas bancarias y estados de cuenta importados (Fase 5, migración 018).

export type CuentaBancaria = {
  id: string; cuenta_id: string; codigo: string; cuenta: string; banco: string; nombre: string; numero: string | null; moneda: string;
  saldo_inicial: string; fecha_inicial: string; formato: Formato | null; activa: boolean;
  saldo_banco: string; saldo_libros: string; pendientes: number; ultimo: string | null;
};

// Saldo según el banco: el inicial más los movimientos importados. Saldo en libros: lo contabilizado en la cuenta del
// catálogo (en pesos; para una cuenta en dólares se muestra aparte).
export async function listarCuentasBancarias(tx: Tx, id?: string): Promise<CuentaBancaria[]> {
  return tx<CuentaBancaria[]>`
    SELECT b.id, b.cuenta_id, c.codigo, c.nombre AS cuenta, b.banco, b.nombre, b.numero, b.moneda, b.saldo_inicial::text,
           to_char(b.fecha_inicial, 'YYYY-MM-DD') AS fecha_inicial, b.formato, b.activa,
           (b.saldo_inicial + COALESCE((SELECT sum(m.monto) FROM movimientos_banco m WHERE m.cuenta_bancaria_id = b.id), 0))::text AS saldo_banco,
           COALESCE((SELECT sum(l.debe - l.haber) FROM lineas_asiento l JOIN asientos a ON a.id = l.asiento_id
                      WHERE l.cuenta_id = b.cuenta_id AND a.estado = 'contabilizado'), 0)::numeric(18,2)::text AS saldo_libros,
           (SELECT count(*) FROM movimientos_banco m WHERE m.cuenta_bancaria_id = b.id AND m.estado = 'pendiente')::int AS pendientes,
           (SELECT to_char(max(m.fecha), 'YYYY-MM-DD') FROM movimientos_banco m WHERE m.cuenta_bancaria_id = b.id) AS ultimo
      FROM cuentas_bancarias b JOIN cuentas c ON c.id = b.cuenta_id
     WHERE ${id ?? null}::uuid IS NULL OR b.id = ${id ?? null}
     ORDER BY b.activa DESC, b.banco, b.nombre`;
}

export async function cuentaBancaria(tx: Tx, id: string): Promise<CuentaBancaria> {
  const [c] = await listarCuentasBancarias(tx, id);
  if (!c) throw new ErrorContable("Cuenta bancaria no encontrada");
  return c;
}

export type MovimientoBanco = {
  id: string; fecha: string; descripcion: string; referencia: string | null; monto: string; saldo: string | null; estado: string;
};

export async function listarMovimientos(tx: Tx, cuentaId: string, f: { estado: string | null; desde: string | null; hasta: string | null }): Promise<MovimientoBanco[]> {
  return tx<MovimientoBanco[]>`
    SELECT id, to_char(fecha, 'YYYY-MM-DD') AS fecha, descripcion, referencia, monto::text, saldo::text, estado
      FROM movimientos_banco
     WHERE cuenta_bancaria_id = ${cuentaId}
       AND (${f.estado}::text IS NULL OR estado = ${f.estado})
       AND (${f.desde}::date IS NULL OR fecha >= ${f.desde}::date)
       AND (${f.hasta}::date IS NULL OR fecha <= ${f.hasta}::date)
     ORDER BY fecha DESC, orden DESC
     LIMIT 1000`;
}

export type Importacion = {
  id: string; cuenta_bancaria_id: string; estado: string; nombre: string; tipo: TipoArchivo; tamano: number; formato: Formato | null;
  recepcion_id: string | null; desde: string | null; hasta: string | null; nuevos: number | null; repetidos: number | null;
  creado: Date; quien: string | null; importado_en: Date | null; conciliados: number;
};

export async function listarImportaciones(tx: Tx, cuentaId: string): Promise<Importacion[]> {
  return tx<Importacion[]>`
    SELECT i.id, i.cuenta_bancaria_id, i.estado, i.nombre, i.tipo, i.tamano, i.formato, i.recepcion_id,
           to_char(i.desde, 'YYYY-MM-DD') AS desde, to_char(i.hasta, 'YYYY-MM-DD') AS hasta, i.nuevos, i.repetidos,
           i.creado, u.nombre AS quien, i.importado_en,
           (SELECT count(*) FROM movimientos_banco m WHERE m.importacion_id = i.id AND m.estado <> 'pendiente')::int AS conciliados
      FROM importaciones_banco i LEFT JOIN usuarios u ON u.id = COALESCE(i.importado_por, i.creado_por)
     WHERE i.cuenta_bancaria_id = ${cuentaId} AND i.estado <> 'descartada'
     ORDER BY i.creado DESC LIMIT 100`;
}

export async function importacion(tx: Tx, id: string): Promise<Importacion & { contenido: Buffer }> {
  const [i] = await tx<(Importacion & { contenido: Buffer })[]>`
    SELECT i.id, i.cuenta_bancaria_id, i.estado, i.nombre, i.tipo, i.tamano, i.formato, i.recepcion_id, i.contenido,
           to_char(i.desde, 'YYYY-MM-DD') AS desde, to_char(i.hasta, 'YYYY-MM-DD') AS hasta, i.nuevos, i.repetidos,
           i.creado, NULL AS quien, i.importado_en, 0 AS conciliados
      FROM importaciones_banco i WHERE i.id = ${id}`;
  if (!i) throw new ErrorContable("Importación no encontrada");
  return i;
}

// Formato con el que se lee el archivo: el elegido en esta importación, o el que quedó guardado en la cuenta (si el
// archivo tiene esas columnas), o el que se adivina por los nombres del encabezado.
export async function formatoDe(tx: Tx, i: Importacion & { contenido: Buffer }) {
  const filas = await leerTabla(new Uint8Array(i.contenido), i.tipo);
  if (i.formato) return { filas, formato: i.formato };
  const [c] = await tx<{ formato: Formato | null }[]>`SELECT formato FROM cuentas_bancarias WHERE id = ${i.cuenta_bancaria_id}`;
  const sugerido = sugerirFormato(filas);
  if (c?.formato) {
    const enc = (filas[c.formato.encabezado] ?? []).map((x) => String(x ?? "").trim());
    if (enc.includes(c.formato.fecha) && enc.includes(c.formato.descripcion)) return { filas, formato: c.formato };
  }
  return { filas, formato: sugerido };
}

export type Vista = Lectura & {
  nuevos: number; repetidos: number; anteriores: number; desde: string | null; hasta: string | null; entradas: bigint; salidas: bigint;
  repetido: Set<string>;
};

// Lo que pasaría al importar: qué movimientos son nuevos, cuáles ya estaban y cuáles son anteriores a la fecha inicial.
export async function vistaPrevia(tx: Tx, cuentaId: string, fechaInicial: string, l: Lectura): Promise<Vista> {
  const claves = l.movimientos.map((m) => `${m.huella}:${m.ocurrencia}`);
  const existentes = claves.length
    ? await tx<{ k: string }[]>`SELECT huella || ':' || ocurrencia AS k FROM movimientos_banco
                                  WHERE cuenta_bancaria_id = ${cuentaId} AND huella || ':' || ocurrencia = ANY(${claves})`
    : [];
  const repetido = new Set(existentes.map((e) => e.k));
  const v: Vista = { ...l, nuevos: 0, repetidos: 0, anteriores: 0, desde: null, hasta: null, entradas: 0n, salidas: 0n, repetido };
  for (const m of l.movimientos) {
    if (m.fecha < fechaInicial) { v.anteriores++; continue; }
    if (repetido.has(`${m.huella}:${m.ocurrencia}`)) { v.repetidos++; continue; }
    v.nuevos++;
    if (m.monto > 0n) v.entradas += m.monto; else v.salidas -= m.monto;
    if (!v.desde || m.fecha < v.desde) v.desde = m.fecha;
    if (!v.hasta || m.fecha > v.hasta) v.hasta = m.fecha;
  }
  return v;
}

export async function leerImportacion(tx: Tx, id: string) {
  const i = await importacion(tx, id);
  const cuenta = await cuentaBancaria(tx, i.cuenta_bancaria_id);
  const { filas, formato } = await formatoDe(tx, i);
  return { i, cuenta, filas, formato };
}

// Importa los movimientos nuevos (los repetidos y los anteriores a la fecha inicial se saltan). Guarda el formato en la
// cuenta para la próxima vez.
export async function confirmarImportacion(tx: Tx, id: string, usuarioId: string) {
  const { i, cuenta, filas, formato } = await leerImportacion(tx, id);
  if (i.estado !== "borrador") throw new ErrorContable("Esta importación ya no está en borrador");
  const l = armarMovimientos(filas, formato);
  if (l.errores.length) throw new ErrorContable(`Hay ${l.errores.length} fila${l.errores.length > 1 ? "s" : ""} con errores: corrige el formato antes de importar.`);
  const v = await vistaPrevia(tx, cuenta.id, cuenta.fecha_inicial, l);
  if (v.nuevos === 0) throw new ErrorContable("El archivo no trae movimientos nuevos.");
  for (const m of l.movimientos) {
    if (m.fecha < cuenta.fecha_inicial || v.repetido.has(`${m.huella}:${m.ocurrencia}`)) continue;
    await tx`INSERT INTO movimientos_banco (empresa_id, cuenta_bancaria_id, importacion_id, fecha, descripcion, referencia, monto, saldo, huella, ocurrencia, orden)
             VALUES (empresa_actual(), ${cuenta.id}, ${id}, ${m.fecha}, ${m.descripcion}, ${m.referencia}, ${deCentavos(m.monto)},
                     ${m.saldo === null ? null : deCentavos(m.saldo)}, ${m.huella}, ${m.ocurrencia}, ${m.orden})
             ON CONFLICT (cuenta_bancaria_id, huella, ocurrencia) DO NOTHING`;
  }
  await tx`UPDATE importaciones_banco SET estado = 'importada', formato = ${tx.json(formato)}, desde = ${v.desde}, hasta = ${v.hasta},
                  nuevos = ${v.nuevos}, repetidos = ${v.repetidos}, importado_por = ${usuarioId}, importado_en = now()
            WHERE id = ${id}`;
  await tx`UPDATE cuentas_bancarias SET formato = ${tx.json(formato)} WHERE id = ${cuenta.id}`;
  if (i.recepcion_id) {
    await tx`UPDATE recepciones SET estado = 'procesado', procesado_por = ${usuarioId}, procesado_en = now(),
                    respuesta = COALESCE(respuesta, ${`Importado a ${cuenta.nombre}: ${v.nuevos} movimientos.`})
              WHERE id = ${i.recepcion_id} AND estado IN ('nuevo', 'en_proceso')`;
  }
  return v;
}

// Deshacer una importación: quita sus movimientos si ninguno está conciliado (y no son de un período cerrado).
export async function deshacerImportacion(tx: Tx, id: string, usuarioId: string) {
  const i = await importacion(tx, id);
  if (i.estado !== "importada") throw new ErrorContable("Solo se deshace una importación hecha");
  const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM movimientos_banco WHERE importacion_id = ${id} AND estado <> 'pendiente'`;
  if (n > 0) throw new ErrorContable(`${n} movimiento${n > 1 ? "s" : ""} de este archivo ya ${n > 1 ? "están conciliados o excluidos" : "está conciliado o excluido"}: deshaz eso primero.`);
  await tx`DELETE FROM movimientos_banco WHERE importacion_id = ${id}`;
  await tx`UPDATE importaciones_banco SET estado = 'deshecha', deshecho_por = ${usuarioId}, deshecho_en = now() WHERE id = ${id}`;
}
