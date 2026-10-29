// Compras y cuentas por pagar. Cada compra nace como borrador y al registrarse genera su asiento:
// gasto, costo o activo + ITBIS pagado (si da crédito) contra cuentas por pagar. Los pagos aplican las retenciones que
// hacemos al proveedor (ITBIS e ISR), que quedan por pagar a la DGII.
import { anularAsientoDeDocumento, bitacora, ErrorContable, insertarAsiento, type LineaAsiento } from "./asientos.ts";
import { aPesos, cantidadTexto, redondearDiv, tasaDeTexto, tasaTexto } from "./calculos.ts";
import type { Tx } from "./db";
import { aplicarTasa, COMPROBANTES, leerPorcentaje, listarImpuestos, listarRetenciones } from "./fiscal.ts";
import { aCentavos, deCentavos } from "./montos.ts";
import { MOTIVOS_608, tomarNcf, type TipoNcf } from "./ventas.ts";

// Tipo de bienes y servicios comprados (formato 606).
export const TIPOS_GASTO: Record<string, string> = {
  "01": "Gastos de personal",
  "02": "Gastos por trabajos, suministros y servicios",
  "03": "Arrendamientos",
  "04": "Gastos de activos fijos",
  "05": "Gastos de representación",
  "06": "Otras deducciones admitidas",
  "07": "Gastos financieros",
  "08": "Gastos extraordinarios",
  "09": "Compras y gastos que forman parte del costo de venta",
  "10": "Adquisiciones de activos",
  "11": "Gastos de seguros",
};

// Forma de pago (formato 606).
export const FORMAS_PAGO: Record<string, string> = {
  "01": "Efectivo",
  "02": "Cheque, transferencia o depósito",
  "03": "Tarjeta de crédito o débito",
  "04": "Compra a crédito",
  "05": "Permuta",
  "06": "Nota de crédito",
  "07": "Mixto",
};

// Comprobantes que entrega el proveedor, notas de crédito del proveedor y comprobantes que emitimos nosotros.
export const COMPROBANTES_PROVEEDOR = ["B01", "B02", "B14", "B15", "E31", "E32", "E44", "E45"] as const;
export const NOTAS_PROVEEDOR = ["B04", "E34"] as const;
export const COMPROBANTES_PROPIOS = ["B11", "B13", "B17"] as const;
export const TIPOS_COMPRA = [...COMPROBANTES_PROVEEDOR, ...COMPROBANTES_PROPIOS] as const;
export type TipoCompra = (typeof TIPOS_COMPRA)[number] | (typeof NOTAS_PROVEEDOR)[number];

export const esPropio = (t: string) => (COMPROBANTES_PROPIOS as readonly string[]).includes(t);
export const esNotaProveedor = (t: string) => (NOTAS_PROVEEDOR as readonly string[]).includes(t);
export const esTipoCompra = (t: string): t is TipoCompra => (TIPOS_COMPRA as readonly string[]).includes(t) || esNotaProveedor(t);
// Comprobantes que no dan derecho a crédito de ITBIS: consumo y gastos menores.
export const SIN_CREDITO = ["B02", "E32", "B13"];
export const nombreComprobante = (t: string) => COMPROBANTES[t]?.nombre ?? t;
export const patronNcf = (t: string) => new RegExp(`^${t}\\d{${t.startsWith("E") ? 10 : 8}}$`);

// ───── Cuentas ─────

export const CLAVES_CUENTAS_COMPRAS = ["cxp", "cxp_exterior", "gasto_general", "ganancia_cambiaria", "perdida_cambiaria"] as const;
type CuentasCompras = Record<(typeof CLAVES_CUENTAS_COMPRAS)[number], string>;

export async function cuentasCompras(tx: Tx): Promise<CuentasCompras> {
  const filas = await tx<{ clave: string; cuenta_id: string }[]>`SELECT clave, cuenta_id FROM cuentas_empresa`;
  const r = Object.fromEntries(filas.map((f) => [f.clave, f.cuenta_id])) as Partial<CuentasCompras>;
  const faltan = CLAVES_CUENTAS_COMPRAS.filter((k) => !r[k]);
  if (faltan.length) throw new ErrorContable("Faltan cuentas en Configuración de cuentas: " + faltan.join(", "));
  return r as CuentasCompras;
}

// ───── Líneas ─────

export type LineaCompraEntrada = {
  descripcion: string; clase: "servicio" | "bien"; cantidad: bigint; precio: bigint; cuentaId: string | null; impuestoIds: string[];
};
export type LineaCompraCalculada = LineaCompraEntrada & {
  cuentaId: string; subtotal: bigint; itbis: bigint; otros: bigint;
  impuestos: { impuestoId: string; tipo: string; tasa: string; monto: bigint; cuentaId: string | null }[];
};

export async function calcularLineasCompra(tx: Tx, fecha: string, entradas: LineaCompraEntrada[], cuentaPorDefecto: string) {
  if (entradas.length === 0) throw new ErrorContable("La compra necesita al menos una línea");
  const vigentes = new Map((await listarImpuestos(tx, fecha)).map((i) => [i.id, i]));
  const resultado: LineaCompraCalculada[] = [];
  for (const [n, l] of entradas.entries()) {
    const donde = `Línea ${n + 1}`;
    if (!l.descripcion.trim()) throw new ErrorContable(`${donde}: escribe la descripción`);
    if (l.cantidad <= 0n || l.precio < 0n) throw new ErrorContable(`${donde}: revisa la cantidad y el precio`);
    const imps = [...new Set(l.impuestoIds)].map((id) => {
      const i = vigentes.get(id);
      if (!i) throw new ErrorContable(`${donde}: el impuesto elegido no está vigente el ${fecha}`);
      return i;
    });
    if (imps.filter((i) => i.tipo === "itbis" || i.tipo === "exento").length !== 1) {
      throw new ErrorContable(`${donde}: elige el ITBIS (o exento) de la línea`);
    }
    const cuentaId = l.cuentaId ?? cuentaPorDefecto;
    const [c] = await tx<{ tipo: string; de_detalle: boolean; activa: boolean }[]>`SELECT tipo, de_detalle, activa FROM cuentas WHERE id = ${cuentaId}`;
    if (!c || !c.de_detalle || !c.activa || !["gasto", "costo", "activo"].includes(c.tipo)) {
      throw new ErrorContable(`${donde}: la cuenta debe ser una cuenta de detalle de gasto, costo o activo`);
    }
    const subtotal = redondearDiv(l.cantidad * l.precio, 10000n);
    const impuestos = imps.map((i) => ({
      impuestoId: i.id, tipo: i.tipo, tasa: i.tasa, monto: aplicarTasa(subtotal, leerPorcentaje(i.tasa)!), cuentaId: i.cuenta_compras_id,
    }));
    resultado.push({
      ...l, cuentaId, subtotal, impuestos,
      itbis: impuestos.filter((i) => i.tipo === "itbis").reduce((s, i) => s + i.monto, 0n),
      otros: impuestos.filter((i) => i.tipo !== "itbis").reduce((s, i) => s + i.monto, 0n),
    });
  }
  return resultado;
}

// ───── Compras ─────

export type DatosCompra = {
  empresaId: string; usuarioId: string; proveedorId: string; tipo: TipoCompra; ncf: string | null; fecha: string; vence: string;
  moneda: "DOP" | "USD"; tasa: bigint; tipoGasto: string; itbisAlCosto: boolean; notas: string | null;
  compraOrigenId?: string | null; lineas: LineaCompraEntrada[];
};

async function revisarDuplicado(tx: Tx, proveedorId: string, ncf: string, excepto: string | null) {
  const [d] = await tx<{ fecha: string; estado: string }[]>`
    SELECT to_char(fecha, 'DD/MM/YYYY') AS fecha, estado FROM compras
     WHERE proveedor_id = ${proveedorId} AND ncf = ${ncf} AND NOT anulada AND id IS DISTINCT FROM ${excepto}::uuid LIMIT 1`;
  if (d) throw new ErrorContable(`Ya registraste el NCF ${ncf} de este proveedor (${d.estado === "borrador" ? "borrador" : "compra"} del ${d.fecha})`);
}

// Crea o reemplaza un borrador de compra. Devuelve su id.
export async function guardarBorradorCompra(tx: Tx, d: DatosCompra & { compraId?: string | null }): Promise<string> {
  if (!esTipoCompra(d.tipo)) throw new ErrorContable("Elige el tipo de comprobante");
  if (!TIPOS_GASTO[d.tipoGasto]) throw new ErrorContable("Elige el tipo de gasto del 606");
  if (d.vence < d.fecha) throw new ErrorContable("El vencimiento no puede ser antes de la fecha de la compra");
  const [p] = await tx<{ activo: boolean; cuenta_gasto_id: string | null }[]>`SELECT activo, cuenta_gasto_id FROM proveedores WHERE id = ${d.proveedorId}`;
  if (!p?.activo) throw new ErrorContable("El proveedor no existe o está inactivo");
  const ncf = esPropio(d.tipo) ? null : d.ncf?.toUpperCase().trim() || null;
  if (ncf && !patronNcf(d.tipo).test(ncf)) {
    throw new ErrorContable(`El NCF no corresponde a un ${d.tipo}: debe ser ${d.tipo} seguido de ${d.tipo.startsWith("E") ? 10 : 8} dígitos`);
  }
  if (ncf) await revisarDuplicado(tx, d.proveedorId, ncf, d.compraId ?? null);
  if (esNotaProveedor(d.tipo) !== !!d.compraOrigenId) throw new ErrorContable("La nota de crédito debe indicar la compra que modifica");
  const cuentas = await cuentasCompras(tx);
  const lineas = await calcularLineasCompra(tx, d.fecha, d.lineas, p.cuenta_gasto_id ?? cuentas.gasto_general);
  const t = {
    subtotal: lineas.reduce((s, l) => s + l.subtotal, 0n), itbis: lineas.reduce((s, l) => s + l.itbis, 0n),
    otros: lineas.reduce((s, l) => s + l.otros, 0n),
  };
  const total = t.subtotal + t.itbis + t.otros;
  if (total <= 0n) throw new ErrorContable("El total de la compra debe ser mayor que cero");
  const cabecera = {
    tipo_comprobante: d.tipo, ncf, proveedor_id: d.proveedorId, compra_origen_id: d.compraOrigenId ?? null, fecha: d.fecha, vence: d.vence,
    moneda: d.moneda, tasa: tasaTexto(d.tasa), tipo_gasto: d.tipoGasto, itbis_al_costo: d.itbisAlCosto || SIN_CREDITO.includes(d.tipo),
    subtotal: deCentavos(t.subtotal), itbis: deCentavos(t.itbis), otros_impuestos: deCentavos(t.otros), total: deCentavos(total), notas: d.notas,
  };
  let id = d.compraId ?? null;
  if (id) {
    const [c] = await tx<{ estado: string }[]>`SELECT estado FROM compras WHERE id = ${id} FOR UPDATE`;
    if (!c) throw new ErrorContable("La compra no existe");
    if (c.estado !== "borrador") throw new ErrorContable("Solo los borradores se pueden editar");
    await tx`UPDATE compras SET ${tx({ ...cabecera, modificado_por: d.usuarioId, modificado_en: new Date() })} WHERE id = ${id}`;
    await tx`DELETE FROM lineas_compra WHERE compra_id = ${id}`;
  } else {
    [{ id }] = await tx<{ id: string }[]>`INSERT INTO compras ${tx({ ...cabecera, empresa_id: d.empresaId, creado_por: d.usuarioId })} RETURNING id`;
  }
  for (const [i, l] of lineas.entries()) {
    const [{ id: lineaId }] = await tx<{ id: string }[]>`
      INSERT INTO lineas_compra (compra_id, empresa_id, orden, descripcion, clase, cantidad, precio, cuenta_id, subtotal, itbis, otros)
      VALUES (${id}, ${d.empresaId}, ${i + 1}, ${l.descripcion.trim()}, ${l.clase}, ${cantidadTexto(l.cantidad)}, ${deCentavos(l.precio)},
              ${l.cuentaId}, ${deCentavos(l.subtotal)}, ${deCentavos(l.itbis)}, ${deCentavos(l.otros)})
      RETURNING id`;
    for (const imp of l.impuestos) {
      await tx`
        INSERT INTO impuestos_linea_compra (linea_id, compra_id, empresa_id, impuesto_id, tipo, tasa, monto)
        VALUES (${lineaId}, ${id}, ${d.empresaId}, ${imp.impuestoId}, ${imp.tipo}, ${imp.tasa}, ${deCentavos(imp.monto)})`;
    }
  }
  return id!;
}

export async function descartarBorradorCompra(tx: Tx, compraId: string) {
  const r = await tx`DELETE FROM compras WHERE id = ${compraId} AND estado = 'borrador'`;
  if (r.count === 0) throw new ErrorContable("Solo se descartan borradores");
}

export async function saldoCompra(tx: Tx, compraId: string): Promise<bigint> {
  const [r] = await tx<{ saldo: string }[]>`SELECT saldo::text FROM saldos_compra WHERE compra_id = ${compraId}`;
  return r ? aCentavos(r.saldo) : 0n;
}

// Registra un borrador: valida, asigna el NCF propio si aplica y registra el asiento contabilizado.
export async function registrarCompra(
  tx: Tx, d: { empresaId: string; usuarioId: string; compraId: string }, opciones: { autorizada?: boolean } = {},
): Promise<{ ncf: string; asiento: number }> {
  const [c] = await tx<{
    estado: string; tipo_comprobante: TipoCompra; ncf: string | null; fecha: string; moneda: string; tasa: string; total: string;
    itbis_al_costo: boolean; creado_por: string; compra_origen_id: string | null; proveedor_id: string; proveedor: string;
    rnc: string | null; tipo_identificacion: string | null; del_exterior: boolean; proveedor_activo: boolean;
  }[]>`
    SELECT c.estado, c.tipo_comprobante, c.ncf, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.moneda, c.tasa::text, c.total::text,
           c.itbis_al_costo, c.creado_por, c.compra_origen_id, c.proveedor_id, p.nombre AS proveedor, p.rnc, p.tipo_identificacion,
           p.del_exterior, p.activo AS proveedor_activo
      FROM compras c JOIN proveedores p ON p.id = c.proveedor_id WHERE c.id = ${d.compraId} FOR UPDATE OF c`;
  if (!c) throw new ErrorContable("La compra no existe");
  if (c.estado !== "borrador") throw new ErrorContable("La compra ya fue registrada");
  const [empresa] = await tx<{ requiere_aprobacion: boolean; contribuye_itbis: boolean }[]>`
    SELECT requiere_aprobacion, contribuye_itbis FROM empresas WHERE id = ${d.empresaId}`;
  if (empresa.requiere_aprobacion && c.creado_por === d.usuarioId && !opciones.autorizada) {
    throw new ErrorContable("En esta empresa otra persona debe aprobar y registrar lo que tú registraste");
  }
  const t = c.tipo_comprobante;
  if (!esPropio(t) && !c.ncf) throw new ErrorContable("Escribe el NCF que aparece en la factura del proveedor");
  if (["B01", "E31", "B14", "E44", "B15", "E45"].includes(t) && !c.rnc) {
    throw new ErrorContable(`Para un ${t} el proveedor debe tener RNC o cédula registrado`);
  }
  if (t === "B11" && c.tipo_identificacion !== "cedula") throw new ErrorContable("El comprobante de compras (B11) es para personas físicas con cédula");
  if (t === "B17" && !c.del_exterior) throw new ErrorContable("El comprobante de pagos al exterior (B17) es para proveedores del exterior");
  const esNota = esNotaProveedor(t);
  let modifica = "";
  if (esNota) {
    const [o] = await tx<{ ncf: string; estado: string; anulada: boolean; proveedor_id: string; fecha: string }[]>`
      SELECT ncf, estado, anulada, proveedor_id, to_char(fecha, 'YYYY-MM-DD') AS fecha FROM compras WHERE id = ${c.compra_origen_id} FOR UPDATE`;
    if (!o || o.estado !== "registrada" || o.anulada || o.proveedor_id !== c.proveedor_id) {
      throw new ErrorContable("La compra que modifica la nota no está vigente o es de otro proveedor");
    }
    if (c.fecha < o.fecha) throw new ErrorContable("La nota de crédito no puede tener fecha anterior a la compra");
    if (aCentavos(c.total) > (await saldoCompra(tx, c.compra_origen_id!))) {
      throw new ErrorContable("La nota de crédito no puede pasar del saldo pendiente de la compra");
    }
    modifica = o.ncf;
  } else if (!c.proveedor_activo) {
    throw new ErrorContable("El proveedor está inactivo");
  }

  const cuentas = await cuentasCompras(tx);
  const tasa = tasaDeTexto(c.tasa);
  const alCosto = c.itbis_al_costo || !empresa.contribuye_itbis;
  const lineas = await tx<{ id: string; cuenta_id: string; subtotal: string }[]>`
    SELECT id, cuenta_id, subtotal::text FROM lineas_compra WHERE compra_id = ${d.compraId} ORDER BY orden`;
  const impuestos = await tx<{ linea_id: string; tipo: string; monto: string; cuenta_id: string | null; nombre: string }[]>`
    SELECT il.linea_id, il.tipo, il.monto::text, i.cuenta_compras_id AS cuenta_id, i.nombre
      FROM impuestos_linea_compra il JOIN impuestos i ON i.id = il.impuesto_id WHERE il.compra_id = ${d.compraId}`;

  // Compra: gasto/costo/activo (+ impuestos sin crédito) e ITBIS con crédito al debe; cuentas por pagar al haber.
  // Nota de crédito del proveedor: al revés.
  const lado = (pesos: bigint): Pick<LineaAsiento, "debe" | "haber"> => (esNota ? { debe: 0n, haber: pesos } : { debe: pesos, haber: 0n });
  const lineasAsiento: LineaAsiento[] = [];
  for (const l of lineas) {
    let alGasto = aCentavos(l.subtotal);
    for (const imp of impuestos.filter((i) => i.linea_id === l.id)) {
      const monto = aCentavos(imp.monto);
      if (monto === 0n) continue;
      if (imp.tipo === "itbis" && !alCosto) {
        if (!imp.cuenta_id) throw new ErrorContable(`El impuesto «${imp.nombre}» no tiene cuenta de compras en la configuración`);
        lineasAsiento.push({ cuentaId: imp.cuenta_id, ...lado(aPesos(monto, tasa)) });
      } else {
        alGasto += monto;
      }
    }
    lineasAsiento.push({ cuentaId: l.cuenta_id, ...lado(aPesos(alGasto, tasa)) });
  }
  const totalPesos = lineasAsiento.reduce((s, l) => s + l.debe + l.haber, 0n);
  const cxp = c.del_exterior ? cuentas.cxp_exterior : cuentas.cxp;
  lineasAsiento.push({ cuentaId: cxp, debe: esNota ? totalPesos : 0n, haber: esNota ? 0n : totalPesos, descripcion: c.proveedor });

  let ncf = c.ncf!;
  let ncfVence: string | null = null;
  if (esPropio(t)) ({ ncf, vence: ncfVence } = await tomarNcf(tx, t as TipoNcf, c.fecha));
  else await revisarDuplicado(tx, c.proveedor_id, ncf, d.compraId);
  const asiento = await insertarAsiento(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, fecha: c.fecha, origen: esNota ? "nota_credito_compra" : "compra",
    concepto: esNota ? `Nota de crédito ${ncf} de ${c.proveedor} (modifica ${modifica})` : `Compra ${ncf} a ${c.proveedor}`,
    referencia: ncf, lineas: lineasAsiento,
  });
  await tx`
    UPDATE compras SET estado = 'registrada', ncf = ${ncf}, ncf_vence = ${ncfVence}, asiento_id = ${asiento.id},
           registrada_por = ${d.usuarioId}, registrada_en = now()
     WHERE id = ${d.compraId}`;
  await bitacora(tx, d.empresaId, d.usuarioId, esNota ? "nota_credito_compra_registrada" : "compra_registrada", { ncf, total: c.total });
  return { ncf, asiento: asiento.numero! };
}

// Con comprobante propio (B11, B13, B17) el NCF es nuestro: va al formato 608 con su «Tipo de Anulación» (MOTIVOS_608).
export async function anularCompra(tx: Tx, d: { empresaId: string; usuarioId: string; compraId: string; motivo: string; motivo608?: string | null }) {
  const [c] = await tx<{ ncf: string; estado: string; anulada: boolean; asiento_id: string; tipo_comprobante: string }[]>`
    SELECT ncf, estado, anulada, asiento_id, tipo_comprobante FROM compras WHERE id = ${d.compraId} FOR UPDATE`;
  if (!c) throw new ErrorContable("La compra no existe");
  if (c.estado !== "registrada") throw new ErrorContable("Un borrador no se anula; se descarta");
  if (c.anulada) throw new ErrorContable("La compra ya está anulada");
  const motivo608 = esPropio(c.tipo_comprobante) ? d.motivo608 ?? null : null;
  if (esPropio(c.tipo_comprobante) && !(motivo608 && motivo608 in MOTIVOS_608)) throw new ErrorContable("Elige el tipo de anulación del formato 608");
  if (!esNotaProveedor(c.tipo_comprobante)) {
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT (SELECT count(*) FROM aplicaciones_pago a JOIN pagos p ON p.id = a.pago_id WHERE a.compra_id = ${d.compraId} AND NOT p.anulado)
           + (SELECT count(*) FROM compras WHERE compra_origen_id = ${d.compraId} AND estado = 'registrada' AND NOT anulada) AS n`;
    if (n > 0) throw new ErrorContable("La compra tiene pagos o notas de crédito vigentes; anúlalos primero");
  }
  await anularAsientoDeDocumento(tx, c.asiento_id, d.usuarioId, `Anulación de la compra ${c.ncf}: ${d.motivo}`);
  await tx`UPDATE compras SET anulada = true, motivo_anulacion = ${d.motivo}, motivo_608 = ${motivo608}, anulada_por = ${d.usuarioId}, anulada_en = now() WHERE id = ${d.compraId}`;
  await bitacora(tx, d.empresaId, d.usuarioId, "compra_anulada", { ncf: c.ncf, motivo: d.motivo });
}

// ───── Pagos ─────

export async function registrarPago(
  tx: Tx,
  d: {
    empresaId: string; usuarioId: string; proveedorId: string; fecha: string; moneda: "DOP" | "USD"; tasa: bigint;
    cuentaOrigenId: string; formaPago: string; referencia: string | null; notas: string | null;
    pagado: bigint; retenciones: { retencionId: string; monto: bigint }[]; aplicaciones: { compraId: string; monto: bigint }[];
  },
): Promise<number> {
  const aplicaciones = d.aplicaciones.filter((a) => a.monto > 0n);
  const retenciones = d.retenciones.filter((r) => r.monto > 0n);
  if (aplicaciones.length === 0) throw new ErrorContable("Aplica el pago a al menos una compra");
  if (!FORMAS_PAGO[d.formaPago]) throw new ErrorContable("Elige la forma de pago");
  if (new Set(retenciones.map((r) => r.retencionId)).size !== retenciones.length) throw new ErrorContable("Hay una retención repetida");
  const totalRetenido = retenciones.reduce((s, r) => s + r.monto, 0n);
  const totalAplicado = aplicaciones.reduce((s, a) => s + a.monto, 0n);
  if (d.pagado < 0n || d.pagado + totalRetenido !== totalAplicado) {
    throw new ErrorContable("Lo pagado más las retenciones debe ser igual a lo aplicado a las compras");
  }
  const [prov] = await tx<{ nombre: string; del_exterior: boolean }[]>`SELECT nombre, del_exterior FROM proveedores WHERE id = ${d.proveedorId}`;
  if (!prov) throw new ErrorContable("El proveedor no existe");
  const [origen] = await tx<{ tipo: string; de_detalle: boolean; activa: boolean }[]>`
    SELECT tipo, de_detalle, activa FROM cuentas WHERE id = ${d.cuentaOrigenId}`;
  if (!origen || origen.tipo !== "activo" || !origen.de_detalle || !origen.activa) {
    throw new ErrorContable("Elige la cuenta de banco o caja de donde salió el dinero");
  }
  const vigentes = new Map((await listarRetenciones(tx, d.fecha)).map((r) => [r.id, r]));
  const detalle = retenciones.map((r) => {
    const conf = vigentes.get(r.retencionId);
    if (!conf) throw new ErrorContable(`Una de las retenciones no está vigente el ${d.fecha}`);
    return { ...r, conf };
  });
  const cuentas = await cuentasCompras(tx);

  let cxpPesos = 0n;
  const ncfs: string[] = [];
  for (const a of aplicaciones) {
    const [c] = await tx<{ ncf: string; proveedor_id: string; moneda: string; tasa: string; anulada: boolean; estado: string; tipo_comprobante: string }[]>`
      SELECT ncf, proveedor_id, moneda, tasa::text, anulada, estado, tipo_comprobante FROM compras WHERE id = ${a.compraId} FOR UPDATE`;
    if (!c || esNotaProveedor(c.tipo_comprobante) || c.estado !== "registrada" || c.proveedor_id !== d.proveedorId) {
      throw new ErrorContable("Una de las compras no es de este proveedor o no está registrada");
    }
    if (c.anulada) throw new ErrorContable(`La compra ${c.ncf} está anulada`);
    if (c.moneda !== d.moneda) throw new ErrorContable(`La compra ${c.ncf} está en ${c.moneda}; el pago debe ser en la misma moneda`);
    if (a.monto > (await saldoCompra(tx, a.compraId))) throw new ErrorContable(`El monto aplicado a ${c.ncf} pasa de su saldo pendiente`);
    cxpPesos += aPesos(a.monto, tasaDeTexto(c.tasa));
    ncfs.push(c.ncf);
  }

  const pagadoPesos = aPesos(d.pagado, d.tasa);
  const retPesos = detalle.map((r) => aPesos(r.monto, d.tasa));
  const diferencia = pagadoPesos + retPesos.reduce((s, m) => s + m, 0n) - cxpPesos; // > 0 pérdida, < 0 ganancia cambiaria
  const cxp = prov.del_exterior ? cuentas.cxp_exterior : cuentas.cxp;

  await tx`SELECT 1 FROM empresas WHERE id = ${d.empresaId} FOR UPDATE`;
  const [{ numero }] = await tx<{ numero: number }[]>`SELECT COALESCE(max(numero), 0) + 1 AS numero FROM pagos`;
  const asiento = await insertarAsiento(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, fecha: d.fecha, origen: "pago",
    concepto: `Pago ${numero} a ${prov.nombre} (${ncfs.join(", ")})`, referencia: d.referencia ?? `Pago ${numero}`,
    lineas: [
      { cuentaId: cxp, debe: cxpPesos, haber: 0n, descripcion: prov.nombre },
      { cuentaId: cuentas.perdida_cambiaria, debe: diferencia > 0n ? diferencia : 0n, haber: 0n },
      { cuentaId: d.cuentaOrigenId, debe: 0n, haber: pagadoPesos },
      ...detalle.map((r, i) => ({ cuentaId: r.conf.cuenta_a_terceros_id, debe: 0n, haber: retPesos[i], descripcion: r.conf.nombre })),
      { cuentaId: cuentas.ganancia_cambiaria, debe: 0n, haber: diferencia < 0n ? -diferencia : 0n },
    ],
  });
  const suma = (imp: string) => detalle.filter((r) => r.conf.impuesto === imp).reduce((s, r) => s + r.monto, 0n);
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO pagos (empresa_id, numero, proveedor_id, fecha, moneda, tasa, cuenta_origen_id, forma_pago, referencia,
                       pagado, retencion_itbis, retencion_isr, notas, asiento_id, creado_por)
    VALUES (${d.empresaId}, ${numero}, ${d.proveedorId}, ${d.fecha}, ${d.moneda}, ${tasaTexto(d.tasa)}, ${d.cuentaOrigenId},
            ${d.formaPago}, ${d.referencia}, ${deCentavos(d.pagado)}, ${deCentavos(suma("itbis"))}, ${deCentavos(suma("isr"))},
            ${d.notas}, ${asiento.id}, ${d.usuarioId})
    RETURNING id`;
  for (const a of aplicaciones) {
    await tx`INSERT INTO aplicaciones_pago (pago_id, compra_id, empresa_id, monto) VALUES (${id}, ${a.compraId}, ${d.empresaId}, ${deCentavos(a.monto)})`;
  }
  for (const r of detalle) {
    await tx`INSERT INTO retenciones_pago (pago_id, empresa_id, retencion_id, impuesto, tasa, codigo_606, monto, cuenta_id)
             VALUES (${id}, ${d.empresaId}, ${r.retencionId}, ${r.conf.impuesto}, ${r.conf.tasa}, ${r.conf.codigo_606},
                     ${deCentavos(r.monto)}, ${r.conf.cuenta_a_terceros_id})`;
  }
  await bitacora(tx, d.empresaId, d.usuarioId, "pago_registrado", { numero, total: deCentavos(totalAplicado) });
  return numero;
}

export async function anularPago(tx: Tx, d: { empresaId: string; usuarioId: string; numero: number; motivo: string }) {
  const [p] = await tx<{ id: string; anulado: boolean; asiento_id: string }[]>`
    SELECT id, anulado, asiento_id FROM pagos WHERE numero = ${d.numero} FOR UPDATE`;
  if (!p) throw new ErrorContable("El pago no existe");
  if (p.anulado) throw new ErrorContable("El pago ya está anulado");
  await anularAsientoDeDocumento(tx, p.asiento_id, d.usuarioId, `Anulación del pago ${d.numero}: ${d.motivo}`);
  await tx`UPDATE pagos SET anulado = true, motivo_anulacion = ${d.motivo}, anulado_por = ${d.usuarioId}, anulado_en = now() WHERE id = ${p.id}`;
  await bitacora(tx, d.empresaId, d.usuarioId, "pago_anulado", { numero: d.numero, motivo: d.motivo });
}
