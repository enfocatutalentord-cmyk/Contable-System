// Fase 2: cálculo de impuestos y retenciones, y reglas de la configuración tributaria en la base.
// Las pruebas de base necesitan DATABASE_URL (base de pruebas, se limpia sola).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { aplicarTasa, calcularOperacion, COMPROBANTES, leerPorcentaje, numeroComprobante, OBLIGACIONES, porcentajeTexto } from "../lib/fiscal.ts";

const p = (s) => leerPorcentaje(s);
const linea = (monto, tasa, tipo = "itbis") => ({ monto, impuestos: [{ tasa: p(tasa), tipo }] });

// ───── Cálculo (sin base) ─────

test("porcentajes: lectura y texto", () => {
  assert.equal(p("18"), 180000n);
  assert.equal(p("18,5"), 185000n);
  assert.equal(p("2.5 %"), 25000n);
  assert.equal(p("100"), 1000000n);
  assert.equal(p("0"), 0n);
  assert.equal(p("100.01"), null);
  assert.equal(p("-5"), null);
  assert.equal(p("abc"), null);
  assert.equal(porcentajeTexto(185000n), "18.5");
  assert.equal(porcentajeTexto(180000n), "18");
});

test("redondeo al centavo, mitad hacia arriba", () => {
  assert.equal(aplicarTasa(33333n, p("18")), 6000n); // 333.33 × 18 % = 59.9994 → 60.00
  assert.equal(aplicarTasa(33333n, p("16")), 5333n); // 53.3328 → 53.33
  assert.equal(aplicarTasa(3n, p("18")), 1n); // 0.0054 → 0.01
  assert.equal(aplicarTasa(25n, p("10")), 3n); // 0.025 → 0.03
});

test("servicio de RD$10,000 con ITBIS 18 %, retención de ITBIS 30 % e ISR 10 %", () => {
  const r = calcularOperacion([linea(1000000n, "18")], [{ impuesto: "itbis", tasa: p("30") }, { impuesto: "isr", tasa: p("10") }]);
  assert.equal(r.subtotal, 1000000n);
  assert.equal(r.itbis, 180000n);
  assert.equal(r.total, 1180000n);
  assert.deepEqual(r.retenciones.map((x) => x.monto), [54000n, 100000n]);
  assert.equal(r.neto, 1026000n); // 11,800 − 540 − 1,000
});

test("mezcla gravado y exento: las retenciones de ITBIS solo miran el ITBIS; las de ISR, todo el monto", () => {
  const r = calcularOperacion([linea(500000n, "18"), linea(200000n, "0", "exento")],
    [{ impuesto: "itbis", tasa: p("100") }, { impuesto: "isr", tasa: p("15") }]);
  assert.equal(r.itbis, 90000n);
  assert.equal(r.total, 790000n);
  assert.deepEqual(r.retenciones.map((x) => x.monto), [90000n, 105000n]);
  assert.equal(r.neto, 595000n);
});

test("ITBIS y propina legal sobre el mismo consumo; la propina no es base de retención", () => {
  const consumo = { monto: 100000n, impuestos: [{ tasa: p("18"), tipo: "itbis" }, { tasa: p("10"), tipo: "propina" }] };
  const r = calcularOperacion([consumo], [{ impuesto: "itbis", tasa: p("30") }, { impuesto: "isr", tasa: p("10") }]);
  assert.equal(r.subtotal, 100000n);
  assert.equal(r.itbis, 18000n);
  assert.equal(r.otros, 10000n);
  assert.equal(r.total, 128000n);
  assert.deepEqual(r.retenciones.map((x) => x.monto), [5400n, 10000n]);
});

test("catálogos: comprobantes impresos y electrónicos, obligaciones sugeridas", () => {
  assert.equal(COMPROBANTES.B01.equivalente, "E31");
  assert.equal(COMPROBANTES.E31.equivalente, "B01");
  assert.equal(COMPROBANTES.E34.nombre, "Nota de crédito");
  assert.equal(numeroComprobante("B01", 25), "B0100000025");
  assert.equal(numeroComprobante("E31", 25), "E310000000025");
  const perfil = { tipo_persona: "juridica", regimen: "ordinario", contribuye_itbis: true, agente_retencion: true, emisor_ecf: false, ecf_desde: null };
  const sugeridas = (pf) => OBLIGACIONES.filter((o) => o.sugerida(pf)).map((o) => o.formulario).join(",");
  assert.equal(sugeridas(perfil), "IT-1,IR-17,606,607,608,Anticipo ISR,IR-2");
  assert.equal(sugeridas({ ...perfil, tipo_persona: "fisica", regimen: "rst", contribuye_itbis: false, agente_retencion: false }), "RST");
  assert.equal(sugeridas({ ...perfil, contribuye_itbis: false }).includes("IT-1"), false);
});

// ───── Reglas en la base ─────

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
let usuario, empresaA, empresaB, cuentasA, cuentasB;

function conEmpresa(id, fn) {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
    await tx`SELECT set_config('app.usuario_id', ${usuario}, true)`;
    await tx`SET LOCAL ROLE contable_app`;
    return fn(tx);
  });
}

const CODIGOS = [["110401", "activo"], ["110403", "activo"], ["110404", "activo"], ["210201", "pasivo"], ["210202", "pasivo"], ["210203", "pasivo"]];

async function crearEmpresa(nombre) {
  return sql.begin(async (tx) => {
    const [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${"Firma fiscal " + nombre}) RETURNING id`;
    const [{ id }] = await tx`INSERT INTO empresas (nombre, firma_id) VALUES (${nombre}, ${firma}) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
    const cuentas = {};
    for (const [codigo, tipo] of CODIGOS) {
      const [c] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, nivel) VALUES (${id}, ${codigo}, ${"Cuenta " + codigo}, ${tipo}, 4) RETURNING id`;
      cuentas[codigo] = c.id;
    }
    const [g] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, nivel, de_detalle) VALUES (${id}, '2102', 'Impuestos', 'pasivo', 3, false) RETURNING id`;
    cuentas.grupo = g.id;
    await tx`SELECT configurar_tributaria(${id})`;
    return { id, cuentas };
  });
}

before(async () => {
  if (!sql) return;
  [{ id: usuario }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`fiscal-${Date.now()}@x.do`}, 'Prueba', 'x') RETURNING id`;
  ({ id: empresaA, cuentas: cuentasA } = await crearEmpresa("Fiscal A"));
  ({ id: empresaB, cuentas: cuentasB } = await crearEmpresa("Fiscal B"));
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id IN (${empresaA}, ${empresaB})`;
    await sql`DELETE FROM firmas WHERE nombre IN ('Firma fiscal Fiscal A', 'Firma fiscal Fiscal B')`;
    await sql`DELETE FROM usuarios WHERE id = ${usuario}`;
  } finally {
    await sql.end();
  }
});

test("la configuración sugerida se carga con sus cuentas", conBase, async () => {
  const { impuestos, retenciones } = await conEmpresa(empresaA, async (tx) => ({
    impuestos: await tx`SELECT nombre, tasa::text, cuenta_ventas_id, cuenta_compras_id FROM impuestos ORDER BY tasa DESC`,
    retenciones: await tx`SELECT nombre, impuesto, tasa::text, cuenta_por_terceros_id, cuenta_a_terceros_id FROM retenciones ORDER BY nombre`,
  }));
  assert.deepEqual(impuestos.map((i) => i.nombre), ["ITBIS 18 %", "ITBIS 16 %", "Exento"]);
  assert.equal(impuestos[0].cuenta_ventas_id, cuentasA["210201"]);
  assert.equal(impuestos[0].cuenta_compras_id, cuentasA["110401"]);
  assert.equal(impuestos[2].cuenta_ventas_id, null);
  assert.equal(retenciones.length, 5);
  const itbis = retenciones.find((r) => r.impuesto === "itbis");
  assert.equal(itbis.cuenta_por_terceros_id, cuentasA["110404"]);
  assert.equal(itbis.cuenta_a_terceros_id, cuentasA["210202"]);
});

test("las tasas con vigencia: ISR de honorarios 10 % hasta junio de 2026 y 15 % desde julio", conBase, async () => {
  const vigentes = (fecha) => conEmpresa(empresaA, (tx) => tx`
    SELECT tasa::int AS tasa FROM retenciones
     WHERE codigo_606 = 2 AND activo AND vigente_desde <= ${fecha} AND (vigente_hasta IS NULL OR vigente_hasta >= ${fecha})`);
  assert.deepEqual((await vigentes("2026-06-30")).map((r) => r.tasa), [10]);
  assert.deepEqual((await vigentes("2026-07-01")).map((r) => r.tasa), [15]);
});

test("no se puede asignar una cuenta de otra empresa ni una cuenta de grupo", conBase, async () => {
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`
    INSERT INTO impuestos (empresa_id, nombre, tipo, tasa, cuenta_ventas_id, cuenta_compras_id)
    VALUES (${empresaA}, 'Ajeno', 'itbis', 18, ${cuentasB["210201"]}, ${cuentasA["110401"]})`), /cuenta de detalle activa de esta empresa/);
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`
    INSERT INTO retenciones (empresa_id, nombre, impuesto, tasa, cuenta_por_terceros_id, cuenta_a_terceros_id)
    VALUES (${empresaA}, 'Grupo', 'isr', 10, ${cuentasA["110403"]}, ${cuentasA.grupo})`), /cuenta de detalle activa de esta empresa/);
});

test("un impuesto con tasa necesita sus cuentas y un exento no lleva tasa", conBase, async () => {
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`
    INSERT INTO impuestos (empresa_id, nombre, tipo, tasa) VALUES (${empresaA}, 'Sin cuentas', 'itbis', 18)`));
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`
    INSERT INTO impuestos (empresa_id, nombre, tipo, tasa) VALUES (${empresaA}, 'Exento raro', 'exento', 5)`));
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`
    INSERT INTO impuestos (empresa_id, nombre, tipo, tasa) VALUES (${empresaA}, 'Exagerado', 'otro', 150)`));
});

test("cada empresa ve solo su configuración tributaria", conBase, async () => {
  const ajenos = await conEmpresa(empresaB, async (tx) => ({
    i: (await tx`SELECT count(*)::int AS n FROM impuestos WHERE empresa_id = ${empresaA}`)[0].n,
    r: (await tx`SELECT count(*)::int AS n FROM retenciones WHERE empresa_id = ${empresaA}`)[0].n,
  }));
  assert.deepEqual(ajenos, { i: 0, r: 0 });
  await assert.rejects(conEmpresa(empresaB, (tx) => tx`
    INSERT INTO obligaciones_empresa (empresa_id, clave, activa) VALUES (${empresaA}, 'it1', true)`));
});

test("rangos de comprobantes: todos los tipos, 8 dígitos en NCF y 10 en e-CF", conBase, async () => {
  const rango = (tipo, hasta) => conEmpresa(empresaA, (tx) => tx`
    INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence) VALUES (${empresaA}, ${tipo}, 1, ${hasta}, 1, '2027-12-31')`);
  await rango("B11", 99999999);
  await rango("E31", 9999999999);
  await assert.rejects(rango("B01", 9999999999));
  await assert.rejects(rango("X99", 10));
});

test("los cambios de la configuración quedan en el historial con su usuario", conBase, async () => {
  const filas = await conEmpresa(empresaA, async (tx) => {
    await tx`UPDATE impuestos SET tasa = 16.5 WHERE nombre = 'ITBIS 16 %'`;
    return tx`SELECT accion, antes->>'tasa' AS antes, despues->>'tasa' AS despues, usuario_id FROM auditoria
               WHERE tabla = 'impuestos' AND accion = 'update'`;
  });
  assert.equal(filas.length, 1);
  assert.equal(Number(filas[0].antes), 16);
  assert.equal(Number(filas[0].despues), 16.5);
  assert.equal(filas[0].usuario_id, usuario);
});
