// Bloque 2, entrega 2c: propuestas (descuento a la vista, conversión en factura o iguala), anticipos aplicados a la factura y
// trueque (permuta). Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { anularAnticipo, aplicarAnticipo, listarAnticipos, registrarAnticipo } from "../lib/anticipos.ts";
import { cambiarEstado, convertirEnFactura, convertirEnIguala, guardarPropuesta, montoAnticipo, totalesPropuesta } from "../lib/propuestas.ts";
import { emitir, registrarCobro, saldoFactura } from "../lib/ventas.ts";

const linea = (precioLista, descuento, impuestoId, servicioId = null) => ({
  servicioId, descripcion: "Constitución de empresa (Pequeña)", cantidad: 10000n, precioLista, descuento, impuestoId, adicionalId: null, unidadId: null,
});

test("totales de la propuesta: lista, descuento a la vista, ITBIS y anticipo", () => {
  const imp = new Map([["i18", { id: "i18", tipo: "itbis", tasa: "18.0000" }]]);
  const t = totalesPropuesta([linea(2250000n, 500000n, "i18")], imp);
  assert.deepEqual(t, { lista: 2250000n, descuento: 500000n, subtotal: 1750000n, impuestos: 315000n, total: 2065000n }, "el ejemplo del documento: 22,500 − 5,000 = 17,500");
  assert.equal(montoAnticipo(t.total, "60.00"), 1239000n, "60 % de 20,650");
  assert.equal(montoAnticipo(t.total, "0"), 0n);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa, cuentas, cliente, servicio, itbis, propuesta, facturaId, anticipo;

const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));
const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const datos = (extra = {}) => ({
  empresaId: empresa, usuarioId: ana, clienteId: cliente, fecha: "2026-11-04", validaHasta: "2026-11-30", requisitos: "Copia del RNC",
  anticipoPct: "60.00", formaPago: "Transferencia o trueque", entrega: "2026-11-20", notas: null,
  lineas: [linea(2250000n, 500000n, itbis, servicio)], ...extra,
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-propuestas-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma propuestas ${marca}`}) RETURNING id`;
  await sql.begin(async (tx) => {
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, firma_id) VALUES ('Empire Propuestas SRL', ${firma}) RETURNING id`;
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
    [{ id: servicio }] = await tx`INSERT INTO servicios (empresa_id, nombre, precio, impuesto_id) VALUES (${empresa}, 'Constitución de empresa', 22500, ${itbis}) RETURNING id`;
    [{ id: cliente }] = await tx`INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion) VALUES (${empresa}, 'Nueva Empresa SRL', '130000051', 'rnc') RETURNING id`;
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

test("propuesta: número, estados y conversión en factura con el precio final", conBase, async () => {
  propuesta = await leer((tx) => guardarPropuesta(tx, datos()));
  const [p] = await leer((tx) => tx`SELECT numero, estado FROM propuestas WHERE id = ${propuesta}`);
  assert.deepEqual({ ...p }, { numero: 1, estado: "borrador" });
  await assert.rejects(leer((tx) => convertirEnFactura(tx, { empresaId: empresa, usuarioId: ana, propuestaId: propuesta, fecha: "2026-11-04" })), /marca la propuesta como aceptada/);
  await leer((tx) => cambiarEstado(tx, propuesta, "enviada"));
  await leer((tx) => cambiarEstado(tx, propuesta, "aceptada"));
  await assert.rejects(leer((tx) => guardarPropuesta(tx, { ...datos(), propuestaId: propuesta })), /aceptada o rechazada no se modifica/);
  await assert.rejects(leer((tx) => cambiarEstado(tx, propuesta, "borrador")), /aceptada no pasa a borrador/);
  facturaId = await leer((tx) => convertirEnFactura(tx, { empresaId: empresa, usuarioId: ana, propuestaId: propuesta, fecha: "2026-11-04" }));
  const [f] = await leer((tx) => tx`SELECT f.estado, f.subtotal::text, f.total::text, f.notas, l.descripcion FROM facturas f JOIN lineas_factura l ON l.factura_id = f.id WHERE f.id = ${facturaId}`);
  assert.deepEqual({ ...f }, { estado: "borrador", subtotal: "17500.00", total: "20650.00", notas: "Según la propuesta n.º 1",
    descripcion: "Constitución de empresa (Pequeña) (precio de lista RD$22500.00, descuento RD$5000.00)" });
  await assert.rejects(leer((tx) => convertirEnFactura(tx, { empresaId: empresa, usuarioId: ana, propuestaId: propuesta, fecha: "2026-11-04" })), /ya se convirtió/);
});

test("anticipo: entra al banco contra «Anticipos de clientes» y se aplica a la factura; no se anula si ya se usó", conBase, async () => {
  anticipo = await leer((tx) => registrarAnticipo(tx, {
    empresaId: empresa, usuarioId: ana, clienteId: cliente, fecha: "2026-11-04", monto: 1239000n, cuentaDestinoId: cuentas["110103"],
    formaPago: "transferencia", referencia: "TRF-1", notas: null, propuestaId: propuesta,
  }));
  const asiento = await leer((tx) => tx`SELECT c.codigo, l.debe::text, l.haber::text FROM lineas_asiento l JOIN cuentas c ON c.id = l.cuenta_id
    JOIN anticipos a ON a.asiento_id = l.asiento_id WHERE a.id = ${anticipo.id} ORDER BY c.codigo`);
  assert.deepEqual(asiento.map((l) => [l.codigo, l.debe, l.haber]), [["110103", "12390.00", "0.00"], ["210501", "0.00", "12390.00"]]);
  await leer((tx) => emitir(tx, { empresaId: empresa, usuarioId: ana, facturaId }));
  await assert.rejects(leer((tx) => aplicarAnticipo(tx, { empresaId: empresa, usuarioId: ana, anticipoId: anticipo.id, facturaId, monto: 1300000n, fecha: "2026-11-05" })), /pasa del saldo del anticipo/);
  await leer((tx) => aplicarAnticipo(tx, { empresaId: empresa, usuarioId: ana, anticipoId: anticipo.id, facturaId, monto: 1239000n, fecha: "2026-11-05" }));
  assert.equal(await leer((tx) => saldoFactura(tx, facturaId)), 826000n, "20,650 − 12,390");
  const [a] = await leer((tx) => listarAnticipos(tx, cliente));
  assert.deepEqual([a.monto, a.aplicado, a.saldo, a.propuesta], ["12390.00", "12390.00", "0.00", 1]);
  await assert.rejects(leer((tx) => anularAnticipo(tx, { empresaId: empresa, usuarioId: ana, anticipoId: anticipo.id, motivo: "x" })), /ya se aplicó/);
});

test("trueque: la permuta va a la cuenta elegida (un gasto) y salda la factura; sin permuta un gasto no sirve de destino", conBase, async () => {
  const cobro = (formaPago, cuenta) => leer((tx) => registrarCobro(tx, {
    empresaId: empresa, usuarioId: ana, clienteId: cliente, fecha: "2026-11-06", moneda: "DOP", tasa: 10000n, cuentaDestinoId: cuenta,
    formaPago, referencia: null, notas: "Pagó con publicidad", recibido: 826000n, retenciones: [], aplicaciones: [{ facturaId, monto: 826000n }],
  }));
  await assert.rejects(cobro("transferencia", cuentas["610209"]), /banco o caja/);
  await cobro("permuta", cuentas["610209"]);
  assert.equal(await leer((tx) => saldoFactura(tx, facturaId)), 0n);
  const [c] = await leer((tx) => tx`SELECT forma_pago FROM cobros WHERE notas = 'Pagó con publicidad'`);
  assert.equal(c.forma_pago, "permuta");
});

test("propuesta aceptada a iguala: acuerdo normal con el total final", conBase, async () => {
  const otra = await leer((tx) => guardarPropuesta(tx, datos({ lineas: [linea(1500000n, 0n, itbis, servicio)], anticipoPct: "0" })));
  await leer((tx) => cambiarEstado(tx, otra, "aceptada"));
  await leer((tx) => convertirEnIguala(tx, { empresaId: empresa, propuestaId: otra, inicio: "2026-12-01" }));
  const [a] = await leer((tx) => tx`SELECT tipo, monto::text, to_char(inicio, 'YYYY-MM-DD') AS inicio FROM acuerdos_cliente WHERE cliente_id = ${cliente}`);
  assert.deepEqual({ ...a }, { tipo: "normal", monto: "15000.00", inicio: "2026-12-01" });
});
