import { bitacora, ErrorContable, insertarAsiento, anularAsientoDeDocumento, type LineaAsiento } from "./asientos";
import { aPesos, calcularLinea, cantidadTexto, redondearDiv, tasaDeTexto, tasaTexto } from "./calculos";
import type { Tx } from "./db";
import { aCentavos, deCentavos } from "./montos";

export { aPesos, calcularLinea, cantidadTexto, leerCantidad, leerTasa, redondearDiv, tasaDeTexto, tasaTexto } from "./calculos";

export type TipoNcf = "B01" | "B02" | "B14" | "B15" | "B04";
export const NOMBRE_NCF: Record<TipoNcf, string> = {
  B01: "Crédito fiscal",
  B02: "Consumo",
  B14: "Régimen especial",
  B15: "Gubernamental",
  B04: "Nota de crédito",
};
// Tipos que exigen RNC o cédula del cliente.
export const NCF_CON_RNC: TipoNcf[] = ["B01", "B14", "B15"];

// Códigos de anulación del formato 608 de la DGII.
export const MOTIVOS_608: Record<string, string> = {
  "01": "Deterioro de factura preimpresa",
  "02": "Errores de impresión (factura preimpresa)",
  "03": "Impresión defectuosa",
  "04": "Corrección de la información",
  "05": "Cambio de productos",
  "06": "Devolución de productos",
  "07": "Omisión de productos",
  "08": "Errores en secuencia de NCF",
  "09": "Por cese de operaciones",
  "10": "Pérdida o hurto de talonarios",
};

export type CuentasVentas = Record<
  "cxc" | "itbis_por_pagar" | "ingreso_servicios" | "devoluciones_ventas" | "itbis_retenido_terceros" |
  "isr_retenido_terceros" | "ganancia_cambiaria" | "perdida_cambiaria",
  string
>;

export async function cuentasVentas(tx: Tx): Promise<CuentasVentas> {
  const filas = await tx<{ clave: keyof CuentasVentas; cuenta_id: string }[]>`SELECT clave, cuenta_id FROM cuentas_empresa`;
  const r = Object.fromEntries(filas.map((f) => [f.clave, f.cuenta_id])) as Partial<CuentasVentas>;
  const faltan = (["cxc", "itbis_por_pagar", "ingreso_servicios", "devoluciones_ventas", "itbis_retenido_terceros",
    "isr_retenido_terceros", "ganancia_cambiaria", "perdida_cambiaria"] as const).filter((k) => !r[k]);
  if (faltan.length) throw new ErrorContable("Faltan cuentas en Configuración: " + faltan.join(", "));
  return r as CuentasVentas;
}

// Toma el siguiente NCF del rango activo y vigente de ese tipo (bloqueando el rango).
export async function tomarNcf(tx: Tx, tipo: TipoNcf, fecha: string): Promise<{ ncf: string; vence: string }> {
  const [s] = await tx<{ id: string; siguiente: string; hasta: string; vence: string }[]>`
    SELECT id, siguiente::text, hasta::text, to_char(vence, 'YYYY-MM-DD') AS vence FROM secuencias_ncf
     WHERE tipo = ${tipo} AND activa AND siguiente <= hasta AND vence >= ${fecha}
     ORDER BY vence, desde LIMIT 1 FOR UPDATE`;
  if (!s) {
    throw new ErrorContable(`No hay comprobantes ${tipo} disponibles y vigentes. Agrega el rango autorizado por la DGII en Comprobantes NCF.`);
  }
  await tx`UPDATE secuencias_ncf SET siguiente = siguiente + 1 WHERE id = ${s.id}`;
  return { ncf: tipo + s.siguiente.padStart(8, "0"), vence: s.vence };
}

export type LineaVenta = {
  servicioId: string | null;
  descripcion: string;
  cantidad: bigint; // x10000
  precio: bigint; // centavos
  tasa: number;
  cuentaIngresoId: string;
};

export async function emitirFactura(
  tx: Tx,
  d: {
    empresaId: string; usuarioId: string; clienteId: string; tipo: Exclude<TipoNcf, "B04">;
    fecha: string; vence: string; moneda: "DOP" | "USD"; tasa: bigint; notas: string | null; lineas: LineaVenta[];
  },
): Promise<string> {
  const [cliente] = await tx<{ nombre: string; rnc: string | null; activo: boolean }[]>`
    SELECT nombre, rnc, activo FROM clientes WHERE id = ${d.clienteId}`;
  if (!cliente || !cliente.activo) throw new ErrorContable("El cliente no existe o está inactivo");
  if (NCF_CON_RNC.includes(d.tipo) && !cliente.rnc) {
    throw new ErrorContable(`Para un comprobante ${d.tipo} (${NOMBRE_NCF[d.tipo]}) el cliente necesita RNC o cédula`);
  }
  if (d.lineas.length === 0) throw new ErrorContable("La factura necesita al menos una línea");
  const cuentas = await cuentasVentas(tx);

  const calc = d.lineas.map((l) => ({ ...l, ...calcularLinea(l.cantidad, l.precio, l.tasa) }));
  const subtotal = calc.reduce((s, l) => s + l.subtotal, 0n);
  const itbis = calc.reduce((s, l) => s + l.itbis, 0n);
  const total = subtotal + itbis;
  if (total <= 0n) throw new ErrorContable("El total de la factura debe ser mayor que cero");

  const { ncf, vence: ncfVence } = await tomarNcf(tx, d.tipo, d.fecha);

  // Asiento en pesos: CxC al total; ingresos por cuenta e ITBIS por pagar.
  const lineasAsiento: LineaAsiento[] = calc.map((l) => ({ cuentaId: l.cuentaIngresoId, debe: 0n, haber: aPesos(l.subtotal, d.tasa) }));
  const itbisPesos = aPesos(itbis, d.tasa);
  lineasAsiento.push({ cuentaId: cuentas.itbis_por_pagar, debe: 0n, haber: itbisPesos });
  const totalPesos = lineasAsiento.reduce((s, l) => s + l.haber, 0n);
  lineasAsiento.unshift({ cuentaId: cuentas.cxc, debe: totalPesos, haber: 0n, descripcion: cliente.nombre });
  const asiento = await insertarAsiento(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, fecha: d.fecha, origen: "factura",
    concepto: `Factura ${ncf} a ${cliente.nombre}`, referencia: ncf, lineas: lineasAsiento,
  });

  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO facturas (empresa_id, tipo_ncf, ncf, ncf_vence, cliente_id, fecha, vence, moneda, tasa,
                          subtotal, itbis, total, notas, asiento_id, creado_por)
    VALUES (${d.empresaId}, ${d.tipo}, ${ncf}, ${ncfVence}, ${d.clienteId}, ${d.fecha}, ${d.vence}, ${d.moneda},
            ${tasaTexto(d.tasa)}, ${deCentavos(subtotal)}, ${deCentavos(itbis)}, ${deCentavos(total)}, ${d.notas},
            ${asiento.id}, ${d.usuarioId})
    RETURNING id`;
  for (const [i, l] of calc.entries()) {
    await tx`
      INSERT INTO lineas_factura (factura_id, empresa_id, orden, servicio_id, descripcion, cantidad, precio, tasa_itbis,
                                  cuenta_ingreso_id, subtotal, itbis)
      VALUES (${id}, ${d.empresaId}, ${i + 1}, ${l.servicioId}, ${l.descripcion}, ${cantidadTexto(l.cantidad)},
              ${deCentavos(l.precio)}, ${l.tasa}, ${l.cuentaIngresoId}, ${deCentavos(l.subtotal)}, ${deCentavos(l.itbis)})`;
  }
  await bitacora(tx, d.empresaId, d.usuarioId, "factura_emitida", { ncf, total: deCentavos(total), moneda: d.moneda });
  return id;
}

export async function saldoFactura(tx: Tx, facturaId: string): Promise<bigint> {
  const [r] = await tx<{ saldo: string }[]>`SELECT saldo::text FROM saldos_factura WHERE factura_id = ${facturaId}`;
  return r ? aCentavos(r.saldo) : 0n;
}

// Nota de crédito (B04) por un monto sobre una factura, sin pasar de su saldo pendiente.
export async function emitirNotaCredito(
  tx: Tx,
  d: { empresaId: string; usuarioId: string; facturaId: string; fecha: string; subtotal: bigint; tasaItbis: number; motivo: string },
): Promise<string> {
  const [f] = await tx<{ id: string; ncf: string; cliente_id: string; moneda: "DOP" | "USD"; tasa: string; anulada: boolean; tipo_ncf: string; fecha: string; nombre: string }[]>`
    SELECT f.id, f.ncf, f.cliente_id, f.moneda, f.tasa::text, f.anulada, f.tipo_ncf, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, c.nombre
      FROM facturas f JOIN clientes c ON c.id = f.cliente_id WHERE f.id = ${d.facturaId} FOR UPDATE OF f`;
  if (!f || f.tipo_ncf === "B04") throw new ErrorContable("La factura no existe");
  if (f.anulada) throw new ErrorContable("La factura está anulada");
  if (d.fecha < f.fecha) throw new ErrorContable("La nota de crédito no puede tener fecha anterior a la factura");
  const itbis = redondearDiv(d.subtotal * BigInt(d.tasaItbis), 100n);
  const total = d.subtotal + itbis;
  if (total <= 0n) throw new ErrorContable("El monto debe ser mayor que cero");
  if (total > (await saldoFactura(tx, f.id))) throw new ErrorContable("La nota de crédito no puede pasar del saldo pendiente de la factura");

  const cuentas = await cuentasVentas(tx);
  const tasa = tasaDeTexto(f.tasa);
  const { ncf, vence } = await tomarNcf(tx, "B04", d.fecha);
  const subPesos = aPesos(d.subtotal, tasa);
  const itbisPesos = aPesos(itbis, tasa);
  const asiento = await insertarAsiento(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, fecha: d.fecha, origen: "nota_credito",
    concepto: `Nota de crédito ${ncf} a ${f.nombre} (modifica ${f.ncf})`, referencia: ncf,
    lineas: [
      { cuentaId: cuentas.devoluciones_ventas, debe: subPesos, haber: 0n },
      { cuentaId: cuentas.itbis_por_pagar, debe: itbisPesos, haber: 0n },
      { cuentaId: cuentas.cxc, debe: 0n, haber: subPesos + itbisPesos, descripcion: f.nombre },
    ],
  });
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO facturas (empresa_id, tipo_ncf, ncf, ncf_vence, cliente_id, factura_origen_id, fecha, vence, moneda, tasa,
                          subtotal, itbis, total, notas, asiento_id, creado_por)
    VALUES (${d.empresaId}, 'B04', ${ncf}, ${vence}, ${f.cliente_id}, ${f.id}, ${d.fecha}, ${d.fecha}, ${f.moneda}, ${f.tasa},
            ${deCentavos(d.subtotal)}, ${deCentavos(itbis)}, ${deCentavos(total)}, ${d.motivo}, ${asiento.id}, ${d.usuarioId})
    RETURNING id`;
  const cuentaIngreso = cuentas.devoluciones_ventas;
  await tx`
    INSERT INTO lineas_factura (factura_id, empresa_id, orden, descripcion, cantidad, precio, tasa_itbis, cuenta_ingreso_id, subtotal, itbis)
    VALUES (${id}, ${d.empresaId}, 1, ${d.motivo}, 1, ${deCentavos(d.subtotal)}, ${d.tasaItbis}, ${cuentaIngreso},
            ${deCentavos(d.subtotal)}, ${deCentavos(itbis)})`;
  await bitacora(tx, d.empresaId, d.usuarioId, "nota_credito_emitida", { ncf, modifica: f.ncf, total: deCentavos(total) });
  return id;
}

export async function anularFactura(tx: Tx, d: { empresaId: string; usuarioId: string; facturaId: string; motivo: string }) {
  const [f] = await tx<{ ncf: string; anulada: boolean; asiento_id: string; tipo_ncf: string }[]>`
    SELECT ncf, anulada, asiento_id, tipo_ncf FROM facturas WHERE id = ${d.facturaId} FOR UPDATE`;
  if (!f) throw new ErrorContable("El comprobante no existe");
  if (f.anulada) throw new ErrorContable("El comprobante ya está anulado");
  if (f.tipo_ncf !== "B04") {
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT (SELECT count(*) FROM aplicaciones_cobro a JOIN cobros c ON c.id = a.cobro_id WHERE a.factura_id = ${d.facturaId} AND NOT c.anulado)
           + (SELECT count(*) FROM facturas WHERE factura_origen_id = ${d.facturaId} AND NOT anulada) AS n`;
    if (n > 0) throw new ErrorContable("La factura tiene cobros o notas de crédito vigentes; anúlalos primero");
  }
  await anularAsientoDeDocumento(tx, f.asiento_id, d.usuarioId, `Anulación de ${f.ncf}: ${MOTIVOS_608[d.motivo] ?? d.motivo}`);
  await tx`
    UPDATE facturas SET anulada = true, motivo_anulacion = ${d.motivo}, anulada_por = ${d.usuarioId}, anulada_en = now()
     WHERE id = ${d.facturaId}`;
  await bitacora(tx, d.empresaId, d.usuarioId, "comprobante_anulado", { ncf: f.ncf, motivo: d.motivo });
}

export type Aplicacion = { facturaId: string; monto: bigint };

export async function registrarCobro(
  tx: Tx,
  d: {
    empresaId: string; usuarioId: string; clienteId: string; fecha: string; moneda: "DOP" | "USD"; tasa: bigint;
    cuentaDestinoId: string; formaPago: string; referencia: string | null; notas: string | null;
    recibido: bigint; retencionItbis: bigint; retencionIsr: bigint; aplicaciones: Aplicacion[];
  },
): Promise<number> {
  const aplicaciones = d.aplicaciones.filter((a) => a.monto > 0n);
  if (aplicaciones.length === 0) throw new ErrorContable("Aplica el cobro a al menos una factura");
  const totalCobro = d.recibido + d.retencionItbis + d.retencionIsr;
  const totalAplicado = aplicaciones.reduce((s, a) => s + a.monto, 0n);
  if (totalCobro !== totalAplicado) {
    throw new ErrorContable("Lo recibido más las retenciones debe ser igual a lo aplicado a las facturas");
  }
  const [cliente] = await tx<{ nombre: string }[]>`SELECT nombre FROM clientes WHERE id = ${d.clienteId}`;
  if (!cliente) throw new ErrorContable("El cliente no existe");
  const [destino] = await tx<{ tipo: string; de_detalle: boolean; activa: boolean }[]>`
    SELECT tipo, de_detalle, activa FROM cuentas WHERE id = ${d.cuentaDestinoId}`;
  if (!destino || destino.tipo !== "activo" || !destino.de_detalle || !destino.activa) {
    throw new ErrorContable("Elige la cuenta de banco o caja donde entró el dinero");
  }
  const cuentas = await cuentasVentas(tx);

  // Revisa cada factura (bloqueándola) y suma su valor en libros en pesos.
  let cxcPesos = 0n;
  const ncfs: string[] = [];
  for (const a of aplicaciones) {
    const [f] = await tx<{ ncf: string; cliente_id: string; moneda: string; tasa: string; anulada: boolean; tipo_ncf: string; fecha: string }[]>`
      SELECT ncf, cliente_id, moneda, tasa::text, anulada, tipo_ncf, to_char(fecha, 'YYYY-MM-DD') AS fecha
        FROM facturas WHERE id = ${a.facturaId} FOR UPDATE`;
    if (!f || f.tipo_ncf === "B04" || f.cliente_id !== d.clienteId) throw new ErrorContable("Una de las facturas no es de este cliente");
    if (f.anulada) throw new ErrorContable(`La factura ${f.ncf} está anulada`);
    if (f.moneda !== d.moneda) throw new ErrorContable(`La factura ${f.ncf} está en ${f.moneda}; el cobro debe ser en la misma moneda`);
    if (a.monto > (await saldoFactura(tx, a.facturaId))) throw new ErrorContable(`El monto aplicado a ${f.ncf} pasa de su saldo pendiente`);
    cxcPesos += aPesos(a.monto, tasaDeTexto(f.tasa));
    ncfs.push(f.ncf);
  }

  const recibidoPesos = aPesos(d.recibido, d.tasa);
  const retItbisPesos = aPesos(d.retencionItbis, d.tasa);
  const retIsrPesos = aPesos(d.retencionIsr, d.tasa);
  const diferencia = recibidoPesos + retItbisPesos + retIsrPesos - cxcPesos; // > 0 ganancia, < 0 pérdida cambiaria

  await tx`SELECT 1 FROM empresas WHERE id = ${d.empresaId} FOR UPDATE`;
  const [{ numero }] = await tx<{ numero: number }[]>`SELECT COALESCE(max(numero), 0) + 1 AS numero FROM cobros`;
  const asiento = await insertarAsiento(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, fecha: d.fecha, origen: "cobro",
    concepto: `Recibo ${numero} de ${cliente.nombre} (${ncfs.join(", ")})`, referencia: d.referencia ?? `Recibo ${numero}`,
    lineas: [
      { cuentaId: d.cuentaDestinoId, debe: recibidoPesos, haber: 0n },
      { cuentaId: cuentas.itbis_retenido_terceros, debe: retItbisPesos, haber: 0n },
      { cuentaId: cuentas.isr_retenido_terceros, debe: retIsrPesos, haber: 0n },
      { cuentaId: cuentas.perdida_cambiaria, debe: diferencia < 0n ? -diferencia : 0n, haber: 0n },
      { cuentaId: cuentas.cxc, debe: 0n, haber: cxcPesos, descripcion: cliente.nombre },
      { cuentaId: cuentas.ganancia_cambiaria, debe: 0n, haber: diferencia > 0n ? diferencia : 0n },
    ],
  });
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO cobros (empresa_id, numero, cliente_id, fecha, moneda, tasa, cuenta_destino_id, forma_pago, referencia,
                        recibido, retencion_itbis, retencion_isr, notas, asiento_id, creado_por)
    VALUES (${d.empresaId}, ${numero}, ${d.clienteId}, ${d.fecha}, ${d.moneda}, ${tasaTexto(d.tasa)}, ${d.cuentaDestinoId},
            ${d.formaPago}, ${d.referencia}, ${deCentavos(d.recibido)}, ${deCentavos(d.retencionItbis)},
            ${deCentavos(d.retencionIsr)}, ${d.notas}, ${asiento.id}, ${d.usuarioId})
    RETURNING id`;
  for (const a of aplicaciones) {
    await tx`INSERT INTO aplicaciones_cobro (cobro_id, factura_id, empresa_id, monto)
             VALUES (${id}, ${a.facturaId}, ${d.empresaId}, ${deCentavos(a.monto)})`;
  }
  await bitacora(tx, d.empresaId, d.usuarioId, "cobro_registrado", { numero, total: deCentavos(totalCobro) });
  return numero;
}

export async function anularCobro(tx: Tx, d: { empresaId: string; usuarioId: string; numero: number; motivo: string }) {
  const [c] = await tx<{ id: string; anulado: boolean; asiento_id: string }[]>`
    SELECT id, anulado, asiento_id FROM cobros WHERE numero = ${d.numero} FOR UPDATE`;
  if (!c) throw new ErrorContable("El recibo no existe");
  if (c.anulado) throw new ErrorContable("El recibo ya está anulado");
  await anularAsientoDeDocumento(tx, c.asiento_id, d.usuarioId, `Anulación del recibo ${d.numero}: ${d.motivo}`);
  await tx`UPDATE cobros SET anulado = true, motivo_anulacion = ${d.motivo}, anulado_por = ${d.usuarioId}, anulado_en = now() WHERE id = ${c.id}`;
  await bitacora(tx, d.empresaId, d.usuarioId, "cobro_anulado", { numero: d.numero, motivo: d.motivo });
}
