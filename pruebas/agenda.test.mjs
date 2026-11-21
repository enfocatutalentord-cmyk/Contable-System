// Prioridad 3 · P3c: agenda de citas. Lectura del formulario, fechas y horas en palabras, crear, mover, cancelar y marcar realizada, el recordatorio por
// WhatsApp (mensaje «Confirmación de cita»), las alertas y el aislamiento por empresa. Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { alertasDeEmpresa } from "../lib/alertas.ts";
import {
  cancelarCita, crearCita, ErrorAgenda, fechaLarga, leerCita, leerMovimiento, listarCitas, moverCita, realizarCita, terminaA, verHora,
} from "../lib/agenda.ts";
import { armarTexto, datosDe, deshacerEnvio, ErrorMensaje, plantillasDe, registrarEnvio } from "../lib/mensajes-db.ts";

const U = "11111111-2222-3333-4444-555555555555";
const V = "66666666-7777-8888-9999-aaaaaaaaaaaa";
const form = (o) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) for (const x of [].concat(v)) fd.append(k, x); return fd; };
const HOY = "2026-11-21";

test("la fecha y la hora se dicen en palabras", () => {
  assert.equal(fechaLarga("2026-11-24"), "martes 24 de noviembre");
  assert.equal(fechaLarga("2026-12-01"), "martes 1 de diciembre");
  assert.equal(verHora("14:30"), "2:30 p. m.");
  assert.equal(verHora("00:15"), "12:15 a. m.");
  assert.equal(verHora("12:00"), "12:00 p. m.");
  assert.equal(verHora("09:05"), "9:05 a. m.");
  assert.equal(terminaA("15:30", 90), "17:00");
  assert.equal(terminaA("23:30", 60), "00:30");
});

test("el formulario de la cita: asunto por defecto, duración, modalidad y asistentes del equipo", () => {
  const c = leerCita(form({ fecha: "2026-11-24", hora: "10:00" }), HOY);
  assert.deepEqual(c, { titulo: "Reunión", fecha: "2026-11-24", hora: "10:00", duracion: 60, modalidad: "presencial", lugar: null, asistentes: [], notas: null });
  const d = leerCita(form({ titulo: "  Firma de contrato ", fecha: "2026-11-21", hora: "08:30", duracion: "90", modalidad: "virtual", lugar: " https://meet.example/x ", asistentes: [U, U, V], notas: "Traer cédulas" }), HOY);
  assert.deepEqual([d.titulo, d.duracion, d.modalidad, d.lugar, d.asistentes, d.notas], ["Firma de contrato", 90, "virtual", "https://meet.example/x", [U, V], "Traer cédulas"], "hoy vale y los repetidos no se duplican");
  for (const [mal, texto] of [
    [{ fecha: "2026-11-20", hora: "10:00" }, /anterior a hoy/], [{ fecha: "", hora: "10:00" }, /fecha/], [{ fecha: "2026-02-31", hora: "10:00" }, /fecha/],
    [{ fecha: "2026-11-24", hora: "25:00" }, /hora/], [{ fecha: "2026-11-24", hora: "" }, /hora/], [{ fecha: "2026-11-24", hora: "10:00", duracion: "0" }, /duración/],
    [{ fecha: "2026-11-24", hora: "10:00", modalidad: "zoom" }, /presencial/], [{ fecha: "2026-11-24", hora: "10:00", asistentes: "no-es-uuid" }, /asistentes/],
  ]) assert.throws(() => leerCita(form(mal), HOY), (e) => e instanceof ErrorAgenda && texto.test(e.message), JSON.stringify(mal));
  assert.deepEqual(leerMovimiento(form({ fecha: "2026-11-25", hora: "15:00" }), HOY), { fecha: "2026-11-25", hora: "15:00" });
  assert.throws(() => leerMovimiento(form({ fecha: "2026-11-01", hora: "15:00" }), HOY), ErrorAgenda);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa, otra;
const en = (id, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const leer = (fn) => en(empresa, fn);
const nueva = (extra = {}) => leer((tx) => crearCita(tx, { empresaId: empresa, usuarioId: ana, titulo: "Reunión", fecha: "2026-11-24", hora: "10:00", duracion: 60, modalidad: "presencial", lugar: "Oficina de Empire", asistentes: [ana], notas: null, ...extra }));

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-agenda-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma agenda ${marca}`}) RETURNING id`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Cliente Agenda SRL', '130000071', ${firma}) RETURNING id`;
  [{ id: otra }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Otro Cliente SRL', '130000072', ${firma}) RETURNING id`;
  await sql`SELECT crear_plantillas_mensaje(${firma})`;
  await sql`INSERT INTO contactos_empresa (empresa_id, rol, nombre, whatsapp) VALUES (${empresa}, 'principal', 'Luis Pérez', '8095551234')`;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
    const { db } = await import("../lib/db.ts");
    await db().end();
  }
});

test("las citas se guardan por empresa, en orden de fecha y hora, y otra empresa no las ve", conBase, async () => {
  process.env.DATABASE_URL = url;
  const b = await nueva({ titulo: "Segunda", fecha: "2026-11-24", hora: "14:00" });
  const a = await nueva({ titulo: "Primera", fecha: "2026-11-24", hora: "09:30" });
  await nueva({ titulo: "Diciembre", fecha: "2026-12-02", hora: "08:00" });
  const noviembre = await leer((tx) => listarCitas(tx, "2026-11-01", "2026-11-30"));
  assert.deepEqual(noviembre.map((c) => c.titulo), ["Primera", "Segunda"]);
  assert.deepEqual([noviembre[0].hora, noviembre[0].duracion_min, noviembre[0].estado, noviembre[0].asistentes], ["09:30", 60, "programada", [ana]]);
  assert.equal((await leer((tx) => listarCitas(tx, null, null))).length, 3, "sin límites trae todas");
  assert.equal((await en(otra, (tx) => listarCitas(tx, null, null))).length, 0, "aislamiento por empresa");
  await assert.rejects(en(otra, (tx) => tx`INSERT INTO citas (empresa_id, titulo, fecha, hora, creado_por) VALUES (${empresa}, 'x', '2026-11-24', '10:00', ${ana})`), /row-level security|violates/i);
  assert.ok(a && b);
});

test("mover una cita la deja pendiente de nuevo recordatorio; cancelar y realizar solo valen para las programadas", conBase, async () => {
  const id = await nueva({ titulo: "Para mover", fecha: "2026-11-25", hora: "10:00" });
  await sql`UPDATE citas SET recordatorio_enviado = now() WHERE id = ${id}`;
  await leer((tx) => moverCita(tx, { citaId: id, usuarioId: ana, fecha: "2026-11-26", hora: "11:30" }));
  let [c] = (await leer((tx) => listarCitas(tx, "2026-11-26", "2026-11-26"))).filter((x) => x.id === id);
  assert.deepEqual([c.fecha, c.hora, c.movida_veces, c.recordatorio_enviado], ["2026-11-26", "11:30", 1, null], "mover borra el recordatorio enviado");
  await leer((tx) => cancelarCita(tx, { citaId: id, usuarioId: ana, motivo: " El cliente viaja " }));
  [c] = (await leer((tx) => listarCitas(tx, "2026-11-26", "2026-11-26"))).filter((x) => x.id === id);
  assert.deepEqual([c.estado, c.motivo_cancelacion], ["cancelada", "El cliente viaja"]);
  for (const f of [
    () => moverCita(tx0, { citaId: id, usuarioId: ana, fecha: "2026-11-27", hora: "10:00" }), () => cancelarCita(tx0, { citaId: id, usuarioId: ana, motivo: null }),
    () => realizarCita(tx0, { citaId: id, usuarioId: ana, resultado: null }),
  ]) await assert.rejects(leer((tx) => { tx0 = tx; return f(); }), ErrorAgenda);
  const otraId = await nueva({ titulo: "Con resultado", notas: "Llevar documentos" });
  await leer((tx) => realizarCita(tx, { citaId: otraId, usuarioId: ana, resultado: "Se acordó la iguala" }));
  const [r] = (await leer((tx) => listarCitas(tx, "2026-11-24", "2026-11-24"))).filter((x) => x.id === otraId);
  assert.deepEqual([r.estado, r.notas], ["realizada", "Llevar documentos\nResultado: Se acordó la iguala"]);
});
let tx0;

test("el recordatorio sale con «Confirmación de cita», queda anotado y se puede deshacer", conBase, async () => {
  const id = await nueva({ titulo: "Reunión de cierre", fecha: "2026-11-24", hora: "14:30", lugar: "Oficina de Empire, Piantini" });
  const ref = { tipo: "cita", id };
  const p = await leer((tx) => datosDe(tx, empresa, ref));
  assert.deepEqual(p.datos, { fecha: "martes 24 de noviembre", hora: "2:30 p. m.", lugar: "Oficina de Empire, Piantini" });
  assert.equal(p.destinatario.nombre, "Luis Pérez");
  assert.equal(p.destinatario.telefono, "18095551234");
  const plantilla = (await plantillasDe(firma)).find((x) => x.clave === "cita");
  assert.ok(plantilla, "el mensaje «Confirmación de cita» viene con la firma");
  const texto = armarTexto(plantilla.texto, p, null);
  assert.match(texto, /Luis Pérez/);
  assert.match(texto, /martes 24 de noviembre a las 2:30 p\. m\. en Oficina de Empire, Piantini/);
  assert.doesNotMatch(texto, /\[(fecha|hora|lugar)\]/);
  const mensajeId = await leer((tx) => registrarEnvio(tx, { empresaId: empresa, usuarioId: ana, clave: "cita", nombre: plantilla.nombre, texto, destino: "contacto", telefono: p.destinatario.telefono, ref, enlace: null, token: null }));
  const [{ r }] = await sql`SELECT recordatorio_enviado IS NOT NULL AS r FROM citas WHERE id = ${id}`;
  assert.equal(r, true);
  await leer((tx) => deshacerEnvio(tx, { mensajeId, usuarioId: ana, administrador: false }));
  const [{ r: despues }] = await sql`SELECT recordatorio_enviado IS NOT NULL AS r FROM citas WHERE id = ${id}`;
  assert.equal(despues, false, "al deshacer el envío vuelve a faltar el recordatorio");
  // Una llamada o una reunión virtual sin lugar igual se explican; una presencial sin lugar deja [lugar] para escribirlo.
  const llamada = await nueva({ modalidad: "llamada", lugar: null });
  assert.equal((await leer((tx) => datosDe(tx, empresa, { tipo: "cita", id: llamada }))).datos.lugar, "una llamada telefónica");
  const sinLugar = await nueva({ lugar: null });
  assert.equal((await leer((tx) => datosDe(tx, empresa, { tipo: "cita", id: sinLugar }))).datos.lugar, "");
  assert.match(armarTexto(plantilla.texto, await leer((tx) => datosDe(tx, empresa, { tipo: "cita", id: sinLugar })), null), /\[lugar\]/, "falta el lugar: se avisa");
  await leer((tx) => cancelarCita(tx, { citaId: id, usuarioId: ana, motivo: null }));
  await assert.rejects(leer((tx) => datosDe(tx, empresa, ref)), ErrorMensaje, "de una cancelada no se manda recordatorio");
  await assert.rejects(leer((tx) => datosDe(tx, empresa, { tipo: "cita", id: "00000000-0000-0000-0000-000000000000" })), ErrorMensaje);
});

test("las alertas avisan de las citas de hoy y mañana con su recordatorio, y de las que pasaron sin cerrarse", conBase, async () => {
  await sql`DELETE FROM citas WHERE empresa_id = ${empresa}`;
  const hoy = await nueva({ titulo: "Cita de hoy", fecha: HOY, hora: "09:00" });
  const manana = await nueva({ titulo: "Cita de mañana", fecha: "2026-11-22", hora: "15:00" });
  await nueva({ titulo: "Cita lejana", fecha: "2026-11-30", hora: "15:00" });
  const pasada = await nueva({ titulo: "Cita pasada", fecha: "2026-11-19", hora: "10:00" });
  await sql`UPDATE citas SET recordatorio_enviado = now() WHERE id = ${manana}`;
  const alertas = (await leer((tx) => alertasDeEmpresa(tx, { empresaId: empresa, hoy: HOY, propia: false }))).filter((a) => a.tipo === "cita");
  const por = (t) => alertas.find((a) => a.texto.includes(t));
  assert.equal(alertas.length, 3, "la lejana no avisa todavía");
  assert.match(por("de hoy").texto, /hoy a las 9:00 a\. m\.: falta enviarle el recordatorio/);
  assert.deepEqual(por("de hoy").mensaje, { clave: "cita", ref: { tipo: "cita", id: hoy } });
  assert.doesNotMatch(por("de mañana").texto, /falta/);
  assert.equal(por("de mañana").mensaje, undefined, "ya tiene recordatorio: no ofrece enviarlo");
  assert.equal(por("pasada").nivel, "urgente");
  assert.match(por("pasada").texto, /márcala como realizada o cancélala/);
  assert.ok(por("de hoy").enlace.includes(`/firma/${firma}/agenda?dia=${HOY}`));
  await leer((tx) => realizarCita(tx, { citaId: pasada, usuarioId: ana, resultado: null }));
  const despues = (await leer((tx) => alertasDeEmpresa(tx, { empresaId: empresa, hoy: HOY, propia: false }))).filter((a) => a.tipo === "cita");
  assert.equal(despues.length, 2, "al marcarla realizada deja de avisar");
});
