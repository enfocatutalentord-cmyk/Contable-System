// Prioridad 3 · P3d: plantillas de Word. El motor que lee y llena los espacios {{así}} (incluidos los partidos en varios pedazos por Word), la lectura del
// formulario, y con la base: valores del cliente, número de referencia ETL-XX-AAAA-NNNN y el documento guardado en el expediente.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import postgres from "postgres";
import { ErrorPlantilla, fechaConAnio, leerEspacios, llenarDocx, normalizar } from "../lib/plantillas-word.ts";
import { leerPlantilla, verRnc } from "../lib/plantillas-documento.ts";

const TIPOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const parrafo = (...runs) => `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${runs.map((t) => `<w:r><w:rPr><w:b/></w:rPr><w:t>${t}</w:t></w:r>`).join("")}</w:p>`;
const docx = (cuerpo, extra = {}) => zipSync({
  "[Content_Types].xml": strToU8(TIPOS),
  "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${cuerpo}</w:body></w:document>`),
  "word/styles.xml": strToU8(`<w:styles ${W}/>`),
  ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)])),
});
const texto = (bytes, parte = "word/document.xml") => strFromU8(unzipSync(bytes)[parte]);
const sinEtiquetas = (xml) => xml.replace(/<w:br\/>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

test("los nombres de los espacios se normalizan sin tildes, en minúsculas y con guion bajo", () => {
  assert.equal(normalizar(" Nombre Empresa "), "nombre_empresa");
  assert.equal(normalizar("Año"), "ano");
  assert.equal(normalizar("fecha-corta"), "fecha_corta");
  assert.equal(normalizar("RNC"), "rnc");
  assert.equal(fechaConAnio("2026-11-21"), "21 de noviembre de 2026");
  assert.equal(fechaConAnio("2026-01-05"), "5 de enero de 2026");
  assert.equal(verRnc("130000051"), "1-30-00005-1");
  assert.equal(verRnc("40212345678"), "402-1234567-8");
  assert.equal(verRnc(null), "");
});

test("lee los espacios aunque Word los parta en varios pedazos, y también los de encabezados y tablas", () => {
  const archivo = docx(
    parrafo("Yo, {{ger", "ente}} de {{Nombre Empre", "sa}}.") + parrafo("Año {{ Año }} y {{monto}} y otra vez {{gerente}}") +
      `<w:tbl><w:tr><w:tc>${parrafo("RNC: {{rnc}}")}</w:tc></w:tr></w:tbl>`,
    { "word/header1.xml": `<w:hdr ${W}>${parrafo("Ref. {{referencia}}")}</w:hdr>` },
  );
  assert.deepEqual(leerEspacios(archivo), ["gerente", "nombre_empresa", "ano", "monto", "rnc", "referencia"]);
});

test("llena los espacios partidos, conserva todo lo demás y deja con sus llaves los que no tienen valor", () => {
  const archivo = docx(
    parrafo("Yo, {{ger", "ente}} de {{Nombre Empre", "sa}}, RNC {{rnc}}.") + parrafo("Monto: {{monto}} · Año {{ Año }}") +
      `<w:tbl><w:tr><w:tc>${parrafo("Socios:{{socios}}")}</w:tc></w:tr></w:tbl>`,
    { "word/header1.xml": `<w:hdr ${W}>${parrafo("Ref. {{referencia}}")}</w:hdr>` },
  );
  const r = llenarDocx(archivo, {
    gerente: "Luis Pérez", nombre_empresa: "Tom & Jerry <SRL>", rnc: "1-30-00005-1", ano: "2026", monto: "", referencia: "ETL-CA-2026-0001",
    socios: "1. Ana, 60 %\n2. Beto, 40 %",
  });
  const cuerpo = texto(r.bytes);
  assert.equal(sinEtiquetas(cuerpo), "Yo, Luis Pérez de Tom & Jerry <SRL>, RNC 1-30-00005-1.Monto: {{monto}} · Año 2026Socios:1. Ana, 60 %\n2. Beto, 40 %");
  assert.ok(cuerpo.includes("Tom &amp; Jerry &lt;SRL&gt;"), "lo que se escribe se escapa");
  assert.equal(sinEtiquetas(texto(r.bytes, "word/header1.xml")), "Ref. ETL-CA-2026-0001", "también el encabezado");
  assert.deepEqual(r.llenados.sort(), ["ano", "gerente", "nombre_empresa", "referencia", "rnc", "socios"]);
  assert.deepEqual(r.sinValor, ["monto"]);
  assert.ok(cuerpo.includes('<w:jc w:val="both"/>') && cuerpo.includes("<w:b/>"), "el formato de los párrafos no se pierde");
  assert.ok(cuerpo.includes("<w:tbl>"), "las tablas siguen");
  assert.equal(strFromU8(unzipSync(r.bytes)["word/styles.xml"]), strFromU8(unzipSync(archivo)["word/styles.xml"]), "lo que no tiene espacios queda igual");
  // El documento resultante vuelve a ser un Word válido que se puede leer de nuevo.
  assert.deepEqual(leerEspacios(r.bytes), ["monto"]);
});

test("un valor que se repite se llena en todos los lugares y las mayúsculas o tildes no importan", () => {
  const r = llenarDocx(docx(parrafo("{{GERENTE}} firma. {{Gerente}} acepta. {{ gerente }}")), { gerente: "Luis" });
  assert.equal(sinEtiquetas(texto(r.bytes)), "Luis firma. Luis acepta. Luis");
});

test("rechaza lo que no es un Word, está dañado o es una bomba de compresión", () => {
  assert.throws(() => leerEspacios(new Uint8Array([1, 2, 3, 4, 5])), ErrorPlantilla);
  assert.throws(() => leerEspacios(zipSync({ "hola.txt": strToU8("hola") })), /no es un documento de Word/);
  assert.throws(() => leerEspacios(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9])), ErrorPlantilla);
  const grande = zipSync({ "[Content_Types].xml": strToU8(TIPOS), "word/document.xml": new Uint8Array(41 * 1024 * 1024) }, { level: 9 });
  assert.ok(grande.length < 4 * 1024 * 1024, "el archivo comprimido es chico");
  assert.throws(() => leerEspacios(grande), /demasiado grande/);
});

const form = (o) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) fd.append(k, v); return fd; };

test("el formulario de la plantilla: nombre, código de dos o tres letras, carpeta y archivo .docx", async () => {
  const bytes = docx(parrafo("{{gerente}}"));
  const archivo = new File([bytes], "Carta de ingresos.docx");
  const d = await leerPlantilla(form({ nombre: "  Carta de ingresos ", codigo: "ca", carpeta: "02", descripcion: "Para bancos", archivo }));
  assert.deepEqual([d.nombre, d.codigo, d.carpeta, d.descripcion, d.archivo.nombre, d.archivo.bytes.length], ["Carta de ingresos", "CA", "02", "Para bancos", "Carta de ingresos.docx", bytes.length]);
  assert.equal((await leerPlantilla(form({ nombre: "Carta", codigo: "CA" }))).archivo, null, "sin archivo se avisa después");
  assert.equal((await leerPlantilla(form({ nombre: "Carta", codigo: "CA", archivo }))).carpeta, "06", "la carpeta por defecto es 06");
  for (const [mal, texto] of [
    [{ nombre: "ab", codigo: "CA" }, /nombre/], [{ nombre: "Carta", codigo: "C" }, /código/], [{ nombre: "Carta", codigo: "CA1" }, /código/],
    [{ nombre: "Carta", codigo: "CA", carpeta: "09" }, /carpeta/], [{ nombre: "Carta", codigo: "CA", archivo: new File([bytes], "carta.doc") }, /\.docx/],
  ]) await assert.rejects(leerPlantilla(form(mal)), (e) => e instanceof ErrorPlantilla && texto.test(e.message), JSON.stringify(mal).slice(0, 60));
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa, otra, bd, pl;
const en = (id, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const leer = (fn) => en(empresa, fn);

before(async () => {
  if (!sql) return;
  process.env.DATABASE_URL = url;
  bd = await import("../lib/plantillas-documento.ts");
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-plantillas-${marca}@x.do`}, 'Ana Preparadora', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre, rnc) VALUES (${`Firma plantillas ${marca}`}, '133097346') RETURNING id`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (nombre, rnc, direccion, telefono, correo, actividad_economica, tipo_sociedad, municipio, provincia, capital_social, fecha_constitucion, firma_id)
    VALUES ('Ferretería Plantilla SRL', '130000081', 'Calle 1, Piantini', '8095550000', 'info@ferreteria.do', 'Venta de ferretería', 'SRL', 'Santo Domingo', 'Distrito Nacional', 100000, '2020-03-15', ${firma}) RETURNING id`;
  [{ id: otra }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Otra Plantilla SRL', '130000082', ${firma}) RETURNING id`;
  await sql`INSERT INTO socios_empresa (empresa_id, orden, nombre, cedula, porcentaje) VALUES (${empresa}, 1, 'Ana Soto', '40212345678', 60), (${empresa}, 2, 'Beto Díaz', NULL, 40)`;
  await sql`INSERT INTO contactos_empresa (empresa_id, rol, nombre, cedula, whatsapp, correo) VALUES
    (${empresa}, 'principal', 'Luis Pérez', NULL, '8095551234', 'luis@ferreteria.do'), (${empresa}, 'gerente', 'María Gómez', '00112345678', NULL, NULL)`;
  const bytes = docx(parrafo("CARTA {{referencia}}. Yo, {{gerente}}, gerente de {{nombre_empresa}} (RNC {{rnc}}), certifico lo siguiente el {{fecha}}.") + parrafo("Socios:{{socios}}") + parrafo("Monto: {{monto}}"));
  pl = await bd.guardarPlantilla(firma, ana, { nombre: "Carta de ingresos", codigo: "CA", carpeta: "02", descripcion: null, archivo: { nombre: "Carta de ingresos.docx", bytes } });
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM documentos WHERE empresa_id IN (${empresa}, ${otra})`.catch(() => {});
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
    const { db } = await import("../lib/db.ts");
    await db().end();
  }
});

test("la plantilla guardada recuerda sus espacios y la firma solo ve las suyas", conBase, async () => {
  assert.deepEqual(pl.campos, ["referencia", "gerente", "nombre_empresa", "rnc", "fecha", "socios", "monto"]);
  const lista = await bd.plantillasDeFirma(firma);
  assert.deepEqual(lista.map((p) => [p.nombre, p.codigo, p.carpeta, p.campos.length]), [["Carta de ingresos", "CA", "02", 7]]);
  assert.equal((await bd.plantillasDeFirma("00000000-0000-0000-0000-000000000000")).length, 0);
  assert.equal(await bd.plantillaDe("00000000-0000-0000-0000-000000000000", pl.id), null, "otra firma no la abre");
  await assert.rejects(bd.guardarPlantilla(firma, ana, { nombre: "Sin espacios", codigo: "XX", carpeta: "06", descripcion: null, archivo: { nombre: "x.docx", bytes: docx(parrafo("Texto sin espacios")) } }), /ningún espacio/);
});

test("los datos del cliente salen de su ficha", conBase, async () => {
  const v = await leer((tx) => bd.valoresDeCliente(tx, empresa, { firmaNombre: "Empire Tax & Legal", firmaRnc: "133097346", usuarioNombre: "Ana Preparadora", hoy: "2026-11-21" }));
  assert.equal(v.nombre_empresa, "Ferretería Plantilla SRL");
  assert.equal(v.rnc, "1-30-00008-1");
  assert.equal(v.rnc_sin_guiones, "130000081");
  assert.deepEqual([v.direccion, v.actividad, v.tipo_sociedad, v.municipio, v.provincia], ["Calle 1, Piantini", "Venta de ferretería", "SRL", "Santo Domingo", "Distrito Nacional"]);
  assert.equal(v.capital_social, "RD$100,000.00");
  assert.equal(v.fecha_constitucion, "15 de marzo de 2020");
  assert.deepEqual([v.gerente, v.gerente_cedula, v.contacto, v.contacto_telefono, v.contacto_correo], ["María Gómez", "00112345678", "Luis Pérez", "8095551234", "luis@ferreteria.do"]);
  assert.equal(v.socios, "1. Ana Soto, cédula 40212345678, 60 %\n2. Beto Díaz, 40 %");
  assert.deepEqual([v.socios_nombres, v.numero_socios], ["Ana Soto, Beto Díaz", "2"]);
  assert.deepEqual([v.fecha, v.fecha_corta, v.dia, v.mes, v.anio], ["21 de noviembre de 2026", "21/11/2026", "21", "noviembre", "2026"]);
  assert.deepEqual([v.firma_nombre, v.firma_rnc, v.preparado_por, v.representante], ["Empire Tax & Legal", "1-33-09734-6", "Ana Preparadora", ""]);
  const vacio = await en(otra, (tx) => bd.valoresDeCliente(tx, otra, { firmaNombre: "F", firmaRnc: null, usuarioNombre: "U", hoy: "2026-11-21" }));
  assert.equal(vacio.gerente, "", "lo que no se sabe va vacío");
  assert.equal(vacio.socios, "");
});

test("generar un documento toma el número siguiente, lo guarda en el expediente y deja su registro", conBase, async () => {
  const plantilla = await bd.plantillaDe(firma, pl.id);
  const generar = (hoy, valores) => leer(async (tx) => bd.generarDocumento(tx, { empresaId: empresa, usuarioId: ana, hoy, nombreCliente: "Ferretería Plantilla SRL", plantilla, valores }));
  const saber = await leer((tx) => bd.valoresDeCliente(tx, empresa, { firmaNombre: "F", firmaRnc: null, usuarioNombre: "Ana", hoy: "2026-11-21" }));
  const a = await generar("2026-11-21", { ...saber, monto: "RD$50,000.00" });
  assert.equal(a.referencia, "ETL-CA-2026-0001");
  assert.deepEqual(a.sinLlenar, []);
  const b = await generar("2026-11-22", { ...saber, monto: "" });
  assert.equal(b.referencia, "ETL-CA-2026-0002", "el número sigue");
  assert.deepEqual(b.sinLlenar, ["monto"], "lo que quedó sin dato se avisa");
  const otroAnio = await generar("2027-01-05", { ...saber, monto: "1" });
  assert.equal(otroAnio.referencia, "ETL-CA-2027-0001", "cada año empieza en 1");
  const [d] = await leer((tx) => tx`SELECT nombre, tipo, carpeta, anio, descripcion, contenido, entidad FROM documentos WHERE id = ${a.documentoId}`);
  assert.deepEqual([d.tipo, d.carpeta, d.anio, d.entidad, d.descripcion], ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "02", 2026, "expediente", "ETL-CA-2026-0001 · Carta de ingresos"]);
  assert.match(d.nombre, /^ETL-CA-2026-0001 Carta de ingresos - Ferretería Plantilla SRL\.docx$/);
  const texto1 = sinEtiquetas(texto(new Uint8Array(d.contenido)));
  assert.match(texto1, /^CARTA ETL-CA-2026-0001\. Yo, María Gómez, gerente de Ferretería Plantilla SRL \(RNC 1-30-00008-1\), certifico lo siguiente el 21 de noviembre de 2026\./);
  assert.match(texto1, /Socios:1\. Ana Soto, cédula 40212345678, 60 %\n2\. Beto Díaz, 40 %Monto: RD\$50,000\.00$/);
  const gen = await leer((tx) => bd.generadosDe(tx));
  assert.equal(gen.length, 3);
  assert.deepEqual(gen.map((g) => g.referencia).sort(), ["ETL-CA-2026-0001", "ETL-CA-2026-0002", "ETL-CA-2027-0001"]);
  assert.equal((await en(otra, (tx) => bd.generadosDe(tx))).length, 0, "otra empresa no ve lo generado");
  assert.equal((await en(otra, (tx) => tx`SELECT 1 FROM documentos WHERE id = ${a.documentoId}`)).length, 0);
});

test("si algo falla al generar, el número no se gasta", conBase, async () => {
  const plantilla = await bd.plantillaDe(firma, pl.id);
  await assert.rejects(leer(async (tx) => {
    await bd.generarDocumento(tx, { empresaId: empresa, usuarioId: ana, hoy: "2026-11-23", nombreCliente: "X", plantilla, valores: { gerente: "Luis" } });
    throw new Error("falló después");
  }), /falló después/);
  const c = await leer((tx) => bd.generarDocumento(tx, { empresaId: empresa, usuarioId: ana, hoy: "2026-11-23", nombreCliente: "X", plantilla, valores: { gerente: "Luis" } }));
  assert.equal(c.referencia, "ETL-CA-2026-0003", "el número que se iba a gastar sigue libre");
});

test("los números son por firma y por código", conBase, async () => {
  const p2 = await bd.guardarPlantilla(firma, ana, { nombre: "Acta", codigo: "AC", carpeta: "01", descripcion: null, archivo: { nombre: "Acta.docx", bytes: docx(parrafo("{{nombre_empresa}}")) } });
  const plantilla = await bd.plantillaDe(firma, p2.id);
  const a = await leer((tx) => bd.generarDocumento(tx, { empresaId: empresa, usuarioId: ana, hoy: "2026-11-21", nombreCliente: "X", plantilla, valores: { nombre_empresa: "X" } }));
  assert.equal(a.referencia, "ETL-AC-2026-0001");
  const b = await en(otra, (tx) => bd.generarDocumento(tx, { empresaId: otra, usuarioId: ana, hoy: "2026-11-21", nombreCliente: "Y", plantilla, valores: { nombre_empresa: "Y" } }));
  assert.equal(b.referencia, "ETL-AC-2026-0002", "dos clientes de la misma firma comparten la numeración");
  await bd.quitarPlantilla(firma, p2.id);
  assert.equal((await bd.plantillasDeFirma(firma)).some((p) => p.id === p2.id), false, "quitar la esconde");
});
