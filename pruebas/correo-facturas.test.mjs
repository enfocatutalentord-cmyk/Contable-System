// Entrega A (6-nov-2026): facturas por correo. Direcciones, párrafos, errores de Gmail, encabezado sin la marca de Empire
// y el registro del envío: lo que salió va a la bitácora y lo que no salió queda por reenviar.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { db } from "../lib/db.ts";
import { armarHtml, errorDeGmail } from "../lib/correo.ts";
import { estadoCorreos, igualasPorCorreo, leerDirecciones, parrafosDe, plantillaCorreo, registrarCorreo } from "../lib/correo-facturas.ts";

test("direcciones: una o varias, sin repetir, hasta 5 y válidas", () => {
  assert.deepEqual(leerDirecciones(" Ana@Cliente.do, pagos@cliente.do; ana@cliente.do "), ["ana@cliente.do", "pagos@cliente.do"]);
  assert.match(leerDirecciones("").error, /Escribe/);
  assert.match(leerDirecciones("ana@cliente").error, /no es un correo/);
  assert.match(leerDirecciones("a@x.do b@x.do c@x.do d@x.do e@x.do f@x.do").error, /Hasta 5/);
});

test("el texto se parte en párrafos por las líneas en blanco", () => {
  assert.deepEqual(parrafosDe("Buenos días, Ana.\nLe compartimos su factura.\n\n  Gracias.  \n"), ["Buenos días, Ana. Le compartimos su factura.", "Gracias."]);
});

test("Gmail: el límite del día se reconoce para volver a enviarlo después", () => {
  assert.equal(errorDeGmail({ response: "550 5.4.5 Daily user sending limit exceeded" }).limite, true);
  assert.equal(errorDeGmail(new Error("421 4.7.0 Try again later")).limite, true);
  const r = errorDeGmail({ response: "550 5.1.1 The email account that you tried to reach does not exist" });
  assert.equal(r.limite, false);
  assert.match(r.error, /dirección/);
});

test("la factura de un cliente sale con su nombre y sin la marca de Empire", () => {
  const base = { para: "a@x.do", asunto: "Factura", titulo: "Factura B0100000001", parrafos: ["Hola <b>"] };
  const conMarca = armarHtml(base);
  assert.match(conMarca, /EMPIRE TAX’N LEGAL/);
  const sin = armarHtml({ ...base, encabezado: "Salón Rosa SRL" });
  assert.doesNotMatch(sin, /EMPIRE|003D19|B88A40/);
  assert.match(sin, /Salón Rosa SRL/);
  assert.match(sin, /Hola &lt;b&gt;/, "el texto se escapa");
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let usuario, firma, empresa, cliente, factura;

const enEmpresa = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${usuario}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  [{ id: usuario }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`correo-${marca}@x.do`}, 'Rosa', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma correo ${marca}`}) RETURNING id`;
  await sql`SELECT crear_plantillas_mensaje(${firma})`;
  await sql`SELECT crear_plantillas_mensaje_extra(${firma})`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (nombre, firma_id) VALUES ('Empresa correo', ${firma}) RETURNING id`;
  await enEmpresa(async (tx) => {
    [{ id: cliente }] = await tx`INSERT INTO clientes (empresa_id, nombre, email) VALUES (${empresa}, 'Cliente correo', 'pagos@cliente.do') RETURNING id`;
  });
  factura = crypto.randomUUID(); // el registro del correo no exige que la factura exista; basta su id
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${usuario}`;
  } finally {
    await sql.end();
    await db().end();
  }
});

test("la firma tiene el texto predeterminado del correo, y la bitácora no lo ofrece como WhatsApp", conBase, async () => {
  assert.match(await plantillaCorreo(firma), /adjunta en PDF/);
});

test("lo que no salió queda por reenviar y no va a la bitácora; lo que salió sí", conBase, async () => {
  const base = { empresaId: empresa, facturaId: factura, para: "pagos@cliente.do", responderA: null, asunto: "Factura B0100000001 · Empresa correo",
    texto: "Buenos días.", usuarioId: usuario };
  await enEmpresa((tx) => registrarCorreo(tx, { ...base, error: "Gmail frenó el envío por el límite de correos del día." }));
  let estado = await enEmpresa((tx) => estadoCorreos(tx, [factura]));
  assert.equal(estado.get(factura), "no_salio");
  let gestiones = await enEmpresa((tx) => tx`SELECT descripcion FROM gestiones WHERE origen = 'correo'`);
  assert.equal(gestiones.length, 0);

  await enEmpresa((tx) => registrarCorreo(tx, { ...base, error: null }));
  estado = await enEmpresa((tx) => estadoCorreos(tx, [factura]));
  assert.equal(estado.get(factura), "enviado");
  gestiones = await enEmpresa((tx) => tx`SELECT tipo, descripcion FROM gestiones WHERE origen = 'correo'`);
  assert.equal(gestiones.length, 1);
  assert.equal(gestiones[0].tipo, "mensaje");
  assert.match(gestiones[0].descripcion, /^Correo: Factura B0100000001 · Empresa correo \(a pagos@cliente\.do\)$/);
  // Un intento fallido después de uno que salió no lo deja «no salió».
  await enEmpresa((tx) => registrarCorreo(tx, { ...base, error: "Gmail no aceptó el envío." }));
  estado = await enEmpresa((tx) => estadoCorreos(tx, [factura]));
  assert.equal(estado.get(factura), "enviado");
});

test("las igualas por enviar son las emitidas del mes que no han salido", conBase, async () => {
  assert.equal((await enEmpresa((tx) => igualasPorCorreo(tx, "202611"))).length, 0);
});

test("otra empresa no ve los correos enviados", conBase, async () => {
  const filas = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${crypto.randomUUID()}, true)`;
    await tx`SET LOCAL ROLE contable_app`;
    return tx`SELECT id FROM correos_enviados`;
  });
  assert.equal(filas.length, 0);
});
