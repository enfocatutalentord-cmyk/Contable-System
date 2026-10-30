// Fase 5, parte 3: reporte y cierre de la conciliación del mes, con la base (crea su propia firma y la borra).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { insertarAsiento } from "../lib/asientos.ts";
import { conciliar, excluir, lineasPendientes, registrarDesdeMovimiento } from "../lib/conciliacion.ts";
import { cerrarConciliacion, reabrirConciliacion, reporteConciliacion } from "../lib/reporte-conciliacion.ts";

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
const asiento = (fecha, monto) => leer((tx) => insertarAsiento(tx, {
  empresaId: empresa, usuarioId: ana, fecha, concepto: `Prueba ${fecha}`, origen: "manual",
  lineas: monto > 0n
    ? [{ cuentaId: cuentas["110103"], debe: monto, haber: 0n }, { cuentaId: cuentas["410101"], debe: 0n, haber: monto }]
    : [{ cuentaId: cuentas["610214"], debe: -monto, haber: 0n }, { cuentaId: cuentas["110103"], debe: 0n, haber: -monto }],
}));
const lineaDe = async (asientoId) => (await leer((tx) => lineasPendientes(tx, banco))).find((l) => l.asiento_id === asientoId).id;
const mov = (k, fecha, monto) => leer(async (tx) => {
  [{ id: movs[k] }] = await tx`INSERT INTO movimientos_banco (empresa_id, cuenta_bancaria_id, importacion_id, fecha, descripcion, monto, huella, orden)
    VALUES (${empresa}, ${banco}, ${imp}, ${fecha}, ${k}, ${monto}, ${k}, 1) RETURNING id`;
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-rec-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  await sql.begin(async (tx) => {
    const [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma rec ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Reporte SRL', '130000004', ${firma}) RETURNING id`;
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
      VALUES (${empresa}, ${cuentas["110103"]}, 'Banco BHD', 'BHD', '1000.00', '2026-10-01', ${ana}) RETURNING id`;
    [{ id: imp }] = await tx`INSERT INTO importaciones_banco (empresa_id, cuenta_bancaria_id, estado, nombre, tipo, tamano, sha256, contenido, creado_por)
      VALUES (${empresa}, ${banco}, 'importada', 'x.csv', 'csv', 1, 'x', '\\x00', ${ana}) RETURNING id`;
  });
  await asiento("2026-09-20", 100000n); // saldo de apertura: libros 1,000 = banco 1,000
  const cobro = await asiento("2026-10-05", 500000n);
  const pago = await asiento("2026-10-28", -200000n);  // el cheque se cobra en noviembre
  await asiento("2026-10-30", 70000n);                 // depósito que el banco acredita en noviembre
  const tarde = await asiento("2026-11-01", 40000n);   // el banco lo acreditó el 31-oct; en libros se registró en noviembre
  await mov("cobro", "2026-10-05", "5000.00");
  await mov("cargo", "2026-10-15", "-50.00");
  await mov("informativo", "2026-10-20", "300.00");
  await mov("tarde", "2026-10-31", "400.00");
  await mov("cheque", "2026-11-02", "-2000.00");
  await leer(async (tx) => {
    await conciliar(tx, { movimientoId: movs.cobro, lineaIds: [(await lineasPendientes(tx, banco)).find((l) => l.asiento_id === cobro.id).id], usuarioId: ana });
    await excluir(tx, { movimientoId: movs.informativo, motivo: "Informativo", usuarioId: ana });
  });
  const lTarde = await lineaDe(tarde.id), lPago = await lineaDe(pago.id);
  await leer((tx) => conciliar(tx, { movimientoId: movs.tarde, lineaIds: [lTarde], usuarioId: ana }));
  await leer((tx) => conciliar(tx, { movimientoId: movs.cheque, lineaIds: [lPago], usuarioId: ana }));
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE nombre = ${`Firma rec ${marca}`}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("octubre: tránsitos de libros y del banco; las dos cifras ajustadas dan igual", conBase, async () => {
  const r = await leer((tx) => reporteConciliacion(tx, banco, "202610"));
  assert.equal(r.saldoBanco, 665000n, "1,000 + 5,000 − 50 + 300 + 400");
  assert.equal(r.saldoLibros, 470000n, "1,000 + 5,000 − 2,000 + 700");
  assert.deepEqual(r.depositosTransito.map((x) => x.monto), [70000n]);
  assert.deepEqual(r.pagosTransito.map((x) => x.monto), [-200000n], "el cheque conciliado con un movimiento de noviembre sigue en tránsito");
  assert.deepEqual(r.bancoNoLibros.map((x) => [x.monto, x.motivo]), [[-5000n, "Por conciliar"], [30000n, "Excluido: Informativo"], [40000n, "Registrado el 01/11/2026"]]);
  assert.equal(r.apertura.diferencia, 0n);
  assert.equal(r.bancoAjustado, 535000n);
  assert.equal(r.librosAjustado, 535000n);
  assert.equal(r.diferencia, 0n);
  assert.equal(r.pendientesMes, 1);
});

test("cerrar: no con movimientos por conciliar; después sí, y avisa si algo cambia", conBase, async () => {
  await assert.rejects(leer((tx) => cerrarConciliacion(tx, { cuentaBancariaId: banco, periodo: "202610", usuarioId: ana })), /Quedan 1 movimiento por conciliar/);
  await leer((tx) => registrarDesdeMovimiento(tx, { empresaId: empresa, movimientoId: movs.cargo, cuentaId: cuentas["620101"], concepto: "Comisión", tasa: null, usuarioId: ana }));
  const r = await leer((tx) => cerrarConciliacion(tx, { cuentaBancariaId: banco, periodo: "202610", usuarioId: ana }));
  assert.equal(r.diferencia, 0n);
  let otra = await leer((tx) => reporteConciliacion(tx, banco, "202610"));
  assert.equal(otra.cierre.huella, otra.huella, "recién cerrada, la foto coincide");
  await assert.rejects(leer((tx) => cerrarConciliacion(tx, { cuentaBancariaId: banco, periodo: "202610", usuarioId: ana })), /ya está cerrado/);
  await asiento("2026-10-31", 10000n);
  otra = await leer((tx) => reporteConciliacion(tx, banco, "202610"));
  assert.notEqual(otra.cierre.huella, otra.huella, "un registro nuevo en octubre cambia la foto");
  assert.equal(otra.diferencia, 0n, "sigue cuadrando: es un depósito en tránsito más");
  await leer((tx) => reabrirConciliacion(tx, { cuentaBancariaId: banco, periodo: "202610" }));
  otra = await leer((tx) => reporteConciliacion(tx, banco, "202610"));
  assert.equal(otra.cierre, null);
});

test("septiembre (antes de empezar a conciliar) y noviembre", conBase, async () => {
  const sep = await leer((tx) => reporteConciliacion(tx, banco, "202609"));
  assert.equal(sep.diferencia, 0n);
  const nov = await leer((tx) => reporteConciliacion(tx, banco, "202611"));
  assert.equal(nov.pagosTransito.length, 0, "el cheque ya se cobró");
  assert.equal(nov.bancoNoLibros.length, 1, "solo el excluido");
  assert.equal(nov.diferencia, 0n);
});
