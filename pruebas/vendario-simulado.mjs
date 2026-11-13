// Prueba de punta a punta con un Vendario simulado (acuerdo docs/vendario/acuerdo.md). Firma igual que el real
// (supabase/functions/_shared/hmac.ts, con WebCrypto) y recibe los estados en su propio «empire-inbox», que verifica la firma de Empire.
// Uso: con Empire corriendo con V2E_SECRET, E2V_SECRET y VENDARIO_URL=http://localhost:3999 (en .env.local):
//   node --env-file=.env.local pruebas/vendario-simulado.mjs http://localhost:3100
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const EMPIRE = (process.argv[2] ?? "http://localhost:3100").replace(/\/+$/, "");
const V2E = process.env.V2E_SECRET.split(",")[0].trim();
const E2V = process.env.E2V_SECRET.split(",")[0].trim();
const enc = new TextEncoder();

// ── Igual que hmac.ts de Vendario ──
async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))), (b) => b.toString(16).padStart(2, "0")).join("");
}
const signBody = async (secret, body, now = Math.floor(Date.now() / 1000)) => `t=${now},v1=${await hmacHex(secret, `${now}.${body}`)}`;
async function verifySignature(header, body, secrets, toleranceSec = 300, now = Math.floor(Date.now() / 1000)) {
  if (!header || !secrets.length) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => (v ?? "").toLowerCase());
  if (!Number.isFinite(t) || Math.abs(now - t) > toleranceSec || !sigs.length) return false;
  for (const s of secrets) if (sigs.includes(await hmacHex(s, `${t}.${body}`))) return true;
  return false;
}

// ── empire-inbox simulado ──
const estados = [];
const servidor = createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const ok = req.url === "/empire-inbox" && (await verifySignature(req.headers["x-signature"], body, [E2V]));
  if (ok) estados.push(JSON.parse(body));
  res.writeHead(ok ? 200 : 401, { "content-type": "application/json" }).end(JSON.stringify(ok ? { ok: true } : { error: "INVALID_SIGNATURE" }));
});
await new Promise((r) => servidor.listen(3999, r));

// ── Mandar a Empire ──
const ORG = randomUUID();
const RNC = "1" + String(Date.now()).slice(-8);
let seq = 0;
const sobre = (type, data, conSeq = false) => ({ version: "1.0", id: randomUUID(), type, created_at: new Date().toISOString(), org: { vendario_id: ORG, rnc: RNC }, seq: conSeq ? ++seq : null, data });
async function mandar(s, { firma, cuerpo } = {}) {
  const body = cuerpo ?? JSON.stringify(s);
  const r = await fetch(`${EMPIRE}/api/vendario/v1/inbox`, { method: "POST", headers: { "Content-Type": "application/json", "X-Signature": firma ?? (await signBody(V2E, body)) }, body });
  return { codigo: r.status, json: await r.json().catch(() => null) };
}
const esperarEstado = async (status, ms = 20_000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const e = estados.find((x) => x.data.status === status);
    if (e) return e;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No llegó «${status}» a Vendario`);
};

const ALTA = sobre("client.enroll", {
  services: ["registro_contable", "itbis_606_607_608"], start_date: "2026-10-01", history: { from: "2026-10-01", to: "2026-11-13" },
  company: { rnc: RNC, legal_name: "FERRETERIA SIMULADA SRL", trade_name: "Ferretería Simulada", address: "Calle de prueba", phone: "809-000-0000", rnc_status: "ACTIVO", no_fiscal: false },
  contact: { name: "Dueño Simulado", email: "dueno@simulado.test", phone: "809-111-1111" },
  authorization: { by_name: "Dueño Simulado", by_email: "dueno@simulado.test", at: new Date().toISOString(), text_version: "2026-11-13" },
});

const pasos = [];
const paso = async (nombre, fn) => { await fn(); pasos.push(nombre); console.log("✔", nombre); };
try {
  await paso("alta → 202 y Vendario recibe «recibida» firmada", async () => {
    const r = await mandar(ALTA);
    assert.equal(r.codigo, 202);
    const e = await esperarEstado("recibida");
    assert.deepEqual([e.type, e.org.vendario_id, e.org.rnc, e.version], ["service.status", ORG, RNC, "1.0"]);
  });
  await paso("alta repetida → 200 {duplicate: true}", async () => {
    const r = await mandar(ALTA);
    assert.deepEqual([r.codigo, r.json], [200, { duplicate: true }]);
  });
  await paso("firma inválida → 401", async () => {
    assert.equal((await mandar(sobre("client.update", {}), { firma: await signBody("otra-clave", "{}") })).codigo, 401);
  });
  await paso("hora vencida (6 minutos) → 401", async () => {
    const s = sobre("client.update", {});
    const body = JSON.stringify(s);
    const r = await mandar(s, { cuerpo: body, firma: await signBody(V2E, body, Math.floor(Date.now() / 1000) - 360) });
    assert.deepEqual([r.codigo, r.json.error], [401, "EXPIRED_SIGNATURE"]);
  });
  await paso("JSON inválido y tipo desconocido → 422", async () => {
    assert.deepEqual((await mandar(null, { cuerpo: "{roto" })).json, { error: "INVALID_JSON" });
    const r = await mandar(sobre("client.otro", {}));
    assert.deepEqual([r.codigo, r.json.error], [422, "UNKNOWN_TYPE"]);
  });
  await paso("venta antes de aceptar → 202 (queda guardada)", async () => {
    const r = await mandar(sobre("accounting.event", {
      event_type: "sale.posted", reverses: null, historical: true, date: "2026-10-05", occurred_at: "2026-10-05T14:00:00Z",
      fiscal: { ncf: "B0100000045", ncf_type: "01", modified_ncf: null }, party: null,
      amounts: { subtotal: "1000.00", discount: "0.00", taxes: [{ code: "ITBIS18", rate: "18.00", base: "1000.00", tax: "180.00" }], total: "1180.00" },
      payments: [{ kind: "cash", method: "Efectivo", amount: "1180.00", reference: null }], cost_of_sales: "640.00",
      entry: [{ account: "CAJA", debit: "1180.00", credit: "0.00" }, { account: "VENTAS", debit: "0.00", credit: "1000.00" },
        { account: "ITBIS_POR_PAGAR", debit: "0.00", credit: "180.00" }, { account: "COSTO_VENTAS", debit: "640.00", credit: "0.00" },
        { account: "INVENTARIO", debit: "0.00", credit: "640.00" }],
    }, true));
    assert.equal(r.codigo, 202);
  });
  await paso("fin del histórico → 202", async () => {
    assert.equal((await mandar(sobre("sync.history_complete", { from: "2026-10-01", to: "2026-11-13", events: 2, totals: { "sale.posted": { count: 2, total: "2360.00" } } }))).codigo, 202);
  });
  console.log(`\nListo: ${pasos.length} pasos. Organización simulada ${ORG} (RNC ${RNC}). Ábrela en Firma › Vendario para aceptarla;`);
  console.log("este proceso sigue escuchando 3 minutos en el puerto 3999 para recibir «vista», «aceptada» y los demás estados.");
  const hasta = Date.now() + 300_000;
  let vistos = estados.length, enVivo = false;
  while (Date.now() < hasta) {
    await new Promise((r) => setTimeout(r, 1000));
    for (const e of estados.slice(vistos)) console.log("← Vendario recibió:", e.data.status, e.data.accountant?.name ?? "", e.data.period ?? "", e.data.note ?? "");
    vistos = estados.length;
    // Como Vendario: al recibir «aceptada», manda las operaciones en vivo.
    if (!enVivo && estados.some((e) => e.data.status === "aceptada")) {
      enVivo = true;
      const vivos = [
        sobre("accounting.event", { event_type: "sale.posted", source: { kind: "sale", id: randomUUID(), number: "V-00000200" }, reverses: null, historical: false,
          date: "2026-11-13", occurred_at: new Date().toISOString(), fiscal: { ncf: `B01${String(Date.now()).slice(-8)}`, ncf_type: "01", modified_ncf: null },
          party: { kind: "customer", doc_type: "RNC", doc: "101234567", name: "Constructora X" },
          amounts: { subtotal: "2000.00", discount: "0.00", taxes: [{ code: "ITBIS18", rate: "18.00", base: "2000.00", tax: "360.00" }], total: "2360.00" },
          payments: [{ kind: "transfer", method: "Transferencia", amount: "2360.00", reference: "TRF-1" }], cost_of_sales: "1300.00",
          entry: [{ account: "BANCO", debit: "2360.00", credit: "0.00" }, { account: "VENTAS", debit: "0.00", credit: "2000.00" },
            { account: "ITBIS_POR_PAGAR", debit: "0.00", credit: "360.00" }, { account: "COSTO_VENTAS", debit: "1300.00", credit: "0.00" },
            { account: "INVENTARIO", debit: "0.00", credit: "1300.00" }] }, true),
        sobre("accounting.event", { event_type: "expense.posted", source: { kind: "expense", id: randomUUID(), number: "G-1" }, date: "2026-11-13",
          occurred_at: new Date().toISOString(), description: "Luz", category: { name: "Luz", dgii_606_type: "02" },
          fiscal: { ncf: `B01${String(Date.now() + 1).slice(-8)}`, ncf_type: "01", modified_ncf: null }, party: { kind: "supplier", doc_type: "RNC", doc: "101820217", name: "EDESUR" },
          amounts: { subtotal: "500.00", discount: "0.00", taxes: [{ code: "ITBIS", rate: null, base: "500.00", tax: "90.00" }], total: "590.00" },
          payments: [{ kind: "cash", amount: "590.00" }],
          entry: [{ account: "GASTO:Luz", debit: "500.00", credit: "0.00" }, { account: "ITBIS_ADELANTADO", debit: "90.00", credit: "0.00" }, { account: "CAJA", debit: "0.00", credit: "590.00" }] }, true),
        sobre("accounting.event", { event_type: "cash.closed", source: { kind: "cash_session", id: randomUUID() }, date: "2026-11-13", occurred_at: new Date().toISOString(),
          amounts: { subtotal: "25.00", discount: "0.00", taxes: [], total: "25.00" },
          entry: [{ account: "FALTANTE_CAJA", debit: "25.00", credit: "0.00" }, { account: "CAJA", debit: "0.00", credit: "25.00" }] }, true),
      ];
      for (const s of vivos) console.log("→ En vivo:", s.data.event_type, (await mandar(s)).codigo);
    }
  }
} catch (e) {
  console.error("✖", e.message);
  process.exitCode = 1;
} finally {
  servidor.close();
}
