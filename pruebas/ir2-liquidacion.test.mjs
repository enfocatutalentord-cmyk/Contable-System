// IR-2 2026, parte 2: anexos G y E y liquidación (casillas 1 a 33) con las fórmulas del Excel oficial. Las funciones
// puras no necesitan base; el resto crea su propia firma y la borra.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { insertarAsiento } from "../lib/asientos.ts";
import { periodoDe } from "../lib/formatos-dgii.ts";
import { calcularIr2, EDITABLES_IR2, porcentajePerdida, recargoSugerido, venceIr2 } from "../lib/ir2-liquidacion.ts";
import { deCentavos, hoyISO } from "../lib/montos.ts";

test("porcentaje de la renta para compensar pérdidas según su antigüedad (art. 287 k)", () => {
  assert.equal(porcentajePerdida(2026, 2025), 10000n);
  assert.equal(porcentajePerdida(2026, 2023), 10000n);
  assert.equal(porcentajePerdida(2026, 2022), 8000n, "cuarto año: 80 %");
  assert.equal(porcentajePerdida(2026, 2021), 7000n, "quinto año: 70 %");
});

test("fecha límite (120 días) y recargo por mora", () => {
  assert.equal(venceIr2(periodoDe("202612")), "2027-04-30");
  assert.equal(venceIr2(periodoDe("202606")), "2026-10-28");
  assert.equal(recargoSugerido("2027-04-30", "2027-04-30"), 0n);
  assert.equal(recargoSugerido("2027-04-30", "2027-05-10"), 1000n, "primer mes: 10 %");
  assert.equal(recargoSugerido("2027-04-30", "2027-05-30"), 1000n);
  assert.equal(recargoSugerido("2027-04-30", "2027-06-01"), 1400n, "mes o fracción siguiente: +4 %");
  assert.equal(recargoSugerido("2027-04-30", "2027-07-15"), 1800n);
});

test("las casillas calculadas no se pueden escribir", () => {
  for (const k of ["I1", "I7", "I8", "I12", "I23", "I31", "I33", "IA", "IB", "G1", "G3p", "E1k", "E15", "E22"]) assert.ok(!EDITABLES_IR2.has(k), k);
  for (const k of ["I3", "I13", "I22", "I25p", "G1.1", "G3.5n", "E1a", "E1b", "E1c", "E1f", "E1i", "E16"]) assert.ok(EDITABLES_IR2.has(k), k);
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
  empresaId: empresa, usuarioId: ana, fecha, concepto: `${debe}/${haber}`, origen: "manual",
  lineas: [{ cuentaId: cuentas[debe], debe: monto, haber: 0n }, { cuentaId: cuentas[haber], debe: 0n, haber: monto }],
}));
// En 2026 el costo (20,000) se registró con un asiento, sin compras ni inventario: en el anexo D va como compras locales.
const ir2 = (periodo, manuales = {}) => leer((tx) => calcularIr2(tx, periodoDe(periodo), periodo === "202612" ? { Dtipo: "2", D35: "20000", ...manuales } : manuales));
const errores = (r) => r.avisos.filter((a) => a.nivel === "error").map((a) => a.texto);

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-ir2l-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  await sql.begin(async (tx) => {
    const [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma ir2l ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('IR2 Liquidación SRL', '130000007', ${firma}) RETURNING id`;
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
  await asiento("2026-01-02", "110103", "310101", 10000000n);
  await asiento("2026-03-05", "110103", "410101", 5000000n); // ventas 50,000
  await asiento("2026-03-06", "510101", "110103", 2000000n); // costo 20,000
  await asiento("2026-03-07", "610214", "110103", 1000000n); // gastos 10,000
  await asiento("2026-03-08", "620101", "110103", 150000n);  // gastos financieros 1,500
  await asiento("2026-03-31", "630101", "210205", 300000n);  // ISR: no va en el B-1
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE nombre = ${`Firma ir2l ${marca}`}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("liquidación sin ajustes: casillas A, 1, 7, 11 y 12 al 27 %", conBase, async () => {
  const r = await ir2("202612");
  const v = r.valores;
  assert.equal(v.IA, 5000000n);
  assert.equal(v.IB, 5000000n, "base de anticipos = ingresos sin partidas no imputables");
  assert.equal(v.I1, 1850000n);
  assert.equal(v.I7, 1850000n);
  assert.equal(v.I11, 1850000n);
  assert.equal(v.I12p, 2700n);
  assert.equal(v.I12, 499500n);
  assert.equal(v.I23, 499500n);
  assert.equal(v.I31, 499500n);
  assert.equal(v.I33, 0n);
  assert.deepEqual(errores(r), []);
  assert.equal(r.huella, (await ir2("202612")).huella, "la huella no cambia si nada cambia");
});

test("anexo G: el detalle y la distribución deben cuadrar; pasa a las casillas 2 y 5", conBase, async () => {
  const sinDistribuir = await ir2("202612", { "G1.1": "1000" });
  assert.equal(sinDistribuir.valores.G1, 100000n);
  assert.equal(errores(sinDistribuir).length, 1);
  const r = await ir2("202612", { "G1.1": "1000", "G3.13p": "1000", "G2.1": "300", "G3.9n": "300" });
  assert.deepEqual(errores(r), []);
  assert.equal(r.valores.I2, 100000n);
  assert.equal(r.valores.I5, 30000n);
  assert.equal(r.valores.I6, 70000n);
  assert.equal(r.valores.I7, 1920000n);
});

test("anexo E: pérdida de 2022 ajustada por inflación, con el 80 % del cuarto año, y liquidación", conBase, async () => {
  const r = await ir2("202612", { "G1.1": "1000", "G3.13p": "1000", E1a: "2022", E1b: "5000", E1c: "10", I13: "1000" });
  const v = r.valores;
  assert.equal(v.I7, 1950000n);
  assert.equal(v.E1d, 50000n, "10 % de inflación");
  assert.equal(v.E1e, 550000n);
  assert.equal(v.E1f, 200n, "le quedan 2 períodos (sugerido por el año)");
  assert.equal(v.E1g, 275000n, "e ÷ f");
  assert.equal(v.E1h, 1950000n, "renta de la casilla 7");
  assert.equal(v.E1i, 8000n);
  assert.equal(v.E1j, 1560000n);
  assert.equal(v.E1k, 275000n, "el menor entre g y j");
  assert.equal(v.E1l, 275000n);
  assert.equal(v.I8, 275000n);
  assert.equal(v.I9, 1675000n);
  assert.equal(v.I12, 452250n);
  assert.equal(v.I23, 352250n, "menos los anticipos pagados");
  assert.equal(r.sugeridos.E1i, 8000n);
  // Los errores del anexo E: sin año o fuera de los cinco ejercicios anteriores.
  assert.equal(errores(await ir2("202612", { E2b: "100" })).length, 1);
  assert.equal(errores(await ir2("202612", { E2a: "2019", E2b: "100" })).length, 1);
});

test("saldo a favor, y lo presentado pasa al ejercicio siguiente (casilla 22 y pérdidas pendientes)", conBase, async () => {
  const manuales = { E1a: "2022", E1b: "5000", I13: "10000" };
  const r = await ir2("202612", manuales);
  const v = r.valores;
  assert.equal(v.I12, porTasa27(1850000n - 250000n));
  assert.equal(v.I23, 0n);
  assert.equal(v.I24, 1000000n - v.I12);
  assert.equal(v.I33, v.I24, "más de RD$200: nuevo saldo a favor");
  const casillas = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deCentavos(x)]));
  await leer((tx) => tx`INSERT INTO envios_dgii (empresa_id, formato, periodo, huella, registros, enviado_por, casillas)
    VALUES (${empresa}, 'IR-2', '202612', ${r.huella}, 0, ${ana}, ${tx.json(casillas)})`);
  // 2027 con ingresos de RD$1,000,000,000: tasa del 30 %.
  await asiento("2027-02-01", "110103", "410101", 100_000_000_000n);
  const s = await ir2("202712");
  assert.equal(s.valores.I22, v.I33);
  assert.equal(s.origen.I22, "Casilla 33 del IR-2 del ejercicio 2026 (presentado)");
  assert.equal(s.valores.E1a, 202200n);
  assert.equal(s.valores.E1b, 250000n, "lo pendiente de 2026");
  assert.equal(s.valores.E1f, 100n, "un período menos");
  assert.equal(s.valores.E1i, 7000n, "quinto año: 70 %");
  assert.equal(s.valores.E1k, 250000n);
  assert.equal(s.valores.I12p, 3000n);
  assert.equal(s.valores.I12, porTasa(100_000_000_000n - 250000n, 3000n));
  assert.equal(s.valores.I23, s.valores.I12 - v.I33);
});

test("presentado tarde: la casilla 25 trae el recargo de hoy; lo escrito manda y lo presentado queda fijo", conBase, async () => {
  await asiento("2024-05-02", "110103", "410101", 1000000n); // ventas 10,000 en 2024 (vencía el 30-abr-2025)
  const recargo = recargoSugerido(venceIr2(periodoDe("202412")), hoyISO());
  assert.ok(recargo >= 1000n, "ya venció");
  const r = await ir2("202412");
  assert.equal(r.sugeridos.I25p, recargo);
  assert.equal(r.valores.I25p, recargo);
  assert.equal(r.valores.I25, porTasa(r.valores.I23, recargo));
  assert.equal(r.valores.I31, r.valores.I23 + r.valores.I25);
  assert.ok(r.avisos.some((a) => a.texto.includes("la casilla 25 trae el recargo")));
  const escrito = await ir2("202412", { I25p: "10" });
  assert.equal(escrito.valores.I25p, 1000n, "lo escrito a mano manda");
  assert.ok(!escrito.avisos.some((a) => a.texto.includes("la casilla 25 trae el recargo")));
  await leer((tx) => tx`INSERT INTO envios_dgii (empresa_id, formato, periodo, huella, registros, enviado_por, casillas)
    VALUES (${empresa}, 'IR-2', '202412', ${r.huella}, 0, ${ana}, ${tx.json({ I25p: "50.00" })})`);
  const presentado = await ir2("202412");
  assert.equal(presentado.valores.I25p, 5000n, "el recargo presentado no cambia con los meses");
  assert.ok(!presentado.avisos.some((a) => a.texto.includes("la casilla 25 trae el recargo")));
  // Sin nada que pagar no hay recargo.
  assert.equal((await ir2("202412", { I13: "100000" })).valores.I25p, 0n);
});

const porTasa = (b, t) => (b * t + 5000n) / 10000n;
const porTasa27 = (b) => porTasa(b, 2700n);
