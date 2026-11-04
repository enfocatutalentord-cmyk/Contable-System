// IR-2 2026, parte 3 (entrega 1): anexo D (costo de venta) desde las compras y los inventarios, el B-1 con ese costo y
// el impuesto a los activos, con la lógica real de compras. Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { insertarAsiento } from "../lib/asientos.ts";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { guardarBorradorCompra, registrarCompra } from "../lib/compras.ts";
import { periodoDe } from "../lib/formatos-dgii.ts";
import { anexoB1, b1ConCostoD } from "../lib/ir2.ts";
import { calcularIr2 } from "../lib/ir2-liquidacion.ts";

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, empresa, cuentas, imp;

const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));
const asiento = (fecha, debe, haber, monto) => leer((tx) => insertarAsiento(tx, {
  empresaId: empresa, usuarioId: ana, fecha, concepto: `${debe}/${haber}`, origen: "manual",
  lineas: [{ cuentaId: cuentas[debe], debe: monto, haber: 0n }, { cuentaId: cuentas[haber], debe: 0n, haber: monto }],
}));
const ir2 = (periodo, manuales = {}) => leer((tx) => calcularIr2(tx, periodoDe(periodo), manuales));
const errores = (r) => r.avisos.filter((a) => a.nivel === "error").map((a) => a.texto);
const porTasa = (b, t) => (b * t + 5000n) / 10000n;

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-ir2d-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  await sql.begin(async (tx) => {
    const [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma ir2d ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Ferretería D SRL', '130000008', ${firma}) RETURNING id`;
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
  let prov;
  await leer(async (tx) => {
    const i = Object.fromEntries((await tx`SELECT id, nombre FROM impuestos`).map((r) => [r.nombre, r.id]));
    imp = { itbis18: i["ITBIS 18 %"], exento: i["Exento"] };
    const p = async (nombre, extra) => (await tx`INSERT INTO proveedores ${tx({ empresa_id: empresa, nombre, ...extra })} RETURNING id`)[0].id;
    prov = {
      local: await p("Distribuidora SRL", { tipo_identificacion: "rnc", rnc: "101000003" }),
      exterior: await p("Supplier Inc.", { del_exterior: true }),
    };
    await tx`INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence) VALUES (${empresa}, 'B17', 1, 100, 1, '2027-12-31')`;
  });
  // 2025: capital 100,000 y mercancía comprada con un asiento: inventario inicial de 2026 = 30,000.
  await asiento("2025-01-02", "110103", "310101", 10000000n);
  await asiento("2025-06-01", "110301", "110103", 3000000n);
  const compra = (extra) => ({ empresaId: empresa, usuarioId: ana, moneda: "DOP", tasa: 10000n, tipoGasto: "09", itbisAlCosto: false, notas: null, ...extra });
  const lin = (descripcion, clase, precio, cuenta, impuestoIds) => ({ descripcion, clase, cantidad: 10000n, precio, cuentaId: cuentas[cuenta], impuestoIds });
  const registrar = (d) => leer(async (tx) => {
    const id = await guardarBorradorCompra(tx, compra(d));
    await registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId: id });
    return id;
  });
  // 2026: mercancía local 50,000 + ITBIS (con crédito) a inventario; un activo fijo de 10,000 que no cuenta.
  await registrar({ proveedorId: prov.local, tipo: "B01", ncf: "B0100000101", fecha: "2026-02-10", vence: "2026-03-10",
    lineas: [lin("Mercancía", "bien", 5000000n, "110301", [imp.itbis18]), lin("Computadora", "bien", 1000000n, "120103", [imp.itbis18])] });
  // Mercancía local 10,000 con el ITBIS al costo (1,800 a la casilla 37).
  await registrar({ proveedorId: prov.local, tipo: "B01", ncf: "B0100000102", fecha: "2026-03-10", vence: "2026-04-10", itbisAlCosto: true,
    lineas: [lin("Mercancía", "bien", 1000000n, "110301", [imp.itbis18])] });
  // Importación de 20,000 cargada directo al costo, y un servicio de flete que no es bien.
  await registrar({ proveedorId: prov.exterior, tipo: "B17", ncf: null, fecha: "2026-04-10", vence: "2026-05-10",
    lineas: [lin("Mercancía importada", "bien", 2000000n, "510101", [imp.exento]), lin("Flete", "servicio", 300000n, "510101", [imp.exento])] });
  // Venta del inventario (costo perpetuo): sale de inventario 40,000 al costo.
  await asiento("2026-06-30", "510101", "110301", 4000000n);
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE nombre = ${`Firma ir2d ${marca}`}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("anexo D: inventarios del A-1, compras de bienes a inventario o costo, ITBIS al costo y casilla 39", conBase, async () => {
  const r = await ir2("202612", { Dtipo: "2" });
  const v = r.valores;
  assert.equal(v.D34, 3000000n, "inventario al 31/12/2025");
  assert.equal(v.D35, 6000000n, "mercancía local 50,000 + 10,000; la computadora no cuenta");
  assert.equal(v.D36, 2000000n, "importación B17; el flete es servicio");
  assert.equal(v.D37, 180000n, "ITBIS al costo de la segunda compra");
  // Inventario final = 30,000 + 50,000 + 11,800 (con su ITBIS al costo) − 40,000 = 51,800.
  assert.equal(v.D38, 5180000n);
  assert.equal(v.D39, 3000000n + 6000000n + 2000000n + 180000n - 5180000n);
  assert.equal(v.DCV, v.D39);
  assert.deepEqual(errores(r), []);
  assert.equal(r.origen.D34, "Inventarios del anexo A-1 (1.5 a 1.8) al 31/12/2025");
});

test("el B-1 y la casilla 1 usan el costo del anexo D; si no coincide con la contabilidad, se avisa", conBase, async () => {
  const b1 = await leer((tx) => anexoB1(tx, "2026-01-01", "2026-12-31"));
  // Costo en la contabilidad: 40,000 de la venta + 20,000 importado + 3,000 de flete = 63,000.
  assert.equal(b1.valores["5"], 6300000n);
  const r = await ir2("202612", { Dtipo: "2" });
  assert.equal(r.valores.I1, b1ConCostoD(b1.valores, r.valores.DCV)["14"]);
  assert.equal(r.valores.I1, b1.valores["14"] + 6300000n - r.valores.DCV);
  assert.ok(r.avisos.some((a) => /no coincide con las cuentas de costo/.test(a.texto) && a.texto.includes("RD$63,000.00")));
  // Lo escrito a mano manda: si la contadora ajusta el inventario final, el costo coincide y no hay aviso.
  const ajustado = await ir2("202612", { Dtipo: "2", D38: String(Number(r.valores.D39 + r.valores.D38 - 6300000n) / 100) });
  assert.equal(ajustado.valores.DCV, 6300000n);
  assert.ok(!ajustado.avisos.some((a) => /no coincide con las cuentas de costo/.test(a.texto)));
});

test("anexo D: tipo de inventario y manufactura (49 y 52)", conBase, async () => {
  assert.ok((await ir2("202612")).avisos.some((a) => /falta elegir el tipo de inventario/.test(a.texto)));
  assert.equal(errores(await ir2("202612", { Dtipo: "4" })).length, 1);
  const r = await ir2("202612", { Dtipo: "1", D40: "1000", D42: "5000", D44: "2000", D47: "500", D50: "300", D51: "800" });
  assert.equal(r.valores.D49, 750000n, "1,000 + 5,000 + 2,000 − 500");
  assert.equal(r.valores.D52, 700000n, "7,500 + 300 − 800");
  assert.equal(r.valores.DCV, 700000n, "con manufactura manda la casilla 52");
});

test("impuesto a los activos: 1 % de los activos imponibles menos el ISR liquidado", conBase, async () => {
  const r = await ir2("202612", { Dtipo: "2" });
  const v = r.valores;
  assert.ok(v.X1 > 0n);
  assert.equal(v.X9, v.X1 - v.X7 + v.X8);
  assert.equal(v.X38, v.X34);
  assert.equal(v.X39, porTasa(v.X38, 100n));
  assert.equal(v.X40, v.I12);
  assert.equal(v.X41, v.X39 > v.X40 ? v.X39 - v.X40 : 0n);
  // Con bonos de Hacienda y exenciones a mano baja la base; un pago a cuenta mayor deja saldo a favor.
  const e = await ir2("202612", { Dtipo: "2", X6: "1000", X37: "500", X42: "999999" });
  assert.equal(e.valores.X7, v.X7 + 100000n);
  assert.equal(e.valores.X38, v.X38 - 100000n - 50000n);
  assert.equal(e.valores.X45, 0n);
  assert.equal(e.valores.X44, 99999900n - e.valores.X41);
});
