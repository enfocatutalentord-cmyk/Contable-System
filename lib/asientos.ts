import type { Tx } from "./db";
import { aCentavos, deCentavos } from "./montos.ts";

export type LineaAsiento = { cuentaId: string; debe: bigint; haber: bigint; descripcion?: string | null };
export type Origen = "manual" | "factura" | "nota_credito" | "cobro" | "compra" | "nota_credito_compra" | "pago" | "banco" | "cierre";

export class ErrorContable extends Error {
  code = "P0001";
}

function juntarLineas(lineas: LineaAsiento[]): LineaAsiento[] {
  const porClave = new Map<string, LineaAsiento>();
  for (const l of lineas) {
    const clave = `${l.cuentaId}:${l.debe > 0n ? "d" : "h"}:${l.descripcion ?? ""}`;
    const previa = porClave.get(clave);
    if (previa) {
      previa.debe += l.debe;
      previa.haber += l.haber;
    } else porClave.set(clave, { ...l });
  }
  return [...porClave.values()];
}

async function escribirLineas(tx: Tx, empresaId: string, asientoId: string, lineas: LineaAsiento[], desde = 0) {
  for (const [orden, l] of lineas.entries()) {
    await tx`
      INSERT INTO lineas_asiento (asiento_id, empresa_id, orden, cuenta_id, descripcion, debe, haber)
      VALUES (${asientoId}, ${empresaId}, ${desde + orden + 1}, ${l.cuentaId}, ${l.descripcion ?? null},
              ${deCentavos(l.debe)}, ${deCentavos(l.haber)})`;
  }
}

// Asigna el siguiente número y deja el asiento contabilizado. La base vuelve a revisar cuadre, cuentas y cierre.
export async function contabilizarAsiento(tx: Tx, empresaId: string, asientoId: string, usuarioId: string): Promise<number> {
  await tx`SELECT 1 FROM empresas WHERE id = ${empresaId} FOR UPDATE`; // un número por vez
  const [a] = await tx<{ estado: string }[]>`SELECT estado FROM asientos WHERE id = ${asientoId} FOR UPDATE`;
  if (!a) throw new ErrorContable("El asiento no existe");
  if (a.estado !== "borrador") throw new ErrorContable("El asiento ya estaba contabilizado");
  const [{ siguiente }] = await tx<{ siguiente: number }[]>`SELECT COALESCE(max(numero), 0) + 1 AS siguiente FROM asientos`;
  await tx`
    UPDATE asientos SET estado = 'contabilizado', numero = ${siguiente}, aprobado_por = ${usuarioId}, aprobado_en = now()
     WHERE id = ${asientoId}`;
  return siguiente;
}

// Registra un asiento: queda como borrador o, si `contabilizar`, contabilizado con número.
// Los documentos (facturas, cobros) siempre lo contabilizan.
export async function insertarAsiento(
  tx: Tx,
  datos: {
    empresaId: string; usuarioId: string; fecha: string; concepto: string; referencia?: string | null; origen: Origen;
    lineas: LineaAsiento[]; juntar?: boolean; contabilizar?: boolean; revierteA?: string | null;
  },
): Promise<{ id: string; numero: number | null }> {
  let lineas = datos.lineas.filter((l) => l.debe !== 0n || l.haber !== 0n);
  if (datos.juntar !== false) lineas = juntarLineas(lineas);
  if (lineas.some((l) => l.debe < 0n || l.haber < 0n)) throw new ErrorContable("Montos negativos en el asiento");
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO asientos (empresa_id, fecha, concepto, referencia, origen, creado_por, revierte_a)
    VALUES (${datos.empresaId}, ${datos.fecha}, ${datos.concepto}, ${datos.referencia ?? null}, ${datos.origen},
            ${datos.usuarioId}, ${datos.revierteA ?? null}) RETURNING id`;
  await escribirLineas(tx, datos.empresaId, id, lineas);
  const numero = datos.contabilizar === false ? null : await contabilizarAsiento(tx, datos.empresaId, id, datos.usuarioId);
  return { id, numero };
}

// Cambia encabezado y líneas de un borrador.
export async function actualizarBorrador(
  tx: Tx,
  d: { empresaId: string; asientoId: string; usuarioId: string; fecha: string; concepto: string; referencia: string | null; lineas: LineaAsiento[] },
) {
  const [a] = await tx<{ estado: string; origen: string }[]>`SELECT estado, origen FROM asientos WHERE id = ${d.asientoId} FOR UPDATE`;
  if (!a) throw new ErrorContable("El asiento no existe");
  if (a.estado !== "borrador") throw new ErrorContable("Solo los borradores se pueden editar");
  await tx`
    UPDATE asientos SET fecha = ${d.fecha}, concepto = ${d.concepto}, referencia = ${d.referencia},
           modificado_por = ${d.usuarioId}, modificado_en = now()
     WHERE id = ${d.asientoId}`;
  // Se actualizan en su lugar (por orden) para que el historial muestre qué cambió en cada línea.
  const nuevas = d.lineas.filter((l) => l.debe !== 0n || l.haber !== 0n);
  const actuales = await tx<{ id: string; orden: number }[]>`SELECT id, orden FROM lineas_asiento WHERE asiento_id = ${d.asientoId} ORDER BY orden`;
  for (const [i, l] of nuevas.entries()) {
    const existente = actuales[i];
    if (existente) {
      await tx`
        UPDATE lineas_asiento SET orden = ${i + 1}, cuenta_id = ${l.cuentaId}, descripcion = ${l.descripcion ?? null},
               debe = ${deCentavos(l.debe)}, haber = ${deCentavos(l.haber)}
         WHERE id = ${existente.id}`;
    } else {
      await escribirLineas(tx, d.empresaId, d.asientoId, [l], i);
    }
  }
  const sobran = actuales.slice(nuevas.length).map((a) => a.id);
  if (sobran.length) await tx`DELETE FROM lineas_asiento WHERE id IN ${tx(sobran)}`;
}

// Corrige un asiento contabilizado con otro asiento igual pero con debe y haber invertidos, enlazado al original.
export async function revertirAsiento(
  tx: Tx,
  d: { empresaId: string; asientoId: string; usuarioId: string; fecha: string; motivo: string },
): Promise<{ id: string; numero: number }> {
  const [a] = await tx<{ numero: number; estado: string; origen: string; concepto: string; referencia: string | null; revierte_a: string | null; fecha: string }[]>`
    SELECT numero, estado, origen, concepto, referencia, revierte_a, to_char(fecha, 'YYYY-MM-DD') AS fecha FROM asientos WHERE id = ${d.asientoId}`;
  if (!a) throw new ErrorContable("El asiento no existe");
  if (a.estado !== "contabilizado") throw new ErrorContable("Solo se revierten asientos contabilizados");
  if (a.origen !== "manual") throw new ErrorContable("Este asiento lo generó un documento; se corrige anulando el documento");
  if (a.revierte_a) throw new ErrorContable("Este asiento ya es una reversión");
  if (d.fecha < a.fecha) throw new ErrorContable("La reversión no puede tener fecha anterior al asiento original");
  const [ya] = await tx`SELECT 1 FROM asientos WHERE revierte_a = ${d.asientoId}`;
  if (ya) throw new ErrorContable("Este asiento ya fue revertido");
  const lineas = await tx<{ cuenta_id: string; descripcion: string | null; debe: string; haber: string }[]>`
    SELECT cuenta_id, descripcion, debe::text, haber::text FROM lineas_asiento WHERE asiento_id = ${d.asientoId} ORDER BY orden`;
  const r = await insertarAsiento(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, fecha: d.fecha, origen: "manual", juntar: false, revierteA: d.asientoId,
    concepto: `Reversión del asiento n.º ${a.numero}: ${d.motivo}`, referencia: a.referencia,
    lineas: lineas.map((l) => ({ cuentaId: l.cuenta_id, descripcion: l.descripcion, debe: aCentavos(l.haber), haber: aCentavos(l.debe) })),
  });
  return { id: r.id, numero: r.numero! };
}

export async function anularAsientoDeDocumento(tx: Tx, asientoId: string, usuarioId: string, motivo: string) {
  await tx`
    UPDATE asientos SET estado = 'anulado', anulado_por = ${usuarioId}, anulado_en = now(), motivo_anulacion = ${motivo}
     WHERE id = ${asientoId} AND estado = 'contabilizado'`;
}

export async function bitacora(tx: Tx, empresaId: string, usuarioId: string, accion: string, detalle: Record<string, unknown>) {
  await tx`INSERT INTO bitacora (empresa_id, usuario_id, accion, detalle) VALUES (${empresaId}, ${usuarioId}, ${accion}, ${tx.json(detalle as never)})`;
}
