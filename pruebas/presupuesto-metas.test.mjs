// Prioridad 1.6 (parte 2): metas de ahorro, deudas (capital e intereses) y balance por cuenta del presupuesto de Empire.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { registrarSalida, anularSalida } from "../lib/salidas.ts";
import {
  aporteNecesario, estadoMeta, fechaLiquidacion, guardarDeuda, guardarMeta, listarDeudas, listarMetas, mesesHasta, quitarMeta, saldosDeBancos,
} from "../lib/presupuesto-metas.ts";

test("meses que faltan, aporte mensual y estado de una meta", () => {
  assert.equal(mesesHasta("2026-11-20", "2026-11-30"), 1);
  assert.equal(mesesHasta("2026-11-20", "2027-02-10"), 4, "noviembre, diciembre, enero y febrero");
  assert.equal(mesesHasta("2026-11-20", "2026-01-01"), 1, "una fecha pasada no da cero meses");
  assert.equal(aporteNecesario(1000000n, "2026-11-20", "2027-02-10"), 250000n);
  assert.equal(aporteNecesario(1000001n, "2026-11-20", "2027-02-10"), 250001n, "sube al centavo siguiente");
  assert.equal(aporteNecesario(0n, "2026-11-20", "2027-02-10"), 0n);
  assert.equal(aporteNecesario(500n, "2026-11-20", null), 0n);
  assert.equal(estadoMeta(100n, 100n, "2026-01-01", "2026-11-20", true), "Cumplida");
  assert.equal(estadoMeta(50n, 100n, "2026-01-01", "2026-11-20", true), "Vencida");
  assert.equal(estadoMeta(50n, 100n, "2027-01-01", "2026-11-20", true), "Activa");
  assert.equal(estadoMeta(50n, 100n, null, "2026-11-20", false), "Quitada");
});

test("fecha estimada de liquidación de una deuda", () => {
  assert.equal(fechaLiquidacion(1000000n, 250000n, "2026-11-20"), "2027-03");
  assert.equal(fechaLiquidacion(1000001n, 250000n, "2026-11-20"), "2027-04", "una cuota más por el resto");
  assert.equal(fechaLiquidacion(0n, 250000n, "2026-11-20"), null);
  assert.equal(fechaLiquidacion(500n, 0n, "2026-11-20"), null);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa, c;
const padre = (k) => (k.length === 1 ? null : k.length === 2 ? k[0] : k.slice(0, -2));
const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-metas-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma metas ${marca}`}) RETURNING id`;
  c = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, firma_id) VALUES ('Empire Metas SRL', ${firma}) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    const ids = new Map();
    for (const [codigo, n] of [...CATALOGO_RD, ["110204", "Cuenta corriente – Patricia Paulino"]]) {
      const [r] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${empresa}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${ids.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6})
        RETURNING id`;
      ids.set(codigo, r.id);
    }
    await tx`SELECT configurar_cuentas_empresa(${empresa})`;
    return Object.fromEntries(ids);
  });
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally { await sql.end(); }
});

const salida = (d) => leer((tx) => registrarSalida(tx, empresa, ana, { origenId: c["110103"], fecha: "2026-03-10", ...d }));
const lineasDe = (id) => leer((tx) => tx`SELECT cu.codigo, l.debe::text, l.haber::text FROM lineas_asiento l JOIN cuentas cu ON cu.id = l.cuenta_id JOIN salidas s ON s.asiento_id = l.asiento_id WHERE s.id = ${id} ORDER BY l.orden`);

test("un ahorro con meta va a la cuenta de la meta y suma a lo acumulado; anulado no cuenta", conBase, async () => {
  const id = await leer((tx) => guardarMeta(tx, empresa, { nombre: "Fondo de emergencia", tipo: "Fondo de emergencia", meta: 5000000n, objetivo: "2027-02-10", cuentaId: c["110104"] }));
  await assert.rejects(leer((tx) => guardarMeta(tx, empresa, { nombre: " ", tipo: "", meta: 1n, objetivo: null, cuentaId: null })), /nombre/);
  await assert.rejects(leer((tx) => guardarMeta(tx, empresa, { nombre: "X", tipo: "", meta: 0n, objetivo: null, cuentaId: null })), /monto/);
  // El destino que se mande se cambia por la cuenta de la meta.
  const a = await salida({ tipo: "ahorro", destinoId: c["110105"] ?? c["110104"], monto: 1000000n, metaId: id });
  const b = await salida({ tipo: "ahorro", destinoId: c["110104"], monto: 500000n, metaId: id });
  assert.deepEqual((await lineasDe(a.id)).map((x) => [x.codigo, x.debe, x.haber]), [["110104", "10000.00", "0.00"], ["110103", "0.00", "10000.00"]]);
  await leer((tx) => anularSalida(tx, b.id, ana, "Error de monto"));
  const [m] = await leer((tx) => listarMetas(tx, "2026-11-20"));
  assert.equal(m.acumulado, 1000000n);
  assert.equal(m.falta, 4000000n);
  assert.equal(m.aporte, 1000000n, "4 meses hasta febrero");
  assert.equal(m.estado, "Activa");
  await assert.rejects(salida({ tipo: "oficina", destinoId: c["610202"], monto: 100n, metaId: id }), /solo va en un ahorro/);
  await leer((tx) => quitarMeta(tx, id));
  assert.equal((await leer((tx) => listarMetas(tx, "2026-11-20")))[0].estado, "Quitada");
});

test("deuda del negocio: el capital baja el préstamo y los intereses son gasto; la saldo baja con el capital", conBase, async () => {
  await assert.rejects(leer((tx) => guardarDeuda(tx, empresa, { acreedor: "Banco", tipo: "Financiamiento negocio", inicial: 1n, pagoMensual: 0n, cuentaPrestamoId: null, cuentaInteresId: null })), /cuenta del préstamo/);
  const id = await leer((tx) => guardarDeuda(tx, empresa, { acreedor: "Banco Popular", tipo: "Financiamiento negocio", inicial: 10000000n, pagoMensual: 1000000n, cuentaPrestamoId: c["210401"], cuentaInteresId: c["620102"] }));
  const p = await salida({ tipo: "deuda", destinoId: "", monto: 1000000n, interes: 150000n, deudaId: id });
  assert.deepEqual((await lineasDe(p.id)).map((x) => [x.codigo, x.debe, x.haber]), [["210401", "8500.00", "0.00"], ["620102", "1500.00", "0.00"], ["110103", "0.00", "10000.00"]]);
  await assert.rejects(salida({ tipo: "deuda", destinoId: "", monto: 1000n, interes: 2000n, deudaId: id }), /intereses/);
  const [x] = await leer((tx) => listarDeudas(tx, "2026-11-20"));
  assert.deepEqual([x.pagado, x.intereses, x.capital, x.saldo, x.porcentaje, x.estado], [1000000n, 150000n, 850000n, 9150000n, 8.5, "Al día"]);
  assert.equal(x.liquidacion, "2027-09", "10 cuotas de 10,000 para 91,500 de saldo");
  // Pagar todo el capital la deja saldada.
  await salida({ tipo: "deuda", destinoId: "", monto: 9150000n, deudaId: id });
  assert.equal((await leer((tx) => listarDeudas(tx, "2026-11-20")))[0].estado, "Saldada");
});

test("deuda personal: todo va a la cuenta de la socia y los intereses quedan para el saldo", conBase, async () => {
  const id = await leer((tx) => guardarDeuda(tx, empresa, { acreedor: "Tarjeta BHD", tipo: "Tarjeta de crédito", inicial: 2000000n, pagoMensual: 500000n, cuentaPrestamoId: c["210401"], cuentaInteresId: c["620102"] }));
  const p = await salida({ tipo: "deuda", destinoId: c["110204"], monto: 600000n, interes: 100000n, deudaId: id });
  assert.deepEqual((await lineasDe(p.id)).map((x) => [x.codigo, x.debe, x.haber]), [["110204", "6000.00", "0.00"], ["110103", "0.00", "6000.00"]]);
  const d = (await leer((tx) => listarDeudas(tx, "2026-11-20"))).find((y) => y.id === id);
  assert.equal(d.deNegocio, false);
  assert.equal(d.cuentaPrestamo, null, "las cuentas del préstamo solo se guardan si es del negocio");
  assert.equal(d.saldo, 1500000n);
});

test("balance por cuenta: lo que entró, lo que salió y el saldo al fin del mes", conBase, async () => {
  const b = await leer((tx) => saldosDeBancos(tx, "2026-03-01", "2026-03-31"));
  const banco = b.find((x) => x.codigo === "110103");
  assert.ok(banco.salidas > 0n);
  assert.equal(banco.saldo, banco.entradas - banco.salidas, "sin movimientos antes de marzo");
  const antes = await leer((tx) => saldosDeBancos(tx, "2026-02-01", "2026-02-28"));
  assert.equal(antes.find((x) => x.codigo === "110103").saldo, 0n);
});
