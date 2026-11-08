// Rediseño R5: un cliente sin contabilidad. Sus estados salen de las facturas emitidas y las compras registradas (los asientos que
// tengan no cuentan) más el formulario de saldos del balance. Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { insertarAsiento } from "../lib/asientos.ts";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { balanceGeneral, estadoResultados } from "../lib/estados.ts";
import { llevaContabilidad, saldosPorCuenta } from "../lib/reportes.ts";
import { leerSaldos } from "../lib/saldos-registro.ts";

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
const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

test("el formulario de saldos: montos en positivo; los años anteriores pueden tener pérdida", () => {
  assert.deepEqual(leerSaldos(fd({ efectivo: "1,500.50", capital: "100000", acumulados: "-2000" })),
    { efectivo: "1500.50", capital: "100000.00", acumulados: "-2000.00" });
  assert.match(leerSaldos(fd({ efectivo: "-5" })), /no puede ser negativo/);
  assert.match(leerSaldos(fd({ cxc: "abc" })), /no es válido/);
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-reg-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  await sql.begin(async (tx) => {
    [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma registro ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Colmado Registro SRL', '130000044', ${firma}) RETURNING id`;
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
    // Un asiento suelto que no debe contar (al cliente no se le lleva contabilidad).
    await insertarAsiento(tx, { empresaId: empresa, usuarioId: ana, fecha: "2026-03-01", concepto: "viejo", origen: "manual",
      lineas: [{ cuentaId: cuentas["110101"], debe: 99900n, haber: 0n }, { cuentaId: cuentas["410101"], debe: 0n, haber: 99900n }] });
    const [{ id: cliente }] = await tx`INSERT INTO clientes (empresa_id, nombre) VALUES (${empresa}, 'Consumidor') RETURNING id`;
    const [{ id: proveedor }] = await tx`INSERT INTO proveedores (empresa_id, nombre, rnc) VALUES (${empresa}, 'Proveedor', '132151119') RETURNING id`;
    // Factura de 10,000 (ingreso 410101) y nota de crédito de 1,000; compra de 4,000 + ITBIS 720 al costo (610214).
    let origen = null;
    for (const [tipo, ncf, monto] of [["B01", "B0100000001", "10000.00"], ["B04", "B0400000001", "1000.00"]]) {
      const [{ id }] = await tx`INSERT INTO facturas (empresa_id, tipo_ncf, cliente_id, fecha, vence, moneda, tasa, subtotal, itbis, total, estado, creado_por, factura_origen_id)
        VALUES (${empresa}, ${tipo}, ${cliente}, '2026-04-10', '2026-04-10', 'DOP', 1, ${monto}, 0, ${monto}, 'borrador', ${ana}, ${tipo === "B04" ? origen : null}) RETURNING id`;
      origen = origen ?? id;
      await tx`INSERT INTO lineas_factura (factura_id, empresa_id, orden, descripcion, cantidad, precio, cuenta_ingreso_id, subtotal, itbis, otros)
        VALUES (${id}, ${empresa}, 1, 'Venta', 1, ${monto}, ${cuentas["410101"]}, ${monto}, 0, 0)`;
      const as = await insertarAsiento(tx, { empresaId: empresa, usuarioId: ana, fecha: "2026-04-10", concepto: ncf, origen: "factura",
        lineas: [{ cuentaId: cuentas["110201"], debe: 1n, haber: 0n }, { cuentaId: cuentas["410101"], debe: 0n, haber: 1n }] });
      await tx`UPDATE facturas SET estado = 'emitida', ncf = ${ncf}, ncf_vence = '2027-12-31', asiento_id = ${as.id}, emitida_por = ${ana}, emitida_en = now() WHERE id = ${id}`;
    }
    const [{ id: compra }] = await tx`INSERT INTO compras (empresa_id, estado, tipo_comprobante, ncf, proveedor_id, fecha, vence, moneda, tasa, tipo_gasto, itbis_al_costo, subtotal, itbis, otros_impuestos, total, creado_por)
      VALUES (${empresa}, 'borrador', 'B01', 'B0100000099', ${proveedor}, '2026-04-12', '2026-04-12', 'DOP', 1, '02', true, 4000, 720, 0, 4720, ${ana}) RETURNING id`;
    await tx`INSERT INTO lineas_compra (compra_id, empresa_id, orden, descripcion, clase, cantidad, precio, cuenta_id, subtotal, itbis, otros)
      VALUES (${compra}, ${empresa}, 1, 'Luz', 'servicio', 1, 4000, ${cuentas["610214"]}, 4000, 720, 0)`;
    const ac = await insertarAsiento(tx, { empresaId: empresa, usuarioId: ana, fecha: "2026-04-12", concepto: "compra", origen: "compra",
      lineas: [{ cuentaId: cuentas["610214"], debe: 1n, haber: 0n }, { cuentaId: cuentas["210101"], debe: 0n, haber: 1n }] });
    await tx`UPDATE compras SET estado = 'registrada', asiento_id = ${ac.id}, registrada_por = ${ana}, registrada_en = now() WHERE id = ${compra}`;
    await tx`INSERT INTO saldos_registro (empresa_id, fecha, montos) VALUES (${empresa}, '2026-12-31',
      ${tx.json({ efectivo: "20000.00", cxc: "4280.00", cxp: "0.00", capital: "10000.00", acumulados: "10000.00" })})`;
  });
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

test("un cliente sin la marca no lleva contabilidad", conBase, async () => {
  assert.equal(await leer((tx) => llevaContabilidad(tx)), false);
});

test("resultados de las facturas y compras, no de los asientos", conBase, async () => {
  const s = await leer((tx) => saldosPorCuenta(tx, "2026-01-01", "2026-12-31"));
  const c = (codigo) => s.find((x) => x.codigo === codigo);
  assert.equal(c("410101").haber - c("410101").debe, 900000n, "10,000 − nota de 1,000 (el asiento suelto de 999 no cuenta)");
  assert.equal(c("610214").debe, 472000n, "4,000 + ITBIS al costo 720");
  const er = await leer((tx) => estadoResultados(tx, [{ titulo: "2026", desde: "2026-01-01", hasta: "2026-12-31" }], "cuenta"));
  const neta = er.filas.find((f) => /neta/.test(f.texto));
  assert.equal(neta.valores[0], 428000n, "9,000 − 4,720");
});

test("el balance toma el formulario y cuadra con el resultado del ejercicio", conBase, async () => {
  const b = await leer((tx) => balanceGeneral(tx, [{ titulo: "2026", desde: "2026-12-31", hasta: "2026-12-31" }], "cuenta", 12));
  const fila = (t) => b.filas.find((f) => f.texto === t)?.valores[0];
  assert.equal(fila("Total activos"), 2428000n, "20,000 + 4,280");
  assert.equal(fila("Resultado del ejercicio en curso"), 428000n);
  assert.equal(fila("Total pasivos y patrimonio"), 2428000n, "10,000 capital + 10,000 años anteriores + 4,280 del ejercicio");
  assert.deepEqual(b.cuadra, [true]);
  assert.equal(b.filas.some((f) => f.texto === "Resultados de ejercicios anteriores sin cerrar"), false);
});
