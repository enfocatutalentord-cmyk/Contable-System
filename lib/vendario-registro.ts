// Integración con Vendario, parte 2: contabiliza cada evento guardado. Con contabilidad (servicios contables) hace el asiento del «entry»
// pasado a las cuentas del cliente; siempre crea los documentos que necesitan el 606, 607, 608 e IT-1 (decisión del 13-nov-2026: con solo
// itbis_606_607_608 no hay asiento, como en el rediseño R3). Lo que no se puede todavía queda «pendiente» con el motivo, sin perderse.
import { bitacora, ErrorContable, insertarAsiento, type LineaAsiento } from "./asientos.ts";
import { conEmpresa, db, type Tx } from "./db.ts";
import {
  centavos, contraparte, FORMA_606, FORMA_COBRO, impuestos, leerEntry, leerNcf, mapearLineas, NOMBRE_EVENTO, pagos, Pendiente, tasaDe, texto,
  tipoGasto, type PorTasa,
} from "./vendario-contable.ts";

type Evento = {
  id: string; vendario_cliente_id: string; seq: string | null; tipo: string; fecha: string | null; revierte: string | null; datos: Record<string, unknown>;
  estado: string; cliente_estado: string; empresa_id: string | null; servicios: string[]; usuario_id: string | null;
};
type Hecho = { asiento_id?: string | null; factura_id?: string | null; compra_id?: string | null; cobro_id?: string | null; pago_id?: string | null; venta_sin_comprobante_id?: string | null; nota?: string };

const d2 = (c: bigint) => texto(c);

// Contabiliza un evento. Devuelve su estado final.
export async function contabilizarEvento(eventoId: string): Promise<{ estado: string; motivo?: string }> {
  const [e] = await db()<Evento[]>`
    SELECT x.id, x.vendario_cliente_id, x.seq::text, x.tipo, to_char(x.fecha, 'YYYY-MM-DD') AS fecha, x.revierte, x.datos, x.estado,
           v.estado AS cliente_estado, v.empresa_id, v.servicios, coalesce(v.aceptada_por, v.responsable_id) AS usuario_id
      FROM vendario_eventos x JOIN vendario_clientes v ON v.id = x.vendario_cliente_id WHERE x.id = ${eventoId}`;
  if (!e || !["esperando", "pendiente"].includes(e.estado)) return { estado: e?.estado ?? "no existe" };
  const pendiente = async (motivo: string) => {
    await db()`UPDATE vendario_eventos SET estado = 'pendiente', motivo = ${motivo}, intentos = intentos + 1 WHERE id = ${e.id}`;
    return { estado: "pendiente", motivo };
  };
  if (!e.empresa_id || !e.usuario_id) return pendiente("Servicio no aceptado todavía");
  if (e.cliente_estado === "suspendida") return pendiente("Servicio suspendido");
  if (!e.fecha) return pendiente("El evento no trae la fecha");
  try {
    const h = await conEmpresa(e.empresa_id, (tx) => aplicar(tx, e as Evento & { empresa_id: string; usuario_id: string; fecha: string }));
    await db()`
      UPDATE vendario_eventos SET estado = 'contabilizado', motivo = ${h.nota ?? null}, empresa_id = ${e.empresa_id}, asiento_id = ${h.asiento_id ?? null},
             factura_id = ${h.factura_id ?? null}, compra_id = ${h.compra_id ?? null}, cobro_id = ${h.cobro_id ?? null}, pago_id = ${h.pago_id ?? null},
             venta_sin_comprobante_id = ${h.venta_sin_comprobante_id ?? null}, procesado_en = now(), intentos = intentos + 1
       WHERE id = ${e.id}`;
    return { estado: "contabilizado" };
  } catch (err) {
    if (err instanceof Pendiente || err instanceof ErrorContable) return pendiente(err.message);
    const m = (err as Error).message ?? String(err);
    // Errores de la base que explican el motivo (período cerrado, NCF repetido…).
    if (/cerrado|duplicate key|ya está registrado|ya registraste/i.test(m)) return pendiente(m.replace(/duplicate key value violates unique constraint.*/i, "Documento repetido"));
    console.error("vendario contabilizar", eventoId, m);
    return pendiente(`Error al contabilizar: ${m}`.slice(0, 400));
  }
}

// Contabiliza en orden lo que espera (por cliente y seq). Se llama al llegar eventos, al cambiar el mapeo y desde la tarea programada.
export async function contabilizarPendientes(o: { clienteId?: string; limite?: number } = {}): Promise<number> {
  const filas = await db()<{ id: string }[]>`
    SELECT x.id FROM vendario_eventos x JOIN vendario_clientes v ON v.id = x.vendario_cliente_id
     WHERE x.estado IN ('esperando', 'pendiente') AND v.empresa_id IS NOT NULL AND v.estado IN ('aceptada', 'necesita_info')
       AND (${o.clienteId ?? null}::uuid IS NULL OR v.id = ${o.clienteId ?? null}::uuid)
     ORDER BY v.id, x.seq NULLS LAST, x.recibido_en LIMIT ${o.limite ?? 300}`;
  for (const f of filas) await contabilizarEvento(f.id);
  return filas.length;
}

// ───── Un evento ─────

async function aplicar(tx: Tx, e: Evento & { empresa_id: string; usuario_id: string; fecha: string }): Promise<Hecho> {
  const d = e.datos;
  const [{ lleva }] = await tx<{ lleva: boolean }[]>`SELECT lleva_contabilidad(${e.empresa_id}) AS lleva`;
  const mapeo = new Map((await tx<{ cuenta: string; cuenta_id: string }[]>`SELECT cuenta, cuenta_id FROM vendario_mapeo`).map((m) => [m.cuenta, m.cuenta_id]));
  const fiscal = (d.fiscal ?? {}) as Record<string, unknown>;
  const fuente = (d.source ?? {}) as Record<string, unknown>;
  const ref = leerNcf(fiscal.ncf)?.ncf ?? (typeof fuente.number === "string" ? fuente.number : null);
  const concepto = `${NOMBRE_EVENTO[e.tipo] ?? e.tipo}${ref ? ` ${ref}` : ""} (Vendario)`;

  // El asiento del «entry», si el cliente lleva contabilidad. Una anulación queda enlazada al asiento del evento original.
  let asientoId: string | null = null;
  if (lleva) {
    const lineas = mapearLineas(leerEntry(d.entry), mapeo);
    if (lineas.length) {
      let revierteA: string | null = null;
      if (e.revierte) {
        const [o] = await db()<{ asiento_id: string | null; estado: string }[]>`SELECT asiento_id, estado FROM vendario_eventos WHERE id = ${e.revierte}`;
        if (!o) throw new Pendiente("Falta el evento original de esta anulación");
        if (o.estado !== "contabilizado") throw new Pendiente("El evento original todavía no está contabilizado");
        revierteA = o.asiento_id;
      }
      const a = await insertarAsiento(tx, {
        empresaId: e.empresa_id, usuarioId: e.usuario_id, fecha: e.fecha, concepto, referencia: ref, origen: "vendario",
        lineas: lineas as LineaAsiento[], juntar: false, revierteA,
      });
      asientoId = a.id;
    }
  }
  const h: Hecho = { asiento_id: asientoId };
  const con = { tx, e, asientoId, mapeo, lleva };

  switch (e.tipo) {
    case "sale.posted": return { ...h, ...(await venta(con)) };
    case "sale.voided": return { ...h, ...(await anularVenta(con)) };
    case "sale.returned": return { ...h, ...(await devolucion(con)) };
    case "receivable.paid": return { ...h, ...(await cobroCxc(con)) };
    case "purchase.received":
    case "expense.posted": return { ...h, ...(await compra(con)) };
    case "expense.voided": return { ...h, ...(await anularGasto(con)) };
    case "payable.paid": return { ...h, ...(await pagoCxp(con)) };
    // Solo asiento (no hay documento fiscal): anticipos, devolución a suplidor sin NCF, ajustes y caja.
    default: return { ...h, nota: lleva ? undefined : "Sin contabilidad en Empire: este evento solo lleva asiento" };
  }
}

type Con = { tx: Tx; e: Evento & { empresa_id: string; usuario_id: string; fecha: string }; asientoId: string | null; mapeo: Map<string, string>; lleva: boolean };

async function cuentaPorCodigo(tx: Tx, codigo: string): Promise<string | null> {
  return (await tx<{ id: string }[]>`SELECT id FROM cuentas WHERE codigo = ${codigo} AND activa AND de_detalle`)[0]?.id ?? null;
}

// Impuesto de la configuración del cliente para una tasa (ITBIS 18 %, 16 %… o exento) vigente en la fecha.
async function impuestoPara(tx: Tx, t: PorTasa, fecha: string): Promise<{ id: string; tipo: string; tasa: string }> {
  const tasa = tasaDe(t);
  const [i] = tasa === 0
    ? await tx<{ id: string; tipo: string; tasa: string }[]>`
        SELECT id, tipo, tasa::text FROM impuestos WHERE tipo = 'exento' AND activo AND vigente_desde <= ${fecha} AND (vigente_hasta IS NULL OR vigente_hasta >= ${fecha}) LIMIT 1`
    : await tx<{ id: string; tipo: string; tasa: string }[]>`
        SELECT id, tipo, tasa::text FROM impuestos WHERE tipo = 'itbis' AND tasa = ${tasa} AND activo AND vigente_desde <= ${fecha}
           AND (vigente_hasta IS NULL OR vigente_hasta >= ${fecha}) LIMIT 1`;
  if (!i) throw new Pendiente(tasa === 0 ? "El cliente no tiene configurado el impuesto «Exento»" : `El cliente no tiene configurado el ITBIS ${tasa} %`);
  return i;
}

async function clienteDe(tx: Tx, e: Con["e"], tipo: string | null): Promise<string> {
  const p = contraparte(e.datos.party);
  if (p.doc) {
    const [c] = await tx<{ id: string }[]>`SELECT id FROM clientes WHERE rnc = ${p.doc} AND activo ORDER BY creado LIMIT 1`;
    if (c) return c.id;
    const [n] = await tx<{ id: string }[]>`
      INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion, ncf_predeterminado)
      VALUES (${e.empresa_id}, ${p.nombre ?? `Cliente ${p.doc}`}, ${p.doc}, ${p.tipo}, ${tipo && tipo.startsWith("B") ? tipo : "B01"}) RETURNING id`;
    return n.id;
  }
  const [c] = await tx<{ id: string }[]>`SELECT id FROM clientes WHERE rnc IS NULL AND nombre = 'Consumidor final' AND activo ORDER BY creado LIMIT 1`;
  if (c) return c.id;
  const [n] = await tx<{ id: string }[]>`
    INSERT INTO clientes (empresa_id, nombre, ncf_predeterminado) VALUES (${e.empresa_id}, 'Consumidor final', 'B02') RETURNING id`;
  return n.id;
}

async function proveedorDe(tx: Tx, e: Con["e"], gasto: string): Promise<string | null> {
  const p = contraparte(e.datos.party);
  if (!p.doc) return null;
  const [c] = await tx<{ id: string }[]>`SELECT id FROM proveedores WHERE rnc = ${p.doc} AND activo ORDER BY creado LIMIT 1`;
  if (c) return c.id;
  const [n] = await tx<{ id: string }[]>`
    INSERT INTO proveedores (empresa_id, nombre, rnc, tipo_identificacion, tipo_gasto)
    VALUES (${e.empresa_id}, ${p.nombre ?? `Proveedor ${p.doc}`}, ${p.doc}, ${p.tipo}, ${gasto}) RETURNING id`;
  return n.id;
}

// Factura (o nota de crédito) emitida con el NCF de Vendario, una línea por tasa y los montos exactos de Vendario.
async function factura(c: Con, o: { tipo: string; ncf: string; origenId: string | null; imp: ReturnType<typeof impuestos> }): Promise<string> {
  const { tx, e } = c;
  const clienteId = await clienteDe(tx, e, o.tipo);
  const cuenta = c.mapeo.get(o.origenId ? "DEVOLUCIONES_VENTAS" : "VENTAS")
    ?? (await cuentaPorCodigo(tx, o.origenId ? "410103" : "410102"))
    ?? (await tx<{ cuenta_id: string }[]>`SELECT cuenta_id FROM cuentas_empresa WHERE clave = 'ingreso_servicios'`)[0]?.cuenta_id;
  if (!cuenta) throw new Pendiente("El cliente no tiene cuenta de ventas en su catálogo");
  const itbis = o.imp.tasas.reduce((s, t) => s + t.itbis, 0n);
  const fuente = (e.datos.source ?? {}) as Record<string, unknown>;
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO facturas (empresa_id, estado, tipo_ncf, cliente_id, factura_origen_id, fecha, vence, moneda, tasa, subtotal, itbis, otros_impuestos, total,
                          notas, creado_por, tipo_ingreso, ncf_externo, vendario_evento_id)
    VALUES (${e.empresa_id}, 'borrador', ${o.tipo}, ${clienteId}, ${o.origenId}, ${e.fecha}, ${e.fecha}, 'DOP', 1, ${d2(o.imp.subtotal)}, ${d2(itbis)}, 0,
            ${d2(o.imp.total)}, ${`Vendario ${fuente.number ?? ""}`.trim()}, ${e.usuario_id}, '01', ${o.ncf}, ${e.id})
    RETURNING id`;
  for (const [n, t] of o.imp.tasas.entries()) {
    const imp = await impuestoPara(tx, t, e.fecha);
    const [{ id: lineaId }] = await tx<{ id: string }[]>`
      INSERT INTO lineas_factura (factura_id, empresa_id, orden, descripcion, cantidad, precio, cuenta_ingreso_id, subtotal, itbis, otros)
      VALUES (${id}, ${e.empresa_id}, ${n + 1}, ${imp.tipo === "exento" ? "Ventas exentas (Vendario)" : `Ventas con ITBIS ${tasaDe(t)} % (Vendario)`},
              1, ${d2(t.base)}, ${cuenta}, ${d2(t.base)}, ${d2(t.itbis)}, 0) RETURNING id`;
    await tx`INSERT INTO impuestos_linea_factura (linea_id, factura_id, empresa_id, impuesto_id, tipo, tasa, monto)
             VALUES (${lineaId}, ${id}, ${e.empresa_id}, ${imp.id}, ${imp.tipo}, ${imp.tasa}, ${d2(t.itbis)})`;
  }
  const [otro] = await tx`SELECT 1 FROM facturas WHERE ncf = ${o.ncf} AND id <> ${id}`;
  if (otro) throw new Pendiente(`El comprobante ${o.ncf} ya está registrado en esta empresa`);
  await tx`UPDATE facturas SET estado = 'emitida', ncf = ${o.ncf}, asiento_id = ${c.asientoId}, emitida_por = ${e.usuario_id}, emitida_en = now() WHERE id = ${id}`;
  await bitacora(tx, e.empresa_id, e.usuario_id, o.origenId ? "nota_credito_emitida" : "factura_emitida", { ncf: o.ncf, total: d2(o.imp.total), vendario: e.id });
  return id;
}

async function cobro(c: Con, o: { facturaId: string; clienteId: string; pago: { kind: string; amount: bigint; reference: string | null } }): Promise<string | null> {
  const forma = FORMA_COBRO[o.pago.kind] ?? "otro";
  if (!forma) return null; // a crédito: queda en la cuenta por cobrar
  const { tx, e } = c;
  await tx`SELECT 1 FROM empresas WHERE id = ${e.empresa_id} FOR UPDATE`;
  const [{ numero }] = await tx<{ numero: number }[]>`SELECT COALESCE(max(numero), 0) + 1 AS numero FROM cobros`;
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO cobros (empresa_id, numero, cliente_id, fecha, forma_pago, referencia, recibido, notas, asiento_id, creado_por, vendario_evento_id)
    VALUES (${e.empresa_id}, ${numero}, ${o.clienteId}, ${e.fecha}, ${forma}, ${o.pago.reference}, ${d2(o.pago.amount)}, 'Cobrado en Vendario',
            ${c.asientoId}, ${e.usuario_id}, ${e.id}) RETURNING id`;
  await tx`INSERT INTO aplicaciones_cobro (cobro_id, factura_id, empresa_id, monto) VALUES (${id}, ${o.facturaId}, ${e.empresa_id}, ${d2(o.pago.amount)})`;
  return id;
}

async function venta(c: Con): Promise<Hecho> {
  const { tx, e } = c;
  const imp = impuestos(e.datos.amounts);
  const n = leerNcf(((e.datos.fiscal ?? {}) as Record<string, unknown>).ncf);
  const lista = pagos(e.datos.payments);
  if (!n) {
    // Venta sin comprobante: al IT-1 como «otras operaciones».
    const formas: Record<string, string> = {};
    for (const p of lista) { const f = FORMA_COBRO[p.kind]; if (f) formas[f] = d2(centavos(formas[f] ?? "0") + p.amount); }
    const gravado = Object.fromEntries(imp.tasas.filter((t) => t.itbis > 0n).map((t) => [String(tasaDe(t)), d2(t.base)]));
    const exento = imp.tasas.filter((t) => t.itbis === 0n).reduce((s, t) => s + t.base, 0n);
    const [{ id }] = await tx<{ id: string }[]>`
      INSERT INTO ventas_sin_comprobante (empresa_id, vendario_evento_id, fecha, subtotal, itbis, total, gravado, exento, formas, asiento_id)
      VALUES (${e.empresa_id}, ${e.id}, ${e.fecha}, ${d2(imp.subtotal)}, ${d2(imp.total - imp.subtotal)}, ${d2(imp.total)}, ${tx.json(gravado)},
              ${d2(exento)}, ${tx.json(formas)}, ${c.asientoId}) RETURNING id`;
    return { venta_sin_comprobante_id: id };
  }
  if (!["B01", "B02", "B14", "B15", "B16", "E31", "E32", "E44", "E45", "E46"].includes(n.tipo)) throw new Pendiente(`El ${n.tipo} no es un comprobante de venta`);
  const facturaId = await factura(c, { tipo: n.tipo, ncf: n.ncf, origenId: null, imp });
  const [{ cliente_id }] = await tx<{ cliente_id: string }[]>`SELECT cliente_id FROM facturas WHERE id = ${facturaId}`;
  let cobroId: string | null = null;
  for (const p of lista) cobroId = (await cobro(c, { facturaId, clienteId: cliente_id, pago: p })) ?? cobroId;
  return { factura_id: facturaId, cobro_id: cobroId };
}

async function original(e: Con["e"]): Promise<{ factura_id: string | null; compra_id: string | null; venta_sin_comprobante_id: string | null }> {
  if (!e.revierte) throw new Pendiente("La anulación no dice qué evento anula («reverses»)");
  const [o] = await db()<{ estado: string; factura_id: string | null; compra_id: string | null; venta_sin_comprobante_id: string | null }[]>`
    SELECT estado, factura_id, compra_id, venta_sin_comprobante_id FROM vendario_eventos WHERE id = ${e.revierte}`;
  if (!o) throw new Pendiente("Falta el evento original de esta anulación");
  if (o.estado !== "contabilizado") throw new Pendiente("El evento original todavía no está contabilizado");
  return o;
}

async function anularVenta(c: Con): Promise<Hecho> {
  const { tx, e } = c;
  const o = await original(e);
  if (o.venta_sin_comprobante_id) {
    await tx`UPDATE ventas_sin_comprobante SET anulada = true WHERE id = ${o.venta_sin_comprobante_id}`;
    return {};
  }
  if (!o.factura_id) return { nota: "La venta original no tenía documento" };
  // Los cobros que nacieron con la venta se anulan con ella; la factura queda anulada (va al 608 si es serie B).
  await tx`UPDATE cobros SET anulado = true, motivo_anulacion = 'Venta anulada en Vendario', anulado_por = ${e.usuario_id}, anulado_en = now()
            WHERE vendario_evento_id = ${e.revierte} AND NOT anulado`;
  await tx`UPDATE facturas SET anulada = true, motivo_anulacion = '04', anulada_por = ${e.usuario_id}, anulada_en = now() WHERE id = ${o.factura_id}`;
  await bitacora(tx, e.empresa_id, e.usuario_id, "comprobante_anulado", { vendario: e.id, motivo: (e.datos.void_reason as string) ?? null });
  return { factura_id: o.factura_id };
}

async function devolucion(c: Con): Promise<Hecho> {
  const { tx, e } = c;
  const fiscal = (e.datos.fiscal ?? {}) as Record<string, unknown>;
  const imp = impuestos(e.datos.amounts);
  const nota = leerNcf(fiscal.ncf);
  const modifica = leerNcf(fiscal.modified_ncf);
  if (!nota && !modifica) {
    // Devolución de una venta sin comprobante: resta en «otras operaciones».
    const [{ id }] = await tx<{ id: string }[]>`
      INSERT INTO ventas_sin_comprobante (empresa_id, vendario_evento_id, fecha, subtotal, itbis, total, gravado, exento, asiento_id)
      VALUES (${e.empresa_id}, ${e.id}, ${e.fecha}, ${d2(-imp.subtotal)}, ${d2(-(imp.total - imp.subtotal))}, ${d2(-imp.total)},
              ${tx.json(Object.fromEntries(imp.tasas.filter((t) => t.itbis > 0n).map((t) => [String(tasaDe(t)), d2(-t.base)])))},
              ${d2(-imp.tasas.filter((t) => t.itbis === 0n).reduce((s, t) => s + t.base, 0n))}, ${c.asientoId}) RETURNING id`;
    return { venta_sin_comprobante_id: id };
  }
  if (!nota || !["B04", "E34"].includes(nota.tipo)) throw new Pendiente("La devolución no trae su nota de crédito (B04 o E34)");
  const [f] = modifica ? await tx<{ id: string }[]>`SELECT id FROM facturas WHERE ncf = ${modifica.ncf} AND estado = 'emitida' AND NOT anulada` : [];
  if (!f) throw new Pendiente(`No está en Empire la factura que modifica (${modifica?.ncf ?? "sin NCF"})`);
  return { factura_id: await factura(c, { tipo: nota.tipo, ncf: nota.ncf, origenId: f.id, imp }) };
}

// Evento de venta cuyo número (source.number) es el de la cuenta por cobrar, para aplicar el cobro a su factura.
async function documentoPorNumero(clienteId: string, tipos: string[], numero: string): Promise<{ factura_id: string | null; compra_id: string | null } | null> {
  const [o] = await db()<{ factura_id: string | null; compra_id: string | null }[]>`
    SELECT factura_id, compra_id FROM vendario_eventos
     WHERE vendario_cliente_id = ${clienteId} AND tipo = ANY(${tipos}) AND estado = 'contabilizado'
       AND (datos->'source'->>'number' = ${numero} OR datos->'fiscal'->>'invoice_number' = ${numero} OR datos->'fiscal'->>'ncf' = ${numero})
     ORDER BY recibido_en DESC LIMIT 1`;
  return o ?? null;
}

async function cobroCxc(c: Con): Promise<Hecho> {
  const { tx, e } = c;
  const numero = String(((e.datos.source ?? {}) as Record<string, unknown>).number ?? "");
  const o = numero ? await documentoPorNumero(e.vendario_cliente_id, ["sale.posted"], numero) : null;
  if (!o?.factura_id) return { nota: "Cobro sin factura con comprobante en Empire: solo asiento" };
  const [f] = await tx<{ cliente_id: string }[]>`SELECT cliente_id FROM facturas WHERE id = ${o.factura_id}`;
  let cobroId: string | null = null;
  for (const p of pagos(e.datos.payments)) cobroId = (await cobro(c, { facturaId: o.factura_id, clienteId: f.cliente_id, pago: { ...p, kind: p.kind === "credit" ? "other" : p.kind } })) ?? cobroId;
  return { cobro_id: cobroId, factura_id: o.factura_id };
}

async function compra(c: Con): Promise<Hecho> {
  const { tx, e } = c;
  const d = e.datos;
  const n = leerNcf(((d.fiscal ?? {}) as Record<string, unknown>).ncf);
  const gasto = tipoGasto(d, e.tipo);
  if (!n) return { nota: "Sin NCF del suplidor: no va al 606, solo asiento" };
  if (!["B01", "B02", "B14", "B15", "B11", "B13", "B17", "E31", "E32", "E41", "E43", "E44", "E45", "E47"].includes(n.tipo)) throw new Pendiente(`El ${n.tipo} no es un comprobante de compra`);
  const proveedorId = await proveedorDe(tx, e, gasto);
  if (!proveedorId) throw new Pendiente("La compra no trae el RNC o la cédula del suplidor");
  const imp = impuestos(d.amounts);
  const fiscal = (d.fiscal ?? {}) as Record<string, unknown>;
  const vence = typeof fiscal.due_date === "string" && fiscal.due_date >= e.fecha ? fiscal.due_date : e.fecha;
  const categoria = ((d.category ?? {}) as Record<string, unknown>).name;
  const cuenta = (e.tipo === "purchase.received" ? c.mapeo.get("INVENTARIO") : c.mapeo.get(`GASTO:${categoria ?? "Otros"}`))
    ?? (await tx<{ cuenta_id: string }[]>`SELECT cuenta_id FROM cuentas_empresa WHERE clave = 'gasto_general'`)[0]?.cuenta_id;
  if (!cuenta) throw new Pendiente("El cliente no tiene cuenta de gastos en su configuración");
  const itbis = imp.tasas.reduce((s, t) => s + t.itbis, 0n);
  const [dup] = await tx`SELECT 1 FROM compras WHERE proveedor_id = ${proveedorId} AND ncf = ${n.ncf} AND NOT anulada`;
  if (dup) throw new Pendiente(`El NCF ${n.ncf} de ese suplidor ya está registrado`);
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO compras (empresa_id, tipo_comprobante, ncf, proveedor_id, fecha, vence, moneda, tasa, tipo_gasto, itbis_al_costo, subtotal, itbis,
                         otros_impuestos, total, notas, creado_por, vendario_evento_id)
    VALUES (${e.empresa_id}, ${n.tipo}, ${n.ncf}, ${proveedorId}, ${e.fecha}, ${vence}, 'DOP', 1, ${gasto}, ${["B02", "E32", "B13", "E43"].includes(n.tipo)},
            ${d2(imp.subtotal)}, ${d2(itbis)}, 0, ${d2(imp.total)}, ${typeof d.description === "string" ? d.description : `Vendario ${(d.source as Record<string, unknown>)?.number ?? ""}`},
            ${e.usuario_id}, ${e.id}) RETURNING id`;
  for (const [i, t] of imp.tasas.entries()) {
    const im = await impuestoPara(tx, t, e.fecha);
    const [{ id: lineaId }] = await tx<{ id: string }[]>`
      INSERT INTO lineas_compra (compra_id, empresa_id, orden, descripcion, clase, cantidad, precio, cuenta_id, subtotal, itbis, otros)
      VALUES (${id}, ${e.empresa_id}, ${i + 1}, ${categoria ? String(categoria) : e.tipo === "purchase.received" ? "Mercancía (Vendario)" : "Gasto (Vendario)"},
              ${e.tipo === "purchase.received" ? "bien" : "servicio"}, 1, ${d2(t.base)}, ${cuenta}, ${d2(t.base)}, ${d2(t.itbis)}, 0) RETURNING id`;
    await tx`INSERT INTO impuestos_linea_compra (linea_id, compra_id, empresa_id, impuesto_id, tipo, tasa, monto)
             VALUES (${lineaId}, ${id}, ${e.empresa_id}, ${im.id}, ${im.tipo}, ${im.tasa}, ${d2(t.itbis)})`;
  }
  await tx`UPDATE compras SET estado = 'registrada', asiento_id = ${c.asientoId}, registrada_por = ${e.usuario_id}, registrada_en = now() WHERE id = ${id}`;
  await bitacora(tx, e.empresa_id, e.usuario_id, "compra_registrada", { ncf: n.ncf, total: d2(imp.total), vendario: e.id });
  // Un gasto se paga al registrarlo (sus formas de pago); una compra de mercancía queda en cuentas por pagar hasta payable.paid.
  let pagoId: string | null = null;
  if (e.tipo === "expense.posted") {
    for (const p of pagos(d.payments).filter((p) => p.kind !== "credit")) pagoId = await pago(c, { compraId: id, proveedorId, pago: p }) ?? pagoId;
  }
  return { compra_id: id, pago_id: pagoId };
}

async function pago(c: Con, o: { compraId: string; proveedorId: string; pago: { kind: string; amount: bigint; reference: string | null } }): Promise<string> {
  const { tx, e } = c;
  await tx`SELECT 1 FROM empresas WHERE id = ${e.empresa_id} FOR UPDATE`;
  const [{ numero }] = await tx<{ numero: number }[]>`SELECT COALESCE(max(numero), 0) + 1 AS numero FROM pagos`;
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO pagos (empresa_id, numero, proveedor_id, fecha, forma_pago, referencia, pagado, notas, asiento_id, creado_por, vendario_evento_id)
    VALUES (${e.empresa_id}, ${numero}, ${o.proveedorId}, ${e.fecha}, ${FORMA_606[o.pago.kind] ?? "01"}, ${o.pago.reference}, ${d2(o.pago.amount)},
            'Pagado en Vendario', ${c.asientoId}, ${e.usuario_id}, ${e.id}) RETURNING id`;
  await tx`INSERT INTO aplicaciones_pago (pago_id, compra_id, empresa_id, monto) VALUES (${id}, ${o.compraId}, ${e.empresa_id}, ${d2(o.pago.amount)})`;
  return id;
}

async function pagoCxp(c: Con): Promise<Hecho> {
  const { tx, e } = c;
  const numero = String(((e.datos.source ?? {}) as Record<string, unknown>).number ?? "");
  const o = numero ? await documentoPorNumero(e.vendario_cliente_id, ["purchase.received"], numero) : null;
  if (!o?.compra_id) return { nota: "Pago sin compra con NCF en Empire: solo asiento" };
  const [cp] = await tx<{ proveedor_id: string }[]>`SELECT proveedor_id FROM compras WHERE id = ${o.compra_id}`;
  let pagoId: string | null = null;
  for (const p of pagos(e.datos.payments)) pagoId = await pago(c, { compraId: o.compra_id, proveedorId: cp.proveedor_id, pago: p });
  return { pago_id: pagoId, compra_id: o.compra_id };
}

async function anularGasto(c: Con): Promise<Hecho> {
  const { tx, e } = c;
  const o = await original(e);
  if (!o.compra_id) return { nota: "El gasto original no tenía documento" };
  await tx`UPDATE pagos SET anulado = true, motivo_anulacion = 'Gasto anulado en Vendario', anulado_por = ${e.usuario_id}, anulado_en = now()
            WHERE vendario_evento_id = ${e.revierte} AND NOT anulado`;
  await tx`UPDATE compras SET anulada = true, anulada_por = ${e.usuario_id}, anulada_en = now() WHERE id = ${o.compra_id}`;
  return { compra_id: o.compra_id };
}

// ───── Mapeo de cuentas ─────

// Cuentas neutrales que usan los eventos de un cliente (las del acuerdo y las de gasto por categoría que vayan llegando).
export async function cuentasUsadas(clienteId: string): Promise<string[]> {
  const filas = await db()<{ cuenta: string }[]>`
    SELECT DISTINCT l->>'account' AS cuenta FROM vendario_eventos x, jsonb_array_elements(CASE WHEN jsonb_typeof(x.datos->'entry') = 'array' THEN x.datos->'entry' ELSE '[]' END) l
     WHERE x.vendario_cliente_id = ${clienteId} AND l->>'account' IS NOT NULL ORDER BY 1`;
  return filas.map((f) => f.cuenta);
}

export async function mapeoDe(empresaId: string) {
  return conEmpresa(empresaId, async (tx) => ({
    mapeo: Object.fromEntries((await tx<{ cuenta: string; cuenta_id: string }[]>`SELECT cuenta, cuenta_id FROM vendario_mapeo`).map((m) => [m.cuenta, m.cuenta_id])),
    cuentas: await tx<{ id: string; codigo: string; nombre: string }[]>`SELECT id, codigo, nombre FROM cuentas WHERE activa AND de_detalle ORDER BY codigo`,
  }));
}

// Guarda lo que eligió el contable (vacío = quitar). La base revisa que cada cuenta sea de esa empresa.
export async function guardarMapeo(empresaId: string, usuarioId: string, pares: [string, string | null][]) {
  await conEmpresa(empresaId, async (tx) => {
    for (const [cuenta, cuentaId] of pares) {
      if (!cuentaId) { await tx`DELETE FROM vendario_mapeo WHERE cuenta = ${cuenta}`; continue; }
      const [c] = await tx`SELECT 1 FROM cuentas WHERE id = ${cuentaId} AND activa AND de_detalle`;
      if (!c) throw new ErrorContable(`La cuenta elegida para ${cuenta} no es una cuenta de detalle activa`);
      await tx`INSERT INTO vendario_mapeo (empresa_id, cuenta, cuenta_id, actualizado_por) VALUES (${empresaId}, ${cuenta}, ${cuentaId}, ${usuarioId})
               ON CONFLICT (empresa_id, cuenta) DO UPDATE SET cuenta_id = EXCLUDED.cuenta_id, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`;
    }
  });
}

export { centavos };
