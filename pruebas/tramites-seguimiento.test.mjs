// Prioridad 1.5 del prompt de Patricia (20-nov-2026): trámites con días laborables, estados, pendientes y notas.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { cambiarEtapa, crearTramiteNuevo, leerPasos, pasosATexto } from "../lib/tramites.ts";

test("pasos escritos uno por línea con su día", () => {
  const p = leerPasos("Pedir la clave | 1\n\nDepositar | 3\nRetirar la respuesta");
  assert.deepEqual(p, [{ texto: "Pedir la clave", dia: 1 }, { texto: "Depositar", dia: 3 }, { texto: "Retirar la respuesta", dia: null }]);
  assert.equal(pasosATexto(p), "Pedir la clave | 1\nDepositar | 3\nRetirar la respuesta");
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let firma, empresa, ana;

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-tramites-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma trámites ${marca}`}) RETURNING id`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (firma_id, nombre) VALUES (${firma}, 'Cliente Trámites SRL') RETURNING id`;
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

test("crear con pasos: plazo y vencimientos en días laborables; espera y completado quedan en la cronología", conBase, async () => {
  const feriados = new Set(["2026-11-09"]);
  const id = await enEmpresa((tx) => crearTramiteNuevo(tx, {
    empresaId: empresa, usuarioId: ana, nombre: "Cambio de correo", institucion: "dgii", fecha: "2026-11-06", dias: 5, etapa: "en_proceso",
    esperaMotivo: null, esperaDias: null, responsable: ana, pasos: [{ texto: "Pedir el correo", dia: 1 }, { texto: "Depositar", dia: null }], plantillaId: null, feriados,
  }));
  const [t] = await sql`SELECT to_char(plazo, 'YYYY-MM-DD') AS plazo, etapa, estado FROM tramites WHERE id = ${id}`;
  assert.deepEqual({ ...t }, { plazo: "2026-11-16", etapa: "en_proceso", estado: "abierto" }, "5 laborables desde el viernes 6, sin el lunes 9");
  const pasos = await sql`SELECT texto, to_char(vence, 'YYYY-MM-DD') AS vence FROM pendientes_tramite WHERE tramite_id = ${id} ORDER BY orden`;
  assert.deepEqual(pasos.map((p) => [p.texto, p.vence]), [["Pedir el correo", "2026-11-10"], ["Depositar", null]]);

  await assert.rejects(enEmpresa((tx) => cambiarEtapa(tx, { id, etapa: "en_espera", esperaMotivo: null, esperaDias: 3, usuarioId: ana, hoy: "2026-11-10", feriados, respuesta: null })), /motivo/);
  await enEmpresa((tx) => cambiarEtapa(tx, { id, etapa: "en_espera", esperaMotivo: "Falta la clave", esperaDias: 3, usuarioId: ana, hoy: "2026-11-10", feriados, respuesta: null }));
  const [e] = await sql`SELECT etapa, to_char(espera_hasta, 'YYYY-MM-DD') AS hasta FROM tramites WHERE id = ${id}`;
  assert.deepEqual({ ...e }, { etapa: "en_espera", hasta: "2026-11-13" });
  await enEmpresa((tx) => cambiarEtapa(tx, { id, etapa: "completado", esperaMotivo: null, esperaDias: null, usuarioId: ana, hoy: "2026-11-13", feriados, respuesta: "Correo cambiado" }));
  const [c] = await sql`SELECT etapa, estado, respuesta FROM tramites WHERE id = ${id}`;
  assert.deepEqual({ ...c }, { etapa: "completado", estado: "cerrado", respuesta: "Correo cambiado" });
  const notas = await sql`SELECT texto FROM notas_tramite WHERE tramite_id = ${id} ORDER BY creado`;
  assert.equal(notas.length, 2);
  assert.match(notas[0].texto, /En espera de respuesta · Falta la clave/);
});
