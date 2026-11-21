// Prioridad 3 · P3l · Inventario: conteos con el listado de existencias del cliente, lecturas con lector tipo teclado o a mano, y cierre.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import ExcelJS from "exceljs";
import postgres from "postgres";
import { leerTabla, tipoEstadoCuenta } from "../lib/archivos-banco.ts";
import {
  aTexto, cambiarEstadoConteo, crearConteo, deshacerLectura, detalleConteo, deTexto, ErrorInventario, fijarTotal, leerCantidadLectura, leerConteo, leerDecimal, leerExistencias,
  listarConteos, normCodigo, registrarLectura, verCantidad,
} from "../lib/inventario.ts";

const form = (o) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) fd.append(k, v); return fd; };
const E4 = 10000n;

test("números: miles con coma o con punto, hasta 4 decimales, sin floats", () => {
  assert.equal(leerDecimal("12"), 12n * E4);
  assert.equal(leerDecimal("1,250.5"), 12505000n);
  assert.equal(leerDecimal("1.250,5"), 12505000n);
  assert.equal(leerDecimal("7,5"), 75000n);
  assert.equal(leerDecimal(3.25), 32500n);
  assert.equal(leerDecimal(" -3 "), -3n * E4);
  assert.equal(leerDecimal("0.1234"), 1234n);
  assert.equal(leerDecimal("0.12345"), null);
  assert.equal(leerDecimal("abc"), null);
  assert.equal(leerDecimal(""), null);
  assert.equal(leerDecimal(null), null);
  assert.equal(leerDecimal(Number.NaN), null);
  assert.equal(aTexto(12505000n), "1250.5000");
  assert.equal(aTexto(-5000n), "-0.5000");
  assert.equal(deTexto("1250.5000"), 12505000n);
  assert.equal(deTexto("-0.5000"), -5000n);
  assert.equal(deTexto("3"), 3n * E4);
  assert.equal(verCantidad(12505000n), "1,250.5");
  assert.equal(verCantidad(3n * E4), "3");
  assert.equal(verCantidad(-5000n), "-0.5");
  assert.equal(verCantidad(1234567n * E4), "1,234,567");
  assert.equal(verCantidad(0n), "0");
});

test("códigos: se comparan sin espacios, en mayúsculas y sin ceros a la izquierda", () => {
  assert.equal(normCodigo(" 00123 "), "123");
  assert.equal(normCodigo("ab 12"), "AB12");
  assert.equal(normCodigo("000"), "0");
  assert.equal(normCodigo("0"), "0");
  assert.equal(normCodigo("7501234567890"), "7501234567890");
});

test("la cantidad de una lectura: vacía es 1, mayor que cero y razonable", () => {
  assert.equal(leerCantidadLectura(""), E4);
  assert.equal(leerCantidadLectura("12"), 12n * E4);
  assert.equal(leerCantidadLectura("2.5"), 25000n);
  assert.throws(() => leerCantidadLectura("0"), /mayor que cero/);
  assert.throws(() => leerCantidadLectura("-1"), /mayor que cero/);
  assert.throws(() => leerCantidadLectura("abc"), /número/);
  assert.throws(() => leerCantidadLectura("99999999"), /grande/);
});

test("el conteo: nombre, fecha válida y notas", () => {
  const ok = leerConteo(form({ nombre: "  Conteo   de fin de año ", ubicacion: " Bodega 1 ", fecha: "2026-12-31", notas: "" }));
  assert.deepEqual(ok, { nombre: "Conteo de fin de año", ubicacion: "Bodega 1", fecha: "2026-12-31", notas: "" });
  assert.throws(() => leerConteo(form({ nombre: "ab", fecha: "2026-12-31" })), /nombre/);
  assert.throws(() => leerConteo(form({ nombre: "Conteo", fecha: "2026-02-30" })), /fecha/);
  assert.throws(() => leerConteo(form({ nombre: "Conteo", fecha: "" })), /fecha/);
});

test("listado: encuentra el encabezado, las columnas y lee cada fila", () => {
  const r = leerExistencias([
    ["Ferretería Demo", null, null, null, null],
    ["Existencias al 30/11/2026"],
    ["Código", "Descripción", "Unidad de medida", "Existencia", "Costo unitario", "Código de barras"],
    ["00123", "Tornillo 1/2", "caja", "1,250.5", 12.5, 7501234567890],
    [456, "Martillo", "und", 8, "RD$ 350.00", null],
    ["Total", null, null, 1258.5, null, null],
    [null, null, null, null, null, null],
  ]);
  assert.deepEqual(r.errores, []);
  assert.equal(r.articulos.length, 2);
  assert.deepEqual(r.columnas, { codigo: "Código", nombre: "Descripción", unidad: "Unidad de medida", cantidad: "Existencia", costo: "Costo unitario", barras: "Código de barras" });
  assert.deepEqual(r.articulos[0], { orden: 0, codigo: "00123", barras: "7501234567890", nombre: "Tornillo 1/2", unidad: "caja", existencia: 12505000n, costo: 125000n });
  assert.equal(r.articulos[1].codigo, "456");
  assert.equal(r.articulos[1].costo, 3500000n, "«RD$ 350.00»: se quita el signo de pesos");
});

test("listado: lo que no sirve se dice con su fila", () => {
  const filas = [
    ["Código", "Nombre", "Cantidad", "Costo"],
    ["A1", "Uno", "5", "10"],
    ["", "Sin código", "3", ""],
    ["A2", "Dos", "xx", ""],
    ["A3", "Tres", "-4", ""],
    ["A4", "Cuatro", "2", "gratis"],
    ["a1", "Uno repetido", "1", ""],
    ["001", "Cero uno", "1", ""],
    ["1", "Uno otra vez", "1", ""],
    ["TOTAL", "", "", ""],
  ];
  const r = leerExistencias(filas);
  assert.equal(r.articulos.length, 2, "A1 y 001");
  const e = r.errores.join("\n");
  assert.match(e, /Fila 3: falta el código/);
  assert.match(e, /Fila 4 \(A2\): la cantidad «xx» no es un número/);
  assert.match(e, /Fila 5 \(A3\): la cantidad es negativa/);
  assert.match(e, /Fila 6 \(A4\): el costo «gratis» no es válido/);
  assert.match(e, /Fila 7: el código «a1» está repetido \(ya salió en la fila 2\)/);
  assert.match(e, /Fila 9: el código «1» está repetido \(ya salió en la fila 8\)/, "001 y 1 son el mismo código");
  assert.equal(r.ignoradas, 1, "la fila de totales no cuenta");
});

test("listado: sin columnas reconocibles, vacío y avisos de lo que falta", () => {
  assert.match(leerExistencias([["A", "B"], [1, 2]]).errores[0], /No encontré las columnas/);
  assert.match(leerExistencias([["Código", "Cantidad"]]).errores[0], /no tiene artículos/);
  const r = leerExistencias([["SKU", "Stock"], ["X1", 3]]);
  assert.deepEqual(r.errores, []);
  assert.equal(r.articulos[0].existencia, 3n * E4);
  assert.equal(r.avisos.length, 2, "sin nombre y sin costo");
  assert.match(r.avisos.join(" "), /nombre/);
  assert.match(r.avisos.join(" "), /costo/);
});

test("un Excel de verdad (.xlsx) y un CSV con acentos se leen igual", async () => {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Existencias");
  hoja.addRow(["Código", "Descripción", "Existencia", "Costo"]);
  hoja.addRow([100234, "Cemento gris", 150, 475.5]);   // código numérico, como lo guarda Excel
  hoja.addRow(["B-7", "Varilla 3/8", 1200.25, 88]);
  const bytes = new Uint8Array(await libro.xlsx.writeBuffer());
  assert.equal(tipoEstadoCuenta(bytes), "xlsx");
  const r = leerExistencias(await leerTabla(bytes, "xlsx"));
  assert.deepEqual(r.errores, []);
  assert.deepEqual(r.articulos.map((a) => [a.codigo, a.nombre, a.existencia, a.costo]), [["100234", "Cemento gris", 1500000n, 4755000n], ["B-7", "Varilla 3/8", 12002500n, 880000n]]);

  const csv = new TextEncoder().encode("Código;Nombre;Cantidad\nA1;Café molido;3,5\nA2;Azúcar;10\n");
  assert.equal(tipoEstadoCuenta(csv), "csv");
  const c = leerExistencias(await leerTabla(csv, "csv"));
  assert.deepEqual(c.articulos.map((a) => [a.codigo, a.nombre, a.existencia]), [["A1", "Café molido", 35000n], ["A2", "Azúcar", 100000n]]);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let firma, empresa, otra, ana;

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-inventario-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma inventario ${marca}`}) RETURNING id`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (firma_id, nombre) VALUES (${firma}, 'Cliente Inventario SRL') RETURNING id`;
  [{ id: otra }] = await sql`INSERT INTO empresas (firma_id, nombre) VALUES (${firma}, 'Otro Cliente SRL') RETURNING id`;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id IN (${empresa}, ${otra})`; // con un conteo cerrado: el borrado en cascada no se bloquea
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally { await sql.end(); }
});

const en = (eid, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${eid}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  return fn(tx);
});
const enEmpresa = (fn) => en(empresa, fn);
const art = (orden, codigo, nombre, existencia, costo = null, barras = "", unidad = "und") => ({ orden, codigo, barras, nombre, unidad, existencia: BigInt(Math.round(existencia * 10000)), costo: costo === null ? null : BigInt(Math.round(costo * 10000)) });
let cid, a1, a2;

test("abrir el conteo: número por cliente, listado guardado tal cual y cifras en cero", conBase, async () => {
  const articulos = [art(0, "00123", "Tornillo 1/2", 100, 12.5, "7501234567890"), art(1, "456", "Martillo", 8, 350), art(2, "XYZ", "Pintura", 2.5, 1200.75, "", "galón")];
  cid = await enEmpresa((tx) => crearConteo(tx, { nombre: "Conteo de fin de año", ubicacion: "Bodega 1", fecha: "2026-12-31", notas: "", empresaId: empresa, usuarioId: ana, archivoNombre: "existencias.xlsx", articulos }));
  const b = await enEmpresa((tx) => crearConteo(tx, { nombre: "Segundo conteo", ubicacion: "", fecha: "2026-12-31", notas: "", empresaId: empresa, usuarioId: ana, archivoNombre: "e2.csv", articulos: [art(0, "A", "A", 1)] }));
  const c = await en(otra, (tx) => crearConteo(tx, { nombre: "De otro cliente", ubicacion: "", fecha: "2026-12-31", notas: "", empresaId: otra, usuarioId: ana, archivoNombre: "x.csv", articulos: [art(0, "Z", "Z", 1)] }));
  const nums = Object.fromEntries((await sql`SELECT id, numero FROM conteos_inventario WHERE id IN (${cid}, ${b}, ${c})`).map((r) => [r.id, r.numero]));
  assert.deepEqual([nums[cid], nums[b], nums[c]], [1, 2, 1], "el número es por cliente");
  const d = await enEmpresa((tx) => detalleConteo(tx, cid));
  assert.deepEqual([d.estado, d.total_articulos, d.contados, d.lecturas, d.unidades, d.con_costo, d.con_nombre], ["abierto", 3, 0, 0, 0n, 3, 3]);
  assert.deepEqual(d.articulos.map((a) => [a.codigo, a.existencia, a.costo]), [["00123", 1000000n, 125000n], ["456", 80000n, 3500000n], ["XYZ", 25000n, 12007500n]]);
  [a1, a2] = d.articulos.map((a) => a.id);
  const lista = (await enEmpresa((tx) => listarConteos(tx))).find((x) => x.id === cid);
  assert.deepEqual([lista.articulos, lista.contados, lista.lecturas, lista.sin_listado], [3, 0, 0, 0]);
  await assert.rejects(sql`INSERT INTO conteo_articulos (empresa_id, conteo_id, orden, codigo, codigo_norm, existencia) VALUES (${empresa}, ${cid}, 9, 'ABC', ${normCodigo("00123")}, 1)`, /unique|duplicate|duplicad|único/i, "el mismo código no entra dos veces");
});

test("lecturas: por código, sin ceros a la izquierda, por código de barras, y lo que no está en el listado", conBase, async () => {
  const leer = (codigo, cantidad = E4, origen = "lector") => enEmpresa((tx) => registrarLectura(tx, { conteoId: cid, empresaId: empresa, usuarioId: ana, codigo, cantidad, origen }));
  let r = await leer("123");
  assert.equal(r.articulo.codigo, "00123", "«123» es «00123» (Excel le quita los ceros)");
  assert.deepEqual([r.cantidad, r.total], [E4, E4]);
  r = await leer("7501234567890", 5n * E4);
  assert.equal(r.articulo.codigo, "00123", "el código de barras lleva al mismo artículo");
  assert.equal(r.total, 6n * E4);
  r = await leer(" xyz ", 25000n, "manual");
  assert.deepEqual([r.articulo.nombre, r.articulo.unidad, r.total], ["Pintura", "galón", 25000n]);
  r = await leer("999");
  assert.equal(r.articulo, null, "no está en el listado");
  r = await leer("0999", 2n * E4);
  assert.equal(r.total, 3n * E4, "los sin listado se juntan por código normalizado");
  await assert.rejects(leer(""), /Escribe o escanea/);
  await assert.rejects(leer("x".repeat(61)), /muy largo/);

  const d = await enEmpresa((tx) => detalleConteo(tx, cid));
  assert.deepEqual([d.contados, d.lecturas, d.unidades], [2, 5, 6n * E4 + 25000n + 3n * E4]);
  assert.deepEqual(d.sin_listado.map((s) => [s.codigo, s.cantidad, s.lecturas]), [["0999", 3n * E4, 2]]);
  assert.equal(d.recientes[0].codigo, "0999", "la última lectura primero");
  const lista = (await enEmpresa((tx) => listarConteos(tx))).find((x) => x.id === cid);
  assert.deepEqual([lista.contados, lista.lecturas, lista.sin_listado], [2, 5, 1]);
});

test("el listado se filtra por texto y por contado o por contar", conBase, async () => {
  const q = (o) => enEmpresa((tx) => detalleConteo(tx, cid, o)).then((d) => d.articulos.map((a) => a.codigo));
  assert.deepEqual(await q({ q: "tornillo" }), ["00123"]);
  assert.deepEqual(await q({ q: "750123" }), ["00123"], "por código de barras");
  assert.deepEqual(await q({ q: "xy" }), ["XYZ"]);
  assert.deepEqual(await q({ ver: "contados" }), ["00123", "XYZ"]);
  assert.deepEqual(await q({ ver: "pendientes" }), ["456"]);
  assert.deepEqual(await q({ q: "nada" }), []);
  assert.deepEqual(await q({ q: "%" }), [], "el % no es un comodín");
});

test("fijar el total a mano deja una lectura de ajuste; deshacer la quita sin borrarla", conBase, async () => {
  await enEmpresa((tx) => fijarTotal(tx, { conteoId: cid, empresaId: empresa, usuarioId: ana, articuloId: a1, total: 4n * E4, nota: "Recontado" }));
  let d = await enEmpresa((tx) => detalleConteo(tx, cid));
  assert.equal(d.articulos.find((a) => a.id === a1).contado, 4n * E4, "de 6 pasó a 4");
  const [aj] = await sql`SELECT cantidad::text AS c, origen, nota FROM conteo_lecturas WHERE articulo_id = ${a1} AND origen = 'ajuste'`;
  assert.deepEqual({ ...aj }, { c: "-2.0000", origen: "ajuste", nota: "Recontado" });
  await assert.rejects(enEmpresa((tx) => fijarTotal(tx, { conteoId: cid, empresaId: empresa, usuarioId: ana, articuloId: a1, total: 4n * E4, nota: "" })), /ya tiene ese total/);
  await assert.rejects(enEmpresa((tx) => fijarTotal(tx, { conteoId: cid, empresaId: empresa, usuarioId: ana, articuloId: a1, total: -1n, nota: "" })), /no es válido/);
  await enEmpresa((tx) => fijarTotal(tx, { conteoId: cid, empresaId: empresa, usuarioId: ana, articuloId: a2, total: 8n * E4, nota: "" })); // el que no tenía lecturas
  d = await enEmpresa((tx) => detalleConteo(tx, cid));
  assert.equal(d.articulos.find((a) => a.id === a2).contado, 8n * E4);

  const ultimo = d.recientes[0];
  await enEmpresa((tx) => deshacerLectura(tx, { id: ultimo.id, conteoId: cid, usuarioId: ana }));
  d = await enEmpresa((tx) => detalleConteo(tx, cid));
  assert.equal(d.articulos.find((a) => a.id === a2).contado, 0n, "ya no cuenta");
  assert.equal(d.recientes[0].anulada, true, "sigue en la lista, marcada");
  const [{ anulada_por }] = await sql`SELECT anulada_por FROM conteo_lecturas WHERE id = ${ultimo.id}`;
  assert.equal(anulada_por, ana);
  await assert.rejects(enEmpresa((tx) => deshacerLectura(tx, { id: ultimo.id, conteoId: cid, usuarioId: ana })), /ya estaba deshecha/);
});

test("cerrar: el conteo ya no cambia; reabrirlo lo libera", conBase, async () => {
  const L = { conteoId: cid, empresaId: empresa, usuarioId: ana };
  await assert.rejects(enEmpresa((tx) => cambiarEstadoConteo(tx, cid, "abierto", ana)), /ya está abierto/);
  await enEmpresa((tx) => cambiarEstadoConteo(tx, cid, "cerrado", ana));
  const [c] = await sql`SELECT estado, cerrado_por, cerrado_en FROM conteos_inventario WHERE id = ${cid}`;
  assert.equal(c.estado, "cerrado"); assert.equal(c.cerrado_por, ana); assert.ok(c.cerrado_en);
  await assert.rejects(enEmpresa((tx) => registrarLectura(tx, { ...L, codigo: "456", cantidad: E4, origen: "lector" })), /cerrado/);
  await assert.rejects(enEmpresa((tx) => fijarTotal(tx, { ...L, articuloId: a1, total: E4, nota: "" })), /cerrado/);
  const d = await enEmpresa((tx) => detalleConteo(tx, cid));
  await assert.rejects(enEmpresa((tx) => deshacerLectura(tx, { id: d.recientes[1].id, conteoId: cid, usuarioId: ana })), /cerrado/);
  // aunque alguien intente saltarse la aplicación, la base también lo impide
  await assert.rejects(sql`INSERT INTO conteo_lecturas (empresa_id, conteo_id, codigo_leido, codigo_norm, cantidad, origen, creado_por) VALUES (${empresa}, ${cid}, 'X', 'X', 1, 'manual', ${ana})`, /cerrado/);
  await assert.rejects(sql`DELETE FROM conteo_articulos WHERE conteo_id = ${cid}`, /cerrado/);
  await assert.rejects(sql`UPDATE conteos_inventario SET nombre = 'Otro nombre' WHERE id = ${cid}`, /cerrado/);
  // cerrado se ve la existencia y la diferencia: tornillos 4 contados de 100; martillos 0 de 8 (el que se deshizo); pintura 2.5 de 2.5
  const t = Object.fromEntries(d.articulos.map((a) => [a.codigo, [a.contado, a.existencia]]));
  assert.deepEqual(t["00123"], [4n * E4, 100n * E4]);
  assert.deepEqual(t["456"], [0n, 8n * E4]);
  assert.deepEqual(t["XYZ"], [25000n, 25000n]);

  await enEmpresa((tx) => cambiarEstadoConteo(tx, cid, "abierto", ana));
  const [r] = await sql`SELECT estado, cerrado_por, cerrado_en FROM conteos_inventario WHERE id = ${cid}`;
  assert.deepEqual([r.estado, r.cerrado_por, r.cerrado_en], ["abierto", null, null]);
  await enEmpresa((tx) => registrarLectura(tx, { ...L, codigo: "456", cantidad: E4, origen: "lector" }));
  await enEmpresa((tx) => cambiarEstadoConteo(tx, cid, "cerrado", ana)); // se deja cerrado: la limpieza del final borra la empresa de todos modos
});

test("el aislamiento: la base solo muestra los conteos de la empresa en curso", conBase, async () => {
  const aqui = await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE contable_app`;
    await tx`SELECT set_config('app.empresa_id', ${otra}, true)`;
    const c = await tx`SELECT nombre FROM conteos_inventario`;
    const a = await tx`SELECT codigo FROM conteo_articulos`;
    return { c: c.map((r) => r.nombre), a: a.map((r) => r.codigo) };
  });
  assert.deepEqual(aqui, { c: ["De otro cliente"], a: ["Z"] });
});
