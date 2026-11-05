// Bloque 4, entrega 4c: proyección del cierre fiscal (acumulado del ejercicio, proyección a 12 meses, ISR estimado) y alertas
// preventivas, con asientos reales. Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { insertarAsiento } from "../lib/asientos.ts";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { proyeccionDe, tablaProyeccion } from "../lib/proyeccion.ts";

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, empresa, firma, cuentas;

const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));
const asiento = (fecha, debe, haber, monto) => leer((tx) => insertarAsiento(tx, {
  empresaId: empresa, usuarioId: ana, fecha, concepto: `${debe}/${haber}`, origen: "manual",
  lineas: [{ cuentaId: cuentas[debe], debe: monto, haber: 0n }, { cuentaId: cuentas[haber], debe: 0n, haber: monto }],
}));

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-proy-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  await sql.begin(async (tx) => {
    [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma proyeccion ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Servicios Proyección SRL', '130000032', ${firma}) RETURNING id`;
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
  // 2025: utilidad de 100,000. 2026: ingresos de 100,000 al mes; sueldos 30,000 y otros gastos sin factura 20,000 al mes.
  await asiento("2025-06-15", "110101", "410101", 10000000n);
  for (const mes of ["01", "02", "03"]) {
    await asiento(`2026-${mes}-10`, "110101", "410101", 10000000n);
    await asiento(`2026-${mes}-20`, "610101", "110101", 3000000n);
    await asiento(`2026-${mes}-25`, "610214", "110101", 2000000n);
  }
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("acumulado a marzo, proyección a 12 meses, ISR al 27 % y alertas", conBase, async () => {
  const d = await leer((tx) => proyeccionDe(tx, "202603", "2026-04-05"));
  assert.equal(d.inicio, "2026-01-01");
  assert.equal(d.fin, "2026-12-31");
  assert.equal(d.mesesConDatos, 3);
  assert.deepEqual(d.acumulado, { ingresos: "300000.00", costos: "0.00", gastos: "150000.00", utilidad: "150000.00" });
  assert.deepEqual(d.proyectado, { ingresos: "1200000.00", utilidad: "600000.00" });
  assert.equal(d.tasa, 27);
  assert.equal(d.impuesto, "162000.00", "27 % de 600,000");
  assert.equal(d.aPagar, "162000.00");
  assert.equal(d.sinComprobante, "60000.00", "los sueldos no cuentan como gasto sin factura");
  assert.equal(d.anterior, "100000.00");
  const textos = d.alertas.map((a) => a.texto).join(" | ");
  assert.match(textos, /RD\$60,000.00 en gastos registrados sin factura de compra \(40 % del total\)/);
  assert.match(textos, /500 % por encima del ejercicio anterior/);
  assert.doesNotMatch(textos, /revisar antes del cierre/, "en abril aún faltan meses para el cierre");

  const n = await leer((tx) => proyeccionDe(tx, "202603", "2026-11-05"));
  assert.ok(n.alertas.some((a) => /momento de revisar antes del cierre/.test(a.texto)), "en noviembre avisa la revisión antes del cierre");

  await leer((tx) => tx`UPDATE empresas SET tipo_persona = 'fisica' WHERE id = ${empresa}`);
  const f = await leer((tx) => proyeccionDe(tx, "202603", "2026-04-05"));
  assert.deepEqual([f.tasa, f.impuesto, f.aPagar], [null, null, null], "persona física: sin escala del IR-1 no se estima");
  assert.ok(f.alertas.some((a) => /escala vigente del IR-1/.test(a.texto)));

  const t = tablaProyeccion(d, null, { empresa: "Firma", generado: "hoy" });
  assert.ok(t.filas.some((x) => x[0] === "ISR estimado a pagar al cierre" && x[4] === "162000.00"));
});
