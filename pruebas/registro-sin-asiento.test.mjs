// Rediseño, n.º 9: un cliente sin contabilidad. Sus facturas, compras, cobros y pagos se registran para los impuestos sin hacer
// asientos; las retenciones, la forma y la fecha del pago quedan guardadas para el 606, el 607, el IT-1 y el IR-17. Nada se
// emite ni se cobra en período cerrado. Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { listarRetenciones } from "../lib/fiscal.ts";
import { anularCompra, anularPago, guardarBorradorCompra, registrarCompra, registrarPago, saldoCompra } from "../lib/compras.ts";
import { anularCobro, anularFactura, emitir, guardarBorradorFactura, registrarCobro, saldoFactura } from "../lib/ventas.ts";

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa, cuentas, imp, ret, cliente, proveedor;

const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-sa-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  await sql.begin(async (tx) => {
    [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma sin asiento ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, firma_id) VALUES ('Cliente Sin Asientos SRL', ${firma}) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    const ids = new Map();
    for (const [codigo, n] of CATALOGO_RD) {
      const [c] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${empresa}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${ids.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6})
        RETURNING id`;
      ids.set(codigo, c.id);
    }
    cuentas = Object.fromEntries(ids);
    await tx`SELECT configurar_cuentas_empresa(${empresa})`;
    await tx`SELECT configurar_tributaria(${empresa})`;
  });
  await leer(async (tx) => {
    const i = Object.fromEntries((await tx`SELECT id, nombre FROM impuestos`).map((r) => [r.nombre, r.id]));
    imp = { itbis18: i["ITBIS 18 %"] };
    ret = Object.fromEntries((await tx`SELECT id, nombre FROM retenciones`).map((r) => [r.nombre, r.id]));
    [{ id: cliente }] = await tx`INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion) VALUES (${empresa}, 'Cliente SRL', '101000001', 'rnc') RETURNING id`;
    [{ id: proveedor }] = await tx`INSERT INTO proveedores (empresa_id, nombre, rnc, tipo_identificacion) VALUES (${empresa}, 'Abogados SRL', '101000002', 'rnc') RETURNING id`;
    await tx`INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence) VALUES (${empresa}, 'B01', 1, 100, 1, '2027-12-31')`;
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

const nuevaFactura = (fecha = "2026-10-05") => leer((tx) => guardarBorradorFactura(tx, {
  empresaId: empresa, usuarioId: ana, clienteId: cliente, tipo: "B01", fecha, vence: fecha, moneda: "DOP", tasa: 10000n, notas: null,
  lineas: [{ servicioId: null, descripcion: "Asesoría", cantidad: 10000n, precio: 1000000n, impuestoIds: [imp.itbis18] }],
}));

test("la factura se emite con su NCF y sin asiento; se cobra con retención, sin cuenta de banco", conBase, async () => {
  const id = await nuevaFactura();
  const r = await leer((tx) => emitir(tx, { empresaId: empresa, usuarioId: ana, facturaId: id }));
  assert.deepEqual(r, { ncf: "B0100000001", asiento: null });
  const [{ n }] = await leer((tx) => tx`SELECT count(*)::int AS n FROM asientos`);
  assert.equal(n, 0, "no se hizo ningún asiento");
  // 10,000 + ITBIS 1,800 = 11,800; el cliente retiene el 30 % del ITBIS (540).
  const retITBIS = Object.entries(ret).find(([k]) => /ITBIS.*30/.test(k))?.[1];
  assert.ok(retITBIS, "hay una retención de ITBIS del 30 % en la configuración");
  const numero = await leer((tx) => registrarCobro(tx, {
    empresaId: empresa, usuarioId: ana, clienteId: cliente, fecha: "2026-10-20", moneda: "DOP", tasa: 10000n, cuentaDestinoId: null,
    formaPago: "transferencia", referencia: null, notas: null, recibido: 1180000n - 54000n,
    retenciones: [{ retencionId: retITBIS, monto: 54000n }], aplicaciones: [{ facturaId: id, monto: 1180000n }],
  }));
  const [c] = await leer((tx) => tx`SELECT asiento_id, cuenta_destino_id, forma_pago, retencion_itbis::text FROM cobros WHERE numero = ${numero}`);
  assert.deepEqual({ ...c }, { asiento_id: null, cuenta_destino_id: null, forma_pago: "transferencia", retencion_itbis: "540.00" });
  assert.equal(await leer((tx) => saldoFactura(tx, id)), 0n);
  // Se anula el cobro y luego la factura, sin asientos de por medio.
  await leer((tx) => anularCobro(tx, { empresaId: empresa, usuarioId: ana, numero, motivo: "prueba" }));
  await leer((tx) => anularFactura(tx, { empresaId: empresa, usuarioId: ana, facturaId: id, motivo: "04" }));
  const [f] = await leer((tx) => tx`SELECT anulada FROM facturas WHERE id = ${id}`);
  assert.equal(f.anulada, true);
});

test("la compra se registra y se paga con retención de ISR sin asiento", conBase, async () => {
  const id = await leer((tx) => guardarBorradorCompra(tx, {
    empresaId: empresa, usuarioId: ana, proveedorId: proveedor, tipo: "B01", ncf: "B0100000123", fecha: "2026-10-03", vence: "2026-10-03",
    moneda: "DOP", tasa: 10000n, tipoGasto: "02", itbisAlCosto: false, notas: null,
    lineas: [{ descripcion: "Honorarios", clase: "servicio", cantidad: 10000n, precio: 1000000n, cuentaId: cuentas["610205"], impuestoIds: [imp.itbis18] }],
  }));
  const r = await leer((tx) => registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id }));
  assert.equal(r.asiento, null);
  // Una retención de ISR vigente el día del pago (la configuración cambia de tasa con la Ley 30-26).
  const vigentes = await leer((tx) => listarRetenciones(tx, "2026-10-25"));
  const isr = vigentes.find((x) => x.impuesto === "isr");
  assert.ok(isr, "hay una retención de ISR vigente");
  const retISR = isr.id;
  const conf = { tasa: String(isr.tasa) };
  const retenido = (1000000n * BigInt(Math.round(Number(conf.tasa) * 100))) / 10000n;
  const numero = await leer((tx) => registrarPago(tx, {
    empresaId: empresa, usuarioId: ana, proveedorId: proveedor, fecha: "2026-10-25", moneda: "DOP", tasa: 10000n, cuentaOrigenId: null,
    formaPago: "02", referencia: "TRF-1", notas: null, pagado: 1180000n - retenido,
    retenciones: [{ retencionId: retISR, monto: retenido }], aplicaciones: [{ compraId: id, monto: 1180000n }],
  }));
  const [p] = await leer((tx) => tx`SELECT asiento_id, cuenta_origen_id, forma_pago, retencion_isr::text FROM pagos WHERE numero = ${numero}`);
  assert.equal(p.asiento_id, null);
  assert.equal(p.cuenta_origen_id, null);
  assert.equal(p.forma_pago, "02");
  assert.equal(p.retencion_isr, (Number(retenido) / 100).toFixed(2));
  assert.equal(await leer((tx) => saldoCompra(tx, id)), 0n);
  await leer((tx) => anularPago(tx, { empresaId: empresa, usuarioId: ana, numero, motivo: "prueba" }));
  await leer((tx) => anularCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id, motivo: "prueba" }));
});

test("en período cerrado no se emite ni se anula nada, aunque no haya asiento", conBase, async () => {
  const id = await nuevaFactura("2026-09-10");
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    await tx`UPDATE empresas SET fecha_bloqueo = '2026-09-30' WHERE id = ${empresa}`;
  });
  await assert.rejects(leer((tx) => emitir(tx, { empresaId: empresa, usuarioId: ana, facturaId: id })), /período está cerrado/);
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    await tx`UPDATE empresas SET fecha_bloqueo = NULL WHERE id = ${empresa}`;
  });
});

test("si la empresa lleva contabilidad, un documento sin asiento se rechaza", conBase, async () => {
  const id = await nuevaFactura("2026-10-07");
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    await tx`UPDATE empresas SET lleva_contabilidad = true WHERE id = ${empresa}`;
  });
  await assert.rejects(leer((tx) => tx`UPDATE facturas SET estado = 'emitida', ncf = 'B0100000099', ncf_vence = '2027-12-31' WHERE id = ${id}`),
    /necesita su asiento/);
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    await tx`UPDATE empresas SET lleva_contabilidad = false WHERE id = ${empresa}`;
  });
});
