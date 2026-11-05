import { anularAsientoDeDocumento, bitacora, ErrorContable, insertarAsiento } from "./asientos.ts";
import type { Tx } from "./db";
import { aCentavos, deCentavos } from "./montos.ts";
import { registrarCobro } from "./ventas.ts";

// Bloque 2, entrega 2c: anticipos de clientes. Se cobran antes de facturar a «Anticipos de clientes» (210501, pasivo) y se
// aplican a la factura con un cobro desde esa cuenta, que rebaja su saldo y va al 607 con la forma de pago del anticipo.

export const FORMAS_ANTICIPO: Record<string, string> = {
  transferencia: "Transferencia", cheque: "Cheque", efectivo: "Efectivo", tarjeta: "Tarjeta", permuta: "Trueque (permuta)", otro: "Otro",
};

export async function cuentaAnticipos(tx: Tx): Promise<string> {
  const [c] = await tx<{ id: string }[]>`SELECT id FROM cuentas WHERE codigo = '210501' AND de_detalle AND activa`;
  if (!c) throw new ErrorContable("Falta la cuenta 210501 «Anticipos de clientes» en el catálogo");
  return c.id;
}

export type DatosAnticipo = {
  empresaId: string; usuarioId: string; clienteId: string; fecha: string; monto: bigint; cuentaDestinoId: string; formaPago: string;
  referencia: string | null; notas: string | null; propuestaId: string | null;
};

export async function registrarAnticipo(tx: Tx, d: DatosAnticipo): Promise<{ id: string; numero: number }> {
  if (d.monto <= 0n) throw new ErrorContable("El anticipo debe ser mayor que cero");
  if (!(d.formaPago in FORMAS_ANTICIPO)) throw new ErrorContable("Elige la forma de pago");
  const [cliente] = await tx<{ nombre: string }[]>`SELECT nombre FROM clientes WHERE id = ${d.clienteId}`;
  if (!cliente) throw new ErrorContable("El cliente no existe");
  const [destino] = await tx<{ tipo: string; de_detalle: boolean; activa: boolean }[]>`SELECT tipo, de_detalle, activa FROM cuentas WHERE id = ${d.cuentaDestinoId}`;
  const tipos = d.formaPago === "permuta" ? ["activo", "gasto", "costo"] : ["activo"];
  if (!destino || !tipos.includes(destino.tipo) || !destino.de_detalle || !destino.activa) {
    throw new ErrorContable(d.formaPago === "permuta" ? "Elige la cuenta de lo recibido en trueque (un gasto o un activo)" : "Elige la cuenta de banco o caja donde entró el dinero");
  }
  if (d.propuestaId) {
    const [p] = await tx<{ cliente_id: string }[]>`SELECT cliente_id FROM propuestas WHERE id = ${d.propuestaId}`;
    if (!p || p.cliente_id !== d.clienteId) throw new ErrorContable("La propuesta no es de este cliente");
  }
  const anticipos = await cuentaAnticipos(tx);
  await tx`SELECT 1 FROM empresas WHERE id = ${d.empresaId} FOR UPDATE`;
  const [{ numero }] = await tx<{ numero: number }[]>`SELECT COALESCE(max(numero), 0) + 1 AS numero FROM anticipos`;
  const asiento = await insertarAsiento(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, fecha: d.fecha, origen: "anticipo",
    concepto: `Recibo de anticipo ${numero} de ${cliente.nombre}`, referencia: d.referencia ?? `Anticipo ${numero}`,
    lineas: [
      { cuentaId: d.cuentaDestinoId, debe: d.monto, haber: 0n },
      { cuentaId: anticipos, debe: 0n, haber: d.monto, descripcion: cliente.nombre },
    ],
  });
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO anticipos (empresa_id, numero, cliente_id, propuesta_id, fecha, monto, cuenta_destino_id, cuenta_anticipo_id, forma_pago,
                           referencia, notas, asiento_id, creado_por)
    VALUES (${d.empresaId}, ${numero}, ${d.clienteId}, ${d.propuestaId}, ${d.fecha}, ${deCentavos(d.monto)}, ${d.cuentaDestinoId}, ${anticipos},
            ${d.formaPago}, ${d.referencia}, ${d.notas}, ${asiento.id}, ${d.usuarioId}) RETURNING id`;
  await bitacora(tx, d.empresaId, d.usuarioId, "anticipo_registrado", { numero, monto: deCentavos(d.monto) });
  return { id, numero };
}

export type Anticipo = {
  id: string; numero: number; cliente_id: string; cliente: string; fecha: string; monto: string; aplicado: string; saldo: string;
  forma_pago: string; referencia: string | null; anulado: boolean; propuesta: number | null; cuenta: string;
};

export const listarAnticipos = (tx: Tx, clienteId: string | null = null) => tx<Anticipo[]>`
  SELECT a.id, a.numero, a.cliente_id, c.nombre AS cliente, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.monto::text,
         COALESCE(x.aplicado, 0)::text AS aplicado, (a.monto - COALESCE(x.aplicado, 0))::text AS saldo, a.forma_pago, a.referencia, a.anulado,
         p.numero AS propuesta, k.codigo || ' · ' || k.nombre AS cuenta
    FROM anticipos a JOIN clientes c ON c.id = a.cliente_id JOIN cuentas k ON k.id = a.cuenta_destino_id
    LEFT JOIN propuestas p ON p.id = a.propuesta_id
    LEFT JOIN LATERAL (SELECT sum(co.recibido) AS aplicado FROM cobros co WHERE co.anticipo_id = a.id AND NOT co.anulado) x ON true
   WHERE (${clienteId}::uuid IS NULL OR a.cliente_id = ${clienteId}::uuid)
   ORDER BY a.anulado, a.fecha DESC, a.numero DESC`;

// Aplica (parte de) un anticipo a una factura emitida: un cobro desde «Anticipos de clientes».
export async function aplicarAnticipo(tx: Tx, d: { empresaId: string; usuarioId: string; anticipoId: string; facturaId: string; monto: bigint; fecha: string }): Promise<number> {
  const [a] = await tx<{ cliente_id: string; cuenta_anticipo_id: string; forma_pago: string; numero: number; fecha: string }[]>`
    SELECT cliente_id, cuenta_anticipo_id, forma_pago, numero, to_char(fecha, 'YYYY-MM-DD') AS fecha FROM anticipos WHERE id = ${d.anticipoId}`;
  if (!a) throw new ErrorContable("El anticipo no existe");
  if (d.fecha < a.fecha) throw new ErrorContable("El anticipo no se puede aplicar antes de la fecha en que se recibió");
  return registrarCobro(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, clienteId: a.cliente_id, fecha: d.fecha, moneda: "DOP", tasa: 10000n,
    cuentaDestinoId: a.cuenta_anticipo_id, formaPago: a.forma_pago, referencia: `Anticipo ${a.numero}`, notas: null,
    recibido: d.monto, retenciones: [], aplicaciones: [{ facturaId: d.facturaId, monto: d.monto }], anticipoId: d.anticipoId,
  });
}

export async function anularAnticipo(tx: Tx, d: { empresaId: string; usuarioId: string; anticipoId: string; motivo: string }) {
  const [a] = await tx<{ anulado: boolean; asiento_id: string; numero: number }[]>`SELECT anulado, asiento_id, numero FROM anticipos WHERE id = ${d.anticipoId} FOR UPDATE`;
  if (!a) throw new ErrorContable("El anticipo no existe");
  if (a.anulado) throw new ErrorContable("El anticipo ya está anulado");
  const [usado] = await tx`SELECT 1 FROM cobros WHERE anticipo_id = ${d.anticipoId} AND NOT anulado`;
  if (usado) throw new ErrorContable("El anticipo ya se aplicó a una factura; anula primero ese cobro");
  await anularAsientoDeDocumento(tx, a.asiento_id, d.usuarioId, `Anulación del anticipo ${a.numero}: ${d.motivo}`);
  await tx`UPDATE anticipos SET anulado = true, motivo_anulacion = ${d.motivo}, anulado_por = ${d.usuarioId}, anulado_en = now() WHERE id = ${d.anticipoId}`;
  await bitacora(tx, d.empresaId, d.usuarioId, "anticipo_anulado", { numero: a.numero });
}

export const saldoDe = (a: Anticipo) => aCentavos(a.saldo);
