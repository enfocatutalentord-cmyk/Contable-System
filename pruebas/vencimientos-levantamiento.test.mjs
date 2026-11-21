// Prioridad 2.2 (P2c.4): documentos del cliente que vencen (con sus alertas) y levantamiento simple o completo.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { alertasDeEmpresa } from "../lib/alertas.ts";
import { anexosDe, esModo, leerLevantamiento, seccionesDe } from "../lib/levantamiento.ts";
import { estadoDe, faltanDias, leerVencimiento } from "../lib/vencimientos.ts";

const fd = (campos) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x)); else f.set(k, v);
  }
  return f;
};

test("un vencimiento pide documento y fecha, trae 60 días de aviso y rechaza lo que no vale", () => {
  const ok = leerVencimiento(fd({ nombre: "  Contrato de alquiler ", vence: "2027-03-31" }));
  assert.deepEqual(ok, { nombre: "Contrato de alquiler", vence: "2027-03-31", avisar_dias: 60, documento_id: null, nota: null });
  assert.equal(leerVencimiento(fd({ nombre: "Poder", vence: "2027-01-01", avisar_dias: "15", nota: "Notarizado" })).avisar_dias, 15);
  assert.throws(() => leerVencimiento(fd({ nombre: "", vence: "2027-01-01" })), /qué documento/);
  assert.throws(() => leerVencimiento(fd({ nombre: "X", vence: "2027-02-30" })), /fecha/);
  assert.throws(() => leerVencimiento(fd({ nombre: "X", vence: "2027-02-01", avisar_dias: "400" })), /0 a 365/);
  assert.throws(() => leerVencimiento(fd({ nombre: "X", vence: "2027-02-01", documento_id: "no-es-uuid" })), /archivo/);
});

test("el estado de un vencimiento: vigente, por vencer (dentro de los días de aviso) o vencido", () => {
  assert.equal(estadoDe("2026-12-31", 60, "2026-10-01"), "vigente");
  assert.equal(estadoDe("2026-12-31", 60, "2026-11-20"), "por_vencer");
  assert.equal(estadoDe("2026-12-31", 60, "2026-10-31"), "vigente", "faltan 61 días");
  assert.equal(estadoDe("2026-12-31", 60, "2026-11-01"), "por_vencer", "faltan 60 días: ya entra al aviso");
  assert.equal(estadoDe("2026-11-20", 60, "2026-11-20"), "por_vencer", "vence hoy");
  assert.equal(estadoDe("2026-11-19", 60, "2026-11-20"), "vencido");
  assert.equal(faltanDias("2026-11-30", "2026-11-20"), 10);
});

test("el levantamiento simple trae cinco secciones y ningún anexo; el completo, todo", () => {
  const simple = seccionesDe("simple").map((s) => s.titulo.slice(0, 2));
  assert.deepEqual(simple, ["1.", "2.", "4.", "6.", "9."]);
  assert.equal(anexosDe("simple").length, 0);
  assert.equal(seccionesDe("completo").length, 9);
  assert.ok(anexosDe("completo").length > 0);
  assert.ok(esModo("simple") && esModo("completo") && !esModo("otro"));
});

test("leer un levantamiento simple solo toma sus secciones y no pide anexos", () => {
  const base = { nombre: "Colmado Rosa", rnc: "130000021", ventas_mes: "250000", facturas_mes: "40", empleados_fijos: "3", acepta_nombre: "Rosa Pérez", acepta_cedula: "00100000018", acepta: "on" };
  const r = leerLevantamiento(fd({ ...base, doc_ventas: "Físicas", nom0_nombre: "Juan", costos_directos: "100" }), "simple");
  assert.equal(r.nombre, "Colmado Rosa");
  assert.equal(r.ventas_mes, "250000");
  assert.equal(r.doc_ventas, undefined, "la sección 3 no es del simple");
  assert.equal(r.nom0_nombre, undefined, "sin anexos");
  assert.equal(r.costos_directos, undefined);
  const c = leerLevantamiento(fd({ ...base, doc_ventas: "Físicas", costos_directos: "100" }), "completo");
  assert.equal(c.doc_ventas, "Físicas");
  assert.equal(c.costos_directos, "100");
  assert.throws(() => leerLevantamiento(fd({ ...base, acepta: "" }), "simple"), /información es correcta/);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa, otra;
const leer = (id, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-p2c4-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma p2c4 ${marca}`}) RETURNING id`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Cliente P2c4', '130000052', ${firma}) RETURNING id`;
  [{ id: otra }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Otro P2c4', '130000061', ${firma}) RETURNING id`;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally { await sql.end(); }
});

test("los vencimientos avisan dentro de sus días, urgente si ya vencieron, y se van al renovar o quitar", conBase, async () => {
  const hoy = "2026-11-20";
  await leer(empresa, (tx) => tx`
    INSERT INTO vencimientos_empresa (empresa_id, nombre, vence, avisar_dias) VALUES
      (${empresa}, 'Contrato de alquiler', '2026-12-10', 30), (${empresa}, 'Firma digital', '2027-06-01', 30), (${empresa}, 'Poder vencido', '2026-11-01', 30)`);
  const textos = async () => (await leer(empresa, (tx) => alertasDeEmpresa(tx, { empresaId: empresa, hoy, propia: false }))).filter((a) => a.tipo === "vencimiento");
  const antes = await textos();
  assert.equal(antes.length, 2, "la firma digital está lejos y no avisa");
  assert.match(antes.find((a) => /alquiler/.test(a.texto)).texto, /^Contrato de alquiler: vence el 10\/12\/2026 \(faltan 20 días\)$/);
  const vencido = antes.find((a) => /Poder/.test(a.texto));
  assert.equal(vencido.nivel, "urgente");
  assert.match(vencido.texto, /venció el 01\/11\/2026/);
  assert.match(vencido.enlace, /seccion=vencimientos/);
  await leer(empresa, (tx) => tx`UPDATE vencimientos_empresa SET vence = '2027-11-01' WHERE nombre = 'Poder vencido'`);
  await leer(empresa, (tx) => tx`UPDATE vencimientos_empresa SET activo = false WHERE nombre = 'Contrato de alquiler'`);
  assert.equal((await textos()).length, 0, "renovado y quitado: ya no avisan");
  const hist = await sql`SELECT count(*)::int AS n FROM auditoria WHERE empresa_id = ${empresa} AND tabla = 'vencimientos_empresa'`;
  assert.ok(hist[0].n >= 5, "el historial guarda cada cambio");
});

test("un vencimiento no se ve desde otra empresa ni se liga al archivo de otra", conBase, async () => {
  assert.equal((await leer(otra, (tx) => tx`SELECT 1 FROM vencimientos_empresa`)).length, 0);
  const [{ id: doc }] = await leer(otra, (tx) => tx`
    INSERT INTO documentos (empresa_id, entidad, entidad_id, carpeta, nombre, tipo, tamano, sha256, contenido, subido_por)
    VALUES (${otra}, 'expediente', ${otra}, '01', 'a.pdf', 'application/pdf', 4, ${`h-p2c4-${marca}`}, ${Buffer.from("%PDF")}, ${ana}) RETURNING id`);
  await assert.rejects(() => leer(empresa, (tx) => tx`INSERT INTO vencimientos_empresa (empresa_id, nombre, vence, documento_id) VALUES (${empresa}, 'X', '2027-01-01', ${doc})`), /no es de esta empresa/);
});

test("un formulario nuevo es completo salvo que se pida simple, y no admite otro modo", conBase, async () => {
  const [a] = await leer(empresa, (tx) => tx`INSERT INTO formularios (empresa_id, tipo, creado_por) VALUES (${empresa}, 'levantamiento', ${ana}) RETURNING modo`);
  assert.equal(a.modo, "completo");
  const [b] = await leer(empresa, (tx) => tx`INSERT INTO formularios (empresa_id, tipo, modo, creado_por) VALUES (${empresa}, 'levantamiento', 'simple', ${ana}) RETURNING modo`);
  assert.equal(b.modo, "simple");
  await assert.rejects(() => leer(empresa, (tx) => tx`INSERT INTO formularios (empresa_id, tipo, modo, creado_por) VALUES (${empresa}, 'levantamiento', 'raro', ${ana})`), /check/);
});
