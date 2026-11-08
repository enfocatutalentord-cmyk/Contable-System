import { ErrorContable } from "./asientos.ts";
import { cantidadTexto, redondearDiv } from "./calculos.ts";
import type { Tx } from "./db";
import { aplicarTasa, leerPorcentaje } from "./fiscal.ts";
import { aCentavos, deCentavos } from "./montos.ts";
import { guardarBorradorFactura, type TipoFactura } from "./ventas.ts";

// Bloque 2, entrega 2c: propuestas de servicios (Documento maestro, sección 4). El descuento se ve aparte: precio de lista,
// descuento y precio final por línea. Aceptada, se convierte en factura (servicio extra) o en iguala (cliente fijo).

export const ESTADOS_PROPUESTA: Record<string, string> = { borrador: "Borrador", enviada: "Enviada", aceptada: "Aceptada", rechazada: "Rechazada" };

export type LineaPropuesta = {
  servicioId: string | null; descripcion: string; cantidad: bigint /* x10000 */; precioLista: bigint; descuento: bigint;
  impuestoId: string; adicionalId: string | null; unidadId: string | null;
};
export type ImpuestoTasa = { id: string; tipo: string; tasa: string };
export type TotalesPropuesta = { lista: bigint; descuento: bigint; subtotal: bigint; impuestos: bigint; total: bigint };

// Totales en centavos: lista y descuento por la cantidad; impuestos con la tasa de la configuración.
export function totalesPropuesta(lineas: LineaPropuesta[], impuestos: Map<string, ImpuestoTasa>): TotalesPropuesta {
  const t = { lista: 0n, descuento: 0n, subtotal: 0n, impuestos: 0n, total: 0n };
  for (const l of lineas) {
    const lista = redondearDiv(l.cantidad * l.precioLista, 10000n);
    const sub = redondearDiv(l.cantidad * (l.precioLista - l.descuento), 10000n);
    t.lista += lista;
    t.descuento += lista - sub;
    t.subtotal += sub;
    for (const id of [l.impuestoId, l.adicionalId]) {
      const i = id ? impuestos.get(id) : undefined;
      if (i) t.impuestos += aplicarTasa(sub, leerPorcentaje(i.tasa)!);
    }
  }
  t.total = t.subtotal + t.impuestos;
  return t;
}

// El anticipo sobre el total con impuestos (redondeado al centavo).
export const montoAnticipo = (total: bigint, pct: string) => redondearDiv(total * aCentavos(pct), 10000n);

export function validarLineas(lineas: LineaPropuesta[]) {
  if (!lineas.length) throw new ErrorContable("La propuesta necesita al menos un servicio");
  lineas.forEach((l, i) => {
    if (!l.descripcion.trim()) throw new ErrorContable(`Línea ${i + 1}: escribe la descripción`);
    if (l.cantidad <= 0n) throw new ErrorContable(`Línea ${i + 1}: la cantidad debe ser mayor que cero`);
    if (l.descuento > l.precioLista) throw new ErrorContable(`Línea ${i + 1}: el descuento no puede pasar del precio de lista`);
  });
}

export type DatosPropuesta = {
  empresaId: string; usuarioId: string; clienteId: string; fecha: string; validaHasta: string; requisitos: string | null;
  anticipoPct: string; formaPago: string | null; entrega: string | null; notas: string | null; lineas: LineaPropuesta[];
};

export async function guardarPropuesta(tx: Tx, d: DatosPropuesta & { propuestaId?: string | null }): Promise<string> {
  validarLineas(d.lineas);
  if (d.validaHasta < d.fecha) throw new ErrorContable("La propuesta no puede vencer antes de su fecha");
  const cabecera = {
    cliente_id: d.clienteId, fecha: d.fecha, valida_hasta: d.validaHasta, requisitos: d.requisitos, anticipo_pct: d.anticipoPct,
    forma_pago: d.formaPago, entrega: d.entrega, notas: d.notas,
  };
  let id = d.propuestaId ?? null;
  if (id) {
    const [p] = await tx<{ estado: string }[]>`SELECT estado FROM propuestas WHERE id = ${id} FOR UPDATE`;
    if (!p) throw new ErrorContable("La propuesta no existe");
    if (p.estado === "aceptada" || p.estado === "rechazada") throw new ErrorContable("Una propuesta aceptada o rechazada no se modifica");
    await tx`UPDATE propuestas SET ${tx(cabecera)} WHERE id = ${id}`;
    await tx`DELETE FROM lineas_propuesta WHERE propuesta_id = ${id}`;
  } else {
    await tx`SELECT 1 FROM empresas WHERE id = ${d.empresaId} FOR UPDATE`;
    const [{ numero }] = await tx<{ numero: number }[]>`SELECT COALESCE(max(numero), 0) + 1 AS numero FROM propuestas`;
    [{ id }] = await tx<{ id: string }[]>`
      INSERT INTO propuestas ${tx({ ...cabecera, empresa_id: d.empresaId, numero, creado_por: d.usuarioId })} RETURNING id`;
  }
  for (const [i, l] of d.lineas.entries()) {
    await tx`INSERT INTO lineas_propuesta (propuesta_id, empresa_id, orden, servicio_id, descripcion, cantidad, precio_lista, descuento,
                                           impuesto_id, impuesto_adicional_id, unidad_id)
             VALUES (${id}, ${d.empresaId}, ${i + 1}, ${l.servicioId}, ${l.descripcion.trim()}, ${cantidadTexto(l.cantidad)},
                     ${deCentavos(l.precioLista)}, ${deCentavos(l.descuento)}, ${l.impuestoId}, ${l.adicionalId}, ${l.unidadId})`;
  }
  return id!;
}

const PASOS: Record<string, string[]> = { borrador: ["enviada", "aceptada", "rechazada"], enviada: ["aceptada", "rechazada", "borrador"] };

export async function cambiarEstado(tx: Tx, propuestaId: string, estado: string) {
  const [p] = await tx<{ estado: string }[]>`SELECT estado FROM propuestas WHERE id = ${propuestaId} FOR UPDATE`;
  if (!p) throw new ErrorContable("La propuesta no existe");
  if (!(PASOS[p.estado] ?? []).includes(estado)) throw new ErrorContable(`Una propuesta ${ESTADOS_PROPUESTA[p.estado].toLowerCase()} no pasa a ${ESTADOS_PROPUESTA[estado]?.toLowerCase() ?? estado}`);
  await tx`UPDATE propuestas SET estado = ${estado} WHERE id = ${propuestaId}`;
}

type Fila = {
  servicio_id: string | null; descripcion: string; cantidad: string; precio_lista: string; descuento: string;
  impuesto_id: string; impuesto_adicional_id: string | null; unidad_id: string | null;
};
// EMP-P01: el precio de emprendedor es fijo, sin negociación caso por caso.
export const descuentoAEmprendedor = (categoria: string | null, lineas: { descuento: string }[]) =>
  categoria === "emprendedor" && lineas.some((l) => aCentavos(l.descuento) > 0n);

export const lineasDe = (tx: Tx, propuestaId: string) => tx<Fila[]>`
  SELECT servicio_id, descripcion, cantidad::text, precio_lista::text, descuento::text, impuesto_id, impuesto_adicional_id, unidad_id
    FROM lineas_propuesta WHERE propuesta_id = ${propuestaId} ORDER BY orden`;
const cantidadDe = (t: string) => {
  const [e, dec = ""] = t.split(".");
  return BigInt(e) * 10000n + BigInt((dec + "0000").slice(0, 4));
};
export const aLinea = (f: Fila): LineaPropuesta => ({
  servicioId: f.servicio_id, descripcion: f.descripcion, cantidad: cantidadDe(f.cantidad), precioLista: aCentavos(f.precio_lista),
  descuento: aCentavos(f.descuento), impuestoId: f.impuesto_id, adicionalId: f.impuesto_adicional_id, unidadId: f.unidad_id,
});

async function aceptada(tx: Tx, propuestaId: string) {
  const [p] = await tx<{ numero: number; cliente_id: string; estado: string; factura_id: string | null; acuerdo_id: string | null; fecha: string }[]>`
    SELECT numero, cliente_id, estado, factura_id, acuerdo_id, to_char(fecha, 'YYYY-MM-DD') AS fecha FROM propuestas WHERE id = ${propuestaId} FOR UPDATE`;
  if (!p) throw new ErrorContable("La propuesta no existe");
  if (p.estado !== "aceptada") throw new ErrorContable("Primero marca la propuesta como aceptada");
  if (p.factura_id || p.acuerdo_id) throw new ErrorContable("Esta propuesta ya se convirtió");
  return p;
}

// Aceptada → borrador de factura con el precio final de cada línea (el descuento queda dicho en la descripción).
export async function convertirEnFactura(tx: Tx, d: { empresaId: string; usuarioId: string; propuestaId: string; fecha: string }): Promise<string> {
  const p = await aceptada(tx, d.propuestaId);
  const [c] = await tx<{ activo: boolean; rnc: string | null; ncf_predeterminado: TipoFactura | null; dias_credito: number; tipo_ingreso: string }[]>`
    SELECT activo, rnc, ncf_predeterminado, dias_credito, tipo_ingreso FROM clientes WHERE id = ${p.cliente_id}`;
  if (!c?.activo) throw new ErrorContable("El cliente está inactivo");
  const vence = new Date(`${d.fecha}T00:00:00Z`);
  vence.setUTCDate(vence.getUTCDate() + c.dias_credito);
  const lineas = (await lineasDe(tx, d.propuestaId)).map(aLinea).map((l) => ({
    servicioId: l.servicioId, cantidad: l.cantidad, precio: l.precioLista - l.descuento, unidadId: l.unidadId,
    impuestoIds: [l.impuestoId, ...(l.adicionalId ? [l.adicionalId] : [])],
    descripcion: l.descuento > 0n ? `${l.descripcion} (precio de lista RD$${deCentavos(l.precioLista)}, descuento RD$${deCentavos(l.descuento)})` : l.descripcion,
  }));
  const facturaId = await guardarBorradorFactura(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, clienteId: p.cliente_id, tipo: c.ncf_predeterminado ?? (c.rnc ? "B01" : "B02"),
    fecha: d.fecha, vence: vence.toISOString().slice(0, 10), moneda: "DOP", tasa: 10000n, notas: `Según la propuesta n.º ${p.numero}`,
    lineas, tipoIngreso: c.tipo_ingreso,
  });
  await tx`UPDATE propuestas SET factura_id = ${facturaId} WHERE id = ${d.propuestaId}`;
  return facturaId;
}

// Aceptada → iguala: acuerdo normal con el servicio de la primera línea y el total final como iguala mensual.
export async function convertirEnIguala(tx: Tx, d: { empresaId: string; propuestaId: string; inicio: string }): Promise<string> {
  const p = await aceptada(tx, d.propuestaId);
  const lineas = (await lineasDe(tx, d.propuestaId)).map(aLinea);
  const servicio = lineas.find((l) => l.servicioId)?.servicioId;
  if (!servicio) throw new ErrorContable("Para convertirla en iguala, al menos una línea debe ser un servicio de la lista de precios");
  const [ya] = await tx`SELECT 1 FROM acuerdos_cliente WHERE cliente_id = ${p.cliente_id} AND activo`;
  if (ya) throw new ErrorContable("El cliente ya tiene un acuerdo de iguala activo; edítalo en Igualas");
  const monto = lineas.reduce((s, l) => s + redondearDiv(l.cantidad * (l.precioLista - l.descuento), 10000n), 0n);
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO acuerdos_cliente (empresa_id, cliente_id, tipo, servicio_id, monto, inicio, notas)
    VALUES (${d.empresaId}, ${p.cliente_id}, 'normal', ${servicio}, ${deCentavos(monto)}, ${d.inicio}, ${`Según la propuesta n.º ${p.numero}`})
    RETURNING id`;
  await tx`UPDATE propuestas SET acuerdo_id = ${id} WHERE id = ${d.propuestaId}`;
  return id;
}
