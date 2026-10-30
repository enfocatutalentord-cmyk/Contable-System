// Fase 7, parte 1: estado de resultados y estado de situación financiera. Las fechas de las columnas no necesitan base;
// el resto crea su propia firma y la borra.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { insertarAsiento } from "../lib/asientos.ts";
import {
  balanceGeneral, columnasBalance, columnasResultados, estadoResultados, inicioEjercicio, porcentaje, variacion,
} from "../lib/estados.ts";
import { actividadSugerida, cambiosPatrimonio, flujoEfectivo } from "../lib/estados-flujo.ts";

const rangos = (cols) => cols.map((c) => [c.desde, c.hasta]);

test("columnas del estado de resultados: período anterior, año pasado y mes por mes", () => {
  assert.deepEqual(rangos(columnasResultados("2026-10-01", "2026-10-31", "anterior")), [["2026-10-01", "2026-10-31"], ["2026-09-01", "2026-09-30"]]);
  assert.deepEqual(rangos(columnasResultados("2026-01-01", "2026-03-31", "anterior")), [["2026-01-01", "2026-03-31"], ["2025-10-01", "2025-12-31"]]);
  assert.deepEqual(rangos(columnasResultados("2026-10-05", "2026-10-14", "anterior")), [["2026-10-05", "2026-10-14"], ["2026-09-25", "2026-10-04"]]);
  assert.deepEqual(rangos(columnasResultados("2024-02-01", "2024-02-29", "anio")), [["2024-02-01", "2024-02-29"], ["2023-02-01", "2023-02-28"]]);
  const meses = columnasResultados("2026-01-01", "2026-03-31", "meses");
  assert.deepEqual(rangos(meses), [["2026-01-01", "2026-01-31"], ["2026-02-01", "2026-02-28"], ["2026-03-01", "2026-03-31"], ["2026-01-01", "2026-03-31"]]);
  assert.deepEqual(meses.map((c) => c.titulo), ["ene 2026", "feb 2026", "mar 2026", "Total"]);
  assert.equal(columnasResultados("2025-01-01", "2026-06-30", "meses").length, 13, "hasta 12 meses y el total");
});

test("columnas del balance y ejercicio fiscal", () => {
  assert.deepEqual(rangos(columnasBalance("2026-10-31", "anterior", 12)).map((r) => r[1]), ["2026-10-31", "2026-09-30"]);
  assert.deepEqual(rangos(columnasBalance("2026-02-28", "anio", 12)).map((r) => r[1]), ["2026-02-28", "2025-02-28"]);
  assert.deepEqual(rangos(columnasBalance("2026-03-31", "meses", 12)).map((r) => r[1]), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  assert.equal(inicioEjercicio("2026-10-15", 12), "2026-01-01");
  assert.equal(inicioEjercicio("2026-10-15", 6), "2026-07-01");
  assert.equal(inicioEjercicio("2026-03-15", 6), "2025-07-01");
});

test("porcentaje y variación sin decimales flotantes", () => {
  assert.equal(porcentaje(1600000n, 5000000n), "32.0 %");
  assert.equal(porcentaje(1n, 3n), "33.3 %");
  assert.equal(porcentaje(-1n, 3n), "-33.3 %");
  assert.equal(porcentaje(5n, 0n), "");
  assert.deepEqual(variacion([150n, 100n]), { monto: 50n, pct: "50.0 %" });
  assert.deepEqual(variacion([50n, -100n]), { monto: 150n, pct: "150.0 %" });
});

test("actividad sugerida para el flujo de efectivo", () => {
  assert.equal(actividadSugerida("110103", "activo", "Banco cuenta corriente"), "efectivo");
  assert.equal(actividadSugerida("110201", "activo", "Cuentas por cobrar clientes"), "operacion");
  assert.equal(actividadSugerida("120106", "activo", "Depreciación acumulada"), "ajuste");
  assert.equal(actividadSugerida("120105", "activo", "Vehículos"), "inversion");
  assert.equal(actividadSugerida("210401", "pasivo", "Préstamos bancarios a corto plazo"), "financiamiento");
  assert.equal(actividadSugerida("220101", "pasivo", "Préstamos bancarios a largo plazo"), "financiamiento");
  assert.equal(actividadSugerida("310101", "patrimonio", "Capital suscrito y pagado"), "financiamiento");
  assert.equal(actividadSugerida("410101", "ingreso", "Ingresos por servicios"), null);
});

// ───── Con la base ─────

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, empresa, cuentas;
const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));
const asiento = (fecha, debe, haber, monto) => leer((tx) => insertarAsiento(tx, {
  empresaId: empresa, usuarioId: ana, fecha, concepto: `${debe} contra ${haber}`, origen: "manual",
  lineas: [{ cuentaId: cuentas[debe], debe: monto, haber: 0n }, { cuentaId: cuentas[haber], debe: 0n, haber: monto }],
}));

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-ef-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  await sql.begin(async (tx) => {
    const [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma ef ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Estados SRL', '130000005', ${firma}) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    const m = new Map();
    for (const [codigo, n] of CATALOGO_RD) {
      const [c] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${empresa}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${m.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6})
        RETURNING id`;
      m.set(codigo, c.id);
    }
    cuentas = Object.fromEntries(m);
  });
  await asiento("2025-06-01", "110103", "310101", 10000000n); // capital
  await asiento("2025-11-10", "110103", "410101", 500000n);   // ingreso de 2025 (sin cerrar)
  await asiento("2026-03-05", "110103", "410101", 5000000n);  // ventas de 2026
  await asiento("2026-03-06", "510101", "110103", 2000000n);  // costo
  await asiento("2026-03-07", "610214", "110103", 1000000n);  // gasto operacional
  await asiento("2026-03-08", "620101", "110103", 100000n);   // gasto financiero
  await asiento("2026-03-31", "630101", "210205", 300000n);   // ISR
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE nombre = ${`Firma ef ${marca}`}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

const total = (e, texto) => e.filas.find((f) => f.texto === texto)?.valores;

test("estado de resultados de 2026 comparado con 2025", conBase, async () => {
  const e = await leer((tx) => estadoResultados(tx, columnasResultados("2026-01-01", "2026-12-31", "anio"), "cuentas"));
  assert.deepEqual(total(e, "Total ingresos operacionales"), [5000000n, 500000n]);
  assert.deepEqual(total(e, "Utilidad bruta"), [3000000n, 500000n]);
  assert.deepEqual(total(e, "Utilidad en operaciones"), [2000000n, 500000n]);
  assert.deepEqual(total(e, "Utilidad antes del impuesto sobre la renta"), [1900000n, 500000n]);
  assert.deepEqual(total(e, "Utilidad (pérdida) neta del período"), [1600000n, 500000n]);
  assert.deepEqual(e.base, [5000000n, 500000n]);
  assert.ok(e.filas.some((f) => f.tipo === "cuenta" && f.texto.startsWith("620101")), "gasto financiero en su sección");
  const g = await leer((tx) => estadoResultados(tx, columnasResultados("2026-01-01", "2026-12-31", "ninguno"), "grupos"));
  assert.ok(g.filas.filter((f) => f.tipo === "cuenta").every((f) => /^\d{4} /.test(f.texto)), "por subgrupo de 4 dígitos");
});

test("estado de situación financiera: cuadra y separa el resultado del ejercicio del de años anteriores", conBase, async () => {
  const e = await leer((tx) => balanceGeneral(tx, columnasBalance("2026-12-31", "anio", 12), "cuentas", 12));
  assert.deepEqual(total(e, "Total activos"), [12400000n, 10500000n]);
  assert.deepEqual(total(e, "Total pasivos"), [300000n, 0n]);
  assert.deepEqual(total(e, "Resultados de ejercicios anteriores sin cerrar"), [500000n, 0n]);
  assert.deepEqual(total(e, "Resultado del ejercicio en curso"), [1600000n, 500000n]);
  assert.deepEqual(total(e, "Total patrimonio"), [12100000n, 10500000n]);
  assert.deepEqual(e.cuadra, [true, true]);
});

test("flujo de efectivo de 2026 (método indirecto): cuadra con el efectivo", conBase, async () => {
  const e = await leer((tx) => flujoEfectivo(tx, columnasResultados("2026-01-01", "2026-12-31", "ninguno")));
  assert.deepEqual(total(e, "Utilidad (pérdida) neta del período"), [1600000n]);
  assert.deepEqual(e.filas.find((f) => f.texto.startsWith("210205"))?.valores, [300000n], "el ISR por pagar es efectivo que no salió");
  assert.deepEqual(total(e, "Efectivo neto de las actividades de operación"), [1900000n]);
  assert.deepEqual(total(e, "Aumento (disminución) neto del efectivo"), [1900000n]);
  assert.deepEqual(total(e, "Efectivo y equivalentes al inicio del período"), [10500000n]);
  assert.deepEqual(total(e, "Efectivo y equivalentes al final del período"), [12400000n]);
  assert.deepEqual(e.cuadraEfectivo, [true]);
});

test("flujo de enero 2027: depreciación sumada de vuelta y préstamo en financiamiento", conBase, async () => {
  await asiento("2027-01-15", "610214", "120106", 50000n);
  await asiento("2027-01-20", "110103", "220101", 1000000n);
  await asiento("2027-01-25", "120104", "110103", 300000n);
  const e = await leer((tx) => flujoEfectivo(tx, columnasResultados("2027-01-01", "2027-01-31", "ninguno")));
  assert.deepEqual(total(e, "Utilidad (pérdida) neta del período"), [-50000n]);
  assert.deepEqual(e.filas.find((f) => f.texto.startsWith("120106"))?.valores, [50000n]);
  assert.deepEqual(total(e, "Efectivo neto de las actividades de operación"), [0n]);
  assert.deepEqual(total(e, "Efectivo neto de las actividades de inversión"), [-300000n]);
  assert.deepEqual(total(e, "Efectivo neto de las actividades de financiamiento"), [1000000n]);
  assert.deepEqual(e.cuadraEfectivo, [true]);
  // Una cuenta reclasificada en el catálogo cambia de sección.
  await leer((tx) => tx`UPDATE cuentas SET actividad_flujo = 'operacion' WHERE id = ${cuentas["220101"]}`);
  const r = await leer((tx) => flujoEfectivo(tx, columnasResultados("2027-01-01", "2027-01-31", "ninguno")));
  assert.deepEqual(total(r, "Efectivo neto de las actividades de financiamiento"), [0n]);
  assert.deepEqual(r.cuadraEfectivo, [true]);
  await leer((tx) => tx`UPDATE cuentas SET actividad_flujo = NULL WHERE id = ${cuentas["220101"]}`);
});

test("cambios en el patrimonio de 2026: llega al total del estado de situación", conBase, async () => {
  const e = await leer((tx) => cambiosPatrimonio(tx, "2026-01-01", "2026-12-31"));
  assert.deepEqual(e.columnas.map((c) => c.titulo), ["Capital social", "Resultados sin cerrar", "Total"]);
  assert.deepEqual(total(e, "Saldo al inicio del período"), [10000000n, 500000n, 10500000n]);
  assert.deepEqual(total(e, "Resultado del período"), [0n, 1600000n, 1600000n]);
  assert.deepEqual(total(e, "Saldo al final del período"), [10000000n, 2100000n, 12100000n]);
});
