import type { Tx } from "./db";
import { deCentavos } from "./montos";

export type LineaAsiento = { cuentaId: string; debe: bigint; haber: bigint; descripcion?: string | null };

export class ErrorContable extends Error {
  code = "P0001";
}

// Registra un asiento con el siguiente número de la empresa. Junta las líneas de una misma cuenta
// y lado, y descarta las que quedan en cero. La base vuelve a revisar el cuadre y el cierre.
export async function insertarAsiento(
  tx: Tx,
  datos: {
    empresaId: string;
    usuarioId: string;
    fecha: string;
    concepto: string;
    referencia?: string | null;
    origen: "manual" | "factura" | "nota_credito" | "cobro";
    lineas: LineaAsiento[];
    juntar?: boolean;
  },
): Promise<{ id: string; numero: number }> {
  let lineas = datos.lineas.filter((l) => l.debe !== 0n || l.haber !== 0n);
  if (datos.juntar !== false) {
    const porClave = new Map<string, LineaAsiento>();
    for (const l of lineas) {
      const lado = l.debe > 0n ? "d" : "h";
      const clave = `${l.cuentaId}:${lado}:${l.descripcion ?? ""}`;
      const previa = porClave.get(clave);
      if (previa) {
        previa.debe += l.debe;
        previa.haber += l.haber;
      } else porClave.set(clave, { ...l });
    }
    lineas = [...porClave.values()];
  }
  if (lineas.some((l) => l.debe < 0n || l.haber < 0n)) throw new ErrorContable("Montos negativos en el asiento");

  await tx`SELECT 1 FROM empresas WHERE id = ${datos.empresaId} FOR UPDATE`;
  const [{ siguiente }] = await tx<{ siguiente: number }[]>`SELECT COALESCE(max(numero), 0) + 1 AS siguiente FROM asientos`;
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO asientos (empresa_id, numero, fecha, concepto, referencia, origen, creado_por)
    VALUES (${datos.empresaId}, ${siguiente}, ${datos.fecha}, ${datos.concepto}, ${datos.referencia ?? null},
            ${datos.origen}, ${datos.usuarioId}) RETURNING id`;
  for (const [orden, l] of lineas.entries()) {
    await tx`
      INSERT INTO lineas_asiento (asiento_id, empresa_id, orden, cuenta_id, descripcion, debe, haber)
      VALUES (${id}, ${datos.empresaId}, ${orden + 1}, ${l.cuentaId}, ${l.descripcion ?? null},
              ${deCentavos(l.debe)}, ${deCentavos(l.haber)})`;
  }
  return { id, numero: siguiente };
}

export async function anularAsientoDeDocumento(tx: Tx, asientoId: string, usuarioId: string, motivo: string) {
  await tx`
    UPDATE asientos SET anulado = true, anulado_por = ${usuarioId}, anulado_en = now(), motivo_anulacion = ${motivo}
     WHERE id = ${asientoId} AND NOT anulado`;
}

export async function bitacora(tx: Tx, empresaId: string, usuarioId: string, accion: string, detalle: Record<string, unknown>) {
  await tx`INSERT INTO bitacora (empresa_id, usuario_id, accion, detalle) VALUES (${empresaId}, ${usuarioId}, ${accion}, ${tx.json(detalle as never)})`;
}
