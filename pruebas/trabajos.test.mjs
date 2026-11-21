// Prioridad 2.2 (P2d): el trabajo (la solicitud) con sus requisitos, su precio y su factura.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { cambiarSolicitud } from "../lib/formularios.ts";
import { faltan, leerPrecioTrabajo, leerRequisito, textoRequisitos } from "../lib/trabajos.ts";

const fd = (campos) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};

test("un requisito pide texto y es obligatorio salvo que se marque opcional", () => {
  assert.deepEqual(leerRequisito(fd({ texto: "  Copia de la   cédula " })), { texto: "Copia de la cédula", obligatorio: true });
  assert.deepEqual(leerRequisito(fd({ texto: "Estados anteriores", opcional: "on" })), { texto: "Estados anteriores", obligatorio: false });
  assert.throws(() => leerRequisito(fd({ texto: "   " })), /Escribe el requisito/);
});

test("el precio del trabajo: vacío usa la lista, y no admite negativos ni letras", () => {
  assert.equal(leerPrecioTrabajo(fd({ precio: "" })), null);
  assert.equal(leerPrecioTrabajo(fd({ precio: "RD$ 12,500.5" })), "12500.50");
  assert.equal(leerPrecioTrabajo(fd({ precio: "0" })), "0.00");
  assert.throws(() => leerPrecioTrabajo(fd({ precio: "abc" })), /no es válido/);
  assert.throws(() => leerPrecioTrabajo(fd({ precio: "-5" })), /no es válido/);
});

test("faltan cuenta solo los obligatorios pendientes y el mensaje lista lo que falta", () => {
  const r = [
    { texto: "Cédula", obligatorio: true, estado: "recibido" },
    { texto: "Contrato", obligatorio: true, estado: "pendiente" },
    { texto: "Estados previos", obligatorio: false, estado: "pendiente" },
    { texto: "Acta", obligatorio: true, estado: "no_aplica" },
  ];
  assert.equal(faltan(r), 1);
  assert.equal(textoRequisitos(r), "• Contrato\n• Estados previos (opcional)");
  assert.equal(textoRequisitos([{ texto: "Cédula", obligatorio: true, estado: "recibido" }]), "");
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa, otra, solicitud;
const leer = (id, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-trabajos-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma trabajos ${marca}`}) RETURNING id`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Cliente Trabajos', '130000079', ${firma}) RETURNING id`;
  [{ id: otra }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Otro Trabajos', '130000088', ${firma}) RETURNING id`;
  [{ id: solicitud }] = await leer(empresa, (tx) => tx`
    INSERT INTO solicitudes (empresa_id, origen, tipo, servicio, descripcion, estado, creado_por) VALUES (${empresa}, 'escrito', 'servicio', 'Servicio de prueba', 'Prueba', 'en_proceso', ${ana}) RETURNING id`);
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM plantillas_mensaje WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally { await sql.end(); }
});

test("un trabajo con un requisito obligatorio pendiente no se entrega; con todo recibido o sin aplicar, sí", conBase, async () => {
  await leer(empresa, (tx) => tx`
    INSERT INTO requisitos_solicitud (empresa_id, solicitud_id, texto, obligatorio, orden) VALUES
      (${empresa}, ${solicitud}, 'Cédula del representante', true, 0), (${empresa}, ${solicitud}, 'Contrato firmado', true, 1), (${empresa}, ${solicitud}, 'Estados previos', false, 2)`);
  await assert.rejects(() => leer(empresa, (tx) => cambiarSolicitud(tx, solicitud, "entregada")), /faltan 2 requisitos obligatorios por recibir/);
  await leer(empresa, (tx) => tx`UPDATE requisitos_solicitud SET estado = 'recibido' WHERE texto = 'Cédula del representante'`);
  await assert.rejects(() => leer(empresa, (tx) => cambiarSolicitud(tx, solicitud, "entregada")), /falta 1 requisito obligatorio por recibir/);
  await leer(empresa, (tx) => tx`UPDATE requisitos_solicitud SET estado = 'no_aplica' WHERE texto = 'Contrato firmado'`);
  await leer(empresa, (tx) => cambiarSolicitud(tx, solicitud, "entregada"));
  const [s] = await leer(empresa, (tx) => tx`SELECT estado FROM solicitudes WHERE id = ${solicitud}`);
  assert.equal(s.estado, "entregada", "el opcional pendiente no estorba");
  // Volver a abrirlo y devolver un requisito lo vuelve a bloquear.
  await leer(empresa, (tx) => cambiarSolicitud(tx, solicitud, "en_proceso"));
  await leer(empresa, (tx) => tx`UPDATE requisitos_solicitud SET estado = 'pendiente' WHERE texto = 'Contrato firmado'`);
  await assert.rejects(() => leer(empresa, (tx) => cambiarSolicitud(tx, solicitud, "entregada")), /falta 1 requisito/);
});

test("los requisitos son de cada empresa y la base guarda su historial", conBase, async () => {
  assert.equal((await leer(otra, (tx) => tx`SELECT 1 FROM requisitos_solicitud`)).length, 0);
  await assert.rejects(() => leer(otra, (tx) => tx`INSERT INTO requisitos_solicitud (empresa_id, solicitud_id, texto) VALUES (${otra}, ${solicitud}, 'X')`), /no es de esta empresa/);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM auditoria WHERE empresa_id = ${empresa} AND tabla = 'requisitos_solicitud'`;
  assert.ok(n >= 4);
  await assert.rejects(() => leer(empresa, (tx) => tx`UPDATE requisitos_solicitud SET estado = 'raro'`), /check/);
});

test("el precio y la factura se guardan en la solicitud, y no admite precio negativo", conBase, async () => {
  await leer(empresa, (tx) => tx`UPDATE solicitudes SET precio = 4500.5 WHERE id = ${solicitud}`);
  const [s] = await leer(empresa, (tx) => tx`SELECT precio::text AS precio, factura_id FROM solicitudes WHERE id = ${solicitud}`);
  assert.equal(s.precio, "4500.50");
  assert.equal(s.factura_id, null);
  await assert.rejects(() => leer(empresa, (tx) => tx`UPDATE solicitudes SET precio = -1 WHERE id = ${solicitud}`), /check/);
});

test("el mensaje «Requisitos del servicio» lo traen las firmas, también las nuevas", conBase, async () => {
  await sql`SELECT crear_plantillas_mensaje_extra(${firma})`;
  const [p] = await sql`SELECT texto FROM plantillas_mensaje WHERE firma_id = ${firma} AND clave = 'requisitos_servicio'`;
  assert.match(p.texto, /\[servicio\].*\n\[requisitos\]/s);
});
