// Fase 6: formatos 606, 607 y 608 de la DGII armados con la lógica real de compras, pagos, ventas y cobros.
// Las utilidades no necesitan base; el resto necesita DATABASE_URL (crea su propia firma y la borra al final).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { anularCompra, guardarBorradorCompra, registrarCompra, registrarPago } from "../lib/compras.ts";
import {
  armarFormato, CONSUMO_DETALLADO_DESDE, fechaDgii, formaPago606, ncfValido, periodoAnterior, periodoDe, repartir, tipoIdentificacion,
} from "../lib/formatos-dgii.ts";
import { anularFactura, emitir, guardarBorradorFactura, registrarCobro } from "../lib/ventas.ts";

test("período AAAAMM: rango del mes y vencimiento el 15 del mes siguiente", () => {
  assert.deepEqual(periodoDe("202602"), { periodo: "202602", inicio: "2026-02-01", fin: "2026-02-28", vence: "2026-03-15" });
  assert.equal(periodoDe("202612").vence, "2027-01-15");
  assert.equal(periodoDe("202613"), null);
  assert.equal(periodoAnterior("2026-01-10"), "202512");
  assert.equal(periodoAnterior("2026-10-29"), "202609");
  assert.equal(fechaDgii("2026-10-05"), "20261005");
});

test("repartir no pierde ni suma centavos", () => {
  assert.deepEqual(repartir(100n, [1n, 1n, 1n]), [34n, 33n, 33n]);
  assert.deepEqual(repartir(54000n, [1180000n, 0n]), [54000n, 0n]);
  const r = repartir(99999n, [3n, 7n, 11n]);
  assert.equal(r.reduce((s, x) => s + x, 0n), 99999n);
});

test("códigos del instructivo: identificación, NCF y forma de pago", () => {
  assert.equal(tipoIdentificacion("rnc", "101000002"), "1");
  assert.equal(tipoIdentificacion("cedula", "00100000001"), "2");
  assert.equal(tipoIdentificacion("pasaporte", "AB12345"), "3");
  assert.equal(tipoIdentificacion(null, null), null);
  assert.ok(ncfValido("B0100000123") && ncfValido("E310000000001"));
  assert.ok(!ncfValido("B01000001") && !ncfValido("E3100000001"));
  assert.equal(formaPago606([], false), "04");
  assert.equal(formaPago606([], true), "06");
  assert.equal(formaPago606(["02", "02"], false), "02");
  assert.equal(formaPago606(["01", "02"], false), "07");
});

// ───── Con la base ─────

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, empresa, cuentas, imp, ret, prov, cli;
const ids = {};

function leer(fn) {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
    await tx`SET LOCAL ROLE contable_app`;
    return fn(tx);
  });
}
const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));
const fila = (a, ncf) => {
  const i = a.columnas.findIndex(([k]) => k === "ncf");
  const f = a.filas.find((x) => x[i] === ncf);
  return f && Object.fromEntries(a.columnas.map(([k], j) => [k, f[j]]));
};
// El 608 de las anulaciones de hoy se arma en el mes de hoy (hora de Santo Domingo).
const mesDeHoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" }).slice(0, 7).replace("-", "");

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-dgii-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  await sql.begin(async (tx) => {
    const [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma dgii ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Formatos SRL', '130000001', ${firma}) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    const m = new Map();
    for (const [codigo, n] of CATALOGO_RD) {
      const [c] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${empresa}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${m.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6})
        RETURNING id`;
      m.set(codigo, c.id);
    }
    cuentas = Object.fromEntries(m);
    await tx`SELECT configurar_cuentas_empresa(${empresa})`;
    await tx`SELECT configurar_tributaria(${empresa})`;
  });
  await leer(async (tx) => {
    const i = Object.fromEntries((await tx`SELECT id, nombre FROM impuestos`).map((r) => [r.nombre, r.id]));
    imp = { itbis18: i["ITBIS 18 %"], exento: i["Exento"] };
    ret = Object.fromEntries((await tx`SELECT id, nombre FROM retenciones`).map((r) => [r.nombre, r.id]));
    const p = async (nombre, extra) => (await tx`INSERT INTO proveedores ${tx({ empresa_id: empresa, nombre, ...extra })} RETURNING id`)[0].id;
    prov = { abogados: await p("Abogados SRL", { tipo_identificacion: "rnc", rnc: "101000002" }), juan: await p("Juan Pérez", { tipo_identificacion: "cedula", rnc: "00100000001" }) };
    const c = async (nombre, extra) => (await tx`INSERT INTO clientes ${tx({ empresa_id: empresa, nombre, ...extra })} RETURNING id`)[0].id;
    cli = { srl: await c("Cliente SRL", { tipo_identificacion: "rnc", rnc: "101000001", tipo_ingreso: "04" }), final: await c("Consumidor final", {}) };
    for (const t of ["B01", "B02", "B11"]) {
      await tx`INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence) VALUES (${empresa}, ${t}, 1, 100, 1, '2027-12-31')`;
    }
  });

  const compra = (extra) => ({
    empresaId: empresa, usuarioId: ana, moneda: "DOP", tasa: 10000n, tipoGasto: "02", itbisAlCosto: false, notas: null, ...extra,
  });
  const lin = (descripcion, clase, precio, impuestoIds) => ({ descripcion, clase, cantidad: 10000n, precio, cuentaId: cuentas["610205"], impuestoIds });
  // Septiembre: honorarios de Juan (cédula), 10,000 + ITBIS 1,800, pagados en octubre con retenciones.
  ids.c1 = await leer(async (tx) => {
    const id = await guardarBorradorCompra(tx, compra({ proveedorId: prov.juan, tipo: "B01", ncf: "B0100000777", fecha: "2026-09-10", vence: "2026-10-10",
      lineas: [lin("Honorarios", "servicio", 1000000n, [imp.itbis18])] }));
    await registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id });
    return id;
  });
  // Octubre: 3,000 de servicio y 2,000 de bienes + ITBIS 900, sin pagar.
  ids.c2 = await leer(async (tx) => {
    const id = await guardarBorradorCompra(tx, compra({ proveedorId: prov.abogados, tipo: "B01", ncf: "B0100000888", fecha: "2026-10-03", vence: "2026-11-02",
      tipoGasto: "09", lineas: [lin("Servicio", "servicio", 300000n, [imp.itbis18]), lin("Materiales", "bien", 200000n, [imp.itbis18])] }));
    await registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id });
    return id;
  });
  // Pago de octubre: 30 % del ITBIS (540) y 15 % de ISR honorarios (1,500).
  await leer((tx) => registrarPago(tx, {
    empresaId: empresa, usuarioId: ana, proveedorId: prov.juan, fecha: "2026-10-05", moneda: "DOP", tasa: 10000n, cuentaOrigenId: cuentas["110103"],
    formaPago: "02", referencia: null, notas: null, pagado: 1180000n - 54000n - 150000n,
    retenciones: [{ retencionId: ret["ITBIS retenido 30 %"], monto: 54000n }, { retencionId: ret["ISR honorarios a personas físicas 15 %"], monto: 150000n }],
    aplicaciones: [{ compraId: ids.c1, monto: 1180000n }],
  }));
  // B11 propio que se anula: va al 608 con el tipo de anulación elegido.
  await leer(async (tx) => {
    const id = await guardarBorradorCompra(tx, compra({ proveedorId: prov.juan, tipo: "B11", ncf: null, fecha: "2026-10-08", vence: "2026-10-08",
      lineas: [lin("Reparación", "servicio", 50000n, [imp.exento])] }));
    await registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id });
    await assert.rejects(anularCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id, motivo: "Error" }), /tipo de anulación/);
    await anularCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id, motivo: "Se registró dos veces", motivo608: "04" });
  });

  // Ventas de octubre.
  const factura = (extra) => ({ empresaId: empresa, usuarioId: ana, fecha: "2026-10-05", vence: "2026-11-04", moneda: "DOP", tasa: 10000n, notas: null, ...extra });
  const lv = (descripcion, precio, impuestoIds) => ({ servicioId: null, descripcion, cantidad: 10000n, precio, impuestoIds });
  const emitida = (d) => leer(async (tx) => {
    const id = await guardarBorradorFactura(tx, factura(d));
    return { id, ncf: (await emitir(tx, { empresaId: empresa, usuarioId: ana, facturaId: id })).ncf };
  });
  ids.f1 = await emitida({ clienteId: cli.srl, tipo: "B01", tipoIngreso: "04",
    lineas: [lv("Alquiler", 1000000n, [imp.itbis18]), lv("Libros", 100000n, [imp.exento])] }); // 11,000 + 1,800 = 12,800
  await leer((tx) => registrarCobro(tx, {
    empresaId: empresa, usuarioId: ana, clienteId: cli.srl, fecha: "2026-10-20", moneda: "DOP", tasa: 10000n, cuentaDestinoId: cuentas["110101"],
    formaPago: "efectivo", referencia: null, notas: null, recibido: 500000n, retenciones: [], aplicaciones: [{ facturaId: ids.f1.id, monto: 500000n }],
  }));
  ids.f2 = await emitida({ clienteId: cli.final, tipo: "B02", lineas: [lv("Consulta", 100000n, [imp.itbis18])] }); // 1,180: resumen de consumo
  ids.f3 = await emitida({ clienteId: cli.final, tipo: "B02", lineas: [lv("Equipo", CONSUMO_DETALLADO_DESDE, [imp.itbis18])] }); // ≥ 250,000
  ids.f4 = await emitida({ clienteId: cli.srl, tipo: "B01", lineas: [lv("Error", 100000n, [imp.itbis18])] });
  await leer((tx) => anularFactura(tx, { empresaId: empresa, usuarioId: ana, facturaId: ids.f4.id, motivo: "04" }));
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE nombre = ${`Firma dgii ${marca}`}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("606 de septiembre: la compra sin pagar va a crédito, sin fecha de pago ni retenciones", conBase, async () => {
  const a = await leer((tx) => armarFormato(tx, "606", periodoDe("202609")));
  assert.equal(a.filas.length, 1);
  assert.deepEqual(fila(a, "B0100000777"), {
    rnc: "00100000001", tipoId: "2", tipoBienes: "02", ncf: "B0100000777", ncfModificado: "", fechaComprobante: "20260910", fechaPago: "",
    servicios: 1000000n, bienes: 0n, totalFacturado: 1000000n, itbisFacturado: 180000n, itbisRetenido: 0n, itbisProporcionalidad: 0n,
    itbisCosto: 0n, itbisAdelantar: 180000n, itbisPercibido: 0n, tipoRetencionIsr: "", retencionRenta: 0n, isrPercibido: 0n,
    isc: 0n, otros: 0n, propina: 0n, formaPago: "04",
  });
  assert.equal(a.avisos.filter((x) => x.nivel === "error").length, 0);
});

test("606 de octubre: reenvío con la fecha original para reportar las retenciones; bienes y servicios separados", conBase, async () => {
  const a = await leer((tx) => armarFormato(tx, "606", periodoDe("202610")));
  assert.equal(a.filas.length, 2, "la compra de octubre y el reenvío de la de septiembre; la B11 anulada no va");
  const r = fila(a, "B0100000777");
  assert.equal(r.fechaComprobante, "20260910");
  assert.equal(r.fechaPago, "20261005");
  assert.deepEqual([r.itbisRetenido, r.retencionRenta, r.tipoRetencionIsr, r.formaPago], [54000n, 150000n, "2", "02"]);
  const o = fila(a, "B0100000888");
  assert.deepEqual([o.tipoBienes, o.servicios, o.bienes, o.totalFacturado, o.itbisFacturado, o.formaPago, o.fechaPago],
    ["09", 300000n, 200000n, 500000n, 90000n, "04", ""]);
  assert.ok(a.avisos.some((x) => /reenvían con su fecha original/.test(x.texto)));
});

test("607: tipo de ingreso, formas de cobro que suman el total y facturas de consumo", conBase, async () => {
  const a = await leer((tx) => armarFormato(tx, "607", periodoDe("202610")));
  const f1 = fila(a, ids.f1.ncf);
  assert.deepEqual([f1.rnc, f1.tipoId, f1.tipoIngreso, f1.fechaComprobante, f1.montoFacturado, f1.itbisFacturado], ["101000001", "1", "04", "20261005", 1100000n, 180000n]);
  assert.deepEqual([f1.efectivo, f1.credito, f1.cheque], [500000n, 780000n, 0n], "cobrado en efectivo 5,000; el resto, a crédito");
  assert.equal(fila(a, ids.f2.ncf), undefined, "la B02 menor de RD$250,000 no va una por una");
  assert.equal(fila(a, ids.f4.ncf), undefined, "la anulada va al 608, no al 607");
  assert.deepEqual([a.consumo.cantidad, a.consumo.montoFacturado, a.consumo.itbis, a.consumo.total], [1, 100000n, 18000n, 118000n]);
  assert.ok(fila(a, ids.f3.ncf), "la B02 desde RD$250,000 sí va");
  assert.ok(a.avisos.some((x) => x.nivel === "error" && x.texto.includes(ids.f3.ncf)), "y pide la identificación del comprador");
});

test("608: facturas y comprobantes propios anulados con su tipo de anulación", conBase, async () => {
  const a = await leer((tx) => armarFormato(tx, "608", periodoDe(mesDeHoy())));
  assert.deepEqual(fila(a, ids.f4.ncf), { ncf: ids.f4.ncf, fechaComprobante: "20261005", tipoAnulacion: "04" });
  assert.deepEqual(fila(a, "B1100000001"), { ncf: "B1100000001", fechaComprobante: "20261008", tipoAnulacion: "04" });
  assert.equal(a.avisos.length, 0);
});

test("la huella cambia si cambia algo del mes y la marca de envío queda en el historial", conBase, async () => {
  const p = periodoDe("202609");
  const antes = await leer((tx) => armarFormato(tx, "606", p));
  assert.equal((await leer((tx) => armarFormato(tx, "606", p))).huella, antes.huella, "misma huella si nada cambia");
  await leer((tx) => tx`INSERT INTO envios_dgii (empresa_id, formato, periodo, huella, registros, enviado_por)
                        VALUES (${empresa}, '606', '202609', ${antes.huella}, 1, ${ana})`);
  await leer(async (tx) => {
    const id = await guardarBorradorCompra(tx, {
      empresaId: empresa, usuarioId: ana, proveedorId: prov.abogados, tipo: "B01", ncf: "B0100000999", fecha: "2026-09-30", vence: "2026-09-30",
      moneda: "DOP", tasa: 10000n, tipoGasto: "02", itbisAlCosto: true, notas: null,
      lineas: [{ descripcion: "Tarde", clase: "servicio", cantidad: 10000n, precio: 100000n, cuentaId: cuentas["610205"], impuestoIds: [imp.itbis18] }],
    });
    await registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id });
  });
  const despues = await leer((tx) => armarFormato(tx, "606", p));
  assert.notEqual(despues.huella, antes.huella);
  const tarde = fila(despues, "B0100000999");
  assert.deepEqual([tarde.itbisCosto, tarde.itbisAdelantar], [18000n, 0n], "ITBIS llevado al costo");
  const [h] = await leer((tx) => tx`SELECT count(*)::int AS n FROM auditoria WHERE tabla = 'envios_dgii'`);
  assert.equal(h.n, 1);
});
