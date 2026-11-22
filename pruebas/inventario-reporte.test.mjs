// Prioridad 3 · P3m · Reporte de diferencias del conteo de inventario: cantidades, pesos, Excel y PDF.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { cambiarEstadoConteo, crearConteo, fijarTotal, registrarLectura } from "../lib/inventario.ts";
import { guardarArchivos } from "../lib/expediente.ts";
import { armarDiferencias, CARPETA_REPORTE, descripcionReporte, docInventario, lineasResumen, ordenarDiferencias, reporteConteo, reportesGuardados, tablaInventario, valorEnCentavos } from "../lib/inventario-reporte.ts";

const E4 = 10000n;
const q = (n) => BigInt(Math.round(n * 10000));
const art = (codigo, nombre, existencia, contado, costo = null, lecturas = contado === 0 ? 0 : 1, extra = {}) =>
  ({ codigo, barras: "", nombre, unidad: "und", existencia: q(existencia), contado: q(contado), lecturas, costo: costo === null ? null : q(costo), ...extra });

test("valor en pesos: cantidad × costo con 4 decimales, a centavos, medio centavo hacia afuera", () => {
  assert.equal(valorEnCentavos(q(2), q(12.5)), 2500n);
  assert.equal(valorEnCentavos(q(-98), q(12.5)), -122500n);
  assert.equal(valorEnCentavos(q(0.5), q(0.01)), 1n, "0.005 → medio centavo sube a 1");
  assert.equal(valorEnCentavos(q(-0.5), q(0.01)), -1n);
  assert.equal(valorEnCentavos(q(0.4), q(0.01)), 0n);
  assert.equal(valorEnCentavos(q(1250.5), q(0.3333)), 41679n, "1250.5 × 0.3333 = 416.79165 → 416.79");
  assert.equal(valorEnCentavos(0n, q(99)), 0n);
});

test("diferencias: faltantes, sobrantes, iguales, sin contar y sin costo", () => {
  const { filas, resumen: r } = armarDiferencias([
    art("A", "Tornillo", 100, 98, 12.5),       // faltan 2 → -25.00
    art("B", "Martillo", 8, 10, 350),          // sobran 2 → +700.00
    art("C", "Pintura", 2.5, 2.5, 1200.75),    // igual
    art("D", "Cemento", 40, 0, 475.5),         // sin contar: falta todo → -19,020.00
    art("E", "Sin costo", 5, 3, null),         // falta 2, sin costo
  ]);
  assert.deepEqual(filas.map((f) => [f.codigo, f.tipo, f.diferencia, f.valor]), [
    ["A", "faltante", q(-2), -2500n], ["B", "sobrante", q(2), 70000n], ["C", "igual", 0n, 0n], ["D", "faltante", q(-40), -1902000n], ["E", "faltante", q(-2), null],
  ]);
  assert.deepEqual([r.articulos, r.iguales, r.faltantes, r.sobrantes, r.sinContar, r.sinCosto, r.conCosto], [5, 1, 3, 1, 1, 1, true]);
  assert.deepEqual([r.unidadesFaltantes, r.unidadesSobrantes], [q(44), q(2)]);
  assert.deepEqual([r.valorFaltante, r.valorSobrante, r.valorNeto], [-1904500n, 70000n, -1834500n]);
  // el valor del listado (100×12.50 + 8×350 + 2.5×1200.75 + 40×475.50) y el contado (98×12.50 + 10×350 + 2.5×1200.75 + 0)
  assert.equal(r.valorListado, 125000n + 280000n + 300188n + 1902000n, "2.5 × 1200.75 = 3001.875 → 3,001.88");
  assert.equal(r.valorContado, 122500n + 350000n + 300188n);
  assert.equal(r.valorNeto, r.valorFaltante + r.valorSobrante);

  const sinCostos = armarDiferencias([art("X", "Uno", 5, 4)]);
  assert.equal(sinCostos.resumen.conCosto, false);
  assert.deepEqual(sinCostos.resumen.valorNeto, 0n);
});

test("orden: primero lo de más peso en pesos; lo que no tiene costo, al final por cantidad", () => {
  const { filas } = armarDiferencias([art("A", "a", 100, 98, 12.5), art("B", "b", 8, 10, 350), art("C", "c", 40, 0, 475.5), art("E", "e", 5, 0, null), art("F", "f", 5, 4, null), art("G", "g", 1, 0, 1)]);
  assert.deepEqual(ordenarDiferencias(filas).map((f) => f.codigo), ["C", "B", "A", "G", "E", "F"]);
});

const reporte = (filas, sinListado = []) => ({
  id: "x", numero: 4, nombre: "Conteo de fin de año", ubicacion: "Bodega 1", fecha: "2026-12-31", notas: "Se contó con lector", cerrado_por: "Ana", cerrado_en: new Date(), creado_por: "Ana",
  ...armarDiferencias(filas), sinListado,
});
const textos = (n) => Array.isArray(n) ? n.flatMap(textos) : typeof n === "string" ? [n] : n && typeof n === "object" ? Object.values(n).flatMap(textos) : [];

test("Excel: las diferencias ordenadas, los códigos sin listado y el total valorado", () => {
  const rep = reporte([art("A", "Tornillo", 100, 98, 12.5), art("B", "Martillo", 8, 10, 350), art("C", "Pintura", 2.5, 2.5, 1200.75), art("D", "Cemento", 40, 0, 475.5)],
    [{ codigo: "999", cantidad: q(2), lecturas: 2 }]);
  const t = tablaInventario(rep, "Salón Rosa SRL · RNC 101234567", "Generado por Ana", false);
  assert.equal(t.columnas.length, 9);
  assert.deepEqual(t.filas.map((f) => [f[0], f[5], f[6], f[8]]), [
    ["D", -40, "Sin contar", "-19020.00"], ["B", 2, "Sobrante", "700.00"], ["A", -2, "Faltante", "-25.00"], ["999", 2, "Sobrante sin listado", null],
  ]);
  assert.equal(t.totales.length, t.columnas.length);
  assert.equal(t.totales[8], "-18345.00");
  assert.match(t.detalle, /Conteo de fin de año · Bodega 1 · conteo del 31\/12\/2026/);
  assert.equal(tablaInventario(rep, "x", "y", true).filas.length, 5, "con todos los artículos entra «Pintura», que no tiene diferencia");

  const sinPesos = tablaInventario(reporte([art("A", "Uno", 5, 4)]), "x", "y");
  assert.equal(sinPesos.columnas.length, 7);
  assert.equal(sinPesos.totales, undefined);
  assert.match(sinPesos.detalle, /no trae costo/);
});

test("PDF: resumen, diferencias, sin listado, notas y línea de firmas; con o sin logo", () => {
  const rep = reporte([art("A", "Tornillo 😀", 100, 98, 12.5), art("C", "Pintura", 2.5, 2.5, 1200.75), art("D", "Cemento", 40, 0, 475.5)], [{ codigo: "999", cantidad: q(2), lecturas: 2 }]);
  const { nombre, doc } = docInventario(rep, { empresa: "Salón Rosa SRL", rnc: "101234567", firma: "Empire Tax & Legal", preparadoPor: "Ana", logo: "data:image/png;base64,AAAA" });
  const t = textos(doc.content).join("\n");
  assert.equal(nombre, "diferencias-inventario-101234567-n4.pdf");
  for (const x of ["Diferencias de inventario", "Salón Rosa SRL", "RNC 101234567", "Conteo de fin de año", "Conteo n.º 4 del 31/12/2026", "3 artículos en el listado: 1 sin diferencia, 2 con faltante",
    "Artículos con diferencia", "Tornillo ?", "-2", "-40", "sin contar", "Diferencia neta valorada", "Códigos contados que no están en el listado", "999", "Se contó con lector", "Contado por", "Recibido por el cliente",
    "1 artículo no se contó", "En pesos: faltante RD$19,045.00"]) {
    assert.ok(t.includes(x), `falta «${x}»`);
  }
  assert.ok(!t.includes("Pintura"), "sin diferencia no sale (a menos que se pidan todos)");
  assert.ok(doc.content.some((c) => c.columns?.[0]?.image), "lleva el logo");
  assert.ok(textos(docInventario(rep, { empresa: "x", rnc: null, firma: "f", preparadoPor: "a", logo: null }, true).doc.content).join("\n").includes("Pintura"), "con todos, sí");
  assert.ok(!docInventario(rep, { empresa: "x", rnc: null, firma: "f", preparadoPor: "a", logo: null }).doc.content.some((c) => c.columns?.[0]?.image));
  const limpio = docInventario(reporte([art("A", "Uno", 5, 5, 10)]), { empresa: "x", rnc: null, firma: "f", preparadoPor: "a", logo: null });
  assert.ok(textos(limpio.doc.content).join("\n").includes("No hay diferencias"));
  assert.match(lineasResumen(reporte([art("A", "Uno", 5, 4)]).resumen).join(" "), /no trae costo/);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let firma, empresa, ana;

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-invrep-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma invrep ${marca}`}) RETURNING id`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (firma_id, nombre) VALUES (${firma}, 'Cliente Reporte SRL') RETURNING id`;
});
after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally { await sql.end(); }
});
const enEmpresa = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  return fn(tx);
});

test("el reporte de un conteo: no sale abierto; cerrado, sale con lo contado y lo que no estaba", conBase, async () => {
  const articulos = [
    { orden: 0, codigo: "00123", barras: "7501234567890", nombre: "Tornillo", unidad: "caja", existencia: q(100), costo: q(12.5) },
    { orden: 1, codigo: "456", barras: "", nombre: "Martillo", unidad: "und", existencia: q(8), costo: q(350) },
    { orden: 2, codigo: "XYZ", barras: "", nombre: "Pintura", unidad: "galón", existencia: q(2.5), costo: null },
  ];
  const id = await enEmpresa((tx) => crearConteo(tx, { nombre: "Conteo prueba", ubicacion: "", fecha: "2026-12-31", notas: "", empresaId: empresa, usuarioId: ana, archivoNombre: "x.csv", articulos }));
  const L = { conteoId: id, empresaId: empresa, usuarioId: ana };
  assert.match((await enEmpresa((tx) => reporteConteo(tx, id))).error, /cuando el conteo está cerrado/);
  await enEmpresa((tx) => registrarLectura(tx, { ...L, codigo: "123", cantidad: 98n * E4, origen: "manual" }));
  await enEmpresa((tx) => registrarLectura(tx, { ...L, codigo: "7501234567890", cantidad: E4, origen: "lector" }));
  await enEmpresa((tx) => registrarLectura(tx, { ...L, codigo: "456", cantidad: 10n * E4, origen: "manual" }));
  await enEmpresa((tx) => registrarLectura(tx, { ...L, codigo: "xyz", cantidad: 1n * E4, origen: "lector" }));
  await enEmpresa((tx) => registrarLectura(tx, { ...L, codigo: "999", cantidad: 2n * E4, origen: "manual" }));
  const [{ id: art }] = await sql`SELECT id FROM conteo_articulos WHERE conteo_id = ${id} AND codigo = 'XYZ'`;
  await enEmpresa((tx) => fijarTotal(tx, { ...L, articuloId: art, total: 2n * E4, nota: "" }));
  await enEmpresa((tx) => cambiarEstadoConteo(tx, id, "cerrado", ana));

  const rep = await enEmpresa((tx) => reporteConteo(tx, id));
  assert.equal(rep.cerrado_por, "Ana");
  assert.deepEqual(rep.filas.map((f) => [f.codigo, f.existencia, f.contado, f.diferencia, f.valor]), [
    ["00123", q(100), q(99), q(-1), -1250n], ["456", q(8), q(10), q(2), 70000n], ["XYZ", q(2.5), q(2), q(-0.5), null],
  ]);
  assert.deepEqual(rep.sinListado.map((s) => [s.codigo, s.cantidad]), [["999", q(2)]]);
  assert.deepEqual([rep.resumen.faltantes, rep.resumen.sobrantes, rep.resumen.sinCosto, rep.resumen.valorNeto], [2, 1, 1, 68750n]);
  assert.equal(await enEmpresa((tx) => reporteConteo(tx, "00000000-0000-0000-0000-000000000000")), null);
});

test("reportes guardados: carpeta 05 del expediente, uno por número de conteo y sin los retirados", conBase, async () => {
  assert.equal(CARPETA_REPORTE, "05");
  assert.equal(descripcionReporte(4, "Fin de año"), "Diferencias de inventario n.º 4 · Fin de año");
  assert.equal(descripcionReporte(4, "x".repeat(300)).length, 150);
  const guardar = (n) => enEmpresa((tx) => guardarArchivos(tx, { empresaId: empresa, usuarioId: ana, archivos: [{ nombre: `diferencias-inventario-n${n}.pdf`, bytes: new TextEncoder().encode(`%PDF-1.3 ${n} ${Math.random()}`) }],
    carpeta: CARPETA_REPORTE, anio: 2026, descripcion: descripcionReporte(n, "Conteo") }));
  const [a] = await guardar(4), [b] = await guardar(4); // una copia nueva no se confunde con la anterior
  await guardar(40);
  const lista = await enEmpresa((tx) => reportesGuardados(tx, empresa, 4));
  assert.deepEqual(lista.map((r) => r.id).sort(), [a, b].sort(), "solo el n.º 4, no el 40");
  assert.equal(lista[0].quien, "Ana");
  assert.equal((await enEmpresa((tx) => reportesGuardados(tx, empresa, 40))).length, 1);
  await sql`UPDATE documentos SET eliminado = true WHERE id = ${a}`;
  assert.deepEqual((await enEmpresa((tx) => reportesGuardados(tx, empresa, 4))).map((r) => r.id), [b], "el retirado ya no sale");
});
