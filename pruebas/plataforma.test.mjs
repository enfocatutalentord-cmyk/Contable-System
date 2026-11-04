// Consola de la plataforma (entrega 1): dueñas por correo, conteos por firma sin datos contables, registro que no se
// cambia ni se borra. Crea su propia firma y la borra al final (el registro de prueba queda, como cualquier registro).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { contactoPlataforma, detalleFirma, esDuenaPlataforma, firmasPlataforma, registrar, registroPlataforma } from "../lib/plataforma.ts";

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, luis, firma;

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-plat-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: luis }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`luis-plat-${marca}@x.do`}, 'Luis', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre, rnc) VALUES (${`Firma plataforma ${marca}`}, '130000011') RETURNING id`;
  await sql`INSERT INTO miembros_firma (firma_id, usuario_id, administrador) VALUES (${firma}, ${ana}, true), (${firma}, ${luis}, false)`;
  await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Cliente A SRL', '130000012', ${firma}), ('Cliente B SRL', null, ${firma})`;
  await sql`INSERT INTO sesiones (token_hash, usuario_id, expira, creada) VALUES (${`plat-${marca}`}, ${luis}, now() + interval '1 day', '2026-11-01T10:00:00Z')`;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id IN (${ana}, ${luis})`;
  } finally {
    await sql.end();
    await globalThis._sql?.end(); // la conexión que abre lib/db.ts para la consola
  }
});

test("dueñas de la plataforma por correo, sin importar mayúsculas; el contacto es su correo", conBase, async () => {
  assert.equal(await esDuenaPlataforma("patriciapm2312@gmail.com"), true);
  assert.equal(await esDuenaPlataforma("PatriciaPM2312@gmail.com"), true);
  assert.equal(await esDuenaPlataforma(`ana-plat-${marca}@x.do`), false);
  assert.equal(await contactoPlataforma(), "patriciapm2312@gmail.com");
});

test("lista de firmas: clientes, personas, última entrada y estado; detalle con administradores y clientes", conBase, async () => {
  const f = (await firmasPlataforma()).find((x) => x.id === firma);
  assert.equal(f.clientes, 2);
  assert.equal(f.personas, 2);
  assert.equal(f.ultima_entrada.toISOString(), "2026-11-01T10:00:00.000Z");
  assert.equal(f.suspendida_en, null);
  const d = await detalleFirma(firma);
  assert.deepEqual(d.administradores.map((a) => a.nombre), ["Ana"], "solo los administradores");
  assert.deepEqual(d.clientes.map((c) => c.nombre), ["Cliente A SRL", "Cliente B SRL"]);
  assert.equal(await detalleFirma("00000000-0000-0000-0000-000000000000"), null);
});

test("suspensión y registro: se guarda quién, qué y por qué; el registro no se cambia ni se borra", conBase, async () => {
  const yo = { id: ana, nombre: "Ana", email: `ana-plat-${marca}@x.do`, dosPasos: true };
  await sql`UPDATE firmas SET suspendida_en = now(), suspendida_motivo = 'Prueba', suspendida_por = ${ana} WHERE id = ${firma}`;
  await registrar(yo, { id: firma, nombre: `Firma plataforma ${marca}` }, "suspender", "Falta de pago de prueba");
  assert.ok((await firmasPlataforma()).find((x) => x.id === firma).suspendida_en);
  const [r] = await registroPlataforma(firma);
  assert.equal(r.accion, "suspender");
  assert.equal(r.motivo, "Falta de pago de prueba");
  assert.equal(r.usuario_nombre, "Ana");
  await assert.rejects(sql`UPDATE registro_plataforma SET motivo = 'otro' WHERE id = ${r.id}`, /no se cambia ni se borra/);
  await assert.rejects(sql`DELETE FROM registro_plataforma WHERE id = ${r.id}`, /no se cambia ni se borra/);
  await sql`UPDATE firmas SET suspendida_en = NULL, suspendida_motivo = NULL, suspendida_por = NULL WHERE id = ${firma}`;
});
