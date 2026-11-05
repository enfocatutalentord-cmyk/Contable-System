// Bloque 3, entrega 3c: mensajes de WhatsApp (llenar campos, número para wa.me), enlace seguro de 30 días y registro del envío
// en la bitácora con su deshacer. Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { db } from "../lib/db.ts";
import { faltantes, llenar, telefonoWa, urlWhatsApp } from "../lib/mensajes.ts";
import { armarTexto, datosDe, deshacerEnvio, enlaceVigente, nuevoToken, plantillasDe, quitarEnlace, registrarEnvio } from "../lib/mensajes-db.ts";

test("llenar los campos: los que tienen dato se cambian y los demás quedan entre corchetes", () => {
  const t = llenar("Buenos días, [nombre]. Su iguala de [mes], por RD$[monto]: [enlace]. Cita a las [hora].", { nombre: "María", mes: "octubre 2026", monto: "3,500.00" });
  assert.equal(t, "Buenos días, María. Su iguala de octubre 2026, por RD$3,500.00: [enlace]. Cita a las [hora].");
  assert.deepEqual(faltantes(t), ["enlace", "hora"]);
  assert.equal(llenar("Antes del [Fecha límite]", { "fecha límite": "03/11/2026" }), "Antes del 03/11/2026", "sin importar mayúsculas");
});

test("número para wa.me: los de RD llevan el 1; lo que no es un número queda sin chat", () => {
  assert.equal(telefonoWa("(809) 555-1234"), "18095551234");
  assert.equal(telefonoWa("829.555.1234"), "18295551234");
  assert.equal(telefonoWa("+1 849 555 1234"), "18495551234");
  assert.equal(telefonoWa("555-1234"), null);
  assert.equal(telefonoWa(""), null);
  assert.equal(urlWhatsApp("Hola & adiós", "18095551234"), "https://wa.me/18095551234?text=Hola%20%26%20adi%C3%B3s");
  assert.equal(urlWhatsApp("Hola"), "https://wa.me/?text=Hola", "sin número: WhatsApp pide elegir el chat o el grupo");
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, beto, firma, cliente, notificacion, documento;

const leer = (eid, usuario, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${eid}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${usuario}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-wa-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: beto }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`beto-wa-${marca}@x.do`}, 'Beto', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma WhatsApp ${marca}`}) RETURNING id`;
  await sql`SELECT crear_plantillas_mensaje(${firma})`;
  [{ id: cliente }] = await sql`INSERT INTO empresas (nombre, firma_id, grupo_whatsapp) VALUES ('Ferretería WhatsApp', ${firma}, 'Contabilidad Ferretería') RETURNING id`;
  await leer(cliente, ana, async (tx) => {
    await tx`INSERT INTO contactos_empresa (empresa_id, rol, nombre, whatsapp) VALUES (${cliente}, 'principal', 'María', '809-555-1234')`;
    [{ id: notificacion }] = await tx`INSERT INTO notificaciones_pago (empresa_id, tipo, periodo, monto, fecha_limite, creado_por)
      VALUES (${cliente}, 'tss', '202610', 12450, '2026-11-03', ${ana}) RETURNING id`;
    [{ id: documento }] = await tx`INSERT INTO documentos (empresa_id, entidad, entidad_id, nombre, tipo, tamano, sha256, contenido, subido_por)
      VALUES (${cliente}, 'notificacion', ${notificacion}, 'tss.pdf', 'application/pdf', 4, 'x', '\\x25504446', ${ana}) RETURNING id`;
  });
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id IN (${ana}, ${beto})`;
  } finally {
    await sql.end();
    await db().end();
  }
});

test("los 24 mensajes del manual se cargan en la firma y terminan con la firma de Empire", conBase, async () => {
  const p = await plantillasDe(firma);
  assert.equal(p.length, 24);
  assert.ok(p.every((x) => x.texto.endsWith("-- Empire Tax’N Legal")));
  await sql`SELECT crear_plantillas_mensaje(${firma})`;
  assert.equal((await plantillasDe(firma)).length, 24, "cargarlos otra vez no repite");
});

test("notificación TSS: el mensaje se llena, el enlace descarga el PDF, la bitácora lo anota y deshacer lo quita todo", conBase, async () => {
  const ref = { tipo: "notificacion", id: notificacion };
  const plantilla = (await plantillasDe(firma)).find((x) => x.clave === "notificacion_tss");
  const p = await leer(cliente, ana, (tx) => datosDe(tx, cliente, ref));
  assert.deepEqual(p.destinatario, { empresa: "Ferretería WhatsApp", grupo: "Contabilidad Ferretería", nombre: "María", telefono: "18095551234" });
  assert.deepEqual(p.enlace, { tipo: "documento", refId: documento, titulo: "Notificación TSS de octubre 2026" });
  const token = nuevoToken();
  const texto = armarTexto(plantilla.texto, p, `https://ejemplo.do/d/${token}`);
  assert.equal(texto, `Buenos días, María. Le compartimos la notificación de pago de la TSS de octubre 2026, por RD$12,450.00: https://ejemplo.do/d/${token}. Favor pagar antes del 03/11/2026 para evitar recargos. -- Empire Tax’N Legal`);

  assert.equal(await enlaceVigente(token), null, "antes de enviarlo el enlace no existe");
  const id = await leer(cliente, ana, (tx) => registrarEnvio(tx, {
    empresaId: cliente, usuarioId: ana, clave: plantilla.clave, nombre: plantilla.nombre, texto, destino: "contacto", telefono: p.destinatario.telefono,
    ref, enlace: p.enlace, token,
  }));
  const e = await enlaceVigente(token);
  assert.equal(e?.ref_id, documento);
  const [{ descargas }] = await sql`SELECT descargas FROM enlaces_documento WHERE id = ${e.id}`;
  assert.equal(descargas, 1, "cuenta la descarga");
  assert.equal(await enlaceVigente(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A")), null, "otro token no abre nada");
  const [{ count: cifrado }] = await sql`SELECT count(*)::int FROM enlaces_documento WHERE token_hash = ${token}`;
  assert.equal(cifrado, 0, "no se guarda el enlace, solo su hash");

  const bitacora = await leer(cliente, ana, (tx) => tx`SELECT tipo, origen, descripcion FROM gestiones ORDER BY origen = 'mensaje'`);
  assert.deepEqual(bitacora.map((g) => g.origen), ["notificacion", "mensaje"], "la notificación quedó enviada y el mensaje anotado");
  assert.equal(bitacora[1].descripcion, "WhatsApp: Notificación TSS · Notificación TSS de octubre 2026 (al 18095551234)");
  const [{ estado }] = await sql`SELECT estado FROM notificaciones_pago WHERE id = ${notificacion}`;
  assert.equal(estado, "enviada");

  await assert.rejects(leer(cliente, beto, (tx) => deshacerEnvio(tx, { mensajeId: id, usuarioId: beto, administrador: false })), /Solo quien lo envió/);
  await leer(cliente, ana, (tx) => deshacerEnvio(tx, { mensajeId: id, usuarioId: ana, administrador: false }));
  assert.equal(await enlaceVigente(token), null, "el enlace queda retirado");
  const despues = await leer(cliente, ana, (tx) => tx`SELECT origen FROM gestiones`);
  assert.deepEqual(despues.map((g) => g.origen), ["notificacion"], "la gestión del mensaje se va");
  const [{ estado: otra }] = await sql`SELECT estado FROM notificaciones_pago WHERE id = ${notificacion}`;
  assert.equal(otra, "pendiente", "la notificación vuelve a pendiente");
});

test("sin documento: el mensaje no lleva enlace; un enlace vencido o retirado no descarga", conBase, async () => {
  const plantilla = (await plantillasDe(firma)).find((x) => x.clave === "saludo_lunes");
  const p = await leer(cliente, ana, (tx) => datosDe(tx, cliente, null));
  assert.equal(p.enlace, null);
  await leer(cliente, ana, (tx) => registrarEnvio(tx, {
    empresaId: cliente, usuarioId: ana, clave: plantilla.clave, nombre: plantilla.nombre, texto: armarTexto(plantilla.texto, p, null), destino: "elegir",
    telefono: p.destinatario.telefono, ref: null, enlace: null, token: null,
  }));
  const [g] = await leer(cliente, ana, (tx) => tx`SELECT descripcion FROM gestiones WHERE origen = 'mensaje'`);
  assert.equal(g.descripcion, "WhatsApp: Saludo de los lunes (chat o grupo elegido)");

  const vencido = nuevoToken(), retirado = nuevoToken();
  const { hashToken } = await import("../lib/mensajes-db.ts");
  const [, { id: idRetirado }] = await leer(cliente, ana, (tx) => tx`
    INSERT INTO enlaces_documento (empresa_id, token_hash, tipo, ref_id, titulo, creado_por, vence) VALUES
      (${cliente}, ${hashToken(vencido)}, 'documento', ${documento}, 'Viejo', ${ana}, now() - interval '1 day'),
      (${cliente}, ${hashToken(retirado)}, 'documento', ${documento}, 'Retirado', ${ana}, DEFAULT) RETURNING id`);
  assert.equal(await enlaceVigente(vencido), null, "vencido");
  assert.ok(await enlaceVigente(retirado));
  await leer(cliente, ana, (tx) => quitarEnlace(tx, idRetirado, ana));
  assert.equal(await enlaceVigente(retirado), null, "retirado");
  await assert.rejects(leer(cliente, ana, (tx) => quitarEnlace(tx, idRetirado, ana)), /ya no está activo/);
});
