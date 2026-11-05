// Bloque 2, entrega 2a: Lista de Precios (EMP-P01). Precios por categoría con vigencia, categoría del cliente desde la ficha
// única y aislamiento por empresa. Crea sus propias firmas y las borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { guardarPrecios, leerPrecios, precioPara, preciosVigentes } from "../lib/precios.ts";

const fd = (campos) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};

test("leer precios del formulario: vacíos no cambian, montos con comas, fecha por defecto hoy", () => {
  assert.deepEqual(leerPrecios(fd({ p_pequena: "22,500", p_grande: "45000.5" }), "2026-11-04"),
    { desde: "2026-11-04", precios: { pequena: "22500.00", grande: "45000.50" } });
  assert.equal(leerPrecios(fd({ vigente_desde: "2027-01-01" }), "2026-11-04").desde, "2027-01-01");
  assert.throws(() => leerPrecios(fd({ p_mediana: "mil" }), "2026-11-04"), /categoría mediana no es válido/);
  assert.throws(() => leerPrecios(fd({ vigente_desde: "01/01/2027" }), "2026-11-04"), /fecha de vigencia/);
});

test("precio para el cliente: el de su categoría o el general", () => {
  const p = { pequena: "22500.00", mediana: "30000.00" };
  assert.deepEqual(precioPara("25000.00", p, "mediana"), { precio: "30000.00", deLista: true });
  assert.deepEqual(precioPara("25000.00", p, "grande"), { precio: "25000.00", deLista: false }, "sin precio para Grande");
  assert.deepEqual(precioPara("25000.00", p, null), { precio: "25000.00", deLista: false }, "cliente sin categoría");
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, propia, cliente, servicio, impuesto;

const leer = (id, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-precios-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma precios ${marca}`}) RETURNING id`;
  [{ id: propia }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Empire Precios SRL', '133097346', ${firma}) RETURNING id`;
  [{ id: cliente }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id, categoria) VALUES ('Ferretería Precios', '130000031', ${firma}, 'mediana') RETURNING id`;
  await sql`UPDATE firmas SET empresa_propia_id = ${propia} WHERE id = ${firma}`;
  [{ id: impuesto }] = await leer(propia, (tx) => tx`INSERT INTO impuestos (empresa_id, nombre, tipo, tasa) VALUES (${propia}, 'Exento', 'exento', 0) RETURNING id`);
  [{ id: servicio }] = await leer(propia, (tx) => tx`
    INSERT INTO servicios (empresa_id, nombre, precio, impuesto_id, codigo, grupo) VALUES (${propia}, 'Constitución de empresa', 25000, ${impuesto}, 'OT-01', 'otros') RETURNING id`);
});

after(async () => {
  if (!sql) return;
  try {
    await sql`UPDATE firmas SET empresa_propia_id = NULL WHERE id = ${firma}`;
    await sql`DELETE FROM empresas WHERE id = ${propia}`;
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("precios por categoría con vigencia: lo de antes no cambia, lo mismo no se repite", conBase, async () => {
  const guardar = (campos, hoy) => leer(propia, (tx) => guardarPrecios(tx, propia, servicio, leerPrecios(fd(campos), hoy)));
  assert.equal(await guardar({ p_pequena: "22500", p_mediana: "30000" }, "2026-11-01"), 2);
  assert.equal(await guardar({ p_pequena: "22500" }, "2026-11-10"), 0, "el mismo precio no se vuelve a guardar");
  assert.equal(await guardar({ p_pequena: "24750", vigente_desde: "2027-01-01" }, "2026-11-10"), 1);
  const en = (fecha) => leer(propia, async (tx) => (await preciosVigentes(tx, fecha)).get(servicio));
  assert.deepEqual(await en("2026-10-31"), undefined, "antes de la primera vigencia no hay precio de lista");
  assert.deepEqual(await en("2026-12-15"), { pequena: "22500.00", mediana: "30000.00" });
  assert.deepEqual(await en("2027-02-01"), { pequena: "24750.00", mediana: "30000.00" }, "solo cambia Pequeña desde enero");
  const [h] = await sql`SELECT count(*)::int AS n FROM auditoria WHERE empresa_id = ${propia} AND tabla = 'precios_servicio'`;
  assert.equal(h.n, 3, "cada precio queda en el historial");
});

test("aislamiento: otra empresa no ve los precios ni puede ponerle precio a un servicio ajeno", conBase, async () => {
  assert.equal((await leer(cliente, (tx) => tx`SELECT 1 FROM precios_servicio`)).length, 0);
  await assert.rejects(leer(cliente, (tx) => tx`
    INSERT INTO precios_servicio (empresa_id, servicio_id, categoria, precio, vigente_desde) VALUES (${cliente}, ${servicio}, 'grande', 1, '2026-11-01')`),
  /no es de esta empresa/);
});

test("la categoría del cliente sale de la ficha de su empresa y se pone al día sola", conBase, async () => {
  const categoria = async () => (await leer(propia, (tx) => tx`SELECT categoria FROM clientes WHERE empresa_vinculada_id = ${cliente}`))[0].categoria;
  assert.equal(await categoria(), "mediana");
  await leer(cliente, (tx) => tx`UPDATE empresas SET categoria = 'grande' WHERE id = ${cliente}`);
  assert.equal(await categoria(), "grande");
});
