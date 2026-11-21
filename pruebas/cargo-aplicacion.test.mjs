// Prioridad 3 · P3b: cargo por la aplicación. El porcentaje, el precio con cargo, cuánto del precio es el cargo, las igualas y propuestas de un cliente
// que usa la aplicación, el reporte de lo cobrado y el presupuesto. Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { cargoIncluido, conCargo, ErrorCargo, leerPorcentajeCargo, reporteDelMes } from "../lib/cargo-aplicacion.ts";
import { prepararIgualas } from "../lib/igualas-db.ts";
import { ingresosDelAnio, totalIngresos } from "../lib/presupuesto.ts";
import { cambiarEstado, convertirEnFactura, guardarPropuesta } from "../lib/propuestas.ts";
import { emitir, registrarCobro } from "../lib/ventas.ts";

test("el porcentaje va de 0 a 100 con hasta dos decimales", () => {
  assert.equal(leerPorcentajeCargo("10"), "10.00");
  assert.equal(leerPorcentajeCargo(" 12,5 % "), "12.50");
  assert.equal(leerPorcentajeCargo("0"), "0.00");
  assert.equal(leerPorcentajeCargo("100"), "100.00");
  assert.equal(leerPorcentajeCargo("7.25"), "7.25");
  for (const mal of ["", "abc", "-1", "101", "10.555", "1e2", "100.01"]) assert.throws(() => leerPorcentajeCargo(mal), ErrorCargo, mal);
});

test("el precio con cargo se redondea al centavo y el cargo incluido es la parte que corresponde", () => {
  assert.equal(conCargo(1500000n, "10.00"), 1650000n, "15,000 + 10 % = 16,500");
  assert.equal(conCargo(33333n, "10.00"), 36666n, "333.33 × 1.10 = 366.663");
  assert.equal(conCargo(10000n, "12.50"), 11250n);
  assert.equal(conCargo(10000n, "0.00"), 10000n);
  assert.equal(cargoIncluido(1650000n, "10.00"), 150000n, "de 16,500, 1,500 son el cargo");
  assert.equal(cargoIncluido(36666n, "10.00"), 3333n);
  assert.equal(cargoIncluido(10000n, "0.00"), 0n);
  for (const base of [100n, 9999n, 123456n, 1500000n]) {
    const total = conCargo(base, "10.00");
    assert.ok(total - cargoIncluido(total, "10.00") - base >= -1n && total - cargoIncluido(total, "10.00") - base <= 1n, "base + cargo ≈ total, a un centavo");
  }
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa, otra, cuentas, clienteA, clienteB, servicio, itbis, facturaA, facturaB;

const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));
const en = (id, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const leer = (fn) => en(empresa, fn);

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-cargo-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma cargo ${marca}`}) RETURNING id`;
  [{ id: otra }] = await sql`INSERT INTO empresas (nombre, firma_id) VALUES ('Otra Cargo SRL', ${firma}) RETURNING id`;
  await sql.begin(async (tx) => {
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, firma_id, lleva_contabilidad) VALUES ('Empire Cargo SRL', ${firma}, true) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    const ids = new Map();
    for (const [codigo, n] of CATALOGO_RD) {
      const [c] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${empresa}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${ids.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6}) RETURNING id`;
      ids.set(codigo, c.id);
    }
    cuentas = Object.fromEntries(ids);
    await tx`SELECT configurar_cuentas_empresa(${empresa})`;
    await tx`SELECT configurar_tributaria(${empresa})`;
  });
  await leer(async (tx) => {
    [{ id: itbis }] = await tx`SELECT id FROM impuestos WHERE nombre = 'ITBIS 18 %'`;
    [{ id: servicio }] = await tx`INSERT INTO servicios (empresa_id, nombre, precio, impuesto_id) VALUES (${empresa}, 'Iguala contable mensual', 15000, ${itbis}) RETURNING id`;
    [{ id: clienteA }] = await tx`INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion, usa_aplicacion) VALUES (${empresa}, 'Ferretería con App', '130000061', 'rnc', true) RETURNING id`;
    [{ id: clienteB }] = await tx`INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion) VALUES (${empresa}, 'Colmado sin App', '130000062', 'rnc') RETURNING id`;
    for (const c of [clienteA, clienteB]) {
      await tx`INSERT INTO acuerdos_cliente (empresa_id, cliente_id, tipo, servicio_id, monto, inicio, dia_facturacion)
        VALUES (${empresa}, ${c}, 'normal', ${servicio}, 15000, '2025-11-10', 30)`;
    }
    await tx`INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence) VALUES (${empresa}, 'B01', 1, 100, 1, '2027-12-31')`;
  });
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("el porcentaje de la firma empieza en 10 %, solo lo paga quien usa la aplicación y nadie más lo consulta", conBase, async () => {
  const [{ cargo_aplicacion }] = await sql`SELECT cargo_aplicacion::text FROM firmas WHERE id = ${firma}`;
  assert.equal(cargo_aplicacion, "10.00");
  assert.equal((await leer((tx) => tx`SELECT cargo_aplicacion_de(${clienteA})::text AS p`))[0].p, "10.00");
  assert.equal((await leer((tx) => tx`SELECT cargo_aplicacion_de(${clienteB})::text AS p`))[0].p, null);
  assert.equal((await en(otra, (tx) => tx`SELECT cargo_aplicacion_de(${clienteA})::text AS p`))[0].p, null, "otra empresa no ve a los clientes de esta");
  await sql`UPDATE firmas SET cargo_aplicacion = 0 WHERE id = ${firma}`;
  assert.equal((await leer((tx) => tx`SELECT cargo_aplicacion_de(${clienteA})::text AS p`))[0].p, null, "con 0 % no hay cargo");
  await sql`UPDATE firmas SET cargo_aplicacion = 10 WHERE id = ${firma}`;
  await assert.rejects(() => sql`UPDATE firmas SET cargo_aplicacion = 101 WHERE id = ${firma}`, /check/i);
});

test("la iguala de un cliente que usa la aplicación sale con el cargo incluido; la de otro cliente, igual que antes", conBase, async () => {
  const r = await leer((tx) => prepararIgualas(tx, { empresaId: empresa, usuarioId: ana, periodo: "202612", hoy: "2026-12-30", soloHastaHoy: false }));
  assert.deepEqual(r, { creadas: 2, yaEstaban: 0, gratis: [], errores: [] });
  const filas = await leer((tx) => tx`SELECT f.id, f.cliente_id, f.subtotal::text, f.total::text, f.cargo_app_pct::text AS pct, cargo_de_factura(f.id)::text AS cargo
    FROM facturas f WHERE f.periodo = '202612'`);
  const a = filas.find((f) => f.cliente_id === clienteA), b = filas.find((f) => f.cliente_id === clienteB);
  assert.deepEqual({ subtotal: a.subtotal, total: a.total, pct: a.pct, cargo: a.cargo }, { subtotal: "16500.00", total: "19470.00", pct: "10.00", cargo: "1500.00" }, "15,000 + 10 %; el ITBIS va sobre 16,500");
  assert.deepEqual({ subtotal: b.subtotal, pct: b.pct, cargo: b.cargo }, { subtotal: "15000.00", pct: null, cargo: "0" });
  facturaA = a.id;
  facturaB = b.id;
});

test("la propuesta convertida en factura lleva el cargo en el precio final", conBase, async () => {
  const linea = { servicioId: servicio, descripcion: "Constitución de empresa", cantidad: 10000n, precioLista: 2250000n, descuento: 500000n, impuestoId: itbis, adicionalId: null, unidadId: null };
  const propuesta = await leer((tx) => guardarPropuesta(tx, {
    empresaId: empresa, usuarioId: ana, clienteId: clienteA, fecha: "2026-12-01", validaHasta: "2026-12-31", requisitos: null, anticipoPct: "0",
    formaPago: "Transferencia", entrega: "2026-12-20", notas: null, lineas: [linea],
  }));
  await leer((tx) => cambiarEstado(tx, propuesta, "aceptada"));
  const id = await leer((tx) => convertirEnFactura(tx, { empresaId: empresa, usuarioId: ana, propuestaId: propuesta, fecha: "2026-12-01" }));
  const [f] = await leer((tx) => tx`SELECT subtotal::text, cargo_app_pct::text AS pct, cargo_de_factura(id)::text AS cargo FROM facturas WHERE id = ${id}`);
  assert.deepEqual({ ...f }, { subtotal: "19250.00", pct: "10.00", cargo: "1750.00" }, "17,500 × 1.10");
});

test("el cargo de una factura emitida no se puede cambiar", conBase, async () => {
  await leer((tx) => emitir(tx, { empresaId: empresa, usuarioId: ana, facturaId: facturaA }));
  await assert.rejects(leer((tx) => tx`UPDATE facturas SET cargo_app_pct = 5 WHERE id = ${facturaA}`), /emitida|no se modifica|no se puede/i);
});

test("el reporte cuenta el cargo cobrado en proporción a lo que paga el cliente, y solo de facturas con cargo", conBase, async () => {
  await leer((tx) => emitir(tx, { empresaId: empresa, usuarioId: ana, facturaId: facturaB }));
  const cobro = (clienteId, facturaId, monto) => leer((tx) => registrarCobro(tx, {
    empresaId: empresa, usuarioId: ana, clienteId, fecha: "2026-12-31", moneda: "DOP", tasa: 10000n, cuentaDestinoId: cuentas["110103"],
    formaPago: "transferencia", referencia: null, notas: null, recibido: monto, retenciones: [], aplicaciones: [{ facturaId, monto }],
  }));
  await cobro(clienteA, facturaA, 973500n); // la mitad de 19,470
  await cobro(clienteB, facturaB, 1770000n); // todo lo de B: sin cargo
  const r = await leer((tx) => reporteDelMes(tx, "2026-12"));
  assert.equal(r.filas.length, 1, "solo el cliente con cargo");
  assert.deepEqual([r.filas[0].cliente, r.filas[0].facturado, r.filas[0].cobrado, r.filas[0].porCobrar], ["Ferretería con App", 150000n, 75000n, 75000n]);
  assert.deepEqual([r.facturado, r.cobrado, r.porCobrar, r.cobradoAnio], [150000n, 75000n, 75000n, 75000n]);
  const noviembre = await leer((tx) => reporteDelMes(tx, "2026-11"));
  assert.deepEqual([noviembre.facturado, noviembre.cobrado, noviembre.porCobrar, noviembre.filas.length], [0n, 0n, 0n, 0], "antes de la factura no hay nada");
  const enero = await leer((tx) => reporteDelMes(tx, "2027-01"));
  assert.deepEqual([enero.facturado, enero.cobrado, enero.porCobrar, enero.cobradoAnio], [0n, 0n, 75000n, 0n], "lo que falta por cobrar sigue en enero");
});

test("en el presupuesto el cargo sale del grupo de su factura y el total de ingresos no cambia", conBase, async () => {
  const meses = await leer((tx) => ingresosDelAnio(tx, 2026));
  const dic = meses[11];
  assert.equal(dic.cargo_app, 75000n);
  assert.equal(dic.igualas, 973500n + 1770000n - 75000n, "las dos igualas cobradas menos el cargo");
  assert.equal(totalIngresos(dic), 973500n + 1770000n, "el total es lo cobrado");
});

test("una factura anulada deja de contar en el reporte", conBase, async () => {
  await sql`UPDATE facturas SET anulada = true, motivo_anulacion = 'prueba', anulada_en = now() WHERE id = ${facturaA}`;
  const r = await leer((tx) => reporteDelMes(tx, "2026-12"));
  assert.deepEqual([r.facturado, r.cobrado, r.porCobrar], [0n, 0n, 0n]);
});
