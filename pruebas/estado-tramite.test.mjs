// Prioridad 2.2 (P2e.3): el mensaje con el estado de cada trámite, armado desde el trámite, que marca de qué estado ya se le avisó al cliente y avisa a la
// firma mientras falta. Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { alertasDeEmpresa } from "../lib/alertas.ts";
import { detalleParaCliente, ESTADO_PARA_CLIENTE } from "../lib/tramites.ts";

test("lo que se le cuenta al cliente depende del estado del trámite", () => {
  assert.equal(ESTADO_PARA_CLIENTE.completado, "quedó listo");
  assert.match(detalleParaCliente({ etapa: "pendiente", espera_motivo: null, espera_hasta: null, respuesta: null }), /próximos días/);
  assert.match(detalleParaCliente({ etapa: "en_proceso", espera_motivo: null, espera_hasta: null, respuesta: null }), /trabajando/);
  assert.equal(detalleParaCliente({ etapa: "en_espera", espera_motivo: "La respuesta de la DGII", espera_hasta: "2026-12-04", respuesta: null }),
    "Estamos esperando la respuesta de la DGII; contamos con una respuesta hacia el 04/12/2026.");
  assert.equal(detalleParaCliente({ etapa: "en_espera", espera_motivo: null, espera_hasta: null, respuesta: null }), "Estamos esperando la respuesta de la institución.");
  assert.equal(detalleParaCliente({ etapa: "completado", espera_motivo: null, espera_hasta: null, respuesta: "Ya está activo el RNC." }), "Ya terminó. Ya está activo el RNC.");
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa, tramite, md;
const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  process.env.DATABASE_URL = url;
  md = await import("../lib/mensajes-db.ts");
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-tram-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma tramite ${marca}`}) RETURNING id`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Cliente Trámite SRL', '130000115', ${firma}) RETURNING id`;
  await sql`SELECT crear_plantillas_mensaje_extra(${firma})`;
  [{ id: tramite }] = await leer((tx) => tx`
    INSERT INTO tramites (empresa_id, institucion, tipo, fecha, plazo, creado_por) VALUES (${empresa}, 'dgii', 'Activación de RNC', '2026-11-16', '2026-11-30', ${ana}) RETURNING id`);
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM plantillas_mensaje WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
    const { db } = await import("../lib/db.ts");
    await db().end();
  }
});

const avisos = async (hoy = "2026-11-21") => (await leer((tx) => alertasDeEmpresa(tx, { empresaId: empresa, hoy, propia: false })))
  .filter((a) => a.tipo === "tramite" && /avisarle al cliente/.test(a.texto)).map((a) => a.texto);

test("el mensaje del trámite sale armado con su estado y el trámite nuevo queda sin avisar", conBase, async () => {
  assert.deepEqual(await avisos(), ["Trámite «Activación de RNC»: avisarle al cliente que ya se registró"]);
  const p = await leer((tx) => md.datosDe(tx, empresa, { tipo: "tramite", id: tramite }));
  assert.equal(p.enlace, null);
  assert.deepEqual(p.datos, { "trámite": "Activación de RNC", estado: "ya lo registramos", detalle: "Lo iniciaremos en los próximos días y le avisamos cada avance." });
  const [pl] = await sql`SELECT texto FROM plantillas_mensaje WHERE firma_id = ${firma} AND clave = 'estado_tramite'`;
  const texto = md.armarTexto(pl.texto, p, null);
  assert.match(texto, /^Buenos días, .*Le contamos cómo va su trámite «Activación de RNC»: ya lo registramos\. Lo iniciaremos/);
  assert.ok(!/\[(trámite|estado|detalle)\]/.test(texto), "no queda nada entre corchetes");
});

test("al enviarlo queda avisado ese estado, un cambio de estado vuelve a pedir el aviso y deshacer lo devuelve", conBase, async () => {
  const enviar = () => leer((tx) => md.registrarEnvio(tx, {
    empresaId: empresa, usuarioId: ana, clave: "estado_tramite", nombre: "Estado del trámite", texto: "Mensaje de prueba", destino: "elegir", telefono: null,
    ref: { tipo: "tramite", id: tramite }, enlace: null, token: null,
  }));
  const id = await enviar();
  assert.equal((await leer((tx) => tx`SELECT etapa_avisada FROM tramites WHERE id = ${tramite}`))[0].etapa_avisada, "pendiente");
  assert.deepEqual(await avisos(), []);
  await leer((tx) => tx`UPDATE tramites SET etapa = 'en_proceso' WHERE id = ${tramite}`);
  assert.deepEqual(await avisos(), ["Trámite «Activación de RNC»: avisarle al cliente que está en proceso"]);
  const id2 = await enviar();
  assert.deepEqual(await avisos(), []);
  await leer((tx) => md.deshacerEnvio(tx, { mensajeId: id2, usuarioId: ana, administrador: false }));
  assert.equal((await leer((tx) => tx`SELECT etapa_avisada FROM tramites WHERE id = ${tramite}`))[0].etapa_avisada, null, "al deshacer, vuelve a pedirse el aviso");
  assert.equal((await avisos()).length, 1);
  await leer((tx) => md.deshacerEnvio(tx, { mensajeId: id, usuarioId: ana, administrador: false }));
  assert.equal((await leer((tx) => tx`SELECT etapa_avisada FROM tramites WHERE id = ${tramite}`))[0].etapa_avisada, null);
});

test("un trámite cerrado hace tiempo ya no pide aviso y la migración dio por avisados los que existían", conBase, async () => {
  await leer((tx) => tx`UPDATE tramites SET etapa = 'completado', estado = 'cerrado', cerrado_en = now() - interval '20 days' WHERE id = ${tramite}`);
  assert.deepEqual(await avisos(), []);
  await leer((tx) => tx`UPDATE tramites SET cerrado_en = now() - interval '3 days' WHERE id = ${tramite}`);
  assert.deepEqual(await avisos(), ["Trámite «Activación de RNC»: avisarle al cliente que quedó listo"]);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM tramites WHERE etapa_avisada IS NULL AND id <> ${tramite} AND creado < now() - interval '1 hour' AND empresa_id <> ${empresa}`;
  assert.equal(n, 0, "los trámites anteriores a esta entrega no piden aviso");
});
