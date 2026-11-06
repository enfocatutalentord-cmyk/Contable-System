// Bloque 8, entrega 8b: facturas que sube el cliente. Dígito verificador del RNC y la cédula, NCF, lectura del QR de la factura
// electrónica, revisión automática, y la aprobación: el gasto pasa a borrador de compra y el ingreso a borrador de venta que al
// emitirse conserva el NCF del cliente. Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { aprobarSubida, contadorMes, rechazarSubida, subirFactura } from "../lib/facturas-subidas.ts";
import { cedulaValida, leerNcf, leerQr, revisarFactura, rncValido } from "../lib/validar-fiscal.ts";
import { emitir } from "../lib/ventas.ts";

// Cédula con su dígito verificador calculado (pesos 1, 2 sobre los 10 primeros).
const conDigito = (diez) => {
  let s = 0;
  for (let i = 0; i < 10; i++) { const p = Number(diez[i]) * (i % 2 ? 2 : 1); s += p > 9 ? p - 9 : p; }
  return diez + ((10 - (s % 10)) % 10);
};

test("RNC y cédula: formato y dígito verificador", () => {
  assert.equal(rncValido("133097346"), true, "RNC de Empire");
  assert.equal(rncValido("132151119"), true, "RNC de Goemhy");
  assert.equal(rncValido("133097345"), false);
  assert.equal(rncValido("13309734"), false);
  const c = conDigito("0011234567");
  assert.equal(cedulaValida(c), true);
  assert.equal(cedulaValida(c.slice(0, 10) + String((Number(c[10]) + 1) % 10)), false);
});

test("NCF y QR de la factura electrónica", () => {
  assert.deepEqual(leerNcf("b01-00000123"), { ncf: "B0100000123", tipo: "B01" });
  assert.deepEqual(leerNcf("E310000000045"), { ncf: "E310000000045", tipo: "E31" });
  assert.equal(leerNcf("B990000001"), null);
  assert.equal(leerNcf("B010001"), null);
  const qr = leerQr("https://ecf.dgii.gov.do/ecf/ConsultaTimbre?RncEmisor=132151119&RncComprador=133097346&ENCF=E310000000045&FechaEmision=03-11-2026&MontoTotal=11800.00&FechaFirma=03-11-2026%2010:00:00&CodigoSeguridad=Ab12Cd");
  assert.deepEqual({ ...qr, url: undefined }, { url: undefined, rncEmisor: "132151119", rncComprador: "133097346", ncf: "E310000000045", fecha: "2026-11-03", total: "11800.00", codigo: "Ab12Cd" });
  assert.equal(leerQr("https://otro-sitio.com/?RncEmisor=1"), null, "solo direcciones de la DGII");
  assert.equal(leerQr("no es una dirección"), null);
});

test("revisión automática: otra empresa, sin crédito, montos y RNC", () => {
  const base = { tipo: "gasto", rncContraparte: "132151119", ncf: "B0200000001", subtotal: 10000n, itbis: 1800n, total: 11800n, rncEmpresa: "133097346", qr: null, repetida: false };
  const r = revisarFactura(base);
  assert.equal(r.sinCredito, true);
  assert.match(r.marcas.map((m) => m.texto).join(" "), /no da crédito fiscal/);
  const otra = revisarFactura({ ...base, ncf: "E310000000045", qr: { rncComprador: "101010101", rncEmisor: "132151119" } });
  assert.ok(otra.marcas.some((m) => m.nivel === "error" && /otra empresa/.test(m.texto)));
  assert.ok(revisarFactura({ ...base, rncContraparte: "132151118" }).marcas.some((m) => /dígito verificador/.test(m.texto)));
  assert.ok(revisarFactura({ ...base, itbis: 500n }).marcas.some((m) => /18 %/.test(m.texto)));
  assert.ok(revisarFactura({ ...base, repetida: true }).marcas.some((m) => m.nivel === "error"));
});

// ───── Con la base ─────

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa;

const padre = (k) => (k.length === 1 ? null : k.length === 2 ? k[0] : k.slice(0, -2));
const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-subidas-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma subidas ${marca}`}) RETURNING id`;
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, firma_id, rnc) VALUES ('Salón Prueba SRL', ${firma}, '133097346') RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    const ids = new Map();
    for (const [codigo, n] of CATALOGO_RD) {
      const [r] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${empresa}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${ids.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6}) RETURNING id`;
      ids.set(codigo, r.id);
    }
    await tx`SELECT configurar_cuentas_empresa(${empresa})`;
    await tx`SELECT configurar_tributaria(${empresa})`;
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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test("gasto: se sube, no se repite y al aprobarlo queda el borrador de la compra con su soporte", conBase, async () => {
  const datos = { tipo: "gasto", rncContraparte: "132151119", nombreContraparte: "Goemhy Services", ncf: "B0100000077", fecha: "2026-11-03",
    subtotal: 1000000n, itbis: 180000n, total: 1180000n, qr: null };
  const s = await leer((tx) => subirFactura(tx, { ...datos, empresaId: empresa, usuarioId: ana, archivo: { nombre: "luz.png", tipo: "image/png", bytes: PNG } }));
  assert.equal(s.numero, 1);
  await assert.rejects(leer((tx) => subirFactura(tx, { ...datos, ncf: "B0100000078", empresaId: empresa, usuarioId: ana, archivo: { nombre: "otra.png", tipo: "image/png", bytes: PNG } })), /mismo archivo/);
  const rep = await leer((tx) => subirFactura(tx, { ...datos, empresaId: empresa, usuarioId: ana, archivo: null }));
  assert.ok(rep.marcas.some((m) => m.nivel === "error" && /ya se subió/.test(m.texto)), "el mismo NCF queda marcado");
  await leer((tx) => rechazarSubida(tx, rep.id, ana, "desestimada", "Repetida"));
  const r = await leer((tx) => aprobarSubida(tx, { empresaId: empresa, usuarioId: ana, id: s.id, rnc: "132151119", nombre: "Goemhy Services", ncf: "B0100000077",
    fecha: "2026-11-03", subtotal: 1000000n, itbis: 180000n, tipoGasto: "02", clase: "servicio" }));
  const [c] = await leer((tx) => tx`SELECT c.estado, c.ncf, c.total::text, p.nombre FROM compras c JOIN proveedores p ON p.id = c.proveedor_id WHERE c.id = ${r.compraId}`);
  assert.deepEqual({ ...c }, { estado: "borrador", ncf: "B0100000077", total: "11800.00", nombre: "Goemhy Services" });
  const [{ n }] = await leer((tx) => tx`SELECT count(*)::int AS n FROM documentos WHERE entidad = 'compra' AND entidad_id = ${r.compraId}`);
  assert.equal(n, 1, "el archivo pasa como soporte");
  await assert.rejects(leer((tx) => rechazarSubida(tx, s.id, ana, "rechazada", "Borrosa")), /ya se revisó/);
  const m = await leer((tx) => contadorMes(tx, new Date().toLocaleString("sv-SE", { timeZone: "America/Santo_Domingo" }).slice(0, 7)));
  assert.equal(m.gastos_ok, 1);
});

test("ingreso: al aprobarlo queda la venta con el NCF del cliente y al emitirla no toma número del rango", conBase, async () => {
  const s = await leer((tx) => subirFactura(tx, { tipo: "ingreso", rncContraparte: null, nombreContraparte: null, ncf: "B0200000550", fecha: "2026-11-04",
    subtotal: 500000n, itbis: 90000n, total: 590000n, qr: null, empresaId: empresa, usuarioId: ana, archivo: null }));
  const r = await leer((tx) => aprobarSubida(tx, { empresaId: empresa, usuarioId: ana, id: s.id, rnc: null, nombre: null, ncf: "B0200000550", fecha: "2026-11-04",
    subtotal: 500000n, itbis: 90000n, tipoGasto: "", clase: "servicio" }));
  const e = await leer((tx) => emitir(tx, { empresaId: empresa, usuarioId: ana, facturaId: r.facturaId }));
  assert.equal(e.ncf, "B0200000550");
  const [f] = await leer((tx) => tx`SELECT f.estado, f.total::text, c.nombre FROM facturas f JOIN clientes c ON c.id = f.cliente_id WHERE f.id = ${r.facturaId}`);
  assert.deepEqual({ ...f }, { estado: "emitida", total: "5900.00", nombre: "Consumidor final" });
  const otra = await leer((tx) => subirFactura(tx, { tipo: "ingreso", rncContraparte: null, nombreContraparte: null, ncf: "B0200000550", fecha: "2026-11-04",
    subtotal: 1n, itbis: 0n, total: 1n, qr: null, empresaId: empresa, usuarioId: ana, archivo: null }));
  assert.ok(otra.marcas.some((m) => m.nivel === "error"), "ya está registrada como venta");
});
