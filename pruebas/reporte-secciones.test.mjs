// Prioridad 2.2 (P2e.2): el reporte mensual del día 30 con casillas para elegir qué lleva el PDF, la factura del mes en el mismo documento y el aviso
// de que ya toca. Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { alertasDeEmpresa } from "../lib/alertas.ts";
import { INCLUIR_TODO, leerIncluir, SECCIONES_REPORTE, tablaReporte } from "../lib/reporte-mensual.ts";

const datos = {
  periodo: "202611", mes: "noviembre 2026", empresa: "Cliente SRL",
  servicios: [{ fecha: "2026-11-05", tipo: "Declaración", descripcion: "IT-1 de octubre", estado: "hecha" }],
  ventas: { cantidad: 3, subtotal: "1000.00", itbis: "180.00", total: "1180.00" }, notas: { cantidad: 0, subtotal: "0.00", itbis: "0.00", total: "0.00" },
  compras: { cantidad: 2, subtotal: "500.00", itbis: "90.00", total: "590.00" },
  itbis: { fuente: "calculado", cobrado: "180.00", deducible: "90.00", aPagar: "90.00", saldoFavor: "0.00", vence: "2026-12-20" },
  retenciones: null, declaraciones: [], notificaciones: [], pendientes: ["Falta la factura de luz"],
  cuenta: { saldo: "5310.00", facturas: [
    { ncf: "B0100000001", fecha: "2026-11-02", total: "5310.00", saldo: "5310.00", detalle: "Iguala mensual" },
    { ncf: "B0100000000", fecha: "2026-10-02", total: "2000.00", saldo: "0.00", detalle: "Octubre" },
  ] },
};
const base = { empresa: "Cliente SRL", generado: "2026-11-30" };
const titulos = (t) => t.filas.filter((_, i) => t.negritas.includes(i)).map((f) => f[0]);

test("sin tocar nada el PDF lleva todo y la factura del mes sale aparte", () => {
  const t = titulos(tablaReporte(datos, null, base));
  assert.deepEqual(t, ["1. Servicios realizados en el mes", "2. Facturas del mes", "3. ITBIS", "4. Retenciones e ISR", "5. Declaraciones y notificaciones",
    "6. Pendientes del cliente", "7. Factura del mes", "8. Su cuenta con la firma", "Saldo pendiente"]);
  const tabla = tablaReporte(datos, null, base);
  const aparte = tabla.filas.findIndex((f) => f[0] === "7. Factura del mes");
  assert.equal(tabla.filas[aparte + 1][0], "Factura B0100000001 del 02/11/2026");
  const cuenta = tabla.filas.findIndex((f) => f[0] === "8. Su cuenta con la firma");
  assert.ok(!tabla.filas.slice(cuenta).some((f) => String(f[0]).includes("B0100000001")), "no se repite en la cuenta");
});

test("lo que no se marca no va y las secciones se vuelven a numerar", () => {
  const tabla = tablaReporte(datos, null, base, ["servicios", "itbis", "factura"]);
  assert.deepEqual(tabla.filas.filter((_, i) => tabla.negritas.includes(i)).map((f) => f[0]), ["1. Servicios realizados en el mes", "2. ITBIS", "3. Factura del mes"]);
  assert.ok(!tabla.filas.some((f) => /Pendientes|Falta la factura de luz|Su cuenta/.test(String(f[0]))));
  const sinFactura = tablaReporte(datos, null, base, ["pendientes", "cuenta"]);
  assert.ok(sinFactura.filas.some((f) => String(f[0]).includes("B0100000001")), "sin la casilla de factura, el mes queda en la cuenta");
  assert.ok(!sinFactura.filas.some((f) => f[0] === "Factura del mes"));
});

test("las casillas se leen en orden y se descartan las que no existen", () => {
  const fd = new FormData();
  for (const k of ["cuenta", "servicios", "inventada", "factura"]) fd.append("incluir", k);
  assert.deepEqual(leerIncluir(fd), ["servicios", "cuenta", "factura"]);
  assert.deepEqual(leerIncluir(new FormData()), [], "sin ninguna marcada, el PDF solo lleva el encabezado");
  assert.equal(INCLUIR_TODO.length, Object.keys(SECCIONES_REPORTE).length);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa;
const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-rep-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma reporte ${marca}`}) RETURNING id`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Cliente Reporte', '130000106', ${firma}) RETURNING id`;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally { await sql.end(); }
});

test("un reporte nuevo lleva todas las secciones y se puede cambiar", conBase, async () => {
  const [r] = await leer((tx) => tx`INSERT INTO reportes_mensuales (empresa_id, periodo) VALUES (${empresa}, '202611') RETURNING id, incluir`);
  assert.deepEqual(r.incluir, INCLUIR_TODO);
  await leer((tx) => tx`UPDATE reportes_mensuales SET incluir = ${["servicios", "itbis"]} WHERE id = ${r.id}`);
  assert.deepEqual((await leer((tx) => tx`SELECT incluir FROM reportes_mensuales WHERE id = ${r.id}`))[0].incluir, ["servicios", "itbis"]);
});

test("el aviso del reporte sale dos días antes del 30, es urgente ese día y se va al aprobarlo", conBase, async () => {
  const texto = async (hoy) => (await leer((tx) => alertasDeEmpresa(tx, { empresaId: empresa, hoy, propia: false }))).filter((a) => a.tipo === "reporte");
  assert.equal((await texto("2026-11-27")).length, 0, "todavía falta");
  const a28 = await texto("2026-11-28");
  assert.equal(a28.length, 1);
  assert.equal(a28[0].nivel, "aviso");
  assert.match(a28[0].texto, /Reporte mensual de noviembre: falta aprobarlo y enviarlo \(sale el 30\)/);
  assert.match(a28[0].enlace, /bitacora\/reporte\?mes=2026-11/);
  assert.equal((await texto("2026-11-30"))[0].nivel, "urgente");
  assert.match((await texto("2026-12-29"))[0].texto, /Reporte mensual de diciembre: sin preparar/, "diciembre no tiene reporte aún");
  assert.equal((await texto("2027-02-26"))[0].texto.match(/sale el (\d+)/)[1], "28", "en febrero, el último día");
  await leer((tx) => tx`UPDATE reportes_mensuales SET estado = 'aprobado', aprobado_por = ${ana}, aprobado_en = now(), datos = '{}'::jsonb, huella = 'x' WHERE periodo = '202611'`);
  assert.equal((await texto("2026-11-30")).length, 0, "aprobado: ya no avisa");
});
