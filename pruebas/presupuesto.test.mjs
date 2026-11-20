// Prioridad 1.6 del prompt de Patricia (20-nov-2026): presupuesto de Empire, mes por mes y contra lo gastado en «Registrar salidas».
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { registrarSalida } from "../lib/salidas.ts";
import {
  agregarCategoria, categoriasDe, categoriasPresupuesto, claveMonto, copiarAnio, desviacion, diasDelMes, estadoPartida, guardarMonto,
  metaDiaria, metaQuincenal, montosDelAnio, necesidadDelMes, quitarCategoria, realDelAnio, sembrarCategorias, sumar,
} from "../lib/presupuesto.ts";

test("estado de cada partida como en las hojas del Excel", () => {
  assert.equal(estadoPartida(0n, 5000n), "Sin presupuesto");
  assert.equal(estadoPartida(100000n, 100001n), "Excedido");
  assert.equal(estadoPartida(100000n, 100000n), "Cerca del límite", "justo en el presupuesto no es excedido");
  assert.equal(estadoPartida(100000n, 90000n), "Cerca del límite");
  assert.equal(estadoPartida(100000n, 89999n), "Dentro");
  assert.equal(desviacion(0n, 10n), null);
  assert.equal(desviacion(100000n, 110000n), 10);
  assert.equal(desviacion(100000n, 50000n), -50);
});

test("cuánto hay que buscar para cubrir el mes, por día laborable y por quincena", () => {
  const n = necesidadDelMes(5000000n, 3000000n, 1500000n, 500000n, 300000n);
  assert.equal(n.diferencia, -300000n);
  assert.equal(n.buscar, 300000n);
  assert.equal(metaDiaria(n.buscar, 20), 15000n);
  assert.equal(metaQuincenal(n.buscar), 150000n);
  assert.equal(necesidadDelMes(9000000n, 1n, 1n, 1n, 1n).buscar, 0n, "si sobra no hay nada que buscar");
  assert.equal(metaDiaria(100n, 0), 0n);
  assert.equal(diasDelMes(2026, 2), 28);
  assert.equal(diasDelMes(2028, 2), 29);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa, c;
const padre = (k) => (k.length === 1 ? null : k.length === 2 ? k[0] : k.slice(0, -2));
const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-presupuesto-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma presupuesto ${marca}`}) RETURNING id`;
  c = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, firma_id) VALUES ('Empire Presupuesto SRL', ${firma}) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    const ids = new Map();
    for (const [codigo, n] of [...CATALOGO_RD, ["110204", "Cuenta corriente – Patricia Paulino"]]) {
      const [r] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${empresa}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${ids.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6})
        RETURNING id`;
      ids.set(codigo, r.id);
    }
    await tx`SELECT configurar_cuentas_empresa(${empresa})`;
    return Object.fromEntries(ids);
  });
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally { await sql.end(); }
});

test("las categorías del Excel se cargan una vez y se pueden agregar, repetir y quitar", conBase, async () => {
  assert.ok((await leer((tx) => categoriasPresupuesto(tx))).oficina.includes("Alquiler local"), "sin abrir, ofrece las del Excel");
  await leer((tx) => sembrarCategorias(tx, empresa));
  await leer((tx) => sembrarCategorias(tx, empresa));
  const of = await leer((tx) => categoriasDe(tx, "oficina"));
  assert.equal(of.length, 13);
  assert.equal((await leer((tx) => categoriasDe(tx, "personal"))).length, 14);
  await leer((tx) => agregarCategoria(tx, empresa, "oficina", "Capacitación"));
  await leer((tx) => agregarCategoria(tx, empresa, "oficina", "  capacitación "));
  assert.equal((await leer((tx) => categoriasDe(tx, "oficina"))).length, 14, "no repite una categoría con otro uso de mayúsculas");
  await assert.rejects(leer((tx) => agregarCategoria(tx, empresa, "oficina", "  ")), /nombre/);
  await leer((tx) => quitarCategoria(tx, of[0].id));
  assert.equal((await leer((tx) => categoriasDe(tx, "oficina"))).length, 13);
  assert.equal((await leer((tx) => categoriasDe(tx, "oficina", false))).length, 14, "quitar solo la esconde");
});

test("montos por mes: guardar, quitar con cero y copiar a otro año sin pisar lo escrito", conBase, async () => {
  const g = (anio, mes, lista, cat, v) => leer((tx) => guardarMonto(tx, empresa, anio, mes, lista, cat, v));
  await g(2026, 1, "oficina", "Nómina", 5000000n);
  await g(2026, 2, "oficina", "Nómina", 5000000n);
  await g(2026, 1, "personal", "Vivienda", 3500000n);
  await g(2026, 1, "ahorro", "Total", 1000000n);
  await g(2026, 2, "oficina", "Nómina", 5500000n);
  const m = await leer((tx) => montosDelAnio(tx, 2026));
  assert.equal(m.get(claveMonto("oficina", "Nómina", 2)), 5500000n);
  await g(2026, 1, "personal", "Vivienda", 0n);
  assert.equal((await leer((tx) => montosDelAnio(tx, 2026))).has(claveMonto("personal", "Vivienda", 1)), false, "cero lo quita");
  await assert.rejects(g(2026, 13, "oficina", "Nómina", 1n), /mes/);
  await assert.rejects(g(2026, 1, "otra", "Nómina", 1n), /lista/);
  await g(2027, 1, "oficina", "Nómina", 999n);
  const n = await leer((tx) => copiarAnio(tx, empresa, 2026, 2027));
  assert.equal(n, 2, "copia lo que 2027 no tenía: febrero y el ahorro");
  const m27 = await leer((tx) => montosDelAnio(tx, 2027));
  assert.equal(m27.get(claveMonto("oficina", "Nómina", 1)), 999n, "lo escrito en 2027 no se pisa");
  assert.equal(m27.get(claveMonto("oficina", "Nómina", 2)), 5500000n);
});

test("lo real sale de las salidas del mes por categoría; otros años no cuentan", conBase, async () => {
  const s = (d) => leer((tx) => registrarSalida(tx, empresa, ana, { origenId: c["110103"], ...d }));
  await s({ tipo: "oficina", fecha: "2026-03-05", destinoId: c["610202"], monto: 450000n, categoria: "Electricidad oficina" });
  await s({ tipo: "oficina", fecha: "2026-03-20", destinoId: c["610202"], monto: 50000n, categoria: "Electricidad oficina" });
  await s({ tipo: "oficina", fecha: "2026-03-21", destinoId: c["610202"], monto: 70000n });
  await s({ tipo: "personal", fecha: "2026-03-06", destinoId: c["110204"], monto: 600000n, categoria: "Vivienda" });
  await s({ tipo: "ahorro", fecha: "2026-03-07", destinoId: c["110104"], monto: 1000000n });
  await s({ tipo: "deuda", fecha: "2026-04-01", destinoId: c["110204"], monto: 300000n, acreedor: "Tarjeta BHD" });
  await s({ tipo: "oficina", fecha: "2025-03-05", destinoId: c["610202"], monto: 111n, categoria: "Electricidad oficina" });
  const r = await leer((tx) => realDelAnio(tx, 2026));
  assert.equal(r[2].oficina.get("Electricidad oficina"), 500000n);
  assert.equal(r[2].oficina.get("Sin categoría"), 70000n);
  assert.equal(sumar(r[2].oficina), 570000n);
  assert.equal(r[2].personal.get("Vivienda"), 600000n);
  assert.equal(r[2].ahorro, 1000000n);
  assert.equal(r[3].deuda, 300000n);
  assert.equal(r[0].ahorro, 0n);
});
