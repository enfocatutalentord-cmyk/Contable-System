// Prioridad 3 · P3i: cartas de trabajo. Monto en letras, datos del empleado para los espacios, las tres cartas de ejemplo (que son Word válidos con sus espacios) y,
// con la base, agregarlas a una firma y generar la constancia con los datos de un empleado.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { strFromU8, unzipSync } from "fflate";
import postgres from "postgres";
import { agregarCartasDeEjemplo, CARTAS, docxDeParrafos, enLetrasEntero, esCartaDeTrabajo, montoEnLetras, valoresDeEmpleado } from "../lib/cartas-trabajo.ts";
import { CLAVES_ESPACIOS, ESPACIOS, leerEspacios, llenarDocx } from "../lib/plantillas-word.ts";

const sinEtiquetas = (xml) => xml.replace(/<w:br\/>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const texto = (bytes) => sinEtiquetas(strFromU8(unzipSync(bytes)["word/document.xml"]));

test("los montos se escriben en letras, con «un», «veintiún» y «de pesos» donde toca", () => {
  const c = (n) => montoEnLetras(BigInt(Math.round(n * 100)));
  assert.equal(c(0), "cero pesos dominicanos con 00/100");
  assert.equal(c(1), "un peso dominicano con 00/100");
  assert.equal(c(21), "veintiún pesos dominicanos con 00/100");
  assert.equal(c(31), "treinta y un pesos dominicanos con 00/100");
  assert.equal(c(100), "cien pesos dominicanos con 00/100");
  assert.equal(c(101), "ciento un pesos dominicanos con 00/100");
  assert.equal(c(1000), "mil pesos dominicanos con 00/100");
  assert.equal(c(21000), "veintiún mil pesos dominicanos con 00/100");
  assert.equal(c(50000), "cincuenta mil pesos dominicanos con 00/100");
  assert.equal(c(35500.5), "treinta y cinco mil quinientos pesos dominicanos con 50/100");
  assert.equal(c(123456.07), "ciento veintitrés mil cuatrocientos cincuenta y seis pesos dominicanos con 07/100");
  assert.equal(c(1000000), "un millón de pesos dominicanos con 00/100");
  assert.equal(c(2500000), "dos millones quinientos mil pesos dominicanos con 00/100");
  assert.equal(c(21000000), "veintiún millones de pesos dominicanos con 00/100");
  assert.equal(c(1000001), "un millón un pesos dominicanos con 00/100");
  assert.equal(c(0.05), "cero pesos dominicanos con 05/100");
  assert.equal(enLetrasEntero(999999999999), "novecientos noventa y nueve mil novecientos noventa y nueve millones novecientos noventa y nueve mil novecientos noventa y nueve");
  assert.throws(() => enLetrasEntero(1e12), /rango/);
  assert.throws(() => montoEnLetras(-1n), /negativo/);
});

test("los datos del empleado para los espacios; lo que la ficha no tiene va vacío", () => {
  const v = valoresDeEmpleado({ nombre: "María Gómez", cedula: "40212345678", cargo: "Contadora", fecha_ingreso: "2020-03-01", sueldo: "50000.00" }, "2026-03-31");
  assert.deepEqual(v, {
    empleado: "María Gómez", empleado_cedula: "402-1234567-8", empleado_cargo: "Contadora", empleado_fecha_ingreso: "1 de marzo de 2020", empleado_fecha_ingreso_corta: "01/03/2020",
    empleado_antiguedad: "6 años, 1 mes", empleado_sueldo: "RD$50,000.00", empleado_sueldo_letras: "cincuenta mil pesos dominicanos con 00/100",
  });
  const vacio = valoresDeEmpleado({ nombre: "Luis", cedula: null, cargo: null, fecha_ingreso: null, sueldo: null }, "2026-03-31");
  assert.deepEqual(Object.entries(vacio).filter(([, x]) => x !== ""), [["empleado", "Luis"]]);
  assert.equal(valoresDeEmpleado({ nombre: "X", cedula: null, cargo: null, fecha_ingreso: "2027-01-01", sueldo: null }, "2026-03-31").empleado_antiguedad, "", "un ingreso futuro no tiene antigüedad");
  for (const clave of Object.keys(v)) assert.ok(CLAVES_ESPACIOS.has(clave), `${clave} es un espacio conocido`);
  assert.ok(ESPACIOS.filter((e) => e.grupo === "Empleado").length === Object.keys(v).length);
});

test("las cartas de ejemplo son Word válidos con sus espacios", () => {
  assert.deepEqual(CARTAS.map((c) => [c.nombre, c.codigo]), [["Constancia de trabajo", "CT"], ["Comunicación de desahucio", "DE"], ["Aviso de vacaciones", "VA"]]);
  const espacios = Object.fromEntries(CARTAS.map((c) => [c.nombre, leerEspacios(docxDeParrafos(c.parrafos))]));
  for (const [nombre, campos] of Object.entries(espacios)) {
    assert.ok(campos.includes("referencia"), `${nombre} lleva el número de referencia`);
    assert.ok(esCartaDeTrabajo(campos), `${nombre} usa espacios del empleado`);
  }
  assert.deepEqual(espacios["Constancia de trabajo"].filter((c) => !CLAVES_ESPACIOS.has(c)), [], "la constancia se llena sola, sin escribir nada a mano");
  assert.deepEqual(espacios["Comunicación de desahucio"].filter((c) => !CLAVES_ESPACIOS.has(c)), ["fecha_terminacion", "dias_preaviso"]);
  assert.deepEqual(espacios["Aviso de vacaciones"].filter((c) => !CLAVES_ESPACIOS.has(c)), ["dias_vacaciones", "vacaciones_desde", "vacaciones_hasta", "vacaciones_regreso"]);
  assert.equal(esCartaDeTrabajo(["gerente", "rnc"]), false);
});

test("las cartas citan los artículos del Código de Trabajo que las respaldan", () => {
  const todo = (nombre) => CARTAS.find((c) => c.nombre === nombre).parrafos.map((p) => p.texto).join("\n");
  const d = todo("Comunicación de desahucio");
  for (const art of ["artículos 75", "artículo 76", "artículo 77", "artículo 79", "artículo 80", "artículo 86", "diez (10) días", "cuarenta y ocho (48) horas"]) assert.ok(d.includes(art), art);
  const v = todo("Aviso de vacaciones");
  for (const art of ["artículos 177", "artículo 181", "artículo 182"]) assert.ok(v.includes(art), art);
});

test("la constancia se llena completa con los datos del cliente y del empleado", () => {
  const bytes = docxDeParrafos(CARTAS[0].parrafos);
  const valores = {
    nombre_empresa: "Ferretería Plantilla SRL", rnc: "1-30-00008-1", referencia: "ETL-CT-2026-0001", fecha: "31 de marzo de 2026", dia: "31", mes: "marzo", anio: "2026", gerente: "María Gómez",
    ...valoresDeEmpleado({ nombre: "Luis Pérez", cedula: "40212345678", cargo: "Cajero", fecha_ingreso: "2024-01-15", sueldo: "35000.50" }, "2026-03-31"),
  };
  const r = llenarDocx(bytes, valores);
  assert.deepEqual(r.sinValor, []);
  const t = texto(r.bytes);
  assert.match(t, /Ref\.: ETL-CT-2026-0001/);
  assert.match(t, /hace constar que Luis Pérez, portador\(a\) de la cédula de identidad y electoral número 402-1234567-8, presta sus servicios en esta empresa desde el 15 de enero de 2024 \(2 años, 2 meses, 17 días de servicio\), desempeñando el cargo de Cajero, con un salario mensual de RD\$35,000\.50 \(treinta y cinco mil pesos dominicanos con 50\/100\)\./);
  assert.match(t, /a los 31 días del mes de marzo de 2026\./);
  assert.ok(!t.includes("{{"), "no queda ningún espacio sin llenar");
});

test("un .docx hecho aquí tiene todo lo que Word pide para abrirlo", () => {
  const partes = unzipSync(docxDeParrafos([{ texto: "Hola & <adiós>", negrita: true }]));
  assert.deepEqual(Object.keys(partes).sort(), ["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml"]);
  assert.match(strFromU8(partes["[Content_Types].xml"]), /wordprocessingml\.document\.main\+xml/);
  assert.match(strFromU8(partes["word/document.xml"]), /Hola &amp; &lt;adiós&gt;/);
});

// ───── Con la base ─────

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa, bd;
const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  process.env.DATABASE_URL = url;
  bd = await import("../lib/plantillas-documento.ts");
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-cartas-${marca}@x.do`}, 'Ana Preparadora', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre, rnc) VALUES (${`Firma cartas ${marca}`}, '133097346') RETURNING id`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Ferretería Cartas SRL', '130000091', ${firma}) RETURNING id`;
  await sql`INSERT INTO contactos_empresa (empresa_id, rol, nombre) VALUES (${empresa}, 'gerente', 'María Gómez')`;
  await sql`INSERT INTO empleados_empresa (empresa_id, orden, nombre, cedula, cargo, fecha_ingreso, sueldo) VALUES (${empresa}, 1, 'Luis Pérez', '40212345678', 'Cajero', '2024-01-15', 35000.50)`;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM documentos WHERE empresa_id = ${empresa}`.catch(() => {});
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
    const { db } = await import("../lib/db.ts");
    await db().end();
  }
});

test("agregar las cartas de ejemplo: tres plantillas, y repetirlo no duplica", conBase, async () => {
  const primera = await agregarCartasDeEjemplo(firma, ana);
  assert.deepEqual(primera, ["Constancia de trabajo", "Comunicación de desahucio", "Aviso de vacaciones"]);
  assert.deepEqual(await agregarCartasDeEjemplo(firma, ana), []);
  const lista = await bd.plantillasDeFirma(firma);
  assert.equal(lista.length, 3);
  assert.ok(lista.every((p) => p.carpeta === "06" && esCartaDeTrabajo(p.campos)));
  // Si una se quita, vuelve a agregarse solo esa.
  await bd.quitarPlantilla(firma, lista.find((p) => p.codigo === "VA").id);
  assert.deepEqual(await agregarCartasDeEjemplo(firma, ana), ["Aviso de vacaciones"]);
});

test("la constancia de un empleado de la ficha sale en el expediente con su número y todo lleno", conBase, async () => {
  const lista = await bd.plantillasDeFirma(firma);
  const plantilla = await bd.plantillaDe(firma, lista.find((p) => p.codigo === "CT").id);
  const hoy = "2026-03-31";
  const { cliente, emp } = await leer(async (tx) => ({
    cliente: await bd.valoresDeCliente(tx, empresa, { firmaNombre: "Empire Tax & Legal", firmaRnc: "133097346", usuarioNombre: "Ana Preparadora", hoy }),
    emp: (await tx`SELECT nombre, cedula, cargo, to_char(fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso, sueldo::text AS sueldo FROM empleados_empresa`)[0],
  }));
  const valores = { ...cliente, ...valoresDeEmpleado(emp, hoy) };
  const g = await leer((tx) => bd.generarDocumento(tx, { empresaId: empresa, usuarioId: ana, hoy, nombreCliente: "Ferretería Cartas SRL", plantilla, valores }));
  assert.equal(g.referencia, "ETL-CT-2026-0001");
  assert.deepEqual(g.sinLlenar, []);
  const [d] = await leer((tx) => tx`SELECT contenido, carpeta FROM documentos WHERE id = ${g.documentoId}`);
  assert.equal(d.carpeta, "06");
  const t = texto(new Uint8Array(d.contenido));
  assert.match(t, /Luis Pérez, portador\(a\) de la cédula de identidad y electoral número 402-1234567-8/);
  assert.match(t, /RD\$35,000\.50 \(treinta y cinco mil pesos dominicanos con 50\/100\)/);
  assert.match(t, /María Gómez\s*Gerente, Ferretería Cartas SRL/);
  assert.ok(!t.includes("{{"));
});
