// Entrega 6b.1: la Lista de Precios EMP-P01 (octubre 2026) en el sistema, la iguala mínima y el emprendedor sin descuento.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { igualaBajoMinimo } from "../lib/igualas.ts";
import { cargarListaP01, LISTA_P01 } from "../lib/lista-p01.ts";
import { GRUPOS_SERVICIO, guardarPrecios, preciosVigentes } from "../lib/precios.ts";
import { descuentoAEmprendedor } from "../lib/propuestas.ts";

const todas = Object.values(LISTA_P01).flat();

test("EMP-P01: 37 servicios en 6 grupos, sin nombres repetidos", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(LISTA_P01).map(([g, f]) => [g, f.length])),
    { contabilidad: 5, control_interno: 4, auditoria: 4, laboral_tss: 9, tributario: 12, otros: 3 });
  for (const g of Object.keys(LISTA_P01)) assert.ok(g in GRUPOS_SERVICIO, g);
  assert.equal(new Set(todas.map((f) => f[0])).size, 37);
  const ver = (n) => todas.find((f) => f[0] === n).slice(1);
  assert.deepEqual(ver("Declaración de ITBIS en cero (mensual)"), [1000, 1200, 1500, 600]);
  assert.deepEqual(ver("Cierre de negocios"), [6000, 9000, 14000, 3500]);
  assert.deepEqual(ver("Constitución de empresas"), [22500, 25000, 25000, 14000]);
});

test("iguala mínima y emprendedor sin descuento", () => {
  assert.equal(igualaBajoMinimo(399999n, "normal", "pequena"), true);
  assert.equal(igualaBajoMinimo(400000n, "normal", "pequena"), false);
  assert.equal(igualaBajoMinimo(100000n, "cero", "pequena"), false, "declaración en cero");
  assert.equal(igualaBajoMinimo(250000n, "normal", "emprendedor"), false, "emprendedor");
  assert.equal(descuentoAEmprendedor("emprendedor", [{ descuento: "100.00" }]), true);
  assert.equal(descuentoAEmprendedor("emprendedor", [{ descuento: "0.00" }]), false);
  assert.equal(descuentoAEmprendedor("mediana", [{ descuento: "100.00" }]), false);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let firma, empresa;
const en = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));

before(async () => {
  if (!sql) return;
  await sql.begin(async (tx) => {
    [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma P01 ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, firma_id) VALUES ('Empresa P01 SRL', ${firma}) RETURNING id`;
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
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
  } finally {
    await sql.end();
  }
});

test("cargar la lista: crea, no duplica y respeta un cambio posterior", conBase, async () => {
  assert.deepEqual(await en((tx) => cargarListaP01(tx, empresa, "2026-11-08")), { creados: 37, actualizados: 0, sinCambios: 0 });
  const [s] = await en((tx) => tx`SELECT id, precio::text, grupo FROM servicios WHERE nombre = 'Levantamiento contable'`);
  assert.equal(Number(s.precio), 0);
  assert.equal(s.grupo, "otros");
  const p = await en((tx) => preciosVigentes(tx, "2026-11-08"));
  assert.deepEqual(p.get(s.id), { pequena: "10000.00", mediana: "15000.00", grande: "20000.00", emprendedor: "6000.00" });
  await en((tx) => guardarPrecios(tx, empresa, s.id, { desde: "2026-11-05", precios: { pequena: "11000.00" } }));
  assert.deepEqual(await en((tx) => cargarListaP01(tx, empresa, "2026-11-08")), { creados: 0, actualizados: 0, sinCambios: 37 });
  const q = await en((tx) => preciosVigentes(tx, "2026-11-08"));
  assert.equal(q.get(s.id).pequena, "11000.00", "lo que cambió después se queda");
  const [{ n }] = await en((tx) => tx`SELECT count(*)::int AS n FROM servicios`);
  assert.equal(n, 37);
});
