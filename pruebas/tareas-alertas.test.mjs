// Bloque 3, entrega 3b: cronograma (tareas del mes sin repetir, por cliente según el alcance) y alertas por cliente.
// Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { alertasDeEmpresa } from "../lib/alertas.ts";
import { fechasDe, generarTareas, listarTareas, marcarTarea } from "../lib/tareas.ts";

test("fechas de una plantilla: rango del mes (el 30 de febrero es el 28) o un día por semana", () => {
  assert.deepEqual(fechasDe({ dia_desde: 25, dia_hasta: 30, dia_semana: null }, "2026-02"), [{ desde: "2026-02-25", hasta: "2026-02-28", periodo: "2026-02" }]);
  assert.deepEqual(fechasDe({ dia_desde: null, dia_hasta: null, dia_semana: 1 }, "2026-11").map((f) => f.desde),
    ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"], "los lunes de noviembre");
  assert.equal(fechasDe({ dia_desde: null, dia_hasta: null, dia_semana: 5 }, "2026-11").length, 4, "cuatro viernes");
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, propia, conTss, otra;

const comoFirma = (fn) => sql.begin(async (tx) => { await tx`SELECT set_config('app.usuario_id', ${ana}, true)`; return fn(tx); });
const leer = (eid, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${eid}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-tareas-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma tareas ${marca}`}) RETURNING id`;
  await sql`SELECT crear_plantillas_tarea(${firma})`;
  [{ id: propia }] = await sql`INSERT INTO empresas (nombre, firma_id) VALUES ('Empire Tareas SRL', ${firma}) RETURNING id`;
  [{ id: conTss }] = await sql`INSERT INTO empresas (nombre, firma_id, tiene_tss, tipo_cliente, vence_registro_mercantil)
    VALUES ('Ferretería Tareas', ${firma}, true, 'iguala', '2026-12-05') RETURNING id`;
  [{ id: otra }] = await sql`INSERT INTO empresas (nombre, firma_id) VALUES ('Colmado Tareas', ${firma}) RETURNING id`;
  await sql`UPDATE firmas SET empresa_propia_id = ${propia} WHERE id = ${firma}`;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`UPDATE firmas SET empresa_propia_id = NULL WHERE id = ${firma}`;
    await sql`DELETE FROM empresas WHERE id = ${propia}`;
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("tareas del mes: una por plantilla y cliente según el alcance, sin repetir; la del cliente va a su bitácora", conBase, async () => {
  // 5 lunes + 2 de la firma (25–27 y 30) + TSS (1) + iguala (1) + 606 a los 2 clientes + 1 + constancias a los 2 + 1 + 4 viernes.
  assert.equal(await comoFirma((tx) => generarTareas(tx, firma, "2026-11")), 19, "la empresa propia no cuenta como cliente");
  assert.equal(await comoFirma((tx) => generarTareas(tx, firma, "2026-11")), 0, "abrir otra vez no repite");
  const tareas = await comoFirma((tx) => listarTareas(tx, firma, "2026-11"));
  const tss = tareas.filter((t) => t.titulo.includes("TSS"));
  assert.deepEqual(tss.map((t) => [t.cliente, t.desde, t.hasta]), [["Ferretería Tareas", "2026-11-01", "2026-11-03"]]);
  await comoFirma((tx) => marcarTarea(tx, { firmaId: firma, tareaId: tss[0].id, hecha: true, usuarioId: ana }));
  const g = await leer(conTss, (tx) => tx`SELECT descripcion FROM gestiones`);
  assert.deepEqual(g.map((x) => x.descripcion), ["Tarea del cronograma: Enviar notificación de pago de la TSS"]);
  await comoFirma((tx) => marcarTarea(tx, { firmaId: firma, tareaId: tss[0].id, hecha: false, usuarioId: ana }));
  const [t] = await sql`SELECT estado, hecha_por FROM tareas WHERE id = ${tss[0].id}`;
  assert.deepEqual({ ...t }, { estado: "pendiente", hecha_por: null });
});

test("alertas: comprobantes, declaración por vencer, registro mercantil, cumpleaños, documentos y formalización; se van al resolverse", conBase, async () => {
  const hoy = "2026-11-10";
  await leer(conTss, async (tx) => {
    await tx`INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence) VALUES (${conTss}, 'B01', 1, 100, 96, '2027-12-31')`;
    await tx`INSERT INTO obligaciones_empresa (empresa_id, clave, activa) VALUES (${conTss}, 'f606', true), (${conTss}, 'it1', false)`;
    await tx`INSERT INTO contactos_empresa (empresa_id, rol, nombre, nacimiento) VALUES (${conTss}, 'principal', 'María', '1990-11-11')`;
  });
  const textos = async () => (await leer(conTss, (tx) => alertasDeEmpresa(tx, { empresaId: conTss, hoy, propia: false }))).map((a) => a.texto);
  const antes = await textos();
  for (const esperado of [/Quedan 5 comprobantes B01/, /^606 de octubre sin presentar: vence el 15\/11\/2026 \(faltan 5 días\)$/,
    /El registro mercantil vence el 05\/12\/2026/, /Mañana cumple años María/, /No ha enviado documentos este mes/, /Sin formalizar/]) {
    assert.ok(antes.some((t) => esperado.test(t)), `falta ${esperado}: ${antes.join(" | ")}`);
  }
  assert.ok(!antes.some((t) => /IT-1/.test(t)), "la obligación desactivada no avisa");
  await leer(conTss, (tx) => tx`INSERT INTO envios_dgii (empresa_id, formato, periodo, huella, registros, enviado_por) VALUES (${conTss}, '606', '202610', 'x', 0, ${ana})`);
  assert.ok(!(await textos()).some((t) => /^606/.test(t)), "al marcarla presentada se va");
  // La de factura electrónica (entrega E1) sale en noviembre a toda empresa sin fecha de emisor; aquí no cuenta.
  assert.equal((await leer(otra, (tx) => alertasDeEmpresa(tx, { empresaId: otra, hoy: "2026-11-05", propia: false }))).filter((a) => a.tipo !== "ecf").length, 1, "otro cliente: solo «sin formalizar»");
});
