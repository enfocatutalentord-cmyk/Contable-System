// Prioridad 3 · P3j · Auditoría: plan, pasos, hallazgos con sus cinco campos, pruebas (archivos) y cierre.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import {
  agregarPasos, cambiarEstadoAuditoria, camposFaltantes, crearAuditoria, crearHallazgo, detalleAuditoria, ErrorAuditoria, estadoDeHallazgo, guardarAuditoria,
  guardarHallazgo, leerAuditoria, leerHallazgo, leerPasosTexto, listarAuditorias, marcarPaso, quitarPaso, retirarEvidencia,
} from "../lib/auditorias.ts";
import { guardarArchivos } from "../lib/expediente.ts";

const form = (o) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) for (const x of [].concat(v)) fd.append(k, x); return fd; };

test("el plan: nombre, fechas en orden, texto largo y equipo", () => {
  const ok = leerAuditoria(form({ nombre: "  Revisión   de inventario ", objetivo: "Comprobar existencias", periodo_desde: "2026-01-01", periodo_hasta: "2026-06-30", inicio: "2026-11-02", fin: "2026-11-20" }));
  assert.equal(ok.nombre, "Revisión de inventario");
  assert.deepEqual([ok.periodoDesde, ok.periodoHasta, ok.inicio, ok.fin], ["2026-01-01", "2026-06-30", "2026-11-02", "2026-11-20"]);
  assert.deepEqual(ok.equipo, []);
  assert.throws(() => leerAuditoria(form({ nombre: "ab" })), /nombre/);
  assert.throws(() => leerAuditoria(form({ nombre: "Auditoría", periodo_desde: "2026-07-01", periodo_hasta: "2026-06-30" })), /período auditado termina antes/);
  assert.throws(() => leerAuditoria(form({ nombre: "Auditoría", inicio: "2026-11-20", fin: "2026-11-02" })), /trabajo termina antes/);
  assert.throws(() => leerAuditoria(form({ nombre: "Auditoría", inicio: "2026-02-31" })), /fecha/);
  assert.throws(() => leerAuditoria(form({ nombre: "Auditoría", alcance: "x".repeat(2001) })), /2,000/);
  assert.throws(() => leerAuditoria(form({ nombre: "Auditoría", equipo: ["no-es-uuid"] })), /equipo/);
  const u = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(leerAuditoria(form({ nombre: "Auditoría", equipo: [u, u], responsable: u })).equipo, [u]);
});

test("pasos uno por línea, con o sin viñetas", () => {
  assert.deepEqual(leerPasosTexto("1. Pedir el listado\n- Cotejar facturas\n\n  Contar bodega  "), ["Pedir el listado", "Cotejar facturas", "Contar bodega"]);
  assert.throws(() => leerPasosTexto("x".repeat(301)), /300/);
  assert.throws(() => leerPasosTexto(Array.from({ length: 41 }, (_, i) => `p${i}`).join("\n")), /40/);
});

test("hallazgo: los cinco campos, riesgo y lo que falta", () => {
  const h = leerHallazgo(form({ titulo: "Facturas sin NCF", situacion: "Hay 12", criterio: "Norma 06-18", riesgo: "alto" }));
  assert.equal(h.riesgo, "alto");
  assert.deepEqual(camposFaltantes(h), ["Causa", "Efecto", "Recomendación"]);
  assert.equal(leerHallazgo(form({ titulo: "Algo" })).riesgo, "medio");
  assert.throws(() => leerHallazgo(form({ titulo: "Algo", riesgo: "enorme" })), /riesgo/);
  assert.throws(() => leerHallazgo(form({ titulo: "x" })), /título/);
  assert.throws(() => leerHallazgo(form({ titulo: "Algo", causa: "x".repeat(3001) })), /3,000/);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let firma, empresa, otra, ana;

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-auditoria-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma auditoría ${marca}`}) RETURNING id`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (firma_id, nombre) VALUES (${firma}, 'Cliente Auditoría SRL') RETURNING id`;
  [{ id: otra }] = await sql`INSERT INTO empresas (firma_id, nombre) VALUES (${firma}, 'Otro Cliente SRL') RETURNING id`;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id IN (${empresa}, ${otra})`; // con auditorías cerradas: el borrado en cascada no se bloquea
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally { await sql.end(); }
});

const en = (eid, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${eid}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  return fn(tx);
});
const enEmpresa = (fn) => en(empresa, fn);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const base = { objetivo: "Comprobar", alcance: "Compras", periodoDesde: "2026-01-01", periodoHasta: "2026-06-30", inicio: null, fin: null, get responsable() { return ana; }, get equipo() { return [ana]; } };
let aid, p1, p2, h1, h2;

test("crear: número por empresa, pasos en orden, equipo y listado", conBase, async () => {
  aid = await enEmpresa((tx) => crearAuditoria(tx, { ...base, nombre: "Inventario y compras", empresaId: empresa, usuarioId: ana, pasos: ["Pedir listado", "Cotejar facturas", "Contar bodega"] }));
  const b = await enEmpresa((tx) => crearAuditoria(tx, { ...base, nombre: "Segunda", empresaId: empresa, usuarioId: ana, pasos: [] }));
  const c = await en(otra, (tx) => crearAuditoria(tx, { ...base, nombre: "De otro cliente", empresaId: otra, usuarioId: ana, pasos: [] }));
  const nums = await sql`SELECT id, numero FROM auditorias WHERE id IN (${aid}, ${b}, ${c})`;
  const n = Object.fromEntries(nums.map((r) => [r.id, r.numero]));
  assert.deepEqual([n[aid], n[b], n[c]], [1, 2, 1], "el número es por cliente");
  const d = await enEmpresa((tx) => detalleAuditoria(tx, aid));
  assert.deepEqual(d.pasos.map((p) => p.descripcion), ["Pedir listado", "Cotejar facturas", "Contar bodega"]);
  assert.deepEqual(d.equipo, [ana]);
  assert.deepEqual(d.equipo_nombres, ["Ana"]);
  assert.equal(d.estado, "planificada");
  [p1, p2] = d.pasos.map((p) => p.id);
  const lista = await enEmpresa((tx) => listarAuditorias(tx));
  const f = lista.find((x) => x.id === aid);
  assert.deepEqual([f.pasos, f.pasos_hechos, f.hallazgos, f.hallazgos_abiertos], [3, 0, 0, 0]);
  await enEmpresa((tx) => guardarAuditoria(tx, aid, { ...base, nombre: "Inventario y compras 2026", equipo: [] }));
  assert.equal((await enEmpresa((tx) => detalleAuditoria(tx, aid))).nombre, "Inventario y compras 2026");
});

test("pasos: agregar, marcar, «no aplica» pide su motivo, solo se quita el pendiente", conBase, async () => {
  await enEmpresa((tx) => agregarPasos(tx, { empresaId: empresa, auditoriaId: aid, usuarioId: ana, pasos: ["Revisar nómina"], responsable: ana }));
  await assert.rejects(enEmpresa((tx) => agregarPasos(tx, { empresaId: empresa, auditoriaId: aid, usuarioId: ana, pasos: [], responsable: null })), ErrorAuditoria);
  const d = await enEmpresa((tx) => detalleAuditoria(tx, aid));
  assert.equal(d.pasos.length, 4);
  assert.equal(d.pasos[3].responsable, "Ana");
  await enEmpresa((tx) => marcarPaso(tx, { id: p1, auditoriaId: aid, estado: "hecho", nota: "Llegó el 3-nov", usuarioId: ana }));
  await assert.rejects(enEmpresa((tx) => marcarPaso(tx, { id: p2, auditoriaId: aid, estado: "no_aplica", nota: " ", usuarioId: ana })), /por qué/);
  await enEmpresa((tx) => marcarPaso(tx, { id: p2, auditoriaId: aid, estado: "no_aplica", nota: "El cliente no emite cheques", usuarioId: ana }));
  const [h] = await sql`SELECT estado, hecho_por, hecho_en FROM auditoria_pasos WHERE id = ${p1}`;
  assert.equal(h.estado, "hecho"); assert.equal(h.hecho_por, ana); assert.ok(h.hecho_en);
  await assert.rejects(enEmpresa((tx) => quitarPaso(tx, p1, aid)), /ya hecho/);
  await enEmpresa((tx) => marcarPaso(tx, { id: p1, auditoriaId: aid, estado: "pendiente", nota: "", usuarioId: ana })); // reabrir limpia quién y cuándo
  const [r] = await sql`SELECT hecho_por, hecho_en FROM auditoria_pasos WHERE id = ${p1}`;
  assert.deepEqual([r.hecho_por, r.hecho_en], [null, null]);
  await enEmpresa((tx) => marcarPaso(tx, { id: p1, auditoriaId: aid, estado: "hecho", nota: "", usuarioId: ana }));
  await assert.rejects(enEmpresa((tx) => marcarPaso(tx, { id: p1, auditoriaId: aid, estado: "raro", nota: "", usuarioId: ana })), /estado del paso/);
  const nuevo = d.pasos[3].id;
  await enEmpresa((tx) => quitarPaso(tx, nuevo, aid));
  assert.equal((await enEmpresa((tx) => detalleAuditoria(tx, aid))).pasos.length, 3);
});

test("hallazgos: número por auditoría, paso propio, estado con respuesta y pruebas", conBase, async () => {
  const campos = { situacion: "Hay 12 facturas", criterio: "Norma General 06-18", causa: "Falta de control", efecto: "ITBIS no deducible", recomendacion: "Pedir NCF" };
  h1 = await enEmpresa((tx) => crearHallazgo(tx, { titulo: "Facturas sin NCF", ...campos, riesgo: "alto", pasoId: p2, empresaId: empresa, auditoriaId: aid, usuarioId: ana }));
  h2 = await enEmpresa((tx) => crearHallazgo(tx, { titulo: "Sin conteo físico", situacion: "No hay acta", criterio: "", causa: "", efecto: "", recomendacion: "", riesgo: "bajo", pasoId: null, empresaId: empresa, auditoriaId: aid, usuarioId: ana }));
  const ajeno = await en(otra, (tx) => crearAuditoria(tx, { ...base, nombre: "Ajena", empresaId: otra, usuarioId: ana, pasos: ["Un paso"] }));
  const [{ id: pasoAjeno }] = await sql`SELECT id FROM auditoria_pasos WHERE auditoria_id = ${ajeno}`;
  await assert.rejects(enEmpresa((tx) => crearHallazgo(tx, { titulo: "Raro", ...campos, riesgo: "medio", pasoId: pasoAjeno, empresaId: empresa, auditoriaId: aid, usuarioId: ana })), /no es de esta auditoría/);
  let d = await enEmpresa((tx) => detalleAuditoria(tx, aid));
  assert.deepEqual(d.hallazgos.map((h) => [h.numero, h.titulo, h.riesgo]), [[1, "Facturas sin NCF", "alto"], [2, "Sin conteo físico", "bajo"]]);
  assert.equal(d.hallazgos[0].paso, "Cotejar facturas");
  assert.deepEqual(camposFaltantes(d.hallazgos[1]), ["Criterio", "Causa", "Efecto", "Recomendación"]);

  await enEmpresa((tx) => guardarHallazgo(tx, { id: h1, auditoriaId: aid, titulo: "Facturas sin comprobante", ...campos, riesgo: "alto", pasoId: null }));
  await assert.rejects(enEmpresa((tx) => estadoDeHallazgo(tx, { id: h1, auditoriaId: aid, estado: "resuelto", respuesta: "" })), /cómo se resolvió/);
  await assert.rejects(enEmpresa((tx) => estadoDeHallazgo(tx, { id: h1, auditoriaId: aid, estado: "aceptado", respuesta: "" })), /quién lo acepta/);
  await enEmpresa((tx) => estadoDeHallazgo(tx, { id: h1, auditoriaId: aid, estado: "en_seguimiento", respuesta: "El cliente se compromete a pedirlas" }));

  // Pruebas: foto en el hallazgo y archivo general; el mismo archivo no se sube dos veces al mismo lugar.
  await enEmpresa((tx) => guardarArchivos(tx, { empresaId: empresa, usuarioId: ana, archivos: [{ nombre: "foto bodega.png", bytes: PNG }], entidad: "auditoria", entidadId: h1, carpeta: null, anio: null, descripcion: "Bodega" }));
  await assert.rejects(enEmpresa((tx) => guardarArchivos(tx, { empresaId: empresa, usuarioId: ana, archivos: [{ nombre: "otra.png", bytes: PNG }], entidad: "auditoria", entidadId: h1, carpeta: null, anio: null, descripcion: null })), /ya está guardado/);
  await enEmpresa((tx) => guardarArchivos(tx, { empresaId: empresa, usuarioId: ana, archivos: [{ nombre: "listado.png", bytes: PNG }], entidad: "auditoria", entidadId: aid, carpeta: null, anio: null, descripcion: null }));
  d = await enEmpresa((tx) => detalleAuditoria(tx, aid));
  assert.deepEqual(d.hallazgos[0].evidencias.map((e) => e.nombre), ["foto bodega.png"]);
  assert.equal(d.hallazgos[0].estado, "en_seguimiento");
  assert.deepEqual(d.evidencias.map((e) => e.nombre), ["listado.png"]);
  const lista = (await enEmpresa((tx) => listarAuditorias(tx))).find((x) => x.id === aid);
  assert.deepEqual([lista.hallazgos, lista.hallazgos_abiertos, lista.altos_abiertos], [2, 2, 1]);
});

test("estados: solo los pasos permitidos; cerrar pide pasos al día y hallazgos completos", conBase, async () => {
  await assert.rejects(enEmpresa((tx) => cambiarEstadoAuditoria(tx, aid, "cerrada", ana)), /no pasa a/);
  await assert.rejects(enEmpresa((tx) => cambiarEstadoAuditoria(tx, aid, "inventado", ana)), /Elige el estado/);
  await enEmpresa((tx) => cambiarEstadoAuditoria(tx, aid, "en_curso", ana));
  await enEmpresa((tx) => cambiarEstadoAuditoria(tx, aid, "en_informe", ana));
  await assert.rejects(enEmpresa((tx) => cambiarEstadoAuditoria(tx, aid, "cerrada", ana)), /1 paso pendiente/);
  const d = await enEmpresa((tx) => detalleAuditoria(tx, aid));
  const pendiente = d.pasos.find((p) => p.estado === "pendiente");
  await enEmpresa((tx) => marcarPaso(tx, { id: pendiente.id, auditoriaId: aid, estado: "hecho", nota: "", usuarioId: ana }));
  await assert.rejects(enEmpresa((tx) => cambiarEstadoAuditoria(tx, aid, "cerrada", ana)), /hallazgos con campos vacíos \(n\.º 2\)/);
  await enEmpresa((tx) => guardarHallazgo(tx, { id: h2, auditoriaId: aid, titulo: "Sin conteo físico", situacion: "No hay acta", criterio: "Política", causa: "Sin responsable", efecto: "Existencias sin validar", recomendacion: "Contar dos veces al año", riesgo: "bajo", pasoId: null }));
  await enEmpresa((tx) => cambiarEstadoAuditoria(tx, aid, "cerrada", ana));
  const [c] = await sql`SELECT estado, cerrada_por, cerrada_en FROM auditorias WHERE id = ${aid}`;
  assert.equal(c.estado, "cerrada"); assert.equal(c.cerrada_por, ana); assert.ok(c.cerrada_en);
});

test("cerrada no se toca: ni plan, ni pasos, ni hallazgos, ni pruebas; reabrir la libera", conBase, async () => {
  await assert.rejects(enEmpresa((tx) => guardarAuditoria(tx, aid, { ...base, nombre: "Cambio" })), /cerrada/);
  await assert.rejects(enEmpresa((tx) => agregarPasos(tx, { empresaId: empresa, auditoriaId: aid, usuarioId: ana, pasos: ["Otro"], responsable: null })), /cerrada/);
  await assert.rejects(enEmpresa((tx) => marcarPaso(tx, { id: p1, auditoriaId: aid, estado: "pendiente", nota: "", usuarioId: ana })), /cerrada/);
  await assert.rejects(enEmpresa((tx) => crearHallazgo(tx, { titulo: "Nuevo", situacion: "", criterio: "", causa: "", efecto: "", recomendacion: "", riesgo: "bajo", pasoId: null, empresaId: empresa, auditoriaId: aid, usuarioId: ana })), /cerrada/);
  await assert.rejects(enEmpresa((tx) => estadoDeHallazgo(tx, { id: h1, auditoriaId: aid, estado: "resuelto", respuesta: "Listo" })), /cerrada/);
  const [{ id: ev }] = await sql`SELECT id FROM documentos WHERE entidad = 'auditoria' AND entidad_id = ${h1} AND NOT eliminado`;
  await assert.rejects(enEmpresa((tx) => retirarEvidencia(tx, ev, ana)), /cerrada/);

  await enEmpresa((tx) => cambiarEstadoAuditoria(tx, aid, "en_informe", ana)); // reabrir
  const [r] = await sql`SELECT estado, cerrada_por, cerrada_en FROM auditorias WHERE id = ${aid}`;
  assert.deepEqual([r.estado, r.cerrada_por, r.cerrada_en], ["en_informe", null, null]);
  await enEmpresa((tx) => estadoDeHallazgo(tx, { id: h1, auditoriaId: aid, estado: "resuelto", respuesta: "Se pidieron las 12 facturas" }));
  await enEmpresa((tx) => retirarEvidencia(tx, ev, ana));
  const d = await enEmpresa((tx) => detalleAuditoria(tx, aid));
  assert.equal(d.hallazgos[0].evidencias.length, 0, "el archivo retirado ya no sale");
  const [{ eliminado }] = await sql`SELECT eliminado FROM documentos WHERE id = ${ev}`;
  assert.equal(eliminado, true, "se marca, no se borra");
  await assert.rejects(enEmpresa((tx) => retirarEvidencia(tx, ev, ana)), /ya no está/);
  await enEmpresa((tx) => cambiarEstadoAuditoria(tx, aid, "cerrada", ana)); // se deja cerrada: la limpieza del final borra la empresa de todos modos
});

test("el aislamiento: la base solo muestra las auditorías de la empresa en curso", conBase, async () => {
  const aqui = await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE contable_app`;
    await tx`SELECT set_config('app.empresa_id', ${otra}, true)`;
    return tx`SELECT nombre FROM auditorias`;
  });
  assert.deepEqual(aqui.map((r) => r.nombre).sort(), ["Ajena", "De otro cliente"]);
});
