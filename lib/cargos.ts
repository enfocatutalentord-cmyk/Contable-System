import { bitacora, ErrorContable, insertarAsiento } from "./asientos.ts";
import { nivelDeCodigo } from "./catalogo-rd.ts";
import type { Tx } from "./db.ts";
import { aCentavos, deCentavos } from "./montos.ts";

// Prioridad 2.2 (P2e): impuestos que Empire paga por cuenta de un cliente. Como a los clientes no se les factura ni se les llevan asientos, el pago
// queda como un cargo en las cuentas por cobrar de Empire, sin comprobante fiscal: al pagarlo sale del banco contra «Impuestos pagados por cuenta de
// clientes» (activo, bajo 1102) y al cobrarlo entra al banco contra esa misma cuenta. Cada cargo lleva su recibo propio.

export const NOMBRE_CUENTA_CARGOS = "Impuestos pagados por cuenta de clientes";
export const FORMAS_COBRO_CARGO: Record<string, string> = { transferencia: "Transferencia", cheque: "Cheque", efectivo: "Efectivo", tarjeta: "Tarjeta", otro: "Otra" };

// La cuenta de activo donde se anotan; se crea bajo 1102 la primera vez.
export async function cuentaCargos(tx: Tx, empresaId: string): Promise<string> {
  const [padre] = await tx<{ id: string; de_detalle: boolean }[]>`SELECT id, de_detalle FROM cuentas WHERE codigo = '1102'`;
  if (!padre || padre.de_detalle) throw new ErrorContable("Falta el grupo 1102 en el catálogo de cuentas de la empresa propia");
  const [ya] = await tx<{ id: string }[]>`SELECT id FROM cuentas WHERE padre_id = ${padre.id} AND lower(nombre) = lower(${NOMBRE_CUENTA_CARGOS})`;
  if (ya) return ya.id;
  const hijas = await tx<{ codigo: string }[]>`SELECT codigo FROM cuentas WHERE padre_id = ${padre.id}`;
  const usados = new Set(hijas.map((h) => Number(h.codigo.slice(4))));
  let n = 1;
  while (usados.has(n)) n++;
  const codigo = `1102${String(n).padStart(2, "0")}`;
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
    SELECT ${empresaId}, ${codigo}, ${NOMBRE_CUENTA_CARGOS}, tipo, id, ${nivelDeCodigo(codigo)}, true FROM cuentas WHERE id = ${padre.id} RETURNING id`;
  return id;
}

async function cuentaDeEfectivo(tx: Tx, id: string) {
  const [c] = await tx<{ tipo: string; de_detalle: boolean; activa: boolean }[]>`SELECT tipo, de_detalle, activa FROM cuentas WHERE id = ${id}`;
  if (!c || c.tipo !== "activo" || !c.de_detalle || !c.activa) throw new ErrorContable("Elige la cuenta de banco o caja");
}

// Empire pagó el impuesto: sale del banco y queda por cobrar al cliente (corre dentro de la empresa propia).
export async function registrarCargo(tx: Tx, d: {
  empresaId: string; usuarioId: string; clienteId: string; concepto: string; fecha: string; monto: bigint; cuentaPagoId: string; notificacionId: string | null;
}): Promise<{ id: string; numero: number }> {
  if (d.monto <= 0n) throw new ErrorContable("El monto debe ser mayor que cero");
  const [cliente] = await tx<{ nombre: string; activo: boolean }[]>`SELECT nombre, activo FROM clientes WHERE id = ${d.clienteId}`;
  if (!cliente?.activo) throw new ErrorContable("El cliente no existe o está inactivo");
  await cuentaDeEfectivo(tx, d.cuentaPagoId);
  const cuentaCargo = await cuentaCargos(tx, d.empresaId);
  await tx`SELECT 1 FROM empresas WHERE id = ${d.empresaId} FOR UPDATE`;
  const [{ numero }] = await tx<{ numero: number }[]>`SELECT COALESCE(max(numero), 0) + 1 AS numero FROM cargos_cliente`;
  const asiento = await insertarAsiento(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, fecha: d.fecha, origen: "cargo", concepto: `Cargo ${numero}: ${d.concepto} (${cliente.nombre})`.slice(0, 300),
    referencia: `Cargo ${numero}`,
    lineas: [{ cuentaId: cuentaCargo, debe: d.monto, haber: 0n, descripcion: cliente.nombre }, { cuentaId: d.cuentaPagoId, debe: 0n, haber: d.monto }],
  });
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO cargos_cliente (empresa_id, numero, cliente_id, concepto, fecha, monto, cuenta_pago_id, cuenta_cargo_id, asiento_id, notificacion_id, creado_por)
    VALUES (${d.empresaId}, ${numero}, ${d.clienteId}, ${d.concepto}, ${d.fecha}, ${deCentavos(d.monto)}, ${d.cuentaPagoId}, ${cuentaCargo}, ${asiento.id}, ${d.notificacionId}, ${d.usuarioId}) RETURNING id`;
  await bitacora(tx, d.empresaId, d.usuarioId, "cargo_registrado", { numero, monto: deCentavos(d.monto) });
  return { id, numero };
}

// El cliente le devolvió el dinero a Empire: entra al banco y se salda el cargo.
export async function cobrarCargo(tx: Tx, d: { empresaId: string; usuarioId: string; cargoId: string; fecha: string; cuentaCobroId: string; forma: string; referencia: string | null }) {
  if (!(d.forma in FORMAS_COBRO_CARGO)) throw new ErrorContable("Elige la forma de cobro");
  const [c] = await tx<{ numero: number; estado: string; monto: string; cuenta_cargo_id: string; fecha: string; cliente: string }[]>`
    SELECT g.numero, g.estado, g.monto::text, g.cuenta_cargo_id, to_char(g.fecha, 'YYYY-MM-DD') AS fecha, c.nombre AS cliente
      FROM cargos_cliente g JOIN clientes c ON c.id = g.cliente_id WHERE g.id = ${d.cargoId} FOR UPDATE OF g`;
  if (!c) throw new ErrorContable("El cargo no existe");
  if (c.estado !== "pendiente") throw new ErrorContable("Este cargo ya se cobró");
  if (d.fecha < c.fecha) throw new ErrorContable("El cobro no puede ser antes de la fecha del cargo");
  await cuentaDeEfectivo(tx, d.cuentaCobroId);
  const monto = aCentavos(c.monto);
  const asiento = await insertarAsiento(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, fecha: d.fecha, origen: "cargo", concepto: `Cobro del cargo ${c.numero} a ${c.cliente}`.slice(0, 300),
    referencia: d.referencia ?? `Recibo de cargo ${c.numero}`,
    lineas: [{ cuentaId: d.cuentaCobroId, debe: monto, haber: 0n }, { cuentaId: c.cuenta_cargo_id, debe: 0n, haber: monto, descripcion: c.cliente }],
  });
  await tx`UPDATE cargos_cliente SET estado = 'cobrado', cobrado_en = ${d.fecha}, cobro_forma = ${d.forma}, cobro_referencia = ${d.referencia},
                                     cuenta_cobro_id = ${d.cuentaCobroId}, asiento_cobro_id = ${asiento.id} WHERE id = ${d.cargoId}`;
  await bitacora(tx, d.empresaId, d.usuarioId, "cargo_cobrado", { numero: c.numero, monto: c.monto });
}

export type Cargo = {
  id: string; numero: number; cliente_id: string; cliente: string; concepto: string; fecha: string; monto: string; estado: string;
  cobrado_en: string | null; cobro_forma: string | null; cobro_referencia: string | null;
};

export const listarCargos = (tx: Tx) => tx<Cargo[]>`
  SELECT g.id, g.numero, g.cliente_id, c.nombre AS cliente, g.concepto, to_char(g.fecha, 'YYYY-MM-DD') AS fecha, g.monto::text, g.estado,
         to_char(g.cobrado_en, 'YYYY-MM-DD') AS cobrado_en, g.cobro_forma, g.cobro_referencia
    FROM cargos_cliente g JOIN clientes c ON c.id = g.cliente_id ORDER BY g.estado, g.fecha DESC, g.numero DESC`;

// Datos del pago que escribe la persona (el comprobante va aparte, como archivo).
export type PagoImpuesto = { quien: "cliente" | "empire"; fecha: string; referencia: string | null; cuentaPagoId: string | null };
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function leerPagoImpuesto(fd: FormData, hoy: string): PagoImpuesto {
  const t = (k: string, max: number) => String(fd.get(k) ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const quien = t("quien", 10);
  if (quien !== "cliente" && quien !== "empire") throw new ErrorContable("Elige quién pagó el impuesto");
  const fecha = t("fecha", 10);
  if (!FECHA.test(fecha) || Number.isNaN(Date.parse(fecha))) throw new ErrorContable("Escribe la fecha del pago");
  if (fecha > hoy) throw new ErrorContable("La fecha del pago no puede ser futura");
  const cuenta = t("cuenta_pago", 40);
  if (quien === "empire" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cuenta)) throw new ErrorContable("Elige el banco o la caja de donde salió el pago");
  return { quien, fecha, referencia: t("referencia", 100) || null, cuentaPagoId: quien === "empire" ? cuenta : null };
}
