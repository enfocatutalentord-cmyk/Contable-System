import type { Tx } from "./db.ts";
import { aCentavos, deCentavos } from "./montos.ts";
import { ErrorPresupuesto } from "./presupuesto-metas.ts";
import { registrarSalida } from "./salidas.ts";

// Prioridad 1.6 (cierre): gastos pendientes de pago. Mientras están «Pendiente» no cuentan en el presupuesto, ni en el banco, ni en la
// contabilidad; al marcarlos «Pagado» se registra su salida (con su asiento) y recién ahí se restan.

export type GastoPendiente = {
  id: string; tipo: "oficina" | "personal"; fecha: string; categoria: string | null; descripcion: string | null; monto: bigint;
  cuentaId: string; cuenta: string; unidadId: string | null; estado: "pendiente" | "pagado" | "descartado"; salidaNumero: number | null;
};

export async function listarPendientes(tx: Tx, todos = false): Promise<GastoPendiente[]> {
  const f = await tx<{ id: string; tipo: "oficina" | "personal"; fecha: string; categoria: string | null; descripcion: string | null; monto: string; cuenta_id: string; cuenta: string; unidad_id: string | null; estado: GastoPendiente["estado"]; salida: number | null }[]>`
    SELECT g.id, g.tipo, to_char(g.fecha, 'YYYY-MM-DD') AS fecha, g.categoria, g.descripcion, g.monto::text, g.cuenta_destino_id AS cuenta_id,
           c.codigo || ' · ' || c.nombre AS cuenta, g.unidad_id, g.estado, s.numero AS salida
      FROM gastos_pendientes g JOIN cuentas c ON c.id = g.cuenta_destino_id LEFT JOIN salidas s ON s.id = g.salida_id
     WHERE ${todos} OR g.estado = 'pendiente' ORDER BY g.estado = 'pendiente' DESC, g.fecha, g.creado`;
  return f.map((x) => ({
    id: x.id, tipo: x.tipo, fecha: x.fecha, categoria: x.categoria, descripcion: x.descripcion, monto: aCentavos(x.monto), cuentaId: x.cuenta_id, cuenta: x.cuenta,
    unidadId: x.unidad_id, estado: x.estado, salidaNumero: x.salida,
  }));
}

export async function agregarPendiente(tx: Tx, empresaId: string, usuarioId: string, d: {
  tipo: string; fecha: string; categoria: string | null; descripcion: string | null; monto: bigint; cuentaId: string; unidadId?: string | null;
}) {
  if (d.tipo !== "oficina" && d.tipo !== "personal") throw new ErrorPresupuesto("Elige si es gasto de oficina o personal.");
  if (d.monto <= 0n) throw new ErrorPresupuesto("Escribe el monto.");
  if (!d.cuentaId) throw new ErrorPresupuesto(d.tipo === "oficina" ? "Elige la cuenta de gasto." : "Elige la cuenta corriente de la socia.");
  if (d.tipo === "personal" && !d.categoria?.trim()) throw new ErrorPresupuesto("Escribe la categoría del gasto personal.");
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO gastos_pendientes (empresa_id, tipo, fecha, categoria, descripcion, monto, cuenta_destino_id, unidad_id, creado_por)
    VALUES (${empresaId}, ${d.tipo}, ${d.fecha}, ${d.categoria?.trim() || null}, ${d.descripcion?.trim() || null}, ${deCentavos(d.monto)}, ${d.cuentaId}, ${d.unidadId ?? null}, ${usuarioId})
    RETURNING id`;
  return id;
}

// «Pagado»: registra la salida (asiento incluido) con el banco o caja y la fecha del pago, y deja el gasto ligado a ella.
export async function marcarPagado(tx: Tx, empresaId: string, usuarioId: string, id: string, d: { origenId: string; fecha: string; referencia?: string | null }) {
  const [g] = await tx<{ tipo: "oficina" | "personal"; categoria: string | null; descripcion: string | null; monto: string; cuenta_destino_id: string; unidad_id: string | null; estado: string }[]>`
    SELECT tipo, categoria, descripcion, monto::text, cuenta_destino_id, unidad_id, estado FROM gastos_pendientes WHERE id = ${id} FOR UPDATE`;
  if (!g) throw new ErrorPresupuesto("El gasto no existe.");
  if (g.estado !== "pendiente") throw new ErrorPresupuesto("Ese gasto ya no está pendiente.");
  if (!d.origenId) throw new ErrorPresupuesto("Elige de dónde salió el dinero.");
  const s = await registrarSalida(tx, empresaId, usuarioId, {
    tipo: g.tipo, fecha: d.fecha, origenId: d.origenId, destinoId: g.cuenta_destino_id, monto: aCentavos(g.monto), categoria: g.categoria,
    descripcion: g.descripcion, referencia: d.referencia ?? null, unidadId: g.unidad_id,
  });
  await tx`UPDATE gastos_pendientes SET estado = 'pagado', salida_id = ${s.id} WHERE id = ${id}`;
  return s;
}

export async function descartarPendiente(tx: Tx, id: string) {
  const r = await tx`UPDATE gastos_pendientes SET estado = 'descartado' WHERE id = ${id} AND estado = 'pendiente' RETURNING id`;
  if (!r.length) throw new ErrorPresupuesto("Ese gasto ya no está pendiente.");
}

// Pendientes de un mes (por su fecha), en centavos: lo que falta por pagar.
export const totalPendiente = (g: GastoPendiente[], anio: number, mes: number) =>
  g.filter((x) => x.estado === "pendiente" && x.fecha.startsWith(`${anio}-${String(mes).padStart(2, "0")}`)).reduce((a, x) => a + x.monto, 0n);
