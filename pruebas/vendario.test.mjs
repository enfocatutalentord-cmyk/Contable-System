// Integración con Vendario, parte 1 (acuerdo docs/vendario/acuerdo.md): firma, sobre, alta, alta repetida, firma inválida, hora vencida,
// eventos guardados (venta, anulación con reverses, devolución, gasto, cierre de caja), cliente no aceptado, hueco en seq, baja y envío de
// estados a un Vendario simulado que verifica la firma igual que el real (supabase/functions/_shared/hmac.ts).
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { clavesDe, firmar, verificar } from "../lib/vendario-firma.ts";
import { ESPERAS_MIN, leerSobre, sobreEstado, trasRespuesta } from "../lib/vendario-sobre.ts";

const V2E = "clave-de-prueba-v2e";
const E2V = "clave-de-prueba-e2v";
process.env.E2V_SECRET = E2V;
process.env.VENDARIO_URL = "https://vendario.prueba/functions/v1";

// ───── Ejemplos del acuerdo ─────
const ORG = `org-${Date.now()}`;
const sobre = (type, data, seq = null) => ({ version: "1.0", id: randomUUID(), type, created_at: "2026-11-13T14:05:22Z", org: { vendario_id: ORG, rnc: "133833964" }, seq, data });
const ALTA = sobre("client.enroll", {
  services: ["registro_contable", "itbis_606_607_608"], start_date: "2026-10-01", history: { from: "2026-10-01", to: "2026-11-13" },
  company: { rnc: "133833964", legal_name: "ALL IN ONE FERRETERIA Y SERVICIOS SRL", trade_name: "All In One", address: "Calle 1", phone: "809-000-0000", rnc_status: "ACTIVO", no_fiscal: false },
  contact: { name: "Dueño de Prueba", email: "dueno@prueba.test", phone: "809-111-1111" },
  authorization: { by_name: "Dueño de Prueba", by_email: "dueno@prueba.test", at: "2026-11-13T14:00:00Z", text_version: "2026-11-13" },
});
const VENTA = (seq) => sobre("accounting.event", {
  event_type: "sale.posted", source: { kind: "sale", id: randomUUID(), number: "V-00000123" }, reverses: null, historical: false, date: "2026-11-13",
  occurred_at: "2026-11-13T14:05:20Z", fiscal: { ncf: "B0100000045", ncf_type: "01", modified_ncf: null },
  party: { kind: "customer", doc_type: "RNC", doc: "101234567", name: "Constructora X" },
  amounts: { subtotal: "1000.00", discount: "0.00", taxes: [{ code: "ITBIS18", rate: "18.00", base: "1000.00", tax: "180.00" }], total: "1180.00" },
  payments: [{ kind: "cash", method: "Efectivo", amount: "1180.00", reference: null }], cost_of_sales: "640.00",
  entry: [{ account: "CAJA", debit: "1180.00", credit: "0.00" }, { account: "VENTAS", debit: "0.00", credit: "1000.00" },
    { account: "ITBIS_POR_PAGAR", debit: "0.00", credit: "180.00" }, { account: "COSTO_VENTAS", debit: "640.00", credit: "0.00" },
    { account: "INVENTARIO", debit: "0.00", credit: "640.00" }],
}, seq);

// Verificación tal como la hace Vendario (hmac.ts): t y v1, 300 s, varias claves.
function verificaComoVendario(header, body, secrets, now = Math.floor(Date.now() / 1000)) {
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v.toLowerCase());
  if (!Number.isFinite(t) || Math.abs(now - t) > 300) return false;
  return secrets.some((s) => sigs.includes(createHmac("sha256", s).update(`${t}.${body}`).digest("hex")));
}

test("firma: la de Empire la acepta Vendario y al revés", () => {
  const cuerpo = JSON.stringify(ALTA);
  assert.ok(verificaComoVendario(firmar(E2V, cuerpo), cuerpo, [E2V]));
  const t = Math.floor(Date.now() / 1000);
  const deVendario = `t=${t},v1=${createHmac("sha256", V2E).update(`${t}.${cuerpo}`).digest("hex")}`;
  assert.deepEqual(verificar(deVendario, cuerpo, [V2E]), { ok: true });
});

test("firma inválida, cuerpo cambiado, hora vencida y rotación de claves", () => {
  const cuerpo = JSON.stringify(ALTA);
  const h = firmar(V2E, cuerpo);
  assert.equal(verificar(h, cuerpo + " ", [V2E]).motivo, "firma");
  assert.equal(verificar(firmar("otra", cuerpo), cuerpo, [V2E]).motivo, "firma");
  assert.equal(verificar(firmar(V2E, cuerpo, Math.floor(Date.now() / 1000) - 301), cuerpo, [V2E]).motivo, "hora");
  assert.equal(verificar(null, cuerpo, [V2E]).motivo, "sin_firma");
  assert.equal(verificar(h, cuerpo, []).motivo, "sin_clave");
  // Rotación: dos claves en el servidor (separadas por coma) o dos v1 en el encabezado.
  assert.deepEqual(verificar(h, cuerpo, clavesDe(`nueva-clave, ${V2E}`)), { ok: true });
  const t = Math.floor(Date.now() / 1000);
  const dos = `t=${t},v1=${"0".repeat(64)},v1=${createHmac("sha256", V2E).update(`${t}.${cuerpo}`).digest("hex")}`;
  assert.deepEqual(verificar(dos, cuerpo, [V2E]), { ok: true });
});

test("sobre: lo que nunca se podrá procesar es 422; lo demás se acepta", () => {
  assert.equal(leerSobre("{no es json").error, "INVALID_JSON");
  assert.equal(leerSobre(JSON.stringify({ ...ALTA, type: "client.otro" })).error, "UNKNOWN_TYPE");
  assert.equal(leerSobre(JSON.stringify({ ...ALTA, org: {} })).error, "MISSING_FIELDS: org.vendario_id");
  assert.equal(leerSobre(JSON.stringify({ ...ALTA, id: "x" })).error, "MISSING_FIELDS: id");
  assert.equal(leerSobre(JSON.stringify({ ...ALTA, version: "2.0" })).error, "UNSUPPORTED_VERSION");
  const v = leerSobre(JSON.stringify(VENTA(7)));
  assert.ok(v.ok);
  assert.equal(v.sobre.seq, 7);
});

test("estado para Vendario con el formato de la sección 6 y reintentos de la sección 5", () => {
  const s = sobreEstado({ id: randomUUID(), ahora: new Date("2026-11-13T15:10:00.123Z"), org: { vendario_id: ORG, rnc: "133833964" }, estado: "necesita_info",
    contable: "Patricia M.", periodo: "2026-10", nota: "Falta el estado de cuenta bancario de octubre.", pedidos: ["estado_cuenta_banco"] });
  assert.deepEqual(s.data, { status: "necesita_info", at: "2026-11-13T15:10:00Z", accountant: { name: "Patricia M." }, period: "2026-10",
    note: "Falta el estado de cuenta bancario de octubre.", requested: ["estado_cuenta_banco"] });
  assert.equal(s.type, "service.status");
  assert.deepEqual(ESPERAS_MIN, [1, 5, 30, 120, 360, 1440]);
  assert.deepEqual(trasRespuesta(200, 1), { estado: "enviado" });
  assert.deepEqual(trasRespuesta(500, 1), { estado: "pendiente", esperaMin: 1 });
  assert.deepEqual(trasRespuesta(null, 6), { estado: "pendiente", esperaMin: 1440 });
  assert.equal(trasRespuesta(503, 7).estado, "fallido");
  assert.equal(trasRespuesta(422, 1).estado, "rechazado");
  assert.equal(trasRespuesta(401, 1).estado, "rechazado");
});

// ───── Con la base ─────
const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
let v, firma, ana, antes;
const recibidos = []; // lo que le llegó al Vendario simulado
const vendarioSimulado = (codigos = []) => async (u, init) => {
  const ok = verificaComoVendario(init.headers["X-Signature"], init.body, [E2V]);
  recibidos.push({ url: u, ok, cuerpo: JSON.parse(init.body) });
  const codigo = ok ? codigos.shift() ?? 200 : 401;
  return new Response(JSON.stringify(codigo === 200 ? { ok: true } : { error: "X" }), { status: codigo });
};
const recibir = async (s) => {
  const cuerpo = JSON.stringify(s);
  const nuevo = await v.guardarMensaje(leerSobre(cuerpo).sobre, cuerpo);
  if (nuevo) await v.procesarMensaje(s.id);
  return nuevo;
};
const cliente = async () => (await sql`SELECT * FROM vendario_clientes WHERE org_id = ${ORG}`)[0];

before(async () => {
  if (!sql) return;
  // Solo una firma recibe Vendario: las dos pruebas de Vendario se turnan con un candado de la base (se suelta al cerrar).
  await sql`SELECT pg_advisory_lock(57057)`;
  v = await import("../lib/vendario.ts");
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-vendario-${Date.now()}@x.do`}, 'Ana Contable', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma Vendario ${Date.now()}`}) RETURNING id`;
  await sql`SELECT crear_perfiles_firma(${firma})`;
  await sql`INSERT INTO miembros_firma (firma_id, usuario_id, administrador) VALUES (${firma}, ${ana}, true)`;
  antes = (await sql`SELECT id FROM firmas WHERE recibe_vendario`)[0]?.id ?? null;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM vendario_mensajes WHERE org_id = ${ORG}`;
    await sql`DELETE FROM vendario_clientes WHERE org_id = ${ORG}`;
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

test("alta sin firma receptora: queda pendiente y se procesa al marcarla; manda «recibida»", conBase, async () => {
  if (antes) await sql`UPDATE firmas SET recibe_vendario = false WHERE id = ${antes}`;
  assert.equal(await recibir(ALTA), true);
  const [m] = await sql`SELECT estado, motivo FROM vendario_mensajes WHERE id = ${ALTA.id}`;
  assert.equal(m.estado, "pendiente");
  assert.match(m.motivo, /Ninguna firma/);
  await v.marcarFirmaReceptora(firma, true);
  const c = await cliente();
  assert.equal(c.estado, "solicitud");
  assert.equal(c.firma_id, firma);
  assert.equal(c.autorizacion.by_name, "Dueño de Prueba");
  assert.deepEqual(c.servicios, ["registro_contable", "itbis_606_607_608"]);
  const r = await v.enviarPendientes({ pedir: vendarioSimulado() });
  assert.equal(r.enviados, 1);
  const ultimo = recibidos.at(-1);
  assert.ok(ultimo.ok, "Vendario acepta la firma");
  assert.equal(ultimo.url, "https://vendario.prueba/functions/v1/empire-inbox");
  assert.deepEqual([ultimo.cuerpo.type, ultimo.cuerpo.data.status, ultimo.cuerpo.org.vendario_id, ultimo.cuerpo.org.rnc], ["service.status", "recibida", ORG, "133833964"]);
});

test("alta repetida (mismo id): no se registra de nuevo", conBase, async () => {
  assert.equal(await recibir(ALTA), false);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM vendario_mensajes WHERE id = ${ALTA.id}`;
  assert.equal(n, 1);
  const [{ e }] = await sql`SELECT count(*)::int AS e FROM vendario_envios WHERE vendario_cliente_id = ${(await cliente()).id} AND estado_servicio = 'recibida'`;
  assert.equal(e, 1);
});

test("evento de un cliente no aceptado: se guarda, sin contabilizar y sin descartar", conBase, async () => {
  const e = VENTA(1);
  await recibir(e);
  const [x] = await sql`SELECT estado, tipo, total::text, seq::int FROM vendario_eventos WHERE id = ${e.id}`;
  assert.deepEqual([x.estado, x.tipo, x.total, x.seq], ["esperando", "sale.posted", "1180.00", 1]);
});

test("vista, pedir información y aceptar: cada paso va a Vendario con el contable", conBase, async () => {
  const c = await cliente();
  assert.equal(await v.registrarVista(firma, c.id, ana), true);
  assert.equal(await v.registrarVista(firma, c.id, ana), false, "solo la primera vez");
  await assert.rejects(v.cambiarEstado({ firmaId: firma, clienteId: c.id, usuarioId: ana, estado: "necesita_info", nota: " " }), /nota/);
  await v.cambiarEstado({ firmaId: firma, clienteId: c.id, usuarioId: ana, estado: "necesita_info", nota: "Falta el estado de cuenta.", pedidos: ["estado_cuenta_banco"] });
  const empresaId = await v.aceptar({ firmaId: firma, clienteId: c.id, usuarioId: ana, responsableId: ana, empresaId: null });
  const [e] = await sql`SELECT nombre, rnc, estado_cliente, lleva_contabilidad, responsable_id FROM empresas WHERE id = ${empresaId}`;
  assert.deepEqual([e.nombre, e.rnc, e.estado_cliente, e.lleva_contabilidad, e.responsable_id], ["ALL IN ONE FERRETERIA Y SERVICIOS SRL", "133833964", "activo", true, ana]);
  await assert.rejects(v.aceptar({ firmaId: firma, clienteId: c.id, usuarioId: ana, responsableId: ana, empresaId: null }), /ya no se puede aceptar/);
  await v.enviarPendientes({ pedir: vendarioSimulado() });
  const estados = recibidos.slice(-3).map((r) => [r.cuerpo.data.status, r.cuerpo.data.accountant?.name ?? null]);
  assert.deepEqual(estados, [["vista", "Ana Contable"], ["necesita_info", "Ana Contable"], ["aceptada", "Ana Contable"]]);
  assert.deepEqual(recibidos.at(-2).cuerpo.data.requested, ["estado_cuenta_banco"]);
});

test("eventos: venta, anulación con reverses, devolución, gasto y cierre de caja; hueco en seq", conBase, async () => {
  const venta = VENTA(2);
  const anulacion = sobre("accounting.event", { ...VENTA(0).data, event_type: "sale.voided", reverses: venta.id }, 3);
  const devolucion = sobre("accounting.event", { ...VENTA(0).data, event_type: "sale.returned", fiscal: { ncf: "B0400000003", ncf_type: "04", modified_ncf: "B0100000045" } }, 4);
  const gasto = sobre("accounting.event", { event_type: "expense.posted", date: "2026-11-13", category: { name: "Luz", dgii_606_type: "02" },
    fiscal: { ncf: "B0100000099", ncf_type: "01", modified_ncf: null }, amounts: { subtotal: "500.00", discount: "0.00", taxes: [], total: "590.00" }, entry: [] }, 6);
  const caja = sobre("accounting.event", { event_type: "cash.closed", date: "2026-11-13", amounts: { subtotal: "10.00", discount: "0.00", taxes: [], total: "10.00" },
    entry: [{ account: "FALTANTE_CAJA", debit: "10.00", credit: "0.00" }, { account: "CAJA", debit: "0.00", credit: "10.00" }] }, 7);
  for (const e of [venta, anulacion, devolucion, gasto, caja]) await recibir(e);
  const filas = await sql`SELECT tipo, revierte FROM vendario_eventos WHERE vendario_cliente_id = ${(await cliente()).id} ORDER BY seq`;
  assert.deepEqual(filas.map((f) => f.tipo), ["sale.posted", "sale.posted", "sale.voided", "sale.returned", "expense.posted", "cash.closed"]);
  assert.equal(filas[2].revierte, venta.id);
  // Falta el 5: la secuencia tiene un hueco (la pantalla lo muestra).
  const huecos = await sql`SELECT seq + 1 AS falta FROM (SELECT seq, lead(seq) OVER (ORDER BY seq) AS sig FROM vendario_eventos
                           WHERE vendario_cliente_id = ${(await cliente()).id}) x WHERE sig > seq + 1`;
  assert.deepEqual(huecos.map((h) => Number(h.falta)), [5]);
});

test("envío que falla: reintenta con espera; un 422 no se reintenta", conBase, async () => {
  const c = await cliente();
  await v.cambiarEstado({ firmaId: firma, clienteId: c.id, usuarioId: ana, estado: "en_proceso", periodo: "2026-10" });
  let r = await v.enviarPendientes({ pedir: vendarioSimulado([500]) });
  assert.deepEqual(r, { enviados: 0, fallidos: 1 });
  const [s] = await sql`SELECT estado, intentos, proximo_intento > now() + interval '50 seconds' AS espera FROM vendario_envios WHERE estado_servicio = 'en_proceso' AND vendario_cliente_id = ${c.id}`;
  assert.deepEqual([s.estado, s.intentos, s.espera], ["pendiente", 1, true]);
  await v.cambiarEstado({ firmaId: firma, clienteId: c.id, usuarioId: ana, estado: "al_dia", periodo: "2026-10" });
  r = await v.enviarPendientes({ pedir: vendarioSimulado([422]) });
  const [a] = await sql`SELECT estado FROM vendario_envios WHERE estado_servicio = 'al_dia' AND vendario_cliente_id = ${c.id}`;
  assert.equal(a.estado, "rechazado");
  assert.equal((await cliente()).al_dia_hasta, "2026-10");
});

test("baja: manda «finalizada» y lo que llega después no se contabiliza", conBase, async () => {
  await recibir(sobre("client.unenroll", { reason: "autorizacion_retirada", at: "2026-11-14T10:00:00Z" }));
  const c = await cliente();
  assert.equal(c.estado, "finalizada");
  const tarde = VENTA(8);
  tarde.data.occurred_at = "2026-11-15T10:00:00Z";
  await recibir(tarde);
  const [x] = await sql`SELECT estado FROM vendario_eventos WHERE id = ${tarde.id}`;
  assert.equal(x.estado, "despues_de_baja");
  await assert.rejects(v.cambiarEstado({ firmaId: firma, clienteId: c.id, usuarioId: ana, estado: "en_proceso", periodo: "2026-11" }), /terminó/);
  await v.enviarPendientes({ pedir: vendarioSimulado() });
  assert.equal(recibidos.at(-1).cuerpo.data.status, "finalizada");
});
