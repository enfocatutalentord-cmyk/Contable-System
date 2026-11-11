// Factura electrónica, entrega E1: las e-CF se emiten fuera (Facturador Gratuito o proveedor) y aquí se registran con su e-NCF.
// Un borrador pasa a su tipo electrónico sin tomar número del rango; la nota de una e-CF es E34; las compras con comprobante propio
// electrónico (E41, E43, E47) llevan el e-NCF que se emitió. El IT-1 cuenta las e-CF y el 607 no. Crea su propia firma y la borra.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { alertasDeEmpresa } from "../lib/alertas.ts";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { guardarBorradorCompra, registrarCompra } from "../lib/compras.ts";
import { formato607, periodoDe } from "../lib/formatos-dgii.ts";
import { calcularIt1 } from "../lib/it1.ts";
import { anularFactura, emitir, emitirNotaCredito, guardarBorradorFactura, leerCodigoEcf, leerEncf, registrarEcfEmitida, saldoFactura } from "../lib/ventas.ts";

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa, imp, cliente, consumidor, informal, exterior;

const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));
const error = async (p, re) => assert.rejects(p, (e) => { assert.match(e.message, re); return true; });

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-ecf-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  await sql.begin(async (tx) => {
    [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma e-CF ${marca}`}) RETURNING id`;
    // Lleva contabilidad: así se prueba también el asiento de la e-CF.
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, firma_id, lleva_contabilidad, emisor_ecf, ecf_desde, ecf_via)
                                 VALUES ('Emisora Electrónica SRL', ${firma}, true, true, '2026-11-01', 'gratuito') RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    const ids = new Map();
    for (const [codigo, n] of CATALOGO_RD) {
      const [c] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${empresa}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${ids.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6})
        RETURNING id`;
      ids.set(codigo, c.id);
    }
    await tx`SELECT configurar_cuentas_empresa(${empresa})`;
    await tx`SELECT configurar_tributaria(${empresa})`;
  });
  await leer(async (tx) => {
    const i = Object.fromEntries((await tx`SELECT id, nombre FROM impuestos`).map((r) => [r.nombre, r.id]));
    imp = { itbis18: i["ITBIS 18 %"] };
    [{ id: cliente }] = await tx`INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion) VALUES (${empresa}, 'Cliente SRL', '101000001', 'rnc') RETURNING id`;
    [{ id: consumidor }] = await tx`INSERT INTO clientes (empresa_id, nombre) VALUES (${empresa}, 'Consumidor final') RETURNING id`;
    [{ id: informal }] = await tx`INSERT INTO proveedores (empresa_id, nombre, rnc, tipo_identificacion) VALUES (${empresa}, 'Juan Pérez', '00100000001', 'cedula') RETURNING id`;
    [{ id: exterior }] = await tx`INSERT INTO proveedores (empresa_id, nombre, del_exterior) VALUES (${empresa}, 'Software Inc.', true) RETURNING id`;
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

const borrador = (tipo = "B01", c = cliente, fecha = "2026-11-16") => leer((tx) => guardarBorradorFactura(tx, {
  empresaId: empresa, usuarioId: ana, clienteId: c, tipo, fecha, vence: fecha, moneda: "DOP", tasa: 10000n, notas: null,
  lineas: [{ servicioId: null, descripcion: "Asesoría", cantidad: 10000n, precio: 1000000n, impuestoIds: [imp.itbis18] }],
}));
const registrar = (facturaId, encf, codigo = null, firmada = null) =>
  leer((tx) => registrarEcfEmitida(tx, { empresaId: empresa, usuarioId: ana, facturaId, encf, codigo, firmada }));

test("lee el e-NCF y el código de seguridad", () => {
  assert.equal(leerEncf("e31-0000000001"), "E310000000001");
  assert.equal(leerEncf("E31000000001"), null, "le falta un dígito");
  assert.equal(leerEncf("B0100000001"), null);
  assert.equal(leerCodigoEcf(""), null);
  assert.equal(leerCodigoEcf("Ab12cD"), "Ab12cD");
  assert.equal(leerCodigoEcf("ab-12"), false);
});

let e31;
test("el borrador B01 se registra como E31 con su e-NCF: no toma del rango y lleva su asiento", conBase, async () => {
  e31 = await borrador();
  const r = await registrar(e31, "E310000000001", "Ab12cD", "2026-11-16 10:30");
  assert.equal(r.ncf, "E310000000001");
  assert.ok(r.asiento, "lleva asiento porque la empresa lleva contabilidad");
  const [f] = await leer((tx) => tx`SELECT tipo_ncf, ncf, ncf_vence, ecf_codigo, to_char(ecf_firmada, 'YYYY-MM-DD HH24:MI') AS firmada FROM facturas WHERE id = ${e31}`);
  assert.deepEqual({ ...f }, { tipo_ncf: "E31", ncf: "E310000000001", ncf_vence: null, ecf_codigo: "Ab12cD", firmada: "2026-11-16 10:30" });
  const [{ siguiente }] = await leer((tx) => tx`SELECT siguiente::int FROM secuencias_ncf WHERE tipo = 'B01'`);
  assert.equal(siguiente, 1, "el rango B01 no se tocó");
});

test("no deja registrar un e-NCF repetido, de otro tipo o mal escrito", conBase, async () => {
  const id = await borrador();
  await error(registrar(id, "E310000000001"), /ya está registrado/);
  await error(registrar(id, "E320000000002"), /equivalente electrónico es E31/);
  await error(registrar(id, "E3100000002"), /E seguido de 12 dígitos/);
  await error(registrar(id, "E340000000002"), /no es una factura de venta/);
  await leer((tx) => tx`DELETE FROM facturas WHERE id = ${id}`);
});

test("una e-CF no se emite tomando del rango: pide su e-NCF", conBase, async () => {
  const id = await borrador("E32", consumidor);
  await error(leer((tx) => emitir(tx, { empresaId: empresa, usuarioId: ana, facturaId: id })), /se registra con su e-NCF/);
  const r = await registrar(id, "E320000000005");
  assert.equal(r.ncf, "E320000000005");
});

test("la nota de una e-CF es E34 con su e-NCF y rebaja el saldo", conBase, async () => {
  const base = { empresaId: empresa, usuarioId: ana, facturaId: e31, fecha: "2026-11-20", subtotal: 100000n, impuestoId: imp.itbis18, motivo: "Descuento" };
  await error(leer((tx) => emitirNotaCredito(tx, base)), /es una E34/);
  await error(leer((tx) => emitirNotaCredito(tx, { ...base, encf: "B040000000001" })), /E34 seguido de 10 dígitos/);
  const nota = await leer((tx) => emitirNotaCredito(tx, { ...base, encf: "E340000000001", ecfCodigo: "Zz9900" }));
  const [n] = await leer((tx) => tx`SELECT tipo_ncf, ncf, ecf_codigo, factura_origen_id FROM facturas WHERE id = ${nota}`);
  assert.deepEqual({ ...n }, { tipo_ncf: "E34", ncf: "E340000000001", ecf_codigo: "Zz9900", factura_origen_id: e31 });
  // 11,800 − (1,000 + 180) = 10,620
  assert.equal(await leer((tx) => saldoFactura(tx, e31)), 1062000n);
  await error(leer((tx) => anularFactura(tx, { empresaId: empresa, usuarioId: ana, facturaId: e31, motivo: "04" })), /notas de crédito vigentes/);
});

test("compras con comprobante propio electrónico: E41 a una persona con cédula y E47 al exterior", conBase, async () => {
  const compra = (proveedorId, tipo, ncf) => leer((tx) => guardarBorradorCompra(tx, {
    empresaId: empresa, usuarioId: ana, proveedorId, tipo, ncf, fecha: "2026-11-18", vence: "2026-11-18", moneda: "DOP", tasa: 10000n,
    tipoGasto: "02", itbisAlCosto: false, notas: null,
    lineas: [{ descripcion: "Servicio", clase: "servicio", cantidad: 10000n, precio: 500000n, cuentaId: null, impuestoIds: [imp.itbis18] }],
  }));
  const reg = (id) => leer((tx) => registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id }));
  assert.equal((await reg(await compra(informal, "E41", "E410000000001"))).ncf, "E410000000001");
  assert.equal((await reg(await compra(exterior, "E47", "E470000000001"))).ncf, "E470000000001");
  await error(reg(await compra(exterior, "E41", "E410000000002")), /personas físicas con cédula/);
  await error(reg(await compra(informal, "E43", null)), /e-NCF del E43/);
});

test("alerta de la firma: sin fecha de emisor electrónico, aviso 30 días antes del 15-nov y urgente desde ese día", conBase, async () => {
  await sql`UPDATE empresas SET emisor_ecf = false, ecf_desde = NULL WHERE id = ${empresa}`;
  const de = (hoy) => leer((tx) => alertasDeEmpresa(tx, { empresaId: empresa, hoy, propia: false })).then((a) => a.filter((x) => x.tipo === "ecf"));
  assert.equal((await de("2026-10-01")).length, 0);
  assert.equal((await de("2026-11-01"))[0].nivel, "aviso");
  assert.equal((await de("2026-11-16"))[0].nivel, "urgente");
  await sql`UPDATE empresas SET emisor_ecf = true, ecf_desde = '2026-11-01' WHERE id = ${empresa}`;
  assert.equal((await de("2026-11-16")).length, 0);
});

test("el IT-1 cuenta las e-CF (E31 en la casilla 1, E32 en la 2, E34 en la 4) y el 607 no las lleva", conBase, async () => {
  const r = await leer((tx) => calcularIt1(tx, periodoDe("202611"), {}));
  const v = (k) => r.valores[k];
  assert.deepEqual([v("A1c"), v("A1"), v("A2c"), v("A2"), v("A4c"), v("A4")], [100n, 1000000n, 100n, 1000000n, 100n, 100000n]);
  const f607 = await leer((tx) => formato607(tx, periodoDe("202611")));
  assert.equal(f607.filas.filter((f) => f.ncf.startsWith("E")).length, 0);
});
