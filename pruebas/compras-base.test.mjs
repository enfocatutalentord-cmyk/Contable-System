// Fase 4: compras y cuentas por pagar con la lógica real (lib/compras.ts) sobre la base, con el rol de la app.
// Necesita DATABASE_URL (base de pruebas; crea sus propias firmas y las borra al final).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import {
  anularCompra, anularPago, descartarBorradorCompra, guardarBorradorCompra, registrarCompra, registrarPago, saldoCompra,
} from "../lib/compras.ts";
import { antiguedadCxp, estadoCuentaProveedor } from "../lib/cxp.ts";

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, beto, empresa, otra, cuentas, imp, ret, prov;

function conEmpresa(id, usuario, fn) {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
    await tx`SELECT set_config('app.usuario_id', ${usuario}, true)`;
    await tx`SET LOCAL ROLE contable_app`;
    return fn(tx);
  });
}
const leer = (fn) => conEmpresa(empresa, ana, fn);
const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));

async function crearEmpresa(nombre) {
  return sql.begin(async (tx) => {
    const [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma compras ${marca} ${nombre}`}) RETURNING id`;
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

async function lineasAsiento(asientoId) {
  return [...await leer((tx) => tx`
    SELECT c.codigo, sum(l.debe)::text AS debe, sum(l.haber)::text AS haber FROM lineas_asiento l JOIN cuentas c ON c.id = l.cuenta_id
     WHERE l.asiento_id = ${asientoId} GROUP BY c.codigo ORDER BY c.codigo`)].map((r) => ({ ...r }));
}

const linea = (descripcion, monto, impuestoIds, extra = {}) => ({ descripcion, clase: "servicio", cantidad: 10000n, precio: monto, cuentaId: null, impuestoIds, ...extra });
const compra = (extra = {}) => ({
  empresaId: empresa, usuarioId: ana, proveedorId: prov.abogados, tipo: "B01", ncf: "B0100000123", fecha: "2026-10-03", vence: "2026-11-02",
  moneda: "DOP", tasa: 10000n, tipoGasto: "02", itbisAlCosto: false, notas: null,
  lineas: [linea("Honorarios legales", 1000000n, [imp.itbis18], { cuentaId: cuentas["610205"] })],
  ...extra,
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-c-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: beto }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`beto-c-${marca}@x.do`}, 'Beto', 'x') RETURNING id`;
  ({ id: empresa, cuentas } = await crearEmpresa("Compras A"));
  ({ id: otra } = await crearEmpresa("Compras B"));
  await leer(async (tx) => {
    imp = Object.fromEntries((await tx`SELECT id, nombre FROM impuestos`).map((r) => [r.nombre, r.id]));
    imp = { itbis18: imp["ITBIS 18 %"], exento: imp["Exento"] };
    ret = Object.fromEntries((await tx`SELECT id, nombre FROM retenciones`).map((r) => [r.nombre, r.id]));
    const p = async (nombre, extra) => (await tx`INSERT INTO proveedores ${tx({ empresa_id: empresa, nombre, ...extra })} RETURNING id`)[0].id;
    prov = {
      abogados: await p("Abogados SRL", { tipo_identificacion: "rnc", rnc: "101000002" }),
      juan: await p("Juan Pérez", { tipo_identificacion: "cedula", rnc: "00100000001" }),
      exterior: await p("Software Inc", { del_exterior: true }),
      colmado: await p("Colmado La Esquina", {}),
    };
    await tx`INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence) VALUES (${empresa}, 'B11', 1, 50, 1, '2027-12-31')`;
  });
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id IN (${empresa}, ${otra})`;
    await sql`DELETE FROM firmas WHERE nombre LIKE ${`Firma compras ${marca}%`}`;
    await sql`DELETE FROM usuarios WHERE id IN (${ana}, ${beto})`;
  } finally {
    await sql.end();
  }
});

test("compra con crédito de ITBIS: gasto + ITBIS pagado contra cuentas por pagar", conBase, async () => {
  const id = await leer((tx) => guardarBorradorCompra(tx, compra()));
  const [b] = await leer((tx) => tx`SELECT estado, asiento_id, total::text FROM compras WHERE id = ${id}`);
  assert.deepEqual([b.estado, b.asiento_id, b.total], ["borrador", null, "11800.00"]);
  const r = await leer((tx) => registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id }));
  assert.equal(r.ncf, "B0100000123");
  const [c] = await leer((tx) => tx`SELECT asiento_id FROM compras WHERE id = ${id}`);
  assert.deepEqual(await lineasAsiento(c.asiento_id), [
    { codigo: "110401", debe: "1800.00", haber: "0.00" },
    { codigo: "210101", debe: "0.00", haber: "11800.00" },
    { codigo: "610205", debe: "10000.00", haber: "0.00" },
  ]);
});

test("el mismo NCF del mismo proveedor no se registra dos veces; de otro proveedor sí", conBase, async () => {
  await assert.rejects(leer((tx) => guardarBorradorCompra(tx, compra())), /Ya registraste el NCF B0100000123/);
  await assert.rejects(leer((tx) => guardarBorradorCompra(tx, compra({ ncf: "B0200000123" }))), /no corresponde a un B01/);
  await leer((tx) => guardarBorradorCompra(tx, compra({ proveedorId: prov.colmado, tipo: "B02", ncf: "B0100000123".replace("B01", "B02") })));
});

test("consumo (B02) y empresas no contribuyentes llevan el ITBIS al gasto", conBase, async () => {
  const id = await leer((tx) => guardarBorradorCompra(tx, compra({
    proveedorId: prov.colmado, tipo: "B02", ncf: "B0200000777", tipoGasto: "05",
    lineas: [linea("Almuerzo con cliente", 100000n, [imp.itbis18], { cuentaId: cuentas["610214"] })],
  })));
  await leer((tx) => registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id }));
  const [c] = await leer((tx) => tx`SELECT itbis_al_costo, asiento_id FROM compras WHERE id = ${id}`);
  assert.equal(c.itbis_al_costo, true);
  assert.deepEqual(await lineasAsiento(c.asiento_id), [
    { codigo: "210101", debe: "0.00", haber: "1180.00" },
    { codigo: "610214", debe: "1180.00", haber: "0.00" },
  ]);
});

test("comprobantes propios: B11 toma nuestro NCF y exige cédula; B17 solo para el exterior", conBase, async () => {
  await assert.rejects(leer(async (tx) => {
    const id = await guardarBorradorCompra(tx, compra({ proveedorId: prov.abogados, tipo: "B11", ncf: null }));
    await registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id });
  }), /personas físicas con cédula/);
  const id = await leer((tx) => guardarBorradorCompra(tx, compra({
    proveedorId: prov.juan, tipo: "B11", ncf: null, lineas: [linea("Reparación", 500000n, [imp.exento], { cuentaId: cuentas["610208"] })],
  })));
  const r = await leer((tx) => registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id }));
  assert.equal(r.ncf, "B1100000001");
  await assert.rejects(leer(async (tx) => {
    const id2 = await guardarBorradorCompra(tx, compra({ proveedorId: prov.abogados, tipo: "B17", ncf: null }));
    await registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id2 });
  }), /proveedores del exterior/);
});

test("lo registrado no se modifica ni se borra; el borrador se descarta", conBase, async () => {
  const [c] = await leer((tx) => tx`SELECT id FROM compras WHERE ncf = 'B0100000123' AND estado = 'registrada'`);
  await assert.rejects(leer((tx) => tx`UPDATE compras SET notas = 'x' WHERE id = ${c.id}`), /no se modifica/);
  await assert.rejects(leer((tx) => tx`DELETE FROM compras WHERE id = ${c.id}`), /no se borra/);
  await assert.rejects(leer((tx) => tx`UPDATE lineas_compra SET precio = 1 WHERE compra_id = ${c.id}`), /no se modifican/);
  await assert.rejects(leer((tx) => descartarBorradorCompra(tx, c.id)), /Solo se descartan borradores/);
  const [b] = await leer((tx) => tx`SELECT id FROM compras WHERE ncf = 'B0200000123'`);
  await leer((tx) => descartarBorradorCompra(tx, b.id));
});

test("con aprobación obligatoria, quien registró el borrador no lo registra; otra persona sí", conBase, async () => {
  await leer((tx) => tx`UPDATE empresas SET requiere_aprobacion = true WHERE id = ${empresa}`);
  const id = await leer((tx) => guardarBorradorCompra(tx, compra({ ncf: "B0100000200" })));
  await assert.rejects(leer((tx) => registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id })), /otra persona debe aprobar/);
  await conEmpresa(empresa, beto, (tx) => registrarCompra(tx, { empresaId: empresa, usuarioId: beto, compraId: id }));
  await leer((tx) => tx`UPDATE empresas SET requiere_aprobacion = false WHERE id = ${empresa}`);
});

test("nota de crédito del proveedor: rebaja el saldo y revierte gasto e ITBIS; no pasa del saldo", conBase, async () => {
  const [c] = await leer((tx) => tx`SELECT id FROM compras WHERE ncf = 'B0100000123' AND estado = 'registrada'`);
  const nota = (monto, ncf) => leer(async (tx) => {
    const id = await guardarBorradorCompra(tx, compra({
      tipo: "B04", ncf, compraOrigenId: c.id, lineas: [linea("Descuento", monto, [imp.itbis18], { cuentaId: cuentas["610205"] })],
    }));
    await registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id });
    return id;
  });
  await assert.rejects(nota(2000000n, "B0400000099"), /no puede pasar del saldo/);
  const id = await nota(100000n, "B0400000001");
  const [n] = await leer((tx) => tx`SELECT asiento_id FROM compras WHERE id = ${id}`);
  assert.deepEqual(await lineasAsiento(n.asiento_id), [
    { codigo: "110401", debe: "0.00", haber: "180.00" },
    { codigo: "210101", debe: "1180.00", haber: "0.00" },
    { codigo: "610205", debe: "0.00", haber: "1000.00" },
  ]);
  assert.equal(await leer((tx) => saldoCompra(tx, c.id)), 1062000n);
});

test("pago con retenciones: ITBIS 30 % y ISR quedan por pagar a la DGII; el saldo llega a cero", conBase, async () => {
  const [c] = await leer((tx) => tx`SELECT id FROM compras WHERE ncf = 'B0100000123' AND estado = 'registrada'`);
  // Saldo 10,620 = 11,800 − 1,180. Retenciones: 30 % de ITBIS 1,620 = 486; ISR 2 % (otras rentas, configurada aquí) sobre 9,000 = 180.
  const [r2] = await leer((tx) => tx`
    INSERT INTO retenciones (empresa_id, nombre, impuesto, tasa, cuenta_por_terceros_id, cuenta_a_terceros_id, codigo_606)
    VALUES (${empresa}, 'ISR prueba 2 %', 'isr', 2, ${cuentas["110403"]}, ${cuentas["210203"]}, 3) RETURNING id`);
  const base = {
    empresaId: empresa, usuarioId: ana, proveedorId: prov.abogados, fecha: "2026-10-25", moneda: "DOP", tasa: 10000n,
    cuentaOrigenId: cuentas["110103"], formaPago: "02", referencia: "TR-55", notas: null,
  };
  const retenciones = [{ retencionId: ret["ITBIS retenido 30 %"], monto: 48600n }, { retencionId: r2.id, monto: 18000n }];
  const aplicaciones = [{ compraId: c.id, monto: 1062000n }];
  await assert.rejects(leer((tx) => registrarPago(tx, { ...base, pagado: 1062000n, retenciones, aplicaciones })), /debe ser igual/);
  const numero = await leer((tx) => registrarPago(tx, { ...base, pagado: 1062000n - 48600n - 18000n, retenciones, aplicaciones }));
  const [p] = await leer((tx) => tx`SELECT asiento_id, retencion_itbis::text, retencion_isr::text FROM pagos WHERE numero = ${numero}`);
  assert.deepEqual([p.retencion_itbis, p.retencion_isr], ["486.00", "180.00"]);
  assert.deepEqual(await lineasAsiento(p.asiento_id), [
    { codigo: "110103", debe: "0.00", haber: "9954.00" },
    { codigo: "210101", debe: "10620.00", haber: "0.00" },
    { codigo: "210202", debe: "0.00", haber: "486.00" },
    { codigo: "210203", debe: "0.00", haber: "180.00" },
  ]);
  const [{ codigo_606 }] = await leer((tx) => tx`SELECT codigo_606 FROM retenciones_pago WHERE retencion_id = ${r2.id}`);
  assert.equal(codigo_606, 3);
  assert.equal(await leer((tx) => saldoCompra(tx, c.id)), 0n);
});

test("compra del exterior en dólares pagada a otra tasa: pérdida cambiaria y cuenta de proveedores del exterior", conBase, async () => {
  await leer((tx) => tx`INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence) VALUES (${empresa}, 'B17', 1, 50, 1, '2027-12-31')`);
  const id = await leer((tx) => guardarBorradorCompra(tx, compra({
    proveedorId: prov.exterior, tipo: "B17", ncf: null, moneda: "USD", tasa: 600000n, tipoGasto: "02",
    lineas: [linea("Licencia anual", 10000n, [imp.exento], { cuentaId: cuentas["610211"] })],
  })));
  await leer((tx) => registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id }));
  const numero = await leer((tx) => registrarPago(tx, {
    empresaId: empresa, usuarioId: ana, proveedorId: prov.exterior, fecha: "2026-10-26", moneda: "USD", tasa: 620000n,
    cuentaOrigenId: cuentas["110103"], formaPago: "02", referencia: null, notas: null, pagado: 10000n, retenciones: [],
    aplicaciones: [{ compraId: id, monto: 10000n }],
  }));
  const [p] = await leer((tx) => tx`SELECT asiento_id FROM pagos WHERE numero = ${numero}`);
  assert.deepEqual(await lineasAsiento(p.asiento_id), [
    { codigo: "110103", debe: "0.00", haber: "6200.00" },
    { codigo: "210102", debe: "6000.00", haber: "0.00" },
    { codigo: "620103", debe: "200.00", haber: "0.00" },
  ]);
});

test("antigüedad y estado de cuenta del proveedor; anular pago y luego la compra", conBase, async () => {
  const { total, filas } = await leer((tx) => antiguedadCxp(tx, "2026-12-31"));
  // Pendientes: colmado 1,180 (B02), Juan 5,000 (B11), Abogados 11,800 (B0100000200).
  assert.equal(total, 1798000n);
  assert.equal(filas.length, 3);
  const ec = await leer((tx) => estadoCuentaProveedor(tx, empresa, prov.abogados, "DOP", "2026-01-01", "2026-12-31"));
  assert.equal(ec.final, 1180000n);
  assert.deepEqual(ec.movimientos.map((m) => m.documento), ["B0100000123", "B0100000200", "B0400000001", "Pago 1"]);
  const [c] = await leer((tx) => tx`SELECT id, asiento_id FROM compras WHERE ncf = 'B0100000123' AND estado = 'registrada'`);
  await assert.rejects(leer((tx) => anularCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: c.id, motivo: "Error" })), /anúlalos primero/);
  await leer((tx) => anularPago(tx, { empresaId: empresa, usuarioId: ana, numero: 1, motivo: "Cheque nulo" }));
  const [n] = await leer((tx) => tx`SELECT id FROM compras WHERE ncf = 'B0400000001'`);
  await leer((tx) => anularCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: n.id, motivo: "Error" }));
  await leer((tx) => anularCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: c.id, motivo: "Error" }));
  const [a] = await leer((tx) => tx`SELECT estado FROM asientos WHERE id = ${c.asiento_id}`);
  assert.equal(a.estado, "anulado");
  // Anulada, el mismo NCF se puede volver a registrar.
  await leer((tx) => guardarBorradorCompra(tx, compra()));
});

test("no se mezclan empresas: proveedores y compras de otra no se ven ni se usan", conBase, async () => {
  await assert.rejects(conEmpresa(otra, ana, (tx) => guardarBorradorCompra(tx, { ...compra(), empresaId: otra })), /no existe/);
  const [{ n }] = await conEmpresa(otra, ana, (tx) => tx`SELECT count(*)::int AS n FROM compras`);
  assert.equal(n, 0);
  await assert.rejects(conEmpresa(otra, ana, (tx) => tx`
    INSERT INTO proveedores (empresa_id, nombre, cuenta_gasto_id) VALUES (${otra}, 'X', ${cuentas["610205"]})`), /no pertenece a esta empresa/);
});
