// Bloque 5, entrega 5a: expediente digital (archivos por carpeta y lo que el sistema genera), trámites con plazo, alertas y la
// lista de pasos de una empresa nueva. Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { alertasDeEmpresa } from "../lib/alertas.ts";
import { db } from "../lib/db.ts";
import { EXCEL, guardarArchivos, listarExpediente, retirarDelExpediente, tipoDeArchivo, WORD } from "../lib/expediente.ts";
import { abrirConstitucion, cerrarTramite, leerTramite, listarPasos, listarTramites } from "../lib/tramites.ts";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

test("tipo de archivo por contenido: PDF, y Word o Excel solo si es un ZIP con esa extensión", () => {
  assert.equal(tipoDeArchivo(PDF, "x.pdf"), "application/pdf");
  assert.equal(tipoDeArchivo(ZIP, "contrato.docx"), WORD);
  assert.equal(tipoDeArchivo(ZIP, "anexo.XLSX"), EXCEL);
  assert.equal(tipoDeArchivo(ZIP, "algo.zip"), null);
  assert.equal(tipoDeArchivo(new Uint8Array([1, 2, 3, 4]), "falso.docx"), null);
});

test("trámite: sin plazo quedan 30 días; el plazo no puede ser antes de la fecha", () => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ institucion: "dgii", tipo: "Declaración rectificativa", fecha: "2026-11-05" })) fd.set(k, v);
  assert.equal(leerTramite(fd).plazo, "2026-12-05");
  fd.set("plazo", "2026-11-01");
  assert.throws(() => leerTramite(fd), /antes de la fecha/);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa;

const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-exp-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma expediente ${marca}`}) RETURNING id`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (nombre, firma_id) VALUES ('Constructora Expediente SRL', ${firma}) RETURNING id`;
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

test("expediente: lo subido va a su carpeta, lo del sistema aparece solo y se puede retirar y devolver", conBase, async () => {
  const [id] = await leer((tx) => guardarArchivos(tx, { empresaId: empresa, usuarioId: ana, archivos: [{ nombre: "registro.pdf", bytes: PDF }],
    carpeta: "01", anio: 2026, descripcion: "Registro mercantil 2026" }));
  await assert.rejects(leer((tx) => guardarArchivos(tx, { empresaId: empresa, usuarioId: ana, archivos: [{ nombre: "virus.exe", bytes: new Uint8Array([77, 90, 0, 0]) }],
    carpeta: "01", anio: null, descripcion: null })), /no es PDF/);
  await leer((tx) => tx`INSERT INTO envios_dgii (empresa_id, formato, periodo, en_cero, huella, registros, enviado_por) VALUES (${empresa}, '606', '202610', true, 'h', 0, ${ana})`);
  const lista = await leer((tx) => listarExpediente(tx, empresa));
  assert.deepEqual(lista.map((e) => [e.carpeta, e.titulo, e.origen]).sort(), [
    ["01", "Registro mercantil 2026", "subido"], ["04", "606 de octubre 2026", "sistema"],
  ]);
  await leer((tx) => retirarDelExpediente(tx, id, ana));
  assert.equal((await leer((tx) => listarExpediente(tx, empresa))).filter((e) => e.origen === "subido").length, 0);
  assert.equal((await leer((tx) => listarExpediente(tx, empresa, true))).length, 1, "aparece en los retirados");
  await leer((tx) => retirarDelExpediente(tx, id, ana, true));
  assert.equal((await leer((tx) => listarExpediente(tx, empresa))).filter((e) => e.origen === "subido").length, 1, "se devuelve");
});

test("trámite: queda en la bitácora, avisa 5 días antes y al vencer, y al cerrarlo se va la alerta", conBase, async () => {
  const [{ id }] = await leer((tx) => tx`INSERT INTO tramites (empresa_id, institucion, tipo, numero, fecha, plazo, creado_por)
    VALUES (${empresa}, 'dgii', 'Acuerdo de pago', 'V-123', '2026-10-20', '2026-11-19', ${ana}) RETURNING id`);
  const alertas = (hoy) => leer((tx) => alertasDeEmpresa(tx, { empresaId: empresa, hoy, propia: false })).then((a) => a.filter((x) => x.tipo === "tramite"));
  assert.equal((await alertas("2026-11-10")).length, 0, "faltan 9 días");
  assert.match((await alertas("2026-11-15"))[0].texto, /Trámite ante DGII \(Acuerdo de pago\) vence el plazo el 19\/11\/2026 \(faltan 4 días\)/);
  const vencido = (await alertas("2026-11-20"))[0];
  assert.equal(vencido.nivel, "urgente");
  assert.match(vencido.texto, /venció sin respuesta el 19\/11\/2026/);
  await leer((tx) => cerrarTramite(tx, id, "Acuerdo aprobado en 6 cuotas", ana));
  assert.equal((await alertas("2026-11-20")).length, 0);
  await assert.rejects(leer((tx) => cerrarTramite(tx, id, null, ana)), /ya está cerrado/);
  const g = await leer((tx) => tx`SELECT origen, descripcion FROM gestiones WHERE origen LIKE 'tramite%' ORDER BY origen`);
  assert.deepEqual(g.map((x) => x.descripcion), [
    "Trámite ante DGII: Acuerdo de pago (n.º V-123), respuesta a más tardar el 19/11/2026",
    "Trámite ante DGII cerrado: Acuerdo de pago · Acuerdo aprobado en 6 cuotas",
  ]);
  assert.equal((await leer((tx) => listarTramites(tx, true))).length, 0);
});

test("empresa nueva: abre los 9 pasos una sola vez", conBase, async () => {
  await leer((tx) => abrirConstitucion(tx, empresa));
  await leer((tx) => abrirConstitucion(tx, empresa));
  const pasos = await leer((tx) => listarPasos(tx));
  assert.equal(pasos.length, 9);
  assert.ok(pasos.every((p) => p.estado === "pendiente"));
  const [{ en }] = await sql`SELECT en_constitucion AS en FROM empresas WHERE id = ${empresa}`;
  assert.equal(en, true);
});
