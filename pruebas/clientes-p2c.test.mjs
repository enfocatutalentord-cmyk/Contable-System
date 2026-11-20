// Prioridad 2.2 (P2c.1): etiqueta del cliente (Vendario, Aplicación o Manual), tipo de cliente que llega a la facturación de la propia, sin la
// casilla de aprobación de asientos y empresas en constitución con nombre provisional.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { leerFicha } from "../lib/empresas.ts";
import { ORIGENES } from "../lib/ficha.ts";
import { filtrarClientes, leerFiltrosLista } from "../lib/lista-maestra.ts";

const fd = (campos) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};

test("la ficha ya no trae la casilla de aprobación; en constitución el RNC no se guarda y el nombre queda provisional", () => {
  const normal = leerFicha(fd({ nombre: "Ferretería SRL", rnc: "130000021", requiere_aprobacion: "on" }));
  assert.equal(normal.requiere_aprobacion, false, "aunque llegue la casilla, ya no se aplica");
  assert.equal(normal.provisional, false);
  assert.equal(normal.rnc, "130000021");
  const nueva = leerFicha(fd({ nombre: "Panadería (nombre provisional)", rnc: "130000099", en_constitucion: "on" }));
  assert.equal(nueva.provisional, true);
  assert.equal(nueva.rnc, null, "sin RNC hasta que la DGII lo dé");
  assert.match(leerFicha(fd({ nombre: "", en_constitucion: "on" })), /razón social/);
});

test("la etiqueta del cliente se puede filtrar y tiene sus tres nombres", () => {
  assert.deepEqual(ORIGENES, { vendario: "Vendario", aplicacion: "Aplicación", manual: "Manual" });
  const c = (nombre, origen) => ({
    propia: false, activa: true, nombre, rnc: null, responsable_id: null, categoria: null, tipo_cliente: null, estado_cliente: "activo", modalidad: null,
    origen, fecha_inicio_contrato: null, formalizado: false, creada: "2026-01-01",
  });
  const lista = [c("A", "vendario"), c("B", "aplicacion"), c("C", "manual"), c("D", "manual")];
  const f = (sp) => filtrarClientes(lista, leerFiltrosLista(sp)).map((x) => x.nombre);
  assert.deepEqual(f({ origen: "manual" }), ["C", "D"]);
  assert.deepEqual(f({ origen: "vendario" }), ["A"]);
  assert.equal(f({}).length, 4);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, propia, cliente;
const leer = (id, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-p2c-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma p2c ${marca}`}) RETURNING id`;
  [{ id: propia }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Empire P2c SRL', '133097346', ${firma}) RETURNING id`;
  [{ id: cliente }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id, tipo_cliente) VALUES ('Ferretería P2c', '130000041', ${firma}, 'iguala') RETURNING id`;
  await sql`UPDATE firmas SET empresa_propia_id = ${propia} WHERE id = ${firma}`;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`UPDATE firmas SET empresa_propia_id = NULL WHERE id = ${firma}`;
    await sql`DELETE FROM empresas WHERE id = ${propia}`;
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally { await sql.end(); }
});

test("el tipo de cliente de la ficha llega a la facturación de la propia y sigue sus cambios", conBase, async () => {
  const tipo = async () => (await leer(propia, (tx) => tx`SELECT tipo_cliente FROM clientes WHERE empresa_vinculada_id = ${cliente}`))[0].tipo_cliente;
  await sql`SELECT sincronizar_cliente_de_firma(${cliente})`;
  assert.equal(await tipo(), "iguala");
  await leer(cliente, (tx) => tx`UPDATE empresas SET tipo_cliente = 'esporadico' WHERE id = ${cliente}`);
  assert.equal(await tipo(), "esporadico");
  await leer(cliente, (tx) => tx`UPDATE empresas SET tipo_cliente = NULL WHERE id = ${cliente}`);
  assert.equal(await tipo(), null);
});

test("empresa en constitución: nombre provisional; al guardar el RNC deja de serlo", conBase, async () => {
  const [{ id }] = await sql`INSERT INTO empresas (nombre, firma_id, nombre_provisional) VALUES ('Panadería (provisional)', ${firma}, true) RETURNING id`;
  const provisional = async () => (await sql`SELECT nombre_provisional, rnc FROM empresas WHERE id = ${id}`)[0];
  assert.deepEqual({ ...(await provisional()) }, { nombre_provisional: true, rnc: null });
  // Lo que hace «Guardar cambios» de la ficha: con RNC deja de ser provisional; sin RNC, sigue siéndolo.
  const guardar = (rnc) => sql`UPDATE empresas SET rnc = ${rnc}, nombre_provisional = CASE WHEN ${rnc}::text IS NOT NULL THEN false ELSE nombre_provisional END WHERE id = ${id}`;
  await guardar(null);
  assert.equal((await provisional()).nombre_provisional, true);
  await guardar("130000055");
  assert.deepEqual({ ...(await provisional()) }, { nombre_provisional: false, rnc: "130000055" });
});

test("las empresas que tenían la casilla de aprobación ya no la tienen", conBase, async () => {
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM empresas WHERE requiere_aprobacion`;
  assert.equal(n, 0);
});
