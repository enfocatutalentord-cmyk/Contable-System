// Prioridad 2.2 (P2c.3): padrón de contribuyentes de la DGII. Lector del archivo (separador, codificación de columnas por su forma, fechas, comillas)
// y carga por tandas con la consulta por RNC o cédula. Los RNC de estas pruebas son inventados.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { detectarSeparador, leerBloquePadron, leerFechaPadron, leerLineaPadron } from "../lib/padron.ts";

test("la fecha del padrón acepta dd/mm/aaaa y aaaa-mm-dd y rechaza las que no existen", () => {
  assert.equal(leerFechaPadron("20/12/1930"), "1930-12-20");
  assert.equal(leerFechaPadron("1/3/2020"), "2020-03-01");
  assert.equal(leerFechaPadron("2024-02-29"), "2024-02-29");
  assert.equal(leerFechaPadron("31/02/2020"), null);
  assert.equal(leerFechaPadron("ACTIVO"), null);
});

test("una línea con barras verticales se lee por la forma de cada campo", () => {
  const f = leerLineaPadron("101000001|EMPRESA DE PRUEBA, S. A.|PRUEBA|VENTA DE COSAS AL POR MENOR|||||20/12/1980|ACTIVO|NORMAL", "|");
  assert.deepEqual(f, {
    rnc: "101000001", nombre: "EMPRESA DE PRUEBA, S. A.", nombre_comercial: "PRUEBA", actividad: "VENTA DE COSAS AL POR MENOR",
    fecha_inicio: "1980-12-20", estado: "ACTIVO", regimen: "NORMAL",
  });
});

test("con un solo texto después del nombre se toma como actividad y sin estado ni fecha queda vacío", () => {
  const f = leerLineaPadron("40200000012|JUAN PÉREZ DE PRUEBA|SERVICIOS PERSONALES", "|");
  assert.equal(f.rnc, "40200000012");
  assert.equal(f.nombre_comercial, null);
  assert.equal(f.actividad, "SERVICIOS PERSONALES");
  assert.equal(f.estado, null);
  assert.equal(f.fecha_inicio, null);
});

test("lo que no empieza con un RNC de 9 u 11 dígitos no cuenta: encabezado, líneas vacías y basura", () => {
  assert.equal(leerLineaPadron("RNC|RAZON SOCIAL|ACTIVIDAD", "|"), null);
  assert.equal(leerLineaPadron("12345|CORTO|X", "|"), null);
  assert.equal(leerLineaPadron("101000001||||", "|"), null, "sin nombre no sirve");
  assert.equal(leerLineaPadron("101-00000-1|CON GUIONES|X", "|").rnc, "101000001");
});

test("el separador se detecta y el CSV respeta las comillas", () => {
  assert.equal(detectarSeparador(["a|b|c", "d|e|f"]), "|");
  assert.equal(detectarSeparador(["a;b;c"]), ";");
  assert.equal(detectarSeparador(["a,b,c"]), ",");
  const f = leerLineaPadron('101000002,"EMPRESA, S. A.",COMERCIO,01/02/2000,ACTIVO,RST', ",");
  assert.equal(f.nombre, "EMPRESA, S. A.");
  assert.equal(f.estado, "ACTIVO");
  assert.equal(f.regimen, "RST");
  assert.equal(f.fecha_inicio, "2000-02-01");
});

test("un bloque cuenta las rechazadas, repite el mismo RNC una sola vez (gana el último) y acepta CRLF", () => {
  const r = leerBloquePadron("RNC|NOMBRE\r\n101000001|PRIMERO|X\r\n\r\n101000001|SEGUNDO|X\r\nbasura sin forma\r\n101000003|TERCERO|X");
  assert.equal(r.separador, "|");
  assert.equal(r.filas.length, 2);
  assert.equal(r.filas.find((f) => f.rnc === "101000001").nombre, "SEGUNDO");
  assert.equal(r.rechazadas, 2, "el encabezado y la línea sin forma");
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
let ana, db;

before(async () => {
  if (!sql) return;
  process.env.DATABASE_URL = url;
  db = await import("../lib/padron-db.ts");
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-padron-${Date.now()}@x.do`}, 'Ana', 'x') RETURNING id`;
  await sql`DELETE FROM padron_dgii`;
  await sql`DELETE FROM padron_cargas`;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM padron_dgii`;
    await sql`DELETE FROM padron_cargas`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
    const { db: conexion } = await import("../lib/db.ts");
    await conexion().end();
  }
});

test("sin padrón cargado la búsqueda lo dice; con RNC mal escrito, también", conBase, async () => {
  assert.deepEqual(await db.buscarRnc("101000001"), { tipo: "sin_padron" });
  assert.deepEqual(await db.buscarRnc("12"), { tipo: "invalido" });
  assert.deepEqual(await db.buscarRnc(""), { tipo: "invalido" });
});

test("la carga por tandas guarda y se busca por RNC o cédula", conBase, async () => {
  const id = await db.iniciarCarga({ id: ana, nombre: "Ana" }, "DGII_RNC.zip");
  const a = await db.cargarTanda(id, "101000001|EMPRESA UNO, S. A.|UNO|COMERCIO|||20/12/1980|ACTIVO|NORMAL\n40200000012|JUAN DE PRUEBA|SERVICIOS\nsin forma");
  assert.deepEqual(a, { filas: 2, rechazadas: 1 });
  await db.cargarTanda(id, "101000003|EMPRESA TRES|TRES|OTRA ACTIVIDAD||15/06/1999|SUSPENDIDO|RST");
  const c = await db.terminarCarga(id);
  assert.equal(c.estado, "completa");
  assert.equal(c.filas, 3);
  assert.equal(c.rechazadas, 1);

  const uno = await db.buscarRnc("101-00000-1");
  assert.equal(uno.tipo, "encontrado");
  assert.equal(uno.datos.nombre, "EMPRESA UNO, S. A.");
  assert.equal(uno.datos.estado, "ACTIVO");
  assert.equal(uno.datos.fecha_inicio, "1980-12-20");
  assert.equal((await db.buscarRnc("40200000012")).datos.nombre, "JUAN DE PRUEBA");
  assert.equal((await db.buscarRnc("101000003")).datos.estado, "SUSPENDIDO");
  assert.equal((await db.buscarRnc("101000009")).tipo, "no_esta");

  const est = await db.estadoPadron();
  assert.equal(est.filas, 3);
  assert.equal(est.dias, 0);
});

test("una carga nueva pone al día los cambios y no se puede seguir en una ya terminada", conBase, async () => {
  const id = await db.iniciarCarga({ id: ana, nombre: "Ana" }, "DGII_RNC.zip");
  await db.cargarTanda(id, "101000001|EMPRESA UNO CAMBIÓ NOMBRE|UNO|COMERCIO|||20/12/1980|ACTIVO|NORMAL");
  await db.terminarCarga(id);
  assert.equal((await db.buscarRnc("101000001")).datos.nombre, "EMPRESA UNO CAMBIÓ NOMBRE");
  assert.equal((await db.buscarRnc("101000003")).tipo, "encontrado", "lo que no vino en el archivo nuevo no se borra");
  await assert.rejects(() => db.cargarTanda(id, "101000004|OTRA|X"), /ya terminó/);
});

test("un archivo sin ninguna línea válida deja la carga cortada y no cuenta como la última completa", conBase, async () => {
  const antes = await db.estadoPadron();
  const id = await db.iniciarCarga({ id: ana, nombre: "Ana" }, "basura.txt");
  await db.cargarTanda(id, "esto no es\nun padrón");
  const c = await db.terminarCarga(id);
  assert.equal(c.estado, "fallida");
  assert.match(c.nota, /ninguna línea/);
  assert.equal((await db.estadoPadron()).filas, antes.filas);
});

test("una carga cortada por el navegador queda marcada y se ve en el historial", conBase, async () => {
  const id = await db.iniciarCarga({ id: ana, nombre: "Ana" }, "cortada.zip");
  await db.fallarCarga(id, "Se fue el internet.");
  const ultimas = await db.ultimasCargas(10);
  const c = ultimas.find((x) => x.id === id);
  assert.equal(c.estado, "fallida");
  assert.equal(c.nota, "Se fue el internet.");
});

test("la aplicación no puede leer ni escribir el padrón con su rol", conBase, async () => {
  await assert.rejects(() => sql.begin(async (tx) => { await tx`SET LOCAL ROLE contable_app`; await tx`SELECT 1 FROM padron_dgii LIMIT 1`; }), /permission denied/);
});
