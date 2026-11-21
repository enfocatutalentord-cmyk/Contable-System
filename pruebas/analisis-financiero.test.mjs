// Prioridad 3 · P3f: análisis financiero. Las razones salen de los mismos saldos de los estados; sin balance o con divisor en cero no se calculan.
// Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import {
  armarAnalisis, calcularRazones, datosDeSaldos, GRUPOS, guardarObservaciones, hayTextos, leerFiltrosAnalisis, leerTextos, MAX_TEXTO, normalizarTextos,
  observacionesDe, textosVacios, verCambio, verRazon,
} from "../lib/analisis-financiero.ts";
import { insertarAsiento } from "../lib/asientos.ts";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { docAnalisis } from "../lib/pdf-analisis.ts";

const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const porNombre = (razones, clave) => razones.find((r) => r.clave === clave);
const texto = (r, i = 0) => ("num" in r.valores[i] ? verRazon(r.kind, r.valores[i].num) : null);

// ───── Formato y textos (sin base) ─────

test("los números salen sin floats y con su unidad", () => {
  assert.equal(verRazon("veces", 517n), "5.17");
  assert.equal(verRazon("veces", -5n), "-0.05");
  assert.equal(verRazon("pct", 194n), "19.4 %");
  assert.equal(verRazon("pct", -35n), "-3.5 %");
  assert.equal(verRazon("dias", 360n), "36.0 días");
  assert.equal(verRazon("monto", 12500000n), "125,000.00");
  assert.equal(verCambio("pct", 600n, 450n), "+15.0 pts");
  assert.equal(verCambio("veces", 150n, 200n), "-0.50");
  assert.equal(verCambio("dias", 360n, 360n), "0");
  assert.equal(verCambio("monto", 200000n, 100000n), "+1,000.00");
});

test("las observaciones se leen del formulario con su límite", () => {
  const t = leerTextos(fd({ liquidez_observaciones: "  Buena liquidez  ", actividad_sugerencias: "Cobrar más rápido", general: "Todo bien" }));
  assert.equal(t.liquidez.observaciones, "Buena liquidez");
  assert.equal(t.actividad.sugerencias, "Cobrar más rápido");
  assert.equal(t.endeudamiento.observaciones, "");
  assert.equal(t.general, "Todo bien");
  assert.equal(hayTextos(t), true);
  assert.equal(hayTextos(textosVacios()), false);
  assert.match(leerTextos(fd({ general: "x".repeat(MAX_TEXTO + 1) })), /pasa de 2000/);
  assert.deepEqual(normalizarTextos({ liquidez: { observaciones: 5 }, general: "ok", raro: 1 }).liquidez, { observaciones: "", sugerencias: "" });
  assert.equal(normalizarTextos(null).general, "");
  assert.equal(GRUPOS.length, 4);
});

test("los filtros: por defecto el año en curso y sin comparar; fechas malas se corrigen", () => {
  const f = leerFiltrosAnalisis({});
  assert.equal(f.comparar, "ninguno");
  assert.match(f.desde, /^\d{4}-01-01$/);
  assert.equal(leerFiltrosAnalisis({ comparar: "anio" }).comparar, "anio");
  assert.equal(leerFiltrosAnalisis({ comparar: "meses" }).comparar, "ninguno");
  const g = leerFiltrosAnalisis({ desde: "2026-05-10", hasta: "2026-03-31" });
  assert.ok(g.desde <= g.hasta);
});

// ───── Las razones (puras) ─────

const cuenta = (codigo, tipo, { debe = 0n, haber = 0n, final = 0n, detalle = true } = {}) => ({ id: codigo, codigo, nombre: codigo, tipo, nivel: 6, de_detalle: detalle, inicial: 0n, debe, haber, final });

test("datosDeSaldos arma los datos del período con su signo natural y como el balance", () => {
  const mov = [
    cuenta("410101", "ingreso", { haber: 5000000n }), cuenta("510101", "costo", { debe: 2000000n }), cuenta("610214", "gasto", { debe: 500000n }),
    cuenta("11", "activo", { final: 99n, detalle: false }), // las cuentas de grupo no cuentan
  ];
  const corte = [
    cuenta("110101", "activo", { final: 12500000n }), cuenta("110201", "activo", { final: 2000000n }), cuenta("110203", "activo", { final: -100000n }),
    cuenta("110202", "activo", { final: 700000n }), // cuentas por cobrar a empleados: no es cobro a clientes
    cuenta("110301", "activo", { final: 1000000n }), cuenta("120103", "activo", { final: 3000000n }),
    cuenta("210101", "pasivo", { final: -3000000n }), cuenta("220101", "pasivo", { final: -1000000n }),
    cuenta("310101", "patrimonio", { final: -12600000n }),
    cuenta("410101", "ingreso", { final: -5000000n }), cuenta("510101", "costo", { final: 2000000n }), cuenta("610214", "gasto", { final: 500000n }),
  ];
  const d = datosDeSaldos("T", "2026-01-01", "2026-03-31", mov, corte);
  assert.equal(d.dias, 90);
  assert.equal(d.ingresos, 5000000n);
  assert.equal(d.utilidadBruta, 3000000n);
  assert.equal(d.utilidadNeta, 2500000n);
  assert.equal(d.activos, 12500000n + 2000000n - 100000n + 700000n + 1000000n + 3000000n);
  assert.equal(d.activoCorriente, 12500000n + 2000000n - 100000n + 700000n + 1000000n);
  assert.equal(d.cxc, 1900000n, "clientes menos incobrables");
  assert.equal(d.inventarios, 1000000n);
  assert.equal(d.pasivos, 4000000n);
  assert.equal(d.pasivoCorriente, 3000000n);
  assert.equal(d.patrimonio, 12600000n + 2500000n, "capital más el resultado sin cerrar");
  assert.equal(d.hayBalance, true);
  assert.equal(d.cuadra, true);
});

test("sin saldos de balance no se calcula nada que los use, y se dice por qué", () => {
  const d = datosDeSaldos("T", "2026-01-01", "2026-03-31", [cuenta("410101", "ingreso", { haber: 5000000n }), cuenta("510101", "costo", { debe: 2000000n })], []);
  assert.equal(d.hayBalance, false);
  const r = calcularRazones([d]);
  for (const clave of ["corriente", "acida", "capital", "deuda_total", "endeudamiento", "deuda_patrimonio", "roa", "roe", "dias_cobro", "rotacion_inventario", "rotacion_activos"]) {
    const v = porNombre(r, clave).valores[0];
    assert.ok("motivo" in v && /Faltan los saldos del balance/.test(v.motivo), clave);
  }
  // Las de resultados sí: 60 % y 60 %... (ingresos 50,000; costo 20,000; utilidad neta = bruta porque no hay gastos)
  assert.equal(texto(porNombre(r, "margen_bruto")), "60.0 %");
  assert.equal(texto(porNombre(r, "margen_neto")), "60.0 %");
});

test("divisores en cero o negativos: no se calcula y se explica", () => {
  const base = { titulo: "T", desde: "2026-01-01", hasta: "2026-03-31", dias: 90, ingresos: 0n, costo: 0n, utilidadBruta: 0n, utilidadNeta: -100000n,
    activoCorriente: 1000000n, inventarios: 0n, cxc: 0n, activos: 1000000n, pasivoCorriente: 0n, pasivos: 1500000n, patrimonio: -500000n, hayBalance: true, cuadra: true };
  const r = calcularRazones([base]);
  const motivo = (c) => porNombre(r, c).valores[0].motivo;
  assert.match(motivo("corriente"), /No hay pasivos corrientes/);
  assert.match(motivo("acida"), /No hay pasivos corrientes/);
  assert.match(motivo("deuda_patrimonio"), /patrimonio es cero o negativo/);
  assert.match(motivo("roe"), /patrimonio es cero o negativo/);
  assert.match(motivo("margen_bruto"), /No hay ingresos/);
  assert.match(motivo("dias_cobro"), /No hay ingresos/);
  assert.match(motivo("rotacion_inventario"), /No tiene inventario/);
  assert.equal(texto(porNombre(r, "capital")), "10,000.00");
  assert.equal(texto(porNombre(r, "endeudamiento")), "150.0 %");
  assert.equal(texto(porNombre(r, "roa")), "-10.0 %", "una pérdida da rendimiento negativo");
});

// ───── Con la base ─────

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, empresa, firma, cuentas;
const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));
const asiento = (fecha, lineas) => leer((tx) => insertarAsiento(tx, {
  empresaId: empresa, usuarioId: ana, fecha, concepto: "prueba", origen: "manual",
  lineas: lineas.map(([codigo, debe, haber]) => ({ cuentaId: cuentas[codigo], debe, haber })),
}));

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-af-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  await sql.begin(async (tx) => {
    [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma análisis ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, rnc, firma_id, lleva_contabilidad) VALUES ('Análisis SRL', '130000077', ${firma}, true) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    const m = new Map();
    for (const [codigo, n] of CATALOGO_RD) {
      const [c] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${empresa}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${m.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6})
        RETURNING id`;
      m.set(codigo, c.id);
    }
    cuentas = Object.fromEntries(m);
  });
  await asiento("2026-01-02", [["110101", 10000000n, 0n], ["310101", 0n, 10000000n]]);   // capital 100,000
  await asiento("2026-01-05", [["110301", 3000000n, 0n], ["210101", 0n, 3000000n]]);      // inventario 30,000 a crédito
  await asiento("2026-02-10", [["110201", 2000000n, 0n], ["110101", 3000000n, 0n], ["410101", 0n, 5000000n]]); // venta 50,000: 20,000 a crédito
  await asiento("2026-02-10", [["510101", 2000000n, 0n], ["110301", 0n, 2000000n]]);     // costo 20,000
  await asiento("2026-02-15", [["610214", 500000n, 0n], ["110101", 0n, 500000n]]);       // gasto 5,000
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

test("las razones de una empresa con sus asientos, a mano", conBase, async () => {
  const a = await leer((tx) => armarAnalisis(tx, "2026-01-01", "2026-03-31", "ninguno"));
  assert.equal(a.columnas.length, 1);
  assert.deepEqual(a.sinBalance, []);
  assert.deepEqual(a.noCuadra, []);
  assert.equal(a.sinIngresos, false);
  const v = (c) => texto(porNombre(a.razones, c));
  assert.equal(v("corriente"), "5.17");           // 155,000 ÷ 30,000
  assert.equal(v("acida"), "4.83");               // (155,000 − 10,000) ÷ 30,000
  assert.equal(v("capital"), "125,000.00");
  assert.equal(v("deuda_total"), "30,000.00");
  assert.equal(v("endeudamiento"), "19.4 %");     // 30,000 ÷ 155,000
  assert.equal(v("deuda_patrimonio"), "0.24");    // 30,000 ÷ 125,000
  assert.equal(v("margen_bruto"), "60.0 %");      // 30,000 ÷ 50,000
  assert.equal(v("margen_neto"), "50.0 %");       // 25,000 ÷ 50,000
  assert.equal(v("roa"), "16.1 %");               // 25,000 ÷ 155,000
  assert.equal(v("roe"), "20.0 %");               // 25,000 ÷ 125,000
  assert.equal(v("dias_cobro"), "36.0 días");     // 20,000 × 90 ÷ 50,000
  assert.equal(v("rotacion_inventario"), "2.00"); // 20,000 ÷ 10,000
  assert.equal(v("rotacion_activos"), "0.32");    // 50,000 ÷ 155,000
});

test("el comparativo con el año pasado, sin datos, no inventa nada", conBase, async () => {
  const a = await leer((tx) => armarAnalisis(tx, "2026-01-01", "2026-03-31", "anio"));
  assert.equal(a.columnas.length, 2);
  assert.equal(a.columnas[1].hasta, "2025-03-31");
  assert.deepEqual(a.sinBalance, [a.columnas[1].titulo]);
  const corriente = porNombre(a.razones, "corriente");
  assert.equal(texto(corriente, 0), "5.17");
  assert.match(corriente.valores[1].motivo, /Faltan los saldos del balance/);
  assert.match(porNombre(a.razones, "margen_bruto").valores[1].motivo, /No hay ingresos/);
});

test("el período anterior toma el mismo largo justo antes", conBase, async () => {
  const a = await leer((tx) => armarAnalisis(tx, "2026-02-01", "2026-03-31", "anterior"));
  assert.equal(a.columnas[1].desde, "2025-12-01");
  assert.equal(a.columnas[1].hasta, "2026-01-31");
  // En enero hubo capital e inventario pero ninguna venta.
  assert.equal(a.columnas[1].hayBalance, true);
  assert.equal(a.columnas[1].ingresos, 0n);
  assert.equal(texto(porNombre(a.razones, "corriente"), 1), "4.33"); // (100,000 + 30,000) ÷ 30,000
  assert.match(porNombre(a.razones, "margen_bruto").valores[1].motivo, /No hay ingresos/);
  assert.equal(texto(porNombre(a.razones, "corriente"), 0), "5.17");
});

test("las observaciones se guardan por período y se reemplazan; el informe sale en PDF", conBase, async () => {
  assert.equal(hayTextos((await leer((tx) => observacionesDe(tx, "2026-01-01", "2026-03-31"))).textos), false);
  const t = textosVacios();
  t.liquidez = { observaciones: "Liquidez cómoda.", sugerencias: "Invertir el excedente." };
  t.general = "Buena posición.";
  await leer((tx) => guardarObservaciones(tx, { empresaId: empresa, usuarioId: ana, desde: "2026-01-01", hasta: "2026-03-31", textos: t }));
  t.general = "Buena posición, con atención a cobros.";
  await leer((tx) => guardarObservaciones(tx, { empresaId: empresa, usuarioId: ana, desde: "2026-01-01", hasta: "2026-03-31", textos: t }));
  const o = await leer((tx) => observacionesDe(tx, "2026-01-01", "2026-03-31"));
  assert.equal(o.textos.general, "Buena posición, con atención a cobros.");
  assert.equal(o.textos.liquidez.sugerencias, "Invertir el excedente.");
  assert.equal(o.por, "Ana");
  const otro = await leer((tx) => observacionesDe(tx, "2026-01-01", "2026-06-30"));
  assert.equal(hayTextos(otro.textos), false, "es por período");
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM analisis_observaciones WHERE empresa_id = ${empresa}`;
  assert.equal(n, 1);

  const { nombre, doc } = await leer((tx) => docAnalisis(tx, { empresaId: empresa, empresa: "Análisis SRL", rnc: "130000077", desde: "2026-01-01", hasta: "2026-03-31", comparar: "anio", preparadoPor: "Ana" }));
  assert.match(nombre, /^analisis-financiero-130000077-2026-03-31\.pdf$/);
  const todo = JSON.stringify(doc.content);
  for (const parte of ["Análisis financiero", "Razón corriente", "5.17", "Liquidez cómoda.", "Invertir el excedente.", "Buena posición, con atención a cobros.", "Faltan los saldos del balance"]) {
    assert.ok(todo.includes(parte), parte);
  }
  assert.ok(!todo.includes('"image"'), "sin logo en la ficha, el informe sale sin él");
});

test("el informe lleva el logo de la ficha del cliente", conBase, async () => {
  // PNG de 1×1 píxel.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
  await leer((tx) => tx`INSERT INTO documentos (empresa_id, entidad, entidad_id, nombre, tipo, tamano, sha256, contenido, descripcion, subido_por)
    VALUES (${empresa}, 'empresa', ${empresa}, 'logo.png', 'image/png', ${png.length}, ${`af${marca}`}, ${png}, 'logo', ${ana})`);
  const { doc } = await leer((tx) => docAnalisis(tx, { empresaId: empresa, empresa: "Análisis SRL", rnc: null, desde: "2026-01-01", hasta: "2026-03-31", comparar: "ninguno", preparadoPor: "Ana" }));
  const imagen = JSON.stringify(doc.content).match(/"image":"(data:image\/png;base64,[^"]+)"/);
  assert.ok(imagen, "la imagen va en el informe");
  assert.equal(Buffer.from(imagen[1].split(",")[1], "base64").length, png.length);
});

test("las observaciones respetan el aislamiento por empresa", conBase, async () => {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE contable_app`;
    await tx`SELECT set_config('app.empresa_id', '00000000-0000-0000-0000-000000000001', true)`;
    const filas = await tx`SELECT id FROM analisis_observaciones`;
    assert.equal(filas.length, 0);
  });
});

test("el informe no deja pasar letras que el PDF no dibuja", conBase, async () => {
  const t = textosVacios();
  t.general = "Todo bien 😀 − listo";
  await leer((tx) => guardarObservaciones(tx, { empresaId: empresa, usuarioId: ana, desde: "2026-04-01", hasta: "2026-04-30", textos: t }));
  const { doc } = await leer((tx) => docAnalisis(tx, { empresaId: empresa, empresa: "Análisis ’SRL’", rnc: null, desde: "2026-04-01", hasta: "2026-04-30", comparar: "ninguno", preparadoPor: "Ana" }));
  const todo = JSON.stringify(doc.content);
  assert.ok(!todo.includes("😀") && !todo.includes("−"), "sin emojis ni signo menos de Unicode");
  assert.ok(todo.includes("Todo bien ?? - listo"), "cambiados por un signo que sí se dibuja");
  assert.ok(todo.includes("Análisis ’SRL’"), "las comillas y tildes normales se respetan");
});
