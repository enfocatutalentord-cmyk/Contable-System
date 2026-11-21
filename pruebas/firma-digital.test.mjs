// Prioridad 3 · P3e: firma digital (firma electrónica simple con constancia). Lo que escribe el firmante, la página de constancia que se agrega al PDF, y con la base:
// el enlace seguro, el estado de cada solicitud, la firma, el rechazo, la cancelación, lo que no se puede cambiar y el mensaje de WhatsApp.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import postgres from "postgres";
import { anexarConstancia, ErrorFirma, estadoVisible, leerFirma, sha256, validarPdf, verIdentificacion } from "../lib/firma-digital.ts";
import { cedulaValida } from "../lib/validar-fiscal.ts";

// Un PNG de verdad (4×2 píxeles) para la firma.
function png() {
  const trozo = (tipo, datos) => {
    const t = Buffer.from(tipo), cuerpo = Buffer.concat([t, datos]);
    const len = Buffer.alloc(4); len.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cuerpo) >>> 0);
    return Buffer.concat([len, cuerpo, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
  const filas = Buffer.concat([0, 1].map(() => Buffer.concat([Buffer.from([0]), Buffer.alloc(16, 0x30)])));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo("IHDR", ihdr), trozo("IDAT", deflateSync(filas)), trozo("IEND", Buffer.alloc(0))]));
}
const firmaUrl = () => `data:image/png;base64,${Buffer.from(png()).toString("base64")}`;
const pdf = async (paginas = 2) => { const d = await PDFDocument.create(); for (let i = 0; i < paginas; i++) d.addPage([400, 300]).drawText(`Página ${i + 1} del contrato`, { x: 40, y: 200, size: 18 }); return new Uint8Array(await d.save()); };
const cedula = (base = "4021234567") => { for (let d = 0; d < 10; d++) if (cedulaValida(`${base}${d}`)) return `${base}${d}`; throw new Error("sin dígito"); };
const form = (o = {}) => {
  const fd = new FormData();
  const base = { nombre: "María del Carmen Gómez", tipo_doc: "cedula", documento: cedula(), leido: "on", acepto: "on", firma: firmaUrl(), trazos: "40", ...o };
  for (const [k, v] of Object.entries(base)) if (v !== null) fd.append(k, v);
  return fd;
};

test("lo que escribe el firmante: nombre completo, cédula válida o pasaporte, las dos casillas y una firma dibujada", () => {
  const ok = leerFirma(form({ documento: `${cedula().slice(0, 3)}-${cedula().slice(3, 10)}-${cedula()[10]}` }));
  assert.deepEqual([ok.nombre, ok.tipoDoc, ok.documento], ["María del Carmen Gómez", "cedula", cedula()], "la cédula se limpia de guiones");
  assert.equal(ok.firmaPng.length, png().length);
  const p = leerFirma(form({ tipo_doc: "pasaporte", documento: " ab-123456 " }));
  assert.deepEqual([p.tipoDoc, p.documento], ["pasaporte", "AB123456"]);
  for (const [mal, texto] of [
    [{ nombre: "Maria" }, /nombre completo/], [{ nombre: "" }, /nombre completo/], [{ documento: `${cedula().slice(0, 10)}${(Number(cedula()[10]) + 1) % 10}` }, /cédula no es válida/], [{ documento: "123" }, /cédula no es válida/],
    [{ tipo_doc: "pasaporte", documento: "12" }, /pasaporte/], [{ leido: null }, /leíste/], [{ acepto: null }, /aceptas/], [{ trazos: "3" }, /Dibuja tu firma/],
    [{ firma: "" }, /Dibuja tu firma/], [{ firma: "data:image/jpeg;base64,AAAA" }, /Dibuja tu firma/], [{ firma: "data:image/png;base64,AAAAAAAA" }, /no se pudo leer/],
  ]) assert.throws(() => leerFirma(form(mal)), (e) => e instanceof ErrorFirma && texto.test(e.message), JSON.stringify(mal).slice(0, 50));
  assert.equal(verIdentificacion("cedula", "40212345678"), "Cédula 402-1234567-8");
  assert.equal(verIdentificacion("pasaporte", "AB123456"), "Pasaporte AB123456");
});

test("el estado que se muestra: sin enviar, enviada, vista, vencida y los finales", () => {
  const ahora = new Date("2026-11-21T12:00:00Z");
  const futuro = new Date("2026-11-25T12:00:00Z"), pasado = new Date("2026-11-20T12:00:00Z");
  assert.equal(estadoVisible({ estado: "pendiente", tiene_enlace: false, vence: null }, ahora), "sin_enviar");
  assert.equal(estadoVisible({ estado: "pendiente", tiene_enlace: true, vence: futuro }, ahora), "pendiente");
  assert.equal(estadoVisible({ estado: "vista", tiene_enlace: true, vence: futuro }, ahora), "vista");
  assert.equal(estadoVisible({ estado: "vista", tiene_enlace: true, vence: pasado }, ahora), "vencida");
  for (const e of ["firmada", "rechazada", "cancelada"]) assert.equal(estadoVisible({ estado: e, tiene_enlace: true, vence: pasado }, ahora), e, "lo cerrado no vence");
});

test("solo se firman PDF que se puedan abrir", async () => {
  assert.equal(await validarPdf(await pdf(3)), 3);
  await assert.rejects(validarPdf(new TextEncoder().encode("hola, esto no es un PDF")), /tiene que ser un PDF/);
  await assert.rejects(validarPdf(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6])), /tiene que ser un PDF/, "un Word (zip) no vale");
  await assert.rejects(validarPdf(new TextEncoder().encode("%PDF-1.7\nroto roto roto")), /No se pudo abrir/);
  await assert.rejects(validarPdf(new Uint8Array(4 * 1024 * 1024 + 1)), /pasa de 4 MB/);
});

test("la constancia se agrega al final y el documento original no se toca", async () => {
  const original = await pdf(2);
  const firmado = await anexarConstancia(original, {
    solicitudId: "11111111-2222-3333-4444-555555555555", titulo: "Contrato de servicios con ñandú Ω", empresa: "Ferretería Ñ SRL", firma: "Empire Tax & Legal", nombre: "María del Carmen Gómez Ω",
    tipoDoc: "cedula", documento: "40212345678", firmadoEn: new Date("2026-11-21T14:30:00Z"), ip: "186.1.2.3", agente: "Mozilla/5.0 (iPhone)", originalSha: sha256(original), firmaPng: png(),
  });
  const a = await PDFDocument.load(original), b = await PDFDocument.load(firmado);
  assert.equal(a.getPageCount(), 2);
  assert.equal(b.getPageCount(), 3, "una página más: la constancia");
  assert.deepEqual(b.getPage(0).getSize(), a.getPage(0).getSize());
  assert.notEqual(sha256(firmado), sha256(original));
  assert.match(sha256(original), /^[0-9a-f]{64}$/);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa, otra, fd, mdb, ma;
const en = (id, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const leer = (fn) => en(empresa, fn);
const token = () => `${marca}-${Math.random().toString(36).slice(2)}-abcdefghijkl`.slice(0, 40).padEnd(24, "x");
const nueva = async (extra = {}) => leer(async (tx) => fd.crearSolicitud(tx, { empresaId: empresa, usuarioId: ana, titulo: "Contrato de servicios", origen: "subido", origenId: null, carpeta: "02", firmante: null, bytes: await pdf(2), ...extra }));
const conEnlace = async (id) => { const t = token(); await leer((tx) => fd.ponerEnlaceFirma(tx, { empresaId: empresa, solicitudId: id, token: t, usuarioId: ana })); return t; };

before(async () => {
  if (!sql) return;
  process.env.DATABASE_URL = url;
  fd = await import("../lib/firma-digital.ts");
  mdb = await import("../lib/mensajes-db.ts");
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-firma-${marca}@x.do`}, 'Ana Firma', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma digital ${marca}`}) RETURNING id`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Ferretería Firma SRL', '130000091', ${firma}) RETURNING id`;
  [{ id: otra }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Otra Firma SRL', '130000092', ${firma}) RETURNING id`;
  await sql`SELECT crear_plantillas_mensaje(${firma})`;
  await sql`SELECT crear_plantillas_mensaje_extra(${firma})`;
  await sql`INSERT INTO contactos_empresa (empresa_id, rol, nombre, whatsapp) VALUES (${empresa}, 'principal', 'Luis Pérez', '8095551234')`;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`ALTER TABLE solicitudes_firma DISABLE TRIGGER solicitudes_firma_proteger`;
    await sql`ALTER TABLE firma_eventos DISABLE TRIGGER firma_eventos_proteger`;
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`ALTER TABLE solicitudes_firma ENABLE TRIGGER solicitudes_firma_proteger`;
    await sql`ALTER TABLE firma_eventos ENABLE TRIGGER firma_eventos_proteger`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
    const { db } = await import("../lib/db.ts");
    await db().end();
  }
});

test("una solicitud nace sin enviar, el enlace la deja enviada y abrirlo la deja vista una sola vez", conBase, async () => {
  const id = await nueva();
  let [s] = (await leer((tx) => fd.listarSolicitudes(tx))).filter((x) => x.id === id);
  assert.deepEqual([s.estado, s.tiene_enlace, fd.estadoVisible(s)], ["pendiente", false, "sin_enviar"]);
  assert.equal(s.original_sha.length, 64);
  const t = await conEnlace(id);
  const p = await fd.porToken(t);
  assert.deepEqual([p.id, p.empresa, p.titulo, p.estado], [id, "Ferretería Firma SRL", "Contrato de servicios", "pendiente"]);
  assert.equal(await fd.porToken("corto"), null);
  assert.equal(await fd.porToken(token()), null, "un enlace que no existe");
  assert.ok((await fd.archivoPorToken(t, "original")).bytes.length > 100);
  assert.equal(await fd.archivoPorToken(t, "firmado"), null, "todavía no hay copia firmada");
  await fd.marcarVista(id, empresa, "186.0.0.1");
  await fd.marcarVista(id, empresa, "186.0.0.1");
  [s] = (await leer((tx) => fd.listarSolicitudes(tx))).filter((x) => x.id === id);
  assert.equal(s.estado, "vista");
  const ev = await leer((tx) => fd.eventosDe(tx, id));
  assert.deepEqual(ev.map((e) => e.tipo), ["creada", "enlace", "vista"], "la segunda vez no repite");
  assert.equal(ev[2].ip, "186.0.0.1");
});

test("un enlace nuevo reemplaza al anterior", conBase, async () => {
  const id = await nueva();
  const viejo = await conEnlace(id), nuevo = await conEnlace(id);
  assert.equal(await fd.porToken(viejo), null);
  assert.equal((await fd.porToken(nuevo)).id, id);
});

test("firmar: queda el PDF con constancia en el expediente, la bitácora y el historial, y no se firma dos veces", conBase, async () => {
  const id = await nueva({ titulo: "Contrato de servicios 2026", carpeta: "02" });
  const t = await conEnlace(id);
  const datos = leerFirma(form({ documento: cedula() }));
  const r = await fd.firmarPorToken(t, datos, "186.9.9.9", "Mozilla/5.0 (iPhone)");
  assert.match(r.firmadoSha, /^[0-9a-f]{64}$/);
  const [s] = (await leer((tx) => fd.listarSolicitudes(tx))).filter((x) => x.id === id);
  assert.deepEqual([s.estado, s.firmante_nombre, s.firmante_doc, s.firmado_ip, s.firmado_sha], ["firmada", "María del Carmen Gómez", cedula(), "186.9.9.9", r.firmadoSha]);
  const firmado = await leer((tx) => fd.archivoDe(tx, id, "firmado"));
  assert.equal(sha256(firmado.bytes), r.firmadoSha);
  assert.equal((await PDFDocument.load(firmado.bytes)).getPageCount(), 3, "el original de 2 páginas y la constancia");
  const original = await leer((tx) => fd.archivoDe(tx, id, "original"));
  assert.equal(sha256(original.bytes), s.original_sha, "el original no cambió");
  const [d] = await leer((tx) => tx`SELECT nombre, tipo, carpeta, anio, descripcion, entidad, sha256 FROM documentos WHERE id = ${s.documento_firmado_id}`);
  assert.deepEqual([d.tipo, d.carpeta, d.entidad, d.sha256, d.descripcion], ["application/pdf", "02", "expediente", r.firmadoSha, "Firmado por María del Carmen Gómez: Contrato de servicios 2026"]);
  assert.equal(d.nombre, "Contrato de servicios 2026 (firmado).pdf");
  const [g] = await leer((tx) => tx`SELECT descripcion, tipo FROM gestiones WHERE origen = 'firma' AND origen_id = ${id}`);
  assert.deepEqual([g.tipo, g.descripcion], ["documento", "Documento firmado por María del Carmen Gómez: Contrato de servicios 2026"]);
  const ev = await leer((tx) => fd.eventosDe(tx, id));
  assert.deepEqual(ev.map((e) => e.tipo), ["creada", "enlace", "firmada"]);
  // El firmante puede bajar su copia; el original ya no se sirve.
  assert.equal((await fd.archivoPorToken(t, "firmado")).bytes.length, firmado.bytes.length);
  assert.equal(await fd.archivoPorToken(t, "original"), null);
  assert.equal((await fd.porToken(t)).estado, "firmada");
  await assert.rejects(fd.firmarPorToken(t, datos, "1.1.1.1", null), /ya se firmó/);
  await assert.rejects(leer((tx) => fd.ponerEnlaceFirma(tx, { empresaId: empresa, solicitudId: id, token: token(), usuarioId: ana })), /ya se firmó/);
  await assert.rejects(leer((tx) => fd.cancelarSolicitud(tx, { empresaId: empresa, solicitudId: id, usuarioId: ana })), /todavía no se firman/);
});

test("lo firmado no se cambia ni se borra y el historial tampoco", conBase, async () => {
  const [s] = await sql`SELECT id FROM solicitudes_firma WHERE empresa_id = ${empresa} AND estado = 'firmada' LIMIT 1`;
  await assert.rejects(sql`UPDATE solicitudes_firma SET estado = 'pendiente' WHERE id = ${s.id}`, /ya está cerrada/);
  await assert.rejects(sql`UPDATE solicitudes_firma SET firmado = '\\x00'::bytea WHERE id = ${s.id}`, /ya está cerrada/);
  await assert.rejects(sql`UPDATE solicitudes_firma SET original = '\\x00'::bytea WHERE id = ${s.id}`, /ya está cerrada|no se cambia/);
  await assert.rejects(sql`DELETE FROM solicitudes_firma WHERE id = ${s.id}`, /no se borra/);
  await assert.rejects(sql`UPDATE firma_eventos SET tipo = 'creada' WHERE solicitud_id = ${s.id}`, /no se cambia/);
  await assert.rejects(sql`DELETE FROM firma_eventos WHERE solicitud_id = ${s.id}`, /no se borra/);
  const abierta = await nueva();
  await assert.rejects(sql`UPDATE solicitudes_firma SET original = '\\x00'::bytea, original_sha = 'x' WHERE id = ${abierta}`, /no se cambia/, "ni siquiera mientras está abierta");
});

test("un enlace vencido no deja firmar ni abrir", conBase, async () => {
  const id = await nueva();
  const t = await conEnlace(id);
  await sql`UPDATE solicitudes_firma SET vence = now() - interval '1 minute' WHERE id = ${id}`;
  assert.equal(await fd.porToken(t), null);
  await assert.rejects(fd.firmarPorToken(t, leerFirma(form()), null, null), /venció/);
  await assert.rejects(fd.rechazarPorToken(t, "no quiero", null), /venció/);
  const [s] = (await leer((tx) => fd.listarSolicitudes(tx))).filter((x) => x.id === id);
  assert.equal(fd.estadoVisible(s), "vencida");
  const t2 = await conEnlace(id); // un enlace nuevo la revive
  assert.equal((await fd.porToken(t2)).id, id);
});

test("rechazar pide el motivo, queda en la bitácora y cierra la solicitud", conBase, async () => {
  const id = await nueva({ titulo: "Propuesta de servicios" });
  const t = await conEnlace(id);
  await assert.rejects(fd.rechazarPorToken(t, "  ", "1.2.3.4"), /por qué no firmas/);
  await fd.rechazarPorToken(t, "El monto está mal", "1.2.3.4");
  const [s] = (await leer((tx) => fd.listarSolicitudes(tx))).filter((x) => x.id === id);
  assert.deepEqual([s.estado, s.rechazo_motivo], ["rechazada", "El monto está mal"]);
  const [g] = await leer((tx) => tx`SELECT descripcion FROM gestiones WHERE origen = 'firma_rechazo' AND origen_id = ${id}`);
  assert.match(g.descripcion, /Firma rechazada: Propuesta de servicios \(El monto está mal\)/);
  await assert.rejects(fd.firmarPorToken(t, leerFirma(form()), null, null), /venció|ya no se puede/);
  assert.equal((await fd.porToken(t)).estado, "rechazada", "el firmante todavía ve que la rechazó");
});

test("cancelar apaga el enlace; otra empresa no ve nada", conBase, async () => {
  const id = await nueva();
  const t = await conEnlace(id);
  await leer((tx) => fd.cancelarSolicitud(tx, { empresaId: empresa, solicitudId: id, usuarioId: ana }));
  assert.equal(await fd.porToken(t), null);
  await assert.rejects(leer((tx) => fd.ponerEnlaceFirma(tx, { empresaId: empresa, solicitudId: id, token: token(), usuarioId: ana })), /ya se firmó, se rechazó o se canceló/);
  assert.equal((await en(otra, (tx) => fd.listarSolicitudes(tx))).length, 0, "aislamiento por empresa");
  assert.equal(await en(otra, (tx) => fd.archivoDe(tx, id, "original")), null);
  await assert.rejects(en(otra, async (tx) => tx`INSERT INTO solicitudes_firma (empresa_id, titulo, origen, original, original_sha, creado_por) VALUES (${empresa}, 'x', 'subido', 'x', 'x', ${ana})`), /row-level security|violates/i);
});

test("el mensaje de WhatsApp pide la firma y su envío deja el enlace listo", conBase, async () => {
  const id = await nueva({ titulo: "Carta de ingresos", firmante: "Juan Pérez" });
  const ref = { tipo: "firma", id };
  const p = await leer((tx) => mdb.datosDe(tx, empresa, ref));
  assert.deepEqual([p.datos.documento, p.destinatario.nombre, p.enlace.tipo, p.enlace.refId], ["Carta de ingresos", "Juan Pérez", "firma", id]);
  assert.equal(p.destinatario.telefono, "18095551234");
  const plantilla = (await mdb.plantillasDe(firma)).find((x) => x.clave === "firma_documento");
  assert.ok(plantilla, "el mensaje «Firma de documento» viene con la firma");
  const t = mdb.nuevoToken();
  const texto = mdb.armarTexto(plantilla.texto, p, `https://ejemplo.do/firmar/${t}`);
  assert.match(texto, /«Carta de ingresos»/);
  assert.match(texto, new RegExp(`https://ejemplo.do/firmar/${t}`));
  await leer((tx) => mdb.registrarEnvio(tx, { empresaId: empresa, usuarioId: ana, clave: "firma_documento", nombre: plantilla.nombre, texto, destino: "contacto", telefono: p.destinatario.telefono, ref, enlace: p.enlace, token: t }));
  assert.equal((await fd.porToken(t)).id, id, "al enviarlo, el enlace ya funciona");
  await leer((tx) => fd.cancelarSolicitud(tx, { empresaId: empresa, solicitudId: id, usuarioId: ana }));
  await assert.rejects(leer((tx) => mdb.datosDe(tx, empresa, ref)), /ya se firmó, se rechazó o se canceló/);
});
