// Fase 3: ventas y CxC con la lógica real (lib/ventas.ts) sobre la base, con el rol de la app y el aislamiento por empresa.
// Necesita DATABASE_URL (base de pruebas; crea sus propias firmas y las borra al final).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import {
  anularCobro, anularFactura, descartarBorradorFactura, emitir, emitirNotaCredito, guardarBorradorFactura, registrarCobro, saldoFactura,
} from "../lib/ventas.ts";

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, beto, empresa, otra, cuentas, imp, ret, clientes;

function conEmpresa(id, usuario, fn) {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
    await tx`SELECT set_config('app.usuario_id', ${usuario}, true)`;
    await tx`SET LOCAL ROLE contable_app`;
    return fn(tx);
  });
}

const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));

async function crearEmpresa(nombre) {
  return sql.begin(async (tx) => {
    const [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma ventas ${marca} ${nombre}`}) RETURNING id`;
    const [{ id }] = await tx`INSERT INTO empresas (nombre, firma_id) VALUES (${nombre}, ${firma}) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
    const ids = new Map();
    for (const [codigo, n] of CATALOGO_RD) {
      const [c] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${id}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${ids.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6})
        RETURNING id`;
      ids.set(codigo, c.id);
    }
    await tx`SELECT configurar_cuentas_empresa(${id})`;
    await tx`SELECT configurar_tributaria(${id})`;
    return { id, cuentas: Object.fromEntries(ids) };
  });
}

const leer = (id, fn) => conEmpresa(id, ana, fn);
const centavos = (t) => BigInt(Math.round(Number(t) * 100));
const linea = (descripcion, monto, impuestoIds) => ({ servicioId: null, descripcion, cantidad: 10000n, precio: monto, impuestoIds });
const factura = (extra = {}) => ({
  empresaId: empresa, usuarioId: ana, clienteId: clientes.conRnc, tipo: "B01", fecha: "2026-10-05", vence: "2026-11-04",
  moneda: "DOP", tasa: 10000n, notas: null,
  lineas: [linea("Asesoría contable", 1000000n, [imp.itbis18]), linea("Libros de texto", 100000n, [imp.exento])],
  ...extra,
});
const rango = (tipo) => leer(empresa, (tx) => tx`
  INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence) VALUES (${empresa}, ${tipo}, 1, 100, 1, '2027-12-31')`);

async function lineasAsiento(asientoId) {
  return [...await leer(empresa, (tx) => tx`
    SELECT c.codigo, sum(l.debe)::text AS debe, sum(l.haber)::text AS haber FROM lineas_asiento l JOIN cuentas c ON c.id = l.cuenta_id
     WHERE l.asiento_id = ${asientoId} GROUP BY c.codigo ORDER BY c.codigo`)].map((r) => ({ ...r }));
}

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: beto }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`beto-${marca}@x.do`}, 'Beto', 'x') RETURNING id`;
  ({ id: empresa, cuentas } = await crearEmpresa("Ventas A"));
  ({ id: otra } = await crearEmpresa("Ventas B"));
  await leer(empresa, async (tx) => {
    const ids = await tx`SELECT id, nombre FROM impuestos`;
    const porNombre = Object.fromEntries(ids.map((r) => [r.nombre, r.id]));
    const [p] = await tx`INSERT INTO impuestos (empresa_id, nombre, tipo, tasa, cuenta_ventas_id, cuenta_compras_id)
      VALUES (${empresa}, 'Propina legal 10 %', 'propina', 10, ${cuentas["210201"]}, ${cuentas["110401"]}) RETURNING id`;
    imp = { itbis18: porNombre["ITBIS 18 %"], itbis16: porNombre["ITBIS 16 %"], exento: porNombre["Exento"], propina: p.id };
    ret = Object.fromEntries((await tx`SELECT id, nombre FROM retenciones`).map((r) => [r.nombre, r.id]));
    const [a] = await tx`INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion) VALUES (${empresa}, 'Cliente SRL', '101000001', 'rnc') RETURNING id`;
    const [b] = await tx`INSERT INTO clientes (empresa_id, nombre) VALUES (${empresa}, 'Consumidor final') RETURNING id`;
    clientes = { conRnc: a.id, sinRnc: b.id };
  });
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id IN (${empresa}, ${otra})`;
    await sql`DELETE FROM firmas WHERE nombre LIKE ${`Firma ventas ${marca}%`}`;
    await sql`DELETE FROM usuarios WHERE id IN (${ana}, ${beto})`;
  } finally {
    await sql.end();
  }
});

test("el borrador guarda líneas e impuestos de la configuración, sin NCF ni asiento", conBase, async () => {
  const id = await leer(empresa, (tx) => guardarBorradorFactura(tx, factura()));
  const [f] = await leer(empresa, (tx) => tx`SELECT estado, ncf, asiento_id, subtotal::text, itbis::text, otros_impuestos::text, total::text FROM facturas WHERE id = ${id}`);
  assert.deepEqual(f, { estado: "borrador", ncf: null, asiento_id: null, subtotal: "11000.00", itbis: "1800.00", otros_impuestos: "0.00", total: "12800.00" });
  const imps = await leer(empresa, (tx) => tx`SELECT tasa::int AS tasa, monto::text FROM impuestos_linea_factura WHERE factura_id = ${id} ORDER BY tasa DESC`);
  assert.deepEqual(imps.map((i) => [i.tasa, i.monto]), [[18, "1800.00"], [0, "0.00"]]);
});

test("sin rango autorizado no se emite; con rango toma el NCF y el asiento cuadra con las cuentas de la configuración", conBase, async () => {
  const id = await leer(empresa, (tx) => guardarBorradorFactura(tx, factura()));
  await assert.rejects(leer(empresa, (tx) => emitir(tx, { empresaId: empresa, usuarioId: ana, facturaId: id })), /No hay comprobantes B01/);
  await rango("B01");
  const r = await leer(empresa, (tx) => emitir(tx, { empresaId: empresa, usuarioId: ana, facturaId: id }));
  assert.equal(r.ncf, "B0100000001");
  const [f] = await leer(empresa, (tx) => tx`SELECT estado, asiento_id FROM facturas WHERE id = ${id}`);
  assert.equal(f.estado, "emitida");
  assert.deepEqual(await lineasAsiento(f.asiento_id), [
    { codigo: "110201", debe: "12800.00", haber: "0.00" },
    { codigo: "210201", debe: "0.00", haber: "1800.00" },
    { codigo: "410101", debe: "0.00", haber: "11000.00" },
  ]);
});

test("lo emitido no se modifica, no se borra y no recibe líneas nuevas", conBase, async () => {
  const [f] = await leer(empresa, (tx) => tx`SELECT id FROM facturas WHERE ncf = 'B0100000001'`);
  await assert.rejects(leer(empresa, (tx) => tx`UPDATE facturas SET notas = 'cambio' WHERE id = ${f.id}`), /no se modifica/);
  await assert.rejects(leer(empresa, (tx) => tx`DELETE FROM facturas WHERE id = ${f.id}`), /no se borra/);
  await assert.rejects(leer(empresa, (tx) => tx`UPDATE lineas_factura SET precio = 1 WHERE factura_id = ${f.id}`), /no se modifican/);
  await assert.rejects(leer(empresa, (tx) => tx`DELETE FROM impuestos_linea_factura WHERE factura_id = ${f.id}`), /no se modifican/);
});

test("B01 exige RNC o cédula del cliente; un borrador se puede descartar, lo emitido no", conBase, async () => {
  const id = await leer(empresa, (tx) => guardarBorradorFactura(tx, factura({ clienteId: clientes.sinRnc })));
  await assert.rejects(leer(empresa, (tx) => emitir(tx, { empresaId: empresa, usuarioId: ana, facturaId: id })), /necesita RNC o cédula/);
  await leer(empresa, (tx) => descartarBorradorFactura(tx, id));
  const [{ n }] = await leer(empresa, (tx) => tx`SELECT count(*)::int AS n FROM facturas WHERE id = ${id}`);
  assert.equal(n, 0);
  const [e] = await leer(empresa, (tx) => tx`SELECT id FROM facturas WHERE ncf = 'B0100000001'`);
  await assert.rejects(leer(empresa, (tx) => descartarBorradorFactura(tx, e.id)), /Solo se descartan borradores/);
});

test("ITBIS y propina legal sobre el mismo consumo, en sus cuentas", conBase, async () => {
  await rango("B02");
  const id = await leer(empresa, (tx) => guardarBorradorFactura(tx, factura({
    clienteId: clientes.sinRnc, tipo: "B02", lineas: [linea("Cena", 200000n, [imp.itbis18, imp.propina])],
  })));
  const r = await leer(empresa, (tx) => emitir(tx, { empresaId: empresa, usuarioId: ana, facturaId: id }));
  assert.equal(r.ncf, "B0200000001");
  const [f] = await leer(empresa, (tx) => tx`SELECT itbis::text, otros_impuestos::text, total::text, asiento_id FROM facturas WHERE id = ${id}`);
  assert.deepEqual([f.itbis, f.otros_impuestos, f.total], ["360.00", "200.00", "2560.00"]);
  const asiento = await lineasAsiento(f.asiento_id);
  assert.equal(asiento.find((l) => l.codigo === "110201").debe, "2560.00");
  assert.equal(asiento.find((l) => l.codigo === "210201").haber, "560.00"); // ITBIS + propina (la propina se configuró en la misma cuenta)
});

test("un impuesto que no está vigente en la fecha no se puede usar; sin ser contribuyente de ITBIS solo exento", conBase, async () => {
  await leer(empresa, (tx) => tx`UPDATE impuestos SET vigente_hasta = '2026-09-30' WHERE id = ${imp.itbis16}`);
  await assert.rejects(leer(empresa, (tx) => guardarBorradorFactura(tx, factura({ lineas: [linea("X", 1000n, [imp.itbis16])] }))), /no está vigente/);
  await leer(empresa, (tx) => tx`UPDATE empresas SET contribuye_itbis = false WHERE id = ${empresa}`);
  await assert.rejects(leer(empresa, (tx) => guardarBorradorFactura(tx, factura())), /no está registrada como contribuyente de ITBIS/);
  await leer(empresa, (tx) => guardarBorradorFactura(tx, factura({ lineas: [linea("Exento", 1000n, [imp.exento])] })));
  await leer(empresa, (tx) => tx`UPDATE empresas SET contribuye_itbis = true WHERE id = ${empresa}`);
});

test("con aprobación obligatoria, quien registró no emite; otra persona sí", conBase, async () => {
  await leer(empresa, (tx) => tx`UPDATE empresas SET requiere_aprobacion = true WHERE id = ${empresa}`);
  const id = await leer(empresa, (tx) => guardarBorradorFactura(tx, factura()));
  await assert.rejects(leer(empresa, (tx) => emitir(tx, { empresaId: empresa, usuarioId: ana, facturaId: id })), /otra persona debe aprobar/);
  const r = await conEmpresa(empresa, beto, (tx) => emitir(tx, { empresaId: empresa, usuarioId: beto, facturaId: id }));
  assert.equal(r.ncf, "B0100000002");
  await leer(empresa, (tx) => tx`UPDATE empresas SET requiere_aprobacion = false WHERE id = ${empresa}`);
});

test("nota de crédito B04 con la tasa de la factura, sin pasar del saldo", conBase, async () => {
  await rango("B04");
  const [f] = await leer(empresa, (tx) => tx`SELECT id FROM facturas WHERE ncf = 'B0100000001'`);
  const nc = await leer(empresa, (tx) => emitirNotaCredito(tx, {
    empresaId: empresa, usuarioId: ana, facturaId: f.id, fecha: "2026-10-10", subtotal: 100000n, impuestoId: imp.itbis18, motivo: "Descuento",
  }));
  const [n] = await leer(empresa, (tx) => tx`SELECT ncf, total::text, asiento_id FROM facturas WHERE id = ${nc}`);
  assert.deepEqual([n.ncf, n.total], ["B0400000001", "1180.00"]);
  assert.deepEqual(await lineasAsiento(n.asiento_id), [
    { codigo: "110201", debe: "0.00", haber: "1180.00" },
    { codigo: "210201", debe: "180.00", haber: "0.00" },
    { codigo: "410103", debe: "1000.00", haber: "0.00" },
  ]);
  assert.equal(await leer(empresa, (tx) => saldoFactura(tx, f.id)), 1162000n);
  await assert.rejects(leer(empresa, (tx) => emitirNotaCredito(tx, {
    empresaId: empresa, usuarioId: ana, facturaId: f.id, fecha: "2026-10-10", subtotal: 2000000n, impuestoId: imp.itbis18, motivo: "Demasiado",
  })), /saldo pendiente/);
  await assert.rejects(leer(empresa, (tx) => emitirNotaCredito(tx, {
    empresaId: empresa, usuarioId: ana, facturaId: f.id, fecha: "2026-10-10", subtotal: 1000n, impuestoId: imp.propina, motivo: "Otro impuesto",
  })), /impuestos de la factura original/);
});

test("cobro con retenciones de la configuración: cada una a su cuenta y el saldo queda en cero", conBase, async () => {
  const [f] = await leer(empresa, (tx) => tx`SELECT id FROM facturas WHERE ncf = 'B0100000001'`);
  const base = {
    empresaId: empresa, usuarioId: ana, clienteId: clientes.conRnc, fecha: "2026-10-20", moneda: "DOP", tasa: 10000n,
    cuentaDestinoId: cuentas["110103"], formaPago: "transferencia", referencia: "TR-1", notas: null,
  };
  // Saldo 11,620 = 12,800 − 1,180. Retenciones: 30 % del ITBIS (1,620) = 486; ISR 15 % de 9,900 = 1,485.
  const retenciones = [{ retencionId: ret["ITBIS retenido 30 %"], monto: 48600n }, { retencionId: ret["ISR honorarios a personas físicas 15 %"], monto: 148500n }];
  const aplicaciones = [{ facturaId: f.id, monto: 1162000n }];
  await assert.rejects(leer(empresa, (tx) => registrarCobro(tx, { ...base, recibido: 1162000n, retenciones, aplicaciones })), /debe ser igual/);
  await assert.rejects(leer(empresa, (tx) => registrarCobro(tx, {
    ...base, recibido: 1162000n - 100000n, retenciones: [{ retencionId: ret["ISR honorarios a personas físicas 10 %"], monto: 100000n }], aplicaciones,
  })), /no está vigente/);
  const numero = await leer(empresa, (tx) => registrarCobro(tx, { ...base, recibido: 1162000n - 48600n - 148500n, retenciones, aplicaciones }));
  const [c] = await leer(empresa, (tx) => tx`SELECT asiento_id, retencion_itbis::text, retencion_isr::text FROM cobros WHERE numero = ${numero}`);
  assert.deepEqual([c.retencion_itbis, c.retencion_isr], ["486.00", "1485.00"]);
  assert.deepEqual(await lineasAsiento(c.asiento_id), [
    { codigo: "110103", debe: "9649.00", haber: "0.00" },
    { codigo: "110201", debe: "0.00", haber: "11620.00" },
    { codigo: "110403", debe: "1485.00", haber: "0.00" },
    { codigo: "110404", debe: "486.00", haber: "0.00" },
  ]);
  assert.equal(await leer(empresa, (tx) => saldoFactura(tx, f.id)), 0n);
});

test("una factura con cobros no se anula; anulado el cobro, sí (y su asiento queda anulado)", conBase, async () => {
  const [f] = await leer(empresa, (tx) => tx`SELECT id, asiento_id FROM facturas WHERE ncf = 'B0100000001'`);
  await assert.rejects(leer(empresa, (tx) => anularFactura(tx, { empresaId: empresa, usuarioId: ana, facturaId: f.id, motivo: "04" })), /anúlalos primero/);
  const [{ numero }] = await leer(empresa, (tx) => tx`SELECT max(numero) AS numero FROM cobros`);
  await leer(empresa, (tx) => anularCobro(tx, { empresaId: empresa, usuarioId: ana, numero, motivo: "Error" }));
  const [nc] = await leer(empresa, (tx) => tx`SELECT id FROM facturas WHERE ncf = 'B0400000001'`);
  await leer(empresa, (tx) => anularFactura(tx, { empresaId: empresa, usuarioId: ana, facturaId: nc.id, motivo: "04" }));
  await leer(empresa, (tx) => anularFactura(tx, { empresaId: empresa, usuarioId: ana, facturaId: f.id, motivo: "04" }));
  const [a] = await leer(empresa, (tx) => tx`SELECT estado FROM asientos WHERE id = ${f.asiento_id}`);
  assert.equal(a.estado, "anulado");
  await assert.rejects(leer(empresa, (tx) => tx`UPDATE facturas SET anulada = false WHERE id = ${f.id}`), /no se puede reactivar/);
});

test("no se mezclan empresas: impuestos, servicios ni facturas de otra", conBase, async () => {
  await assert.rejects(conEmpresa(otra, ana, (tx) => tx`
    INSERT INTO servicios (empresa_id, nombre, precio, impuesto_id) VALUES (${otra}, 'Ajeno', 1, ${imp.itbis18})`), /no pertenece a esta empresa/);
  await assert.rejects(conEmpresa(otra, ana, (tx) => guardarBorradorFactura(tx, { ...factura(), empresaId: otra })), /no existe/);
  const [{ n }] = await conEmpresa(otra, ana, (tx) => tx`SELECT count(*)::int AS n FROM facturas`);
  assert.equal(n, 0);
});
