// IR-2 2026, parte 1: anexos A-1, B-1 y J. La casilla sugerida no necesita base; el resto crea su propia firma y la borra.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { insertarAsiento } from "../lib/asientos.ts";
import { anexoA1, anexoB1, anexoJ, ASIGNABLES, casillaSugerida, esCasillaIr2 } from "../lib/ir2.ts";

test("casilla sugerida para todo el catálogo dominicano", () => {
  const tipo = (c) => TIPO_POR_CLASE[c[0]];
  const s = Object.fromEntries(CATALOGO_RD.filter(([c]) => c.length >= 6).map(([c, n]) => [c, casillaSugerida(c, tipo(c), n)]));
  assert.equal(s["110103"], "A1:1.1");
  assert.equal(s["110201"], "A1:1.2");
  assert.equal(s["110203"], "A1:5.5", "estimación para incobrables va a provisiones");
  assert.equal(s["110301"], "A1:1.5");
  assert.equal(s["110405"], "A1:1.10");
  assert.equal(s["120101"], "A1:2.5");
  assert.equal(s["120102"], "A1:2.1");
  assert.equal(s["120104"], "A1:2.3", "computadoras: categoría 2");
  assert.equal(s["120106"], "A1:5.3");
  assert.equal(s["210101"], "A1:7.2");
  assert.equal(s["210205"], "A1:7.3");
  assert.equal(s["210401"], "A1:7.1");
  assert.equal(s["210501"], "A1:7.5");
  assert.equal(s["220101"], "A1:8.2");
  assert.equal(s["310101"], "A1:10.1");
  assert.equal(s["310201"], "A1:10.2");
  assert.equal(s["310301"], "A1:10.4");
  assert.equal(s["310302"], "A1:10.5");
  assert.equal(s["410101"], "B1:1.1");
  assert.equal(s["410103"], "B1:1.3");
  assert.equal(s["420101"], "B1:2.1");
  assert.equal(s["420102"], "B1:3.3");
  assert.equal(s["510101"], "B1:5");
  assert.equal(s["610101"], "B1:6.1");
  assert.equal(s["610104"], "B1:6.4");
  assert.equal(s["610201"], "B1:8.2");
  assert.equal(s["610205"], "B1:7.2");
  assert.equal(s["610212"], "B1:9.2");
  assert.equal(s["620102"], "B1:12.1");
  assert.equal(s["620103"], "B1:13.5");
  assert.equal(s["620104"], "B1:12.8");
  assert.equal(s["630101"], null, "el ISR no va en el B-1");
  for (const [c, k] of Object.entries(s)) if (k) assert.ok(esCasillaIr2(k), `${c} → ${k} debe ser una casilla válida`);
  assert.ok(!esCasillaIr2("A1:6") && !esCasillaIr2("B1:14") && !ASIGNABLES.A1.includes("5"), "los totales no se asignan");
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

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-ir2-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  await sql.begin(async (tx) => {
    const [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma ir2 ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('IR2 SRL', '130000006', ${firma}) RETURNING id`;
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
  await asiento("2025-06-01", "110103", "310101", 10000000n);
  await asiento("2025-11-10", "110103", "410101", 500000n);
  await asiento("2026-03-05", "110103", "410101", 5000000n);
  await asiento("2026-03-06", "510101", "110103", 2000000n);
  await asiento("2026-03-07", "610214", "110103", 1000000n);
  await asiento("2026-03-08", "620101", "110103", 100000n);
  await asiento("2026-03-09", "120104", "110103", 600000n);
  await asiento("2026-03-31", "610212", "120106", 50000n);
  await asiento("2026-03-31", "630101", "210205", 300000n);
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE nombre = ${`Firma ir2 ${marca}`}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("anexo A-1 al 31/12/2026: total activos = total pasivos y patrimonio", conBase, async () => {
  const a = await leer((tx) => anexoA1(tx, "2026-12-31", 12));
  const v = a.valores;
  assert.equal(v["1.1"], 10500000n - 2000000n - 1000000n - 100000n - 600000n + 5000000n);
  assert.equal(v["2.3"], 600000n);
  assert.equal(v["5.3"], 50000n, "la depreciación acumulada en positivo, se resta");
  assert.equal(v["6"], v["1"] + v["2"] - v["5"]);
  assert.equal(v["7.3"], 300000n);
  assert.equal(v["10.1"], 10000000n);
  assert.equal(v["10.4"], 500000n, "el resultado de 2025 sin cerrar");
  assert.equal(v["10.5"], 5000000n - 2000000n - 1000000n - 100000n - 50000n - 300000n, "el del ejercicio, después del ISR");
  assert.equal(v["6"], v["11"]);
  assert.deepEqual(a.sinCasilla, []);
});

test("anexo B-1 de 2026: beneficio antes del ISR y total", conBase, async () => {
  const b = await leer((tx) => anexoB1(tx, "2026-01-01", "2026-12-31"));
  const v = b.valores;
  assert.equal(v["1.1"], 5000000n);
  assert.equal(v["4"], 5000000n);
  assert.equal(v["5"], 2000000n);
  assert.equal(v["7.7"], 1000000n);
  assert.equal(v["9.2"], 50000n);
  assert.equal(v["12.10"], 100000n);
  assert.equal(v["14"], 5000000n - 2000000n - 1000000n - 50000n - 100000n, "sin el ISR");
  assert.equal(v["15"], v["4"]);
  // Una casilla cambiada en el catálogo manda sobre la sugerida.
  await leer((tx) => tx`UPDATE cuentas SET casilla_ir2 = 'B1:10.6' WHERE id = ${cuentas["610214"]}`);
  const b2 = await leer((tx) => anexoB1(tx, "2026-01-01", "2026-12-31"));
  assert.equal(b2.valores["10.6"], 1000000n);
  assert.equal(b2.valores["7.7"] ?? 0n, 0n);
  // Una cuenta de resultado asignada a una casilla del A-1 queda «sin casilla» en el B-1.
  await leer((tx) => tx`UPDATE cuentas SET casilla_ir2 = 'A1:1.1' WHERE id = ${cuentas["610214"]}`);
  const b3 = await leer((tx) => anexoB1(tx, "2026-01-01", "2026-12-31"));
  assert.deepEqual(b3.sinCasilla.map((d) => d.codigo), ["610214"]);
  await leer((tx) => tx`UPDATE cuentas SET casilla_ir2 = NULL WHERE id = ${cuentas["610214"]}`);
});

test("anexo J sin comprobantes: todo en cero", conBase, async () => {
  const j = await leer((tx) => anexoJ(tx, "2026-01-01", "2026-12-31"));
  assert.ok(j.filas.every((f) => f.cantidad === 0 && f.monto === 0n));
  assert.deepEqual(j.filas.filter((f) => f.total).map((f) => f.c), ["1.9", "2.6", "2.9"]);
});
