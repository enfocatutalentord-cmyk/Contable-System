// Rediseño R1 y R2 (Lista de rediseños de Patricia, 6-nov-2026): lo que solo es de Contabilidad Empire no se ve en un cliente, los
// mensajes de cobro se separan y las tareas de igualas y cobros pasan a Contabilidad Empire.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { esPrime } from "../lib/ficha.ts";
import { esDeCobro } from "../lib/mensajes.ts";
import { PESTANAS_CONTABLES, pestanasEn, PESTANAS_SOLO_PROPIA, TODAS_LAS_PESTANAS } from "../lib/pestanas.ts";

test("igualas, recurrentes, propuestas y lo de la socia solo en la empresa propia", () => {
  const enCliente = pestanasEn(null, false);
  for (const r of PESTANAS_SOLO_PROPIA) assert.ok(!enCliente.includes(r), r);
  assert.ok(enCliente.includes("/facturas"));
  for (const r of PESTANAS_CONTABLES) assert.ok(!enCliente.includes(r), `${r}: a los clientes no se les lleva contabilidad (R3)`);
  assert.equal(enCliente.length, TODAS_LAS_PESTANAS.length - PESTANAS_SOLO_PROPIA.length - PESTANAS_CONTABLES.length);
  const conContabilidad = pestanasEn(null, false, true);
  for (const r of PESTANAS_CONTABLES) assert.ok(conContabilidad.includes(r), `${r} con «lleva contabilidad»`);
  assert.ok(!conContabilidad.includes("/igualas"));
  assert.equal(pestanasEn(null, true), null, "en la propia, el administrador ve todo");
  assert.deepEqual(pestanasEn(["", "/igualas", "/facturas"], false), ["", "/facturas"]);
  assert.deepEqual(pestanasEn(["", "/igualas"], true), ["", "/igualas"]);
});

test("mensajes de cobro y clientes Prime", () => {
  for (const c of ["cobro_iguala", "envio_factura", "pago_atrasado", "pago_recibido", "cuenta_bancaria", "correo_factura"]) assert.ok(esDeCobro(c), c);
  for (const c of ["bienvenida", "constancia", "reporte_mensual", "ajuste_iguala"]) assert.ok(!esDeCobro(c), c);
  assert.equal(esPrime("sistema_propio"), true);
  assert.equal(esPrime("independiente"), true);
  assert.equal(esPrime("aplicacion"), false);
  assert.equal(esPrime(null), false);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
let firma;

before(async () => {
  if (!sql) return;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma rediseño ${Date.now()}`}) RETURNING id`;
  await sql`SELECT crear_perfiles_firma(${firma})`;
});

after(async () => {
  if (!sql) return;
  try { if (firma) await sql`DELETE FROM firmas WHERE id = ${firma}`; } finally { await sql.end(); }
});

test("los roles de clientes solo ven la aplicación", conBase, async () => {
  const roles = await sql`SELECT nombre, pestanas FROM perfiles WHERE firma_id = ${firma} AND para_clientes ORDER BY nombre`;
  assert.ok(roles.length >= 4);
  for (const r of roles.filter((r) => r.nombre !== "Cliente · Factura")) {
    assert.ok(r.pestanas.every((p) => ["", "/facturas-subidas", "/solicitudes", "/recepcion"].includes(p)), `${r.nombre}: ${r.pestanas}`);
  }
  // E3a: el rol que factura suma sus facturas, clientes, productos y su certificado; nada de compras, impuestos ni contabilidad.
  const factura = roles.find((r) => r.nombre === "Cliente · Factura");
  assert.deepEqual([...factura.pestanas].sort(), ["", "/certificado", "/clientes", "/facturas", "/facturas-subidas", "/recepcion", "/servicios", "/solicitudes"]);
});

test("una firma nueva tiene las tareas de igualas y cobros en Contabilidad Empire", conBase, async () => {
  await sql`SELECT crear_plantillas_tarea(${firma})`;
  const filas = await sql`SELECT titulo, seccion FROM plantillas_tarea WHERE firma_id = ${firma} ORDER BY orden`;
  assert.equal(filas.length, 10);
  const empire = filas.filter((f) => f.seccion === "empire").map((f) => f.titulo);
  assert.equal(empire.length, 3);
  assert.ok(empire.every((t) => /iguala/i.test(t)));
});
