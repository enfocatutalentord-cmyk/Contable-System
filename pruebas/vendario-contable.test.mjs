// Integración con Vendario, parte 2: de cada evento al asiento (cuadra al centavo, cuentas mapeadas por el contable) y a los documentos del
// 606/607/608 e IT-1. Venta con NCF y cobro, venta sin comprobante, anulación enlazada, devolución con nota, gasto con pago, cierre de caja,
// cuenta sin mapear (pendiente y reproceso), cliente no aceptado y cliente con solo el servicio de ITBIS (sin asiento).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { centavos, impuestos, leerEntry, leerNcf, mapearLineas, Pendiente, tasaDe, tipoGasto } from "../lib/vendario-contable.ts";
import { leerSobre } from "../lib/vendario-sobre.ts";

// ───── Puras ─────
const ENTRY_VENTA = [{ account: "CAJA", debit: "1180.00", credit: "0.00" }, { account: "VENTAS", debit: "0.00", credit: "1000.00" },
  { account: "ITBIS_POR_PAGAR", debit: "0.00", credit: "180.00" }, { account: "COSTO_VENTAS", debit: "640.00", credit: "0.00" },
  { account: "INVENTARIO", debit: "0.00", credit: "640.00" }];

test("el asiento del evento cuadra al centavo o queda pendiente", () => {
  assert.equal(leerEntry(ENTRY_VENTA).length, 5);
  assert.throws(() => leerEntry([{ account: "CAJA", debit: "1180.00", credit: "0" }, { account: "VENTAS", debit: "0", credit: "1179.99" }]), /no cuadra/);
  assert.throws(() => leerEntry(null), Pendiente);
  assert.throws(() => mapearLineas(leerEntry(ENTRY_VENTA), new Map([["CAJA", "x"]])), /Cuenta sin mapear: VENTAS, ITBIS_POR_PAGAR, COSTO_VENTAS, INVENTARIO/);
});

test("impuestos por tasa, NCF, tipo de gasto y montos sin decimales flotantes", () => {
  const i = impuestos({ subtotal: "1000.00", discount: "0.00", taxes: [{ code: "ITBIS18", rate: "18.00", base: "1000.00", tax: "180.00" }], total: "1180.00" });
  assert.deepEqual([i.subtotal, i.total, i.tasas.length], [100000n, 118000n, 1]);
  // Parte exenta: lo que no está en ninguna tasa.
  const m = impuestos({ subtotal: "1500.00", taxes: [{ rate: "18.00", base: "1000.00", tax: "180.00" }], total: "1680.00" });
  assert.deepEqual(m.tasas.map((t) => [t.tasa, t.base]), [["18", 100000n], ["0", 50000n]]);
  // Gasto: tasa sin indicar, se deduce de base e impuesto.
  assert.equal(tasaDe({ tasa: null, base: 50000n, itbis: 9000n }), 18);
  assert.throws(() => impuestos({ subtotal: "100.00", taxes: [], total: "118.00" }), /no es subtotal/);
  assert.deepEqual(leerNcf("b0100000045"), { ncf: "B0100000045", tipo: "B01" });
  assert.deepEqual(leerNcf("E310000000001"), { ncf: "E310000000001", tipo: "E31" });
  assert.equal(leerNcf("B01"), null);
  assert.equal(tipoGasto({ category: { dgii_606_type: "2" } }, "expense.posted"), "02");
  assert.equal(tipoGasto({}, "purchase.received"), "09");
  assert.equal(centavos("0.10") + centavos("0.20"), 30n);
});

// ───── Con la base ─────
const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let v, r, firma, ana, antes;
const ORG = `org-c-${marca}`, ORG2 = `org-i-${marca}`;
const RNC = "1" + String(marca).slice(-8), RNC2 = "2" + String(marca).slice(-8);
let seq = 0;
const sobre = (org, rnc, type, data, conSeq = true) => ({ version: "1.0", id: randomUUID(), type, created_at: new Date().toISOString(), org: { vendario_id: org, rnc }, seq: conSeq ? ++seq : null, data });
const recibir = async (s) => {
  const cuerpo = JSON.stringify(s);
  await v.guardarMensaje(leerSobre(cuerpo).sobre, cuerpo);
  await v.procesarMensaje(s.id);
  if (s.type === "accounting.event") return r.contabilizarEvento(s.id);
};
const alta = (org, rnc, servicios) => sobre(org, rnc, "client.enroll", {
  services: servicios, start_date: "2026-10-01", history: { from: "2026-10-01", to: "2026-11-13" },
  company: { rnc, legal_name: `FERRETERIA ${org}`, trade_name: "Ferretería" }, contact: { name: "Dueño" },
  authorization: { by_name: "Dueño", at: "2026-11-13T14:00:00Z", text_version: "2026-11-13" },
}, false);
const venta = (org, rnc, ncf, pagos, extra = {}) => sobre(org, rnc, "accounting.event", {
  event_type: "sale.posted", source: { kind: "sale", id: randomUUID(), number: `V-${++seq}` }, reverses: null, historical: false, date: "2026-11-10",
  occurred_at: "2026-11-10T14:05:20Z", fiscal: { ncf, ncf_type: ncf?.slice(1, 3) ?? null, modified_ncf: null },
  party: ncf?.startsWith("B01") ? { kind: "customer", doc_type: "RNC", doc: "101234567", name: "Constructora X" } : null,
  amounts: { subtotal: "1000.00", discount: "0.00", taxes: [{ code: "ITBIS18", rate: "18.00", base: "1000.00", tax: "180.00" }], total: "1180.00" },
  payments: pagos, cost_of_sales: "640.00", entry: ENTRY_VENTA.map((l) => (l.account === "CAJA" && pagos[0]?.kind === "credit" ? { ...l, account: "CXC_CLIENTES" } : l)), ...extra,
});
const empresaDe = async (org) => (await sql`SELECT empresa_id, id FROM vendario_clientes WHERE org_id = ${org}`)[0];
const ver = async (empresaId, fn) => sql.begin(async (tx) => { await tx`SELECT set_config('app.empresa_id', ${empresaId}, true)`; return fn(tx); });
const cuadra = async (empresaId, asientoId) => {
  const [a] = await ver(empresaId, (tx) => tx`SELECT sum(debe)::text AS d, sum(haber)::text AS h FROM lineas_asiento WHERE asiento_id = ${asientoId}`);
  assert.equal(a.d, a.h, "el asiento cuadra");
  return a.d;
};
const evento = async (id) => (await sql`SELECT * FROM vendario_eventos WHERE id = ${id}`)[0];

before(async () => {
  if (!sql) return;
  // Solo una firma recibe Vendario: las dos pruebas de Vendario se turnan con un candado de la base (se suelta al cerrar).
  await sql`SELECT pg_advisory_lock(57057)`;
  v = await import("../lib/vendario.ts");
  r = await import("../lib/vendario-registro.ts");
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-vc-${marca}@x.do`}, 'Ana Contable', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma Vendario C ${marca}`}) RETURNING id`;
  await sql`SELECT crear_perfiles_firma(${firma})`;
  await sql`INSERT INTO miembros_firma (firma_id, usuario_id, administrador) VALUES (${firma}, ${ana}, true)`;
  antes = (await sql`SELECT id FROM firmas WHERE recibe_vendario`)[0]?.id ?? null;
  await v.marcarFirmaReceptora(firma, true);
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM vendario_mensajes WHERE org_id IN (${ORG}, ${ORG2})`;
    await sql`DELETE FROM vendario_clientes WHERE org_id IN (${ORG}, ${ORG2})`;
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`UPDATE firmas SET recibe_vendario = false WHERE id = ${firma}`;
    if (antes) await sql`UPDATE firmas SET recibe_vendario = true WHERE id = ${antes}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
    await globalThis._sql?.end();
  }
});

let empresa, cliente;
test("cliente no aceptado: el evento queda pendiente; al aceptar y mapear se contabiliza", conBase, async () => {
  await recibir(alta(ORG, RNC, ["registro_contable", "itbis_606_607_608"]));
  const temprana = venta(ORG, RNC, "B0100000045", [{ kind: "cash", amount: "1180.00", reference: null }]);
  assert.equal((await recibir(temprana)).motivo, "Servicio no aceptado todavía");
  const c = await empresaDe(ORG);
  empresa = await v.aceptar({ firmaId: firma, clienteId: c.id, usuarioId: ana, responsableId: ana, empresaId: null });
  cliente = c.id;
  // Sin mapeo: pendiente con las cuentas que faltan.
  assert.match((await r.contabilizarEvento(temprana.id)).motivo, /Cuenta sin mapear/);
  // El contable confirma las sugeridas (y elige el gasto y el faltante de caja).
  const { cuentas } = await r.mapeoDe(empresa);
  const id = (codigo) => cuentas.find((x) => x.codigo === codigo).id;
  await r.guardarMapeo(empresa, ana, [["CAJA", id("110101")], ["BANCO", id("110103")], ["CXC_CLIENTES", id("110201")], ["VENTAS", id("410102")],
    ["DEVOLUCIONES_VENTAS", id("410103")], ["ITBIS_POR_PAGAR", id("210201")], ["ITBIS_ADELANTADO", id("110401")], ["COSTO_VENTAS", id("510101")],
    ["INVENTARIO", id("110301")], ["GASTO:Luz", id("610202")], ["FALTANTE_CAJA", id("610214")]]);
  assert.equal(await r.contabilizarPendientes({ clienteId: cliente }), 1);
  const x = await evento(temprana.id);
  assert.equal(x.estado, "contabilizado");
  assert.equal(await cuadra(empresa, x.asiento_id), "1820.00");
  const [f] = await ver(empresa, (tx) => tx`SELECT estado, ncf, total::text, asiento_id, vendario_evento_id FROM facturas WHERE id = ${x.factura_id}`);
  assert.deepEqual([f.estado, f.ncf, f.total, f.asiento_id, f.vendario_evento_id], ["emitida", "B0100000045", "1180.00", x.asiento_id, temprana.id]);
  const [co] = await ver(empresa, (tx) => tx`SELECT forma_pago, recibido::text FROM cobros WHERE id = ${x.cobro_id}`);
  assert.deepEqual([co.forma_pago, co.recibido], ["efectivo", "1180.00"]);
});

test("venta sin comprobante: va a ventas sin comprobante (IT-1), con su asiento", conBase, async () => {
  const s = venta(ORG, RNC, null, [{ kind: "card", amount: "1180.00", reference: "1234" }]);
  s.data.entry[0].account = "BANCO";
  await recibir(s);
  const x = await evento(s.id);
  assert.equal(x.estado, "contabilizado");
  const [vs] = await ver(empresa, (tx) => tx`SELECT subtotal::text, gravado, formas FROM ventas_sin_comprobante WHERE id = ${x.venta_sin_comprobante_id}`);
  assert.deepEqual([vs.subtotal, vs.gravado, vs.formas], ["1000.00", { 18: "1000.00" }, { tarjeta: "1180.00" }]);
  await cuadra(empresa, x.asiento_id);
});

test("anulación con reverses: factura anulada y asiento inverso enlazado al original", conBase, async () => {
  const s = venta(ORG, RNC, "B0100000046", [{ kind: "credit", amount: "1180.00", reference: null }]);
  await recibir(s);
  const o = await evento(s.id);
  const inverso = ENTRY_VENTA.map((l) => ({ account: l.account === "CAJA" ? "CXC_CLIENTES" : l.account, debit: l.credit, credit: l.debit }));
  const an = sobre(ORG, RNC, "accounting.event", { ...s.data, event_type: "sale.voided", reverses: s.id, entry: inverso, void_reason: "Error" });
  await recibir(an);
  const x = await evento(an.id);
  assert.equal(x.estado, "contabilizado");
  const [f] = await ver(empresa, (tx) => tx`SELECT anulada FROM facturas WHERE id = ${o.factura_id}`);
  assert.equal(f.anulada, true);
  const [a] = await ver(empresa, (tx) => tx`SELECT revierte_a FROM asientos WHERE id = ${x.asiento_id}`);
  assert.equal(a.revierte_a, o.asiento_id);
  await cuadra(empresa, x.asiento_id);
});

test("devolución con nota de crédito B04 sobre la factura que modifica", conBase, async () => {
  const s = sobre(ORG, RNC, "accounting.event", {
    event_type: "sale.returned", date: "2026-11-11", occurred_at: "2026-11-11T10:00:00Z",
    fiscal: { ncf: "B0400000003", ncf_type: "04", modified_ncf: "B0100000045" },
    party: { kind: "customer", doc_type: "RNC", doc: "101234567", name: "Constructora X" },
    amounts: { subtotal: "100.00", discount: "0.00", taxes: [{ code: "ITBIS18", rate: "18.00", base: "100.00", tax: "18.00" }], total: "118.00" },
    entry: [{ account: "DEVOLUCIONES_VENTAS", debit: "100.00", credit: "0" }, { account: "ITBIS_POR_PAGAR", debit: "18.00", credit: "0" },
      { account: "CAJA", debit: "0", credit: "118.00" }, { account: "INVENTARIO", debit: "64.00", credit: "0" }, { account: "COSTO_VENTAS", debit: "0", credit: "64.00" }],
  });
  await recibir(s);
  const x = await evento(s.id);
  assert.equal(x.estado, "contabilizado", x.motivo);
  const [n] = await ver(empresa, (tx) => tx`SELECT n.tipo_ncf, n.ncf, o.ncf AS modifica FROM facturas n JOIN facturas o ON o.id = n.factura_origen_id WHERE n.id = ${x.factura_id}`);
  assert.deepEqual([n.tipo_ncf, n.ncf, n.modifica], ["B04", "B0400000003", "B0100000045"]);
});

test("gasto con NCF: compra para el 606 con su tipo de gasto y su pago", conBase, async () => {
  const s = sobre(ORG, RNC, "accounting.event", {
    event_type: "expense.posted", source: { kind: "expense", id: randomUUID(), number: "G-1" }, date: "2026-11-12", description: "Luz de octubre",
    category: { name: "Luz", dgii_606_type: "02" }, fiscal: { ncf: "B0100000099", ncf_type: "01", modified_ncf: null },
    party: { kind: "supplier", doc_type: "RNC", doc: "101820217", name: "EDESUR" },
    amounts: { subtotal: "500.00", discount: "0.00", taxes: [{ code: "ITBIS", rate: null, base: "500.00", tax: "90.00" }], total: "590.00" },
    payments: [{ kind: "transfer", amount: "590.00" }],
    entry: [{ account: "GASTO:Luz", debit: "500.00", credit: "0" }, { account: "ITBIS_ADELANTADO", debit: "90.00", credit: "0" }, { account: "BANCO", debit: "0", credit: "590.00" }],
  });
  await recibir(s);
  const x = await evento(s.id);
  assert.equal(x.estado, "contabilizado", x.motivo);
  const [c] = await ver(empresa, (tx) => tx`SELECT estado, tipo_gasto, itbis::text, total::text FROM compras WHERE id = ${x.compra_id}`);
  assert.deepEqual([c.estado, c.tipo_gasto, c.itbis, c.total], ["registrada", "02", "90.00", "590.00"]);
  const [p] = await ver(empresa, (tx) => tx`SELECT forma_pago, pagado::text FROM pagos WHERE id = ${x.pago_id}`);
  assert.deepEqual([p.forma_pago, p.pagado], ["02", "590.00"]);
  await cuadra(empresa, x.asiento_id);
});

test("cierre de caja con faltante: solo asiento", conBase, async () => {
  const s = sobre(ORG, RNC, "accounting.event", { event_type: "cash.closed", date: "2026-11-12", amounts: { subtotal: "10.00", taxes: [], total: "10.00" },
    entry: [{ account: "FALTANTE_CAJA", debit: "10.00", credit: "0.00" }, { account: "CAJA", debit: "0.00", credit: "10.00" }] });
  await recibir(s);
  const x = await evento(s.id);
  assert.equal(x.estado, "contabilizado");
  assert.equal(await cuadra(empresa, x.asiento_id), "10.00");
  assert.equal(x.factura_id, null);
});

test("cuenta nueva sin mapear: queda pendiente con el motivo, sin descartarse", conBase, async () => {
  const s = sobre(ORG, RNC, "accounting.event", { event_type: "inventory.adjusted", date: "2026-11-12", amounts: { subtotal: "50.00", taxes: [], total: "50.00" },
    entry: [{ account: "AJUSTE_INVENTARIO", debit: "50.00", credit: "0" }, { account: "INVENTARIO", debit: "0", credit: "50.00" }] });
  const res = await recibir(s);
  assert.deepEqual(res, { estado: "pendiente", motivo: "Cuenta sin mapear: AJUSTE_INVENTARIO" });
  assert.equal((await evento(s.id)).estado, "pendiente");
});

test("cliente con solo el servicio de ITBIS: factura y cobro para el 607, sin asiento", conBase, async () => {
  await recibir(alta(ORG2, RNC2, ["itbis_606_607_608"]));
  const c = await empresaDe(ORG2);
  const e2 = await v.aceptar({ firmaId: firma, clienteId: c.id, usuarioId: ana, responsableId: ana, empresaId: null });
  const s = venta(ORG2, RNC2, "B0200000001", [{ kind: "cash", amount: "1180.00", reference: null }]);
  await recibir(s);
  const x = await evento(s.id);
  assert.equal(x.estado, "contabilizado", x.motivo);
  assert.equal(x.asiento_id, null);
  const [f] = await ver(e2, (tx) => tx`SELECT estado, ncf, asiento_id FROM facturas WHERE id = ${x.factura_id}`);
  assert.deepEqual([f.estado, f.ncf, f.asiento_id], ["emitida", "B0200000001", null]);
});
