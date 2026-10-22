// Ventas y cuentas por cobrar. Toda factura o nota de crédito nace como borrador (sin NCF ni asiento) y al emitirse toma
// el siguiente NCF y registra su asiento contabilizado. Impuestos y retenciones salen de la configuración tributaria.
import { anularAsientoDeDocumento, bitacora, ErrorContable, insertarAsiento, type LineaAsiento } from "./asientos.ts";
import { aPesos, cantidadTexto, redondearDiv, tasaDeTexto, tasaTexto } from "./calculos.ts";
import type { Tx } from "./db";
import { aplicarTasa, COMPROBANTES, leerPorcentaje, listarImpuestos, listarRetenciones } from "./fiscal.ts";
import { aCentavos, deCentavos } from "./montos.ts";

export { aPesos, calcularLinea, cantidadTexto, leerCantidad, leerTasa, redondearDiv, tasaDeTexto, tasaTexto } from "./calculos.ts";

// Comprobantes que se emiten desde ventas (los electrónicos llegan con la fase fiscal, por un proveedor certificado).
export const TIPOS_FACTURA = ["B01", "B02", "B14", "B15", "B16"] as const;
export type TipoFactura = (typeof TIPOS_FACTURA)[number];
export type TipoNcf = TipoFactura | "B04";
export const NOMBRE_NCF: Record<TipoNcf, string> = Object.fromEntries(
  [...TIPOS_FACTURA, "B04"].map((t) => [t, COMPROBANTES[t].nombre]),
) as Record<TipoNcf, string>;
// Tipos que exigen RNC o cédula del cliente.
export const NCF_CON_RNC: TipoNcf[] = ["B01", "B14", "B15"];
export const esTipoFactura = (t: string): t is TipoFactura => (TIPOS_FACTURA as readonly string[]).includes(t);

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

// Cuentas de ventas que no salen de la configuración tributaria (Configuración de ventas).
export const CLAVES_CUENTAS = ["cxc", "ingreso_servicios", "devoluciones_ventas", "ganancia_cambiaria", "perdida_cambiaria"] as const;
export type CuentasVentas = Record<(typeof CLAVES_CUENTAS)[number], string>;

export async function cuentasVentas(tx: Tx): Promise<CuentasVentas> {
  const filas = await tx<{ clave: string; cuenta_id: string }[]>`SELECT clave, cuenta_id FROM cuentas_empresa`;
  const r = Object.fromEntries(filas.map((f) => [f.clave, f.cuenta_id])) as Partial<CuentasVentas>;
  const faltan = CLAVES_CUENTAS.filter((k) => !r[k]);
  if (faltan.length) throw new ErrorContable("Faltan cuentas en Configuración de ventas: " + faltan.join(", "));
  return r as CuentasVentas;
}

// Toma el siguiente NCF del rango activo y vigente de ese tipo (bloqueando el rango).
export async function tomarNcf(tx: Tx, tipo: TipoNcf, fecha: string): Promise<{ ncf: string; vence: string }> {
  const [s] = await tx<{ id: string; siguiente: string; vence: string }[]>`
    SELECT id, siguiente::text, to_char(vence, 'YYYY-MM-DD') AS vence FROM secuencias_ncf
     WHERE tipo = ${tipo} AND activa AND siguiente <= hasta AND vence >= ${fecha}
     ORDER BY vence, desde LIMIT 1 FOR UPDATE`;
  if (!s) {
    throw new ErrorContable(`No hay comprobantes ${tipo} disponibles y vigentes. Agrega el rango autorizado por la DGII en Comprobantes fiscales.`);
  }
  await tx`UPDATE secuencias_ncf SET siguiente = siguiente + 1 WHERE id = ${s.id}`;
  return { ncf: tipo + s.siguiente.padStart(8, "0"), vence: s.vence };
}

// ───── Líneas e impuestos ─────

export type LineaEntrada = {
  servicioId: string | null;
  descripcion: string;
  cantidad: bigint; // x10000
  precio: bigint; // centavos
  impuestoIds: string[]; // el principal (ITBIS o exento) y, si aplica, otro cargo (propina, selectivo…)
  cuentaIngresoId?: string;
};

export type ImpuestoCalculado = { impuestoId: string; tipo: string; tasa: string; monto: bigint; cuentaId: string | null };
export type LineaCalculada = Omit<LineaEntrada, "impuestoIds" | "cuentaIngresoId"> & {
  cuentaIngresoId: string; subtotal: bigint; itbis: bigint; otros: bigint; impuestos: ImpuestoCalculado[];
};

// Valida y calcula las líneas con los impuestos vigentes a la fecha del documento. La cuenta de ingreso sale del servicio
// o de la configuración, nunca del navegador.
export async function calcularLineas(tx: Tx, fecha: string, entradas: LineaEntrada[]): Promise<LineaCalculada[]> {
  if (entradas.length === 0) throw new ErrorContable("El documento necesita al menos una línea");
  const [empresa] = await tx<{ contribuye_itbis: boolean }[]>`SELECT contribuye_itbis FROM empresas WHERE id = empresa_actual()`;
  const vigentes = new Map((await listarImpuestos(tx, fecha)).map((i) => [i.id, i]));
  const cuentas = await cuentasVentas(tx);
  const resultado: LineaCalculada[] = [];
  for (const [n, l] of entradas.entries()) {
    const donde = `Línea ${n + 1}`;
    if (l.cantidad <= 0n) throw new ErrorContable(`${donde}: la cantidad debe ser mayor que cero`);
    if (l.precio < 0n) throw new ErrorContable(`${donde}: el precio no puede ser negativo`);
    const imps = [...new Set(l.impuestoIds)].map((id) => {
      const i = vigentes.get(id);
      if (!i) throw new ErrorContable(`${donde}: el impuesto elegido no está vigente el ${fecha}`);
      return i;
    });
    const principales = imps.filter((i) => i.tipo === "itbis" || i.tipo === "exento");
    if (principales.length !== 1) throw new ErrorContable(`${donde}: elige el ITBIS (o exento) de la línea`);
    if (!empresa.contribuye_itbis && imps.some((i) => i.tipo === "itbis" && leerPorcentaje(i.tasa)! > 0n)) {
      throw new ErrorContable(`${donde}: la empresa no está registrada como contribuyente de ITBIS; usa Exento`);
    }
    let cuentaIngresoId = cuentas.ingreso_servicios;
    if (l.servicioId) {
      const [s] = await tx<{ cuenta_ingreso_id: string | null }[]>`SELECT cuenta_ingreso_id FROM servicios WHERE id = ${l.servicioId}`;
      if (!s) throw new ErrorContable(`${donde}: el producto o servicio no existe`);
      cuentaIngresoId = s.cuenta_ingreso_id ?? cuentaIngresoId;
    }
    if (l.cuentaIngresoId) cuentaIngresoId = l.cuentaIngresoId;
    const subtotal = redondearDiv(l.cantidad * l.precio, 10000n);
    const impuestos = imps.map((i) => ({
      impuestoId: i.id, tipo: i.tipo, tasa: i.tasa, monto: aplicarTasa(subtotal, leerPorcentaje(i.tasa)!), cuentaId: i.cuenta_ventas_id,
    }));
    resultado.push({
      servicioId: l.servicioId, descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precio, cuentaIngresoId, subtotal, impuestos,
      itbis: impuestos.filter((i) => i.tipo === "itbis").reduce((s, i) => s + i.monto, 0n),
      otros: impuestos.filter((i) => i.tipo !== "itbis").reduce((s, i) => s + i.monto, 0n),
    });
  }
  return resultado;
}

export function totales(lineas: LineaCalculada[]) {
  const subtotal = lineas.reduce((s, l) => s + l.subtotal, 0n);
  const itbis = lineas.reduce((s, l) => s + l.itbis, 0n);
  const otros = lineas.reduce((s, l) => s + l.otros, 0n);
  return { subtotal, itbis, otros, total: subtotal + itbis + otros };
}

async function escribirLineas(tx: Tx, empresaId: string, facturaId: string, lineas: LineaCalculada[]) {
  for (const [i, l] of lineas.entries()) {
    const [{ id }] = await tx<{ id: string }[]>`
      INSERT INTO lineas_factura (factura_id, empresa_id, orden, servicio_id, descripcion, cantidad, precio, cuenta_ingreso_id,
                                  subtotal, itbis, otros)
      VALUES (${facturaId}, ${empresaId}, ${i + 1}, ${l.servicioId}, ${l.descripcion}, ${cantidadTexto(l.cantidad)},
              ${deCentavos(l.precio)}, ${l.cuentaIngresoId}, ${deCentavos(l.subtotal)}, ${deCentavos(l.itbis)}, ${deCentavos(l.otros)})
      RETURNING id`;
    for (const imp of l.impuestos) {
      await tx`
        INSERT INTO impuestos_linea_factura (linea_id, factura_id, empresa_id, impuesto_id, tipo, tasa, monto)
        VALUES (${id}, ${facturaId}, ${empresaId}, ${imp.impuestoId}, ${imp.tipo}, ${imp.tasa}, ${deCentavos(imp.monto)})`;
    }
  }
}

// ───── Facturas ─────

export type DatosFactura = {
  empresaId: string; usuarioId: string; clienteId: string; tipo: TipoFactura; fecha: string; vence: string;
  moneda: "DOP" | "USD"; tasa: bigint; notas: string | null; lineas: LineaEntrada[];
};

// Crea o reemplaza un borrador de factura. Devuelve su id.
export async function guardarBorradorFactura(tx: Tx, d: DatosFactura & { facturaId?: string | null }): Promise<string> {
  const [cliente] = await tx<{ activo: boolean }[]>`SELECT activo FROM clientes WHERE id = ${d.clienteId}`;
  if (!cliente?.activo) throw new ErrorContable("El cliente no existe o está inactivo");
  if (!esTipoFactura(d.tipo)) throw new ErrorContable("Elige el tipo de comprobante");
  if (d.vence < d.fecha) throw new ErrorContable("El vencimiento no puede ser antes de la fecha de la factura");
  const lineas = await calcularLineas(tx, d.fecha, d.lineas);
  const t = totales(lineas);
  if (t.total <= 0n) throw new ErrorContable("El total de la factura debe ser mayor que cero");
  const cabecera = {
    tipo_ncf: d.tipo, cliente_id: d.clienteId, fecha: d.fecha, vence: d.vence, moneda: d.moneda, tasa: tasaTexto(d.tasa),
    subtotal: deCentavos(t.subtotal), itbis: deCentavos(t.itbis), otros_impuestos: deCentavos(t.otros), total: deCentavos(t.total),
    notas: d.notas,
  };
  let id = d.facturaId ?? null;
  if (id) {
    const [f] = await tx<{ estado: string; tipo_ncf: string }[]>`SELECT estado, tipo_ncf FROM facturas WHERE id = ${id} FOR UPDATE`;
    if (!f || f.tipo_ncf === "B04") throw new ErrorContable("La factura no existe");
    if (f.estado !== "borrador") throw new ErrorContable("Solo los borradores se pueden editar");
    await tx`UPDATE facturas SET ${tx({ ...cabecera, modificado_por: d.usuarioId, modificado_en: new Date() })} WHERE id = ${id}`;
    await tx`DELETE FROM lineas_factura WHERE factura_id = ${id}`;
  } else {
    [{ id }] = await tx<{ id: string }[]>`
      INSERT INTO facturas ${tx({ ...cabecera, empresa_id: d.empresaId, estado: "borrador", creado_por: d.usuarioId })} RETURNING id`;
  }
  await escribirLineas(tx, d.empresaId, id!, lineas);
  return id!;
}

export async function descartarBorradorFactura(tx: Tx, facturaId: string) {
  const r = await tx`DELETE FROM facturas WHERE id = ${facturaId} AND estado = 'borrador'`;
  if (r.count === 0) throw new ErrorContable("Solo se descartan borradores");
}

export async function saldoFactura(tx: Tx, facturaId: string): Promise<bigint> {
  const [r] = await tx<{ saldo: string }[]>`SELECT saldo::text FROM saldos_factura WHERE factura_id = ${facturaId}`;
  return r ? aCentavos(r.saldo) : 0n;
}

// Emite un borrador (factura o nota de crédito): valida, toma el NCF y registra el asiento contabilizado.
export async function emitir(
  tx: Tx, d: { empresaId: string; usuarioId: string; facturaId: string }, opciones: { autorizada?: boolean } = {},
): Promise<{ ncf: string; asiento: number }> {
  const [f] = await tx<{
    estado: string; tipo_ncf: TipoNcf; fecha: string; moneda: string; tasa: string; total: string; creado_por: string;
    cliente: string; rnc: string | null; cliente_activo: boolean; origen_id: string | null;
  }[]>`
    SELECT f.estado, f.tipo_ncf, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, f.moneda, f.tasa::text, f.total::text, f.creado_por,
           c.nombre AS cliente, c.rnc, c.activo AS cliente_activo, f.factura_origen_id AS origen_id
      FROM facturas f JOIN clientes c ON c.id = f.cliente_id WHERE f.id = ${d.facturaId} FOR UPDATE OF f`;
  if (!f) throw new ErrorContable("El comprobante no existe");
  if (f.estado !== "borrador") throw new ErrorContable("El comprobante ya fue emitido");
  const [empresa] = await tx<{ requiere_aprobacion: boolean }[]>`SELECT requiere_aprobacion FROM empresas WHERE id = ${d.empresaId}`;
  if (empresa.requiere_aprobacion && f.creado_por === d.usuarioId && !opciones.autorizada) {
    throw new ErrorContable("En esta empresa otra persona debe aprobar y emitir lo que tú registraste");
  }
  if (NCF_CON_RNC.includes(f.tipo_ncf) && !f.rnc) {
    throw new ErrorContable(`Para un comprobante ${f.tipo_ncf} (${NOMBRE_NCF[f.tipo_ncf]}) el cliente necesita RNC o cédula`);
  }
  const esNota = f.tipo_ncf === "B04";
  let modifica = "";
  if (esNota) {
    const [o] = await tx<{ ncf: string; estado: string; anulada: boolean; fecha: string }[]>`
      SELECT ncf, estado, anulada, to_char(fecha, 'YYYY-MM-DD') AS fecha FROM facturas WHERE id = ${f.origen_id} FOR UPDATE`;
    if (!o || o.estado !== "emitida" || o.anulada) throw new ErrorContable("La factura que modifica no está vigente");
    if (f.fecha < o.fecha) throw new ErrorContable("La nota de crédito no puede tener fecha anterior a la factura");
    if (aCentavos(f.total) > (await saldoFactura(tx, f.origen_id!))) {
      throw new ErrorContable("La nota de crédito no puede pasar del saldo pendiente de la factura");
    }
    modifica = o.ncf;
  } else if (!f.cliente_activo) {
    throw new ErrorContable("El cliente está inactivo");
  }

  const cuentas = await cuentasVentas(tx);
  const tasa = tasaDeTexto(f.tasa);
  const lineas = await tx<{ cuenta_ingreso_id: string; subtotal: string }[]>`
    SELECT cuenta_ingreso_id, subtotal::text FROM lineas_factura WHERE factura_id = ${d.facturaId} ORDER BY orden`;
  const impuestos = await tx<{ monto: string; cuenta_id: string | null; nombre: string }[]>`
    SELECT il.monto::text, i.cuenta_ventas_id AS cuenta_id, i.nombre
      FROM impuestos_linea_factura il JOIN impuestos i ON i.id = il.impuesto_id WHERE il.factura_id = ${d.facturaId}`;
  const sinCuenta = impuestos.find((i) => aCentavos(i.monto) > 0n && !i.cuenta_id);
  if (sinCuenta) throw new ErrorContable(`El impuesto «${sinCuenta.nombre}» no tiene cuenta de ventas en la configuración`);

  // Asiento en pesos. Factura: CxC contra ingresos e impuestos por pagar. Nota de crédito: al revés, contra devoluciones.
  const lado = (pesos: bigint): Pick<LineaAsiento, "debe" | "haber"> => (esNota ? { debe: pesos, haber: 0n } : { debe: 0n, haber: pesos });
  const lineasAsiento: LineaAsiento[] = [
    ...lineas.map((l) => ({ cuentaId: esNota ? cuentas.devoluciones_ventas : l.cuenta_ingreso_id, ...lado(aPesos(aCentavos(l.subtotal), tasa)) })),
    ...impuestos.filter((i) => i.cuenta_id).map((i) => ({ cuentaId: i.cuenta_id!, ...lado(aPesos(aCentavos(i.monto), tasa)) })),
  ];
  const totalPesos = lineasAsiento.reduce((s, l) => s + l.debe + l.haber, 0n);
  lineasAsiento.unshift({ cuentaId: cuentas.cxc, debe: esNota ? 0n : totalPesos, haber: esNota ? totalPesos : 0n, descripcion: f.cliente });

  const { ncf, vence } = await tomarNcf(tx, f.tipo_ncf, f.fecha);
  const asiento = await insertarAsiento(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, fecha: f.fecha, origen: esNota ? "nota_credito" : "factura",
    concepto: esNota ? `Nota de crédito ${ncf} a ${f.cliente} (modifica ${modifica})` : `Factura ${ncf} a ${f.cliente}`,
    referencia: ncf, lineas: lineasAsiento,
  });
  await tx`
    UPDATE facturas SET estado = 'emitida', ncf = ${ncf}, ncf_vence = ${vence}, asiento_id = ${asiento.id},
           emitida_por = ${d.usuarioId}, emitida_en = now()
     WHERE id = ${d.facturaId}`;
  await bitacora(tx, d.empresaId, d.usuarioId, esNota ? "nota_credito_emitida" : "factura_emitida", { ncf, total: f.total, moneda: f.moneda });
  return { ncf, asiento: asiento.numero! };
}

// Nota de crédito (B04) sobre una factura emitida, con uno de los impuestos de esa factura. Se emite al momento.
export async function emitirNotaCredito(
  tx: Tx,
  d: { empresaId: string; usuarioId: string; facturaId: string; fecha: string; subtotal: bigint; impuestoId: string; motivo: string },
): Promise<string> {
  const [f] = await tx<{ cliente_id: string; moneda: "DOP" | "USD"; tasa: string; anulada: boolean; estado: string; tipo_ncf: string }[]>`
    SELECT cliente_id, moneda, tasa::text, anulada, estado, tipo_ncf FROM facturas WHERE id = ${d.facturaId}`;
  if (!f || f.tipo_ncf === "B04" || f.estado !== "emitida") throw new ErrorContable("La factura no existe o no está emitida");
  if (f.anulada) throw new ErrorContable("La factura está anulada");
  const [usado] = await tx`SELECT 1 FROM impuestos_linea_factura WHERE factura_id = ${d.facturaId} AND impuesto_id = ${d.impuestoId} LIMIT 1`;
  if (!usado) throw new ErrorContable("Usa uno de los impuestos de la factura original");
  if (d.subtotal <= 0n) throw new ErrorContable("El monto debe ser mayor que cero");
  // La nota usa la tasa de la factura original aunque la configuración haya cambiado.
  const [imp] = await tx<{ tipo: string; tasa: string; cuenta_ventas_id: string | null }[]>`
    SELECT il.tipo, il.tasa::text, i.cuenta_ventas_id FROM impuestos_linea_factura il JOIN impuestos i ON i.id = il.impuesto_id
     WHERE il.factura_id = ${d.facturaId} AND il.impuesto_id = ${d.impuestoId} LIMIT 1`;
  const monto = aplicarTasa(d.subtotal, leerPorcentaje(imp.tasa)!);
  const itbis = imp.tipo === "itbis" ? monto : 0n;
  const otros = imp.tipo === "itbis" ? 0n : monto;
  const cuentas = await cuentasVentas(tx);
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO facturas (empresa_id, estado, tipo_ncf, cliente_id, factura_origen_id, fecha, vence, moneda, tasa,
                          subtotal, itbis, otros_impuestos, total, notas, creado_por)
    VALUES (${d.empresaId}, 'borrador', 'B04', ${f.cliente_id}, ${d.facturaId}, ${d.fecha}, ${d.fecha}, ${f.moneda}, ${f.tasa},
            ${deCentavos(d.subtotal)}, ${deCentavos(itbis)}, ${deCentavos(otros)}, ${deCentavos(d.subtotal + monto)}, ${d.motivo}, ${d.usuarioId})
    RETURNING id`;
  const [{ id: lineaId }] = await tx<{ id: string }[]>`
    INSERT INTO lineas_factura (factura_id, empresa_id, orden, descripcion, cantidad, precio, cuenta_ingreso_id, subtotal, itbis, otros)
    VALUES (${id}, ${d.empresaId}, 1, ${d.motivo}, 1, ${deCentavos(d.subtotal)}, ${cuentas.devoluciones_ventas},
            ${deCentavos(d.subtotal)}, ${deCentavos(itbis)}, ${deCentavos(otros)})
    RETURNING id`;
  await tx`
    INSERT INTO impuestos_linea_factura (linea_id, factura_id, empresa_id, impuesto_id, tipo, tasa, monto)
    VALUES (${lineaId}, ${id}, ${d.empresaId}, ${d.impuestoId}, ${imp.tipo}, ${imp.tasa}, ${deCentavos(monto)})`;
  // Quien tiene permiso de revertir emite la nota en el mismo paso (no pasa por la aprobación de borradores).
  await emitir(tx, { empresaId: d.empresaId, usuarioId: d.usuarioId, facturaId: id }, { autorizada: true });
  return id;
}

export async function anularFactura(tx: Tx, d: { empresaId: string; usuarioId: string; facturaId: string; motivo: string }) {
  const [f] = await tx<{ ncf: string; estado: string; anulada: boolean; asiento_id: string; tipo_ncf: string }[]>`
    SELECT ncf, estado, anulada, asiento_id, tipo_ncf FROM facturas WHERE id = ${d.facturaId} FOR UPDATE`;
  if (!f) throw new ErrorContable("El comprobante no existe");
  if (f.estado !== "emitida") throw new ErrorContable("Un borrador no se anula; se descarta");
  if (f.anulada) throw new ErrorContable("El comprobante ya está anulado");
  if (f.tipo_ncf !== "B04") {
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT (SELECT count(*) FROM aplicaciones_cobro a JOIN cobros c ON c.id = a.cobro_id WHERE a.factura_id = ${d.facturaId} AND NOT c.anulado)
           + (SELECT count(*) FROM facturas WHERE factura_origen_id = ${d.facturaId} AND estado = 'emitida' AND NOT anulada) AS n`;
    if (n > 0) throw new ErrorContable("La factura tiene cobros o notas de crédito vigentes; anúlalos primero");
  }
  await anularAsientoDeDocumento(tx, f.asiento_id, d.usuarioId, `Anulación de ${f.ncf}: ${MOTIVOS_608[d.motivo] ?? d.motivo}`);
  await tx`
    UPDATE facturas SET anulada = true, motivo_anulacion = ${d.motivo}, anulada_por = ${d.usuarioId}, anulada_en = now()
     WHERE id = ${d.facturaId}`;
  await bitacora(tx, d.empresaId, d.usuarioId, "comprobante_anulado", { ncf: f.ncf, motivo: d.motivo });
}

// ───── Cobros ─────

export type Aplicacion = { facturaId: string; monto: bigint };
export type RetencionCobro = { retencionId: string; monto: bigint };

export async function registrarCobro(
  tx: Tx,
  d: {
    empresaId: string; usuarioId: string; clienteId: string; fecha: string; moneda: "DOP" | "USD"; tasa: bigint;
    cuentaDestinoId: string; formaPago: string; referencia: string | null; notas: string | null;
    recibido: bigint; retenciones: RetencionCobro[]; aplicaciones: Aplicacion[];
  },
): Promise<number> {
  const aplicaciones = d.aplicaciones.filter((a) => a.monto > 0n);
  const retenciones = d.retenciones.filter((r) => r.monto > 0n);
  if (aplicaciones.length === 0) throw new ErrorContable("Aplica el cobro a al menos una factura");
  if (new Set(retenciones.map((r) => r.retencionId)).size !== retenciones.length) throw new ErrorContable("Hay una retención repetida");
  const totalRetenido = retenciones.reduce((s, r) => s + r.monto, 0n);
  const totalAplicado = aplicaciones.reduce((s, a) => s + a.monto, 0n);
  if (d.recibido < 0n || d.recibido + totalRetenido !== totalAplicado) {
    throw new ErrorContable("Lo recibido más las retenciones debe ser igual a lo aplicado a las facturas");
  }
  const [cliente] = await tx<{ nombre: string }[]>`SELECT nombre FROM clientes WHERE id = ${d.clienteId}`;
  if (!cliente) throw new ErrorContable("El cliente no existe");
  const [destino] = await tx<{ tipo: string; de_detalle: boolean; activa: boolean }[]>`
    SELECT tipo, de_detalle, activa FROM cuentas WHERE id = ${d.cuentaDestinoId}`;
  if (!destino || destino.tipo !== "activo" || !destino.de_detalle || !destino.activa) {
    throw new ErrorContable("Elige la cuenta de banco o caja donde entró el dinero");
  }
  const vigentes = new Map((await listarRetenciones(tx, d.fecha)).map((r) => [r.id, r]));
  const detalle = retenciones.map((r) => {
    const conf = vigentes.get(r.retencionId);
    if (!conf) throw new ErrorContable(`Una de las retenciones no está vigente el ${d.fecha}`);
    return { ...r, conf };
  });
  const cuentas = await cuentasVentas(tx);

  // Revisa cada factura (bloqueándola) y suma su valor en libros en pesos.
  let cxcPesos = 0n;
  const ncfs: string[] = [];
  for (const a of aplicaciones) {
    const [f] = await tx<{ ncf: string; cliente_id: string; moneda: string; tasa: string; anulada: boolean; estado: string; tipo_ncf: string }[]>`
      SELECT ncf, cliente_id, moneda, tasa::text, anulada, estado, tipo_ncf FROM facturas WHERE id = ${a.facturaId} FOR UPDATE`;
    if (!f || f.tipo_ncf === "B04" || f.estado !== "emitida" || f.cliente_id !== d.clienteId) {
      throw new ErrorContable("Una de las facturas no es de este cliente o no está emitida");
    }
    if (f.anulada) throw new ErrorContable(`La factura ${f.ncf} está anulada`);
    if (f.moneda !== d.moneda) throw new ErrorContable(`La factura ${f.ncf} está en ${f.moneda}; el cobro debe ser en la misma moneda`);
    if (a.monto > (await saldoFactura(tx, a.facturaId))) throw new ErrorContable(`El monto aplicado a ${f.ncf} pasa de su saldo pendiente`);
    cxcPesos += aPesos(a.monto, tasaDeTexto(f.tasa));
    ncfs.push(f.ncf);
  }

  const recibidoPesos = aPesos(d.recibido, d.tasa);
  const retPesos = detalle.map((r) => aPesos(r.monto, d.tasa));
  const diferencia = recibidoPesos + retPesos.reduce((s, m) => s + m, 0n) - cxcPesos; // > 0 ganancia, < 0 pérdida cambiaria

  await tx`SELECT 1 FROM empresas WHERE id = ${d.empresaId} FOR UPDATE`;
  const [{ numero }] = await tx<{ numero: number }[]>`SELECT COALESCE(max(numero), 0) + 1 AS numero FROM cobros`;
  const asiento = await insertarAsiento(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, fecha: d.fecha, origen: "cobro",
    concepto: `Recibo ${numero} de ${cliente.nombre} (${ncfs.join(", ")})`, referencia: d.referencia ?? `Recibo ${numero}`,
    lineas: [
      { cuentaId: d.cuentaDestinoId, debe: recibidoPesos, haber: 0n },
      ...detalle.map((r, i) => ({ cuentaId: r.conf.cuenta_por_terceros_id, debe: retPesos[i], haber: 0n, descripcion: r.conf.nombre })),
      { cuentaId: cuentas.perdida_cambiaria, debe: diferencia < 0n ? -diferencia : 0n, haber: 0n },
      { cuentaId: cuentas.cxc, debe: 0n, haber: cxcPesos, descripcion: cliente.nombre },
      { cuentaId: cuentas.ganancia_cambiaria, debe: 0n, haber: diferencia > 0n ? diferencia : 0n },
    ],
  });
  const suma = (imp: string) => detalle.filter((r) => r.conf.impuesto === imp).reduce((s, r) => s + r.monto, 0n);
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO cobros (empresa_id, numero, cliente_id, fecha, moneda, tasa, cuenta_destino_id, forma_pago, referencia,
                        recibido, retencion_itbis, retencion_isr, notas, asiento_id, creado_por)
    VALUES (${d.empresaId}, ${numero}, ${d.clienteId}, ${d.fecha}, ${d.moneda}, ${tasaTexto(d.tasa)}, ${d.cuentaDestinoId},
            ${d.formaPago}, ${d.referencia}, ${deCentavos(d.recibido)}, ${deCentavos(suma("itbis"))},
            ${deCentavos(suma("isr"))}, ${d.notas}, ${asiento.id}, ${d.usuarioId})
    RETURNING id`;
  for (const a of aplicaciones) {
    await tx`INSERT INTO aplicaciones_cobro (cobro_id, factura_id, empresa_id, monto)
             VALUES (${id}, ${a.facturaId}, ${d.empresaId}, ${deCentavos(a.monto)})`;
  }
  for (const r of detalle) {
    await tx`INSERT INTO retenciones_cobro (cobro_id, empresa_id, retencion_id, impuesto, tasa, monto, cuenta_id)
             VALUES (${id}, ${d.empresaId}, ${r.retencionId}, ${r.conf.impuesto}, ${r.conf.tasa}, ${deCentavos(r.monto)},
                     ${r.conf.cuenta_por_terceros_id})`;
  }
  await bitacora(tx, d.empresaId, d.usuarioId, "cobro_registrado", { numero, total: deCentavos(totalAplicado) });
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
