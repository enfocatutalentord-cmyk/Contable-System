// Bloque 4, entrega 4b: reporte mensual al cliente armado con lo registrado (servicios de la bitácora, compras, ITBIS calculado,
// declaraciones y pendientes) y su PDF. Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { guardarBorradorCompra, registrarCompra } from "../lib/compras.ts";
import { db } from "../lib/db.ts";
import { armarReporte, huellaReporte, tablaReporte } from "../lib/reporte-mensual.ts";

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, empresa, firma, cuentas, compraId;

const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-rep-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  await sql.begin(async (tx) => {
    [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma reporte ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Colmado Reporte SRL', '130000024', ${firma}) RETURNING id`;
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
    await tx`INSERT INTO obligaciones_empresa (empresa_id, clave, activa) VALUES (${empresa}, 'f606', true), (${empresa}, 'it1', true), (${empresa}, 'ir17', false)`;
  });
  await leer(async (tx) => {
    const [{ id: itbis }] = await tx`SELECT id FROM impuestos WHERE nombre = 'ITBIS 18 %'`;
    const [{ id: prov }] = await tx`INSERT INTO proveedores (empresa_id, nombre, tipo_identificacion, rnc) VALUES (${empresa}, 'Distribuidora SRL', 'rnc', '101000003') RETURNING id`;
    compraId = await guardarBorradorCompra(tx, {
      empresaId: empresa, usuarioId: ana, moneda: "DOP", tasa: 10000n, tipoGasto: "09", itbisAlCosto: false, notas: null,
      proveedorId: prov, tipo: "B01", ncf: "B0100000777", fecha: "2026-10-10", vence: "2026-11-10",
      lineas: [{ descripcion: "Mercancía", clase: "bien", cantidad: 10000n, precio: 1000000n, cuentaId: cuentas["110301"], impuestoIds: [itbis] }],
    });
    await registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId });
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
    await db().end();
  }
});

test("reporte de octubre: servicios, compras, ITBIS calculado, declaraciones y pendientes; el PDF lleva cada sección", conBase, async () => {
  await leer((tx) => tx`INSERT INTO gestiones (empresa_id, fecha, tipo, descripcion, creado_por) VALUES (${empresa}, '2026-10-12', 'llamada', 'Reunión de cierre de mes', ${ana})`);
  const d = await leer((tx) => armarReporte(tx, empresa, "202610", "2026-11-18"));
  assert.equal(d.mes, "octubre 2026");
  assert.deepEqual(d.servicios.map((s) => [s.tipo, s.descripcion]), [["Llamada o reunión", "Reunión de cierre de mes"]]);
  assert.deepEqual(d.compras, { cantidad: 1, subtotal: "10000.00", itbis: "1800.00", total: "11800.00" });
  assert.equal(d.ventas.cantidad, 0);
  assert.equal(d.itbis?.fuente, "calculado");
  assert.equal(d.itbis?.deducible, "1800.00", "el ITBIS de la compra es adelantado");
  assert.equal(d.retenciones?.isr, "0.00", "el IR-17 no está activo: solo las retenciones del IT-1");
  assert.deepEqual(d.declaraciones.map((x) => [x.nombre, x.estado]), [["606 · Compras", "Vencida sin presentar"], ["IT-1 · ITBIS", "Pendiente"]]);
  assert.ok(d.pendientes.some((t) => /No recibimos documentos/.test(t)), d.pendientes.join(" | "));
  assert.ok(!d.pendientes.some((t) => /606/.test(t)), "las declaraciones por presentar son de la firma, no pendientes del cliente");
  assert.equal(d.cuenta, null, "sin empresa propia en la firma no hay cuenta con la firma");
  assert.equal(huellaReporte(d), huellaReporte(await leer((tx) => armarReporte(tx, empresa, "202610", "2026-11-18"))), "la huella no cambia si nada cambia");

  const t = tablaReporte(d, "Recuerde enviar las facturas antes del día 10.", { empresa: "Firma", generado: "hoy" });
  const titulos = t.negritas.map((i) => t.filas[i][0]);
  assert.deepEqual(titulos, ["1. Servicios realizados en el mes", "2. Facturas del mes", "3. ITBIS", "4. Retenciones e ISR",
    "5. Declaraciones y notificaciones", "6. Pendientes del cliente", "Notas"]);
  assert.ok(t.filas.some((f) => f[0] === "ITBIS adelantado (deducible)" && f[2] === "1800.00"));
});
