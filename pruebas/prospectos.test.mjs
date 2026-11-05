// Bloque 8, entrega 8a: la aplicación del cliente. Lo que escribe el prospecto en la página pública, el límite de registros y
// «Pasar a cliente» (la misma cuenta pasa del rol de prospecto al de cliente con aplicación). Crea su propia firma y la borra.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { resumenLista } from "../lib/lista-maestra.ts";
import { altaPermitida, leerAlta, LIMITE_POR_CORREO, pasarACliente, ROL_CLIENTE_APP, ROL_PROSPECTO } from "../lib/prospectos.ts";

const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

test("la página pública pide nombre, correo, teléfono y el permiso para guardar los datos", () => {
  const base = { nombre: "Ana Pérez", email: "Ana@Correo.do", telefono: "809-555-1234", acepto: "on" };
  assert.match(leerAlta(fd({ ...base, nombre: "" })), /nombre/);
  assert.match(leerAlta(fd({ ...base, email: "ana" })), /correo/);
  assert.match(leerAlta(fd({ ...base, telefono: "5551234" })), /teléfono/);
  assert.match(leerAlta(fd({ ...base, identificacion: "1234" })), /9 dígitos/);
  assert.match(leerAlta(fd({ ...base, acepto: "" })), /acepta/);
  const r = leerAlta(fd({ ...base, identificacion: "001-1234567-8" }));
  assert.deepEqual(r, { nombre: "Ana Pérez", email: "ana@correo.do", telefono: "8095551234", negocio: "Ana Pérez", identificacion: "00112345678", tipo: "cedula" },
    "sin negocio se usa su nombre; el correo en minúsculas");
});

test("la lista maestra cuenta los prospectos aparte", () => {
  const c = (estado_cliente) => ({ propia: false, activa: true, nombre: "X", rnc: null, responsable_id: null, categoria: null, tipo_cliente: null,
    estado_cliente, modalidad: null, fecha_inicio_contrato: null, formalizado: false, creada: "2026-11-05" });
  assert.deepEqual(resumenLista([c("activo"), c("prospecto"), c("prospecto")], "2026-11-05"),
    { activos: 1, nuevos: 1, retiradosOEnCero: 0, noFormalizados: 1, prospectos: 2 });
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa;

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-prospecto-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma prospectos ${marca}`}) RETURNING id`;
  await sql`SELECT crear_perfiles_firma(${firma})`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (nombre, firma_id, estado_cliente, alta_app) VALUES ('Colmado Ana', ${firma}, 'prospecto', now()) RETURNING id`;
  await sql`INSERT INTO miembros_firma (firma_id, usuario_id) VALUES (${firma}, ${ana})`;
  await sql`INSERT INTO miembros (empresa_id, usuario_id, perfil_id)
            VALUES (${empresa}, ${ana}, (SELECT id FROM perfiles WHERE firma_id = ${firma} AND nombre = ${ROL_PROSPECTO}))`;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM altas_prospecto WHERE firma_id = ${firma}`;
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("los roles nuevos existen: el prospecto y el cliente con aplicación ven su inicio, sus solicitudes y sus documentos", conBase, async () => {
  const roles = await sql`SELECT nombre, permisos, pestanas, para_clientes FROM perfiles WHERE firma_id = ${firma} AND nombre IN (${ROL_PROSPECTO}, ${ROL_CLIENTE_APP}) ORDER BY nombre`;
  assert.equal(roles.length, 2);
  for (const r of roles) {
    assert.equal(r.para_clientes, true);
    assert.deepEqual(r.pestanas, ["", "/solicitudes", "/recepcion"]);
    assert.ok(!r.permisos.includes("registrar"), "no registran nada contable");
  }
});

test("límite de registros por correo en una hora", conBase, async () => {
  const email = `nuevo-${marca}@x.do`;
  assert.equal(await altaPermitida(sql, email, "10.0.0.1"), true);
  for (let i = 0; i < LIMITE_POR_CORREO; i++) await sql`INSERT INTO altas_prospecto (firma_id, email, ip) VALUES (${firma}, ${email}, ${`10.0.0.${i + 2}`})`;
  assert.equal(await altaPermitida(sql, email, "10.0.0.9"), false);
});

test("pasar a cliente: la misma cuenta toma el rol de cliente con aplicación y la ficha queda activa", conBase, async () => {
  const r = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
    return pasarACliente(tx, empresa, "2026-11-05");
  });
  assert.deepEqual(r.personas.map((p) => p.nombre), ["Ana"]);
  const [e] = await sql`SELECT estado_cliente, to_char(contrato_firmado, 'YYYY-MM-DD') AS contrato, paso_a_cliente IS NOT NULL AS paso FROM empresas WHERE id = ${empresa}`;
  assert.deepEqual({ ...e }, { estado_cliente: "activo", contrato: "2026-11-05", paso: true });
  const [m] = await sql`SELECT p.nombre FROM miembros m JOIN perfiles p ON p.id = m.perfil_id WHERE m.empresa_id = ${empresa} AND m.usuario_id = ${ana}`;
  assert.equal(m.nombre, ROL_CLIENTE_APP);
  await assert.rejects(sql.begin((tx) => pasarACliente(tx, empresa, "2026-11-05")), /ya es cliente/);
});
