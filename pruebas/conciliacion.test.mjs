// Fase 5, parte 2: conciliación bancaria. Las sugerencias no necesitan base; el resto crea su propia firma y la borra.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { insertarAsiento } from "../lib/asientos.ts";
import { listarCuentasBancarias } from "../lib/bancos.ts";
import {
  aplicaRegla, conciliar, conciliarDocumento, desconciliar, excluir, lineasPendientes, registrarDesdeMovimiento, reincluir, sugerir,
} from "../lib/conciliacion.ts";

const linea = (id, fecha, monto, extra = {}) => ({
  id, asiento_id: `a${id}`, numero: 1, fecha, concepto: `Asiento ${id}`, referencia: null, origen: "Asiento", neto: "0", monto, documento: null, ref_doc: null, ...extra,
});
const mov = (id, fecha, monto, descripcion = "Movimiento", referencia = null) => ({ id, fecha, monto, descripcion, referencia, cuenta_bancaria_id: "b1" });
const regla = (extra) => ({
  id: "r1", cuenta_bancaria_id: null, nombre: "Comisiones", textos: "comision, cargo por servicio", direccion: "sale", monto_desde: null,
  monto_hasta: null, cuenta_id: "c1", cuenta: "620101 · Comisiones bancarias", concepto: "Comisiones bancarias", activa: true, ...extra,
});

test("sugerencias: mismo monto con la fecha más cercana; la referencia manda", () => {
  const s = sugerir(
    [mov("m1", "2026-10-05", 500000n, "Depósito", "TRF-7781")],
    [linea("l1", "2026-10-05", 500000n), linea("l2", "2026-10-01", 500000n, { ref_doc: "7781" })],
    [],
  ).get("m1");
  assert.equal(s.tipo, "lineas");
  assert.equal(s.lineas[0].id, "l2");
  assert.equal(s.confianza, "alta");
  assert.match(s.motivo, /referencia/);
});

test("sugerencias: una línea no se sugiere a dos movimientos; un depósito de varios cobros se combina", () => {
  const s = sugerir(
    [mov("m1", "2026-10-02", 100000n), mov("m2", "2026-10-03", 100000n), mov("m3", "2026-10-06", 350000n)],
    [linea("l1", "2026-10-02", 100000n), linea("l2", "2026-10-03", 100000n), linea("l3", "2026-10-05", 200000n), linea("l4", "2026-10-06", 150000n),
     linea("l5", "2026-10-06", -350000n)],
    [],
  );
  assert.deepEqual([s.get("m1").lineas[0].id, s.get("m2").lineas[0].id], ["l1", "l2"]);
  assert.deepEqual(s.get("m3").lineas.map((l) => l.id).sort(), ["l3", "l4"]);
  assert.equal(s.get("m3").confianza, "media");
});

test("reglas: texto sin tildes ni mayúsculas, dirección y rango de monto", () => {
  assert.ok(aplicaRegla(regla(), mov("m", "2026-10-01", -15000n, "COMISIÓN MANEJO DE CUENTA")));
  assert.ok(!aplicaRegla(regla(), mov("m", "2026-10-01", 15000n, "Comisión reversada")), "la regla es de salidas");
  assert.ok(!aplicaRegla(regla({ monto_hasta: "100.00" }), mov("m", "2026-10-01", -15000n, "Comision")));
  assert.ok(!aplicaRegla(regla({ activa: false }), mov("m", "2026-10-01", -15000n, "Comision")));
  assert.ok(!aplicaRegla(regla({ cuenta_bancaria_id: "otra" }), mov("m", "2026-10-01", -15000n, "Comision")));
  const s = sugerir([mov("m1", "2026-10-03", -15000n, "COMISION")], [linea("l1", "2026-10-03", -20000n)], [regla()]).get("m1");
  assert.equal(s.tipo, "regla");
});

// ───── Con la base ─────

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, empresa, cuentas, banco, imp;
const movs = {};

const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));
const asiento = (fecha, monto, contra, referencia = null) => leer((tx) => insertarAsiento(tx, {
  empresaId: empresa, usuarioId: ana, fecha, concepto: `Prueba ${monto}`, referencia, origen: "manual",
  lineas: monto > 0n
    ? [{ cuentaId: cuentas["110103"], debe: monto, haber: 0n }, { cuentaId: cuentas[contra], debe: 0n, haber: monto }]
    : [{ cuentaId: cuentas[contra], debe: -monto, haber: 0n }, { cuentaId: cuentas["110103"], debe: 0n, haber: -monto }],
}));

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-conc-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  await sql.begin(async (tx) => {
    const [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma conc ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Concilia SRL', '130000003', ${firma}) RETURNING id`;
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
  await leer(async (tx) => {
    [{ id: banco }] = await tx`INSERT INTO cuentas_bancarias (empresa_id, cuenta_id, banco, nombre, saldo_inicial, fecha_inicial, creado_por)
      VALUES (${empresa}, ${cuentas["110103"]}, 'Banco Popular', 'Popular', '0', '2026-10-01', ${ana}) RETURNING id`;
    [{ id: imp }] = await tx`INSERT INTO importaciones_banco (empresa_id, cuenta_bancaria_id, estado, nombre, tipo, tamano, sha256, contenido, creado_por)
      VALUES (${empresa}, ${banco}, 'importada', 'x.csv', 'csv', 1, 'x', '\\x00', ${ana}) RETURNING id`;
    let orden = 0;
    for (const [k, fecha, monto, desc] of [
      ["dep", "2026-10-05", "30000.00", "DEPOSITO"], ["com", "2026-10-06", "-150.00", "COMISION"], ["pago", "2026-10-07", "-5000.00", "CHEQUE 12"],
    ]) {
      [{ id: movs[k] }] = await tx`INSERT INTO movimientos_banco (empresa_id, cuenta_bancaria_id, importacion_id, fecha, descripcion, monto, huella, orden)
        VALUES (${empresa}, ${banco}, ${imp}, ${fecha}, ${desc}, ${monto}, ${k}, ${++orden}) RETURNING id`;
    }
  });
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE nombre = ${`Firma conc ${marca}`}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("conciliar un depósito con dos registros que suman su monto; lo que no suma se rechaza", conBase, async () => {
  await asiento("2026-09-28", 99900n, "410101"); // antes de la fecha inicial: no aparece
  const a1 = await asiento("2026-10-04", 2000000n, "410101");
  const a2 = await asiento("2026-10-05", 1000000n, "410101");
  const lineas = await leer((tx) => lineasPendientes(tx, banco));
  assert.equal(lineas.length, 2);
  const ids = lineas.map((l) => l.id);
  await assert.rejects(leer((tx) => conciliar(tx, { movimientoId: movs.dep, lineaIds: [ids[0]], usuarioId: ana })), /suman 20000.00 y el movimiento es de 30000.00/);
  await leer((tx) => conciliar(tx, { movimientoId: movs.dep, lineaIds: ids, usuarioId: ana }));
  assert.equal((await leer((tx) => lineasPendientes(tx, banco))).length, 0);
  // Un asiento conciliado no se anula sin desconciliar.
  await assert.rejects(leer((tx) => tx`UPDATE asientos SET estado = 'anulado' WHERE id = ${a1.id}`), /desconcílialo/);
  assert.ok(a2.numero > 0);
});

test("registrar desde el movimiento: asiento contra la cuenta de gastos y conciliado; desconciliar lo anula", conBase, async () => {
  const aid = await leer((tx) => registrarDesdeMovimiento(tx, {
    empresaId: empresa, movimientoId: movs.com, cuentaId: cuentas["620101"], concepto: "Comisiones bancarias", tasa: null, usuarioId: ana,
  }));
  const [a] = await leer((tx) => tx`SELECT origen, estado, (SELECT sum(debe) FROM lineas_asiento WHERE asiento_id = ${aid})::text AS total FROM asientos WHERE id = ${aid}`);
  assert.deepEqual(a, { origen: "banco", estado: "contabilizado", total: "150.00" });
  let [c] = await leer((tx) => listarCuentasBancarias(tx));
  assert.equal(c.saldo_libros, "30849.00", "incluye el asiento de septiembre, anterior a la fecha inicial");
  assert.equal(c.pendientes, 1);
  await assert.rejects(leer((tx) => registrarDesdeMovimiento(tx, {
    empresaId: empresa, movimientoId: movs.com, cuentaId: cuentas["620101"], concepto: "Otra vez", tasa: null, usuarioId: ana,
  })), /ya no está por conciliar/);
  const anulados = await leer((tx) => desconciliar(tx, { movimientoId: movs.com, usuarioId: ana }));
  assert.equal(anulados, 1);
  [c] = await leer((tx) => listarCuentasBancarias(tx));
  assert.equal(c.saldo_libros, "30999.00");
  assert.equal(c.pendientes, 2);
});

test("un pago registrado desde el movimiento se concilia solo si el monto coincide", conBase, async () => {
  const mal = await asiento("2026-10-07", -490000n, "610214");
  assert.equal(await leer((tx) => conciliarDocumento(tx, { movimientoId: movs.pago, asientoId: mal.id, usuarioId: ana })), null);
  const bien = await asiento("2026-10-07", -500000n, "610214");
  assert.equal(await leer((tx) => conciliarDocumento(tx, { movimientoId: movs.pago, asientoId: bien.id, usuarioId: ana })), banco);
});

test("excluir y volver a incluir; en un período cerrado no se concilia ni desconcilia", conBase, async () => {
  await leer((tx) => excluir(tx, { movimientoId: movs.com, motivo: "Línea repetida del banco", usuarioId: ana }));
  await leer((tx) => reincluir(tx, movs.com));
  await sql`UPDATE empresas SET fecha_bloqueo = '2026-10-31' WHERE id = ${empresa}`;
  try {
    await assert.rejects(leer((tx) => desconciliar(tx, { movimientoId: movs.dep, usuarioId: ana })), /período está cerrado/);
    await assert.rejects(leer((tx) => registrarDesdeMovimiento(tx, {
      empresaId: empresa, movimientoId: movs.com, cuentaId: cuentas["620101"], concepto: "Comisión", tasa: null, usuarioId: ana,
    })), /cerrado/);
  } finally {
    await sql`UPDATE empresas SET fecha_bloqueo = NULL WHERE id = ${empresa}`;
  }
});

test("la línea tiene que ser de la cuenta del banco", conBase, async () => {
  const otra = await leer((tx) => insertarAsiento(tx, {
    empresaId: empresa, usuarioId: ana, fecha: "2026-10-06", concepto: "Caja", origen: "manual",
    lineas: [{ cuentaId: cuentas["610214"], debe: 15000n, haber: 0n }, { cuentaId: cuentas["110101"], debe: 0n, haber: 15000n }],
  }));
  const [l] = await leer((tx) => tx`SELECT id FROM lineas_asiento WHERE asiento_id = ${otra.id} AND haber > 0`);
  await assert.rejects(
    leer((tx) => tx`INSERT INTO conciliaciones_banco (movimiento_id, linea_id, empresa_id, monto) VALUES (${movs.com}, ${l.id}, ${empresa}, '-150.00')`),
    /no es de la cuenta contable de este banco/,
  );
});
