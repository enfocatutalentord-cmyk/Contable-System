// Entrega B · Normas y tasas: la tasa nueva cierra la anterior el día antes sin tocar lo registrado, el calendario fiscal de la firma
// y sus prórrogas mandan en las fechas límite, y los avisos (cambio en 30 días, revisión vencida). Crea su propia firma y la borra.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { agrupar, avisosDeNormas, cargarTasaNueva, diaAntes, estadoVigencia } from "../lib/normas-reglas.ts";

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let firma, empresa;

const en = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));

before(async () => {
  if (!sql) return;
  await sql.begin(async (tx) => {
    [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma normas ${marca}`}) RETURNING id`;
    await tx`SELECT crear_calendario_fiscal(${firma})`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, firma_id) VALUES ('Cliente Normas SRL', ${firma}) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    const ids = new Map();
    for (const [codigo, n] of CATALOGO_RD) {
      const [c] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${empresa}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${ids.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6})
        RETURNING id`;
      ids.set(codigo, c.id);
    }
    await tx`SELECT configurar_cuentas_empresa(${empresa})`;
    await tx`SELECT configurar_tributaria(${empresa})`;
  });
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
  } finally {
    await sql.end();
  }
});

test("una tasa nueva cierra la anterior el día antes y conserva cuentas y códigos", conBase, async () => {
  const [antes] = await en((tx) => tx`SELECT nombre, tasa::text, cuenta_ventas_id, cuenta_compras_id FROM impuestos
    WHERE tipo = 'itbis' AND tasa > 0 AND vigente_hasta IS NULL ORDER BY tasa DESC LIMIT 1`);
  const r = await en((tx) => cargarTasaNueva(tx, { clase: "impuesto", nombre: antes.nombre, nuevoNombre: "ITBIS 19 %", tasa: "19", desde: "2027-01-01", nota: "Prueba" }));
  assert.equal(r, "aplicada");
  const filas = await en((tx) => tx`SELECT nombre, tasa::text, vigente_desde::text AS desde, vigente_hasta::text AS hasta, cuenta_ventas_id, cuenta_compras_id
    FROM impuestos WHERE nombre IN (${antes.nombre}, 'ITBIS 19 %') ORDER BY vigente_desde`);
  assert.equal(filas.length, 2);
  assert.equal(filas[0].hasta, "2026-12-31", "la anterior termina el día antes");
  assert.equal(filas[1].desde, "2027-01-01");
  assert.equal(filas[1].hasta, null);
  assert.equal(Number(filas[1].tasa), 19);
  assert.equal(filas[1].cuenta_ventas_id, antes.cuenta_ventas_id);
  assert.equal(filas[1].cuenta_compras_id, antes.cuenta_compras_id);
  // Repetirla no duplica, y un concepto que no existe no hace nada.
  assert.equal(await en((tx) => cargarTasaNueva(tx, { clase: "impuesto", nombre: antes.nombre, nuevoNombre: "ITBIS 19 %", tasa: "19", desde: "2027-01-01", nota: "x" })), "ya_estaba");
  assert.equal(await en((tx) => cargarTasaNueva(tx, { clase: "impuesto", nombre: "No existe", nuevoNombre: "No existe", tasa: "5", desde: "2027-01-01", nota: "x" })), "sin_concepto");
  // Una fecha anterior al inicio de la tasa ya cargada no se acepta.
  assert.equal(await en((tx) => cargarTasaNueva(tx, { clase: "impuesto", nombre: "ITBIS 19 %", nuevoNombre: "ITBIS 20 %", tasa: "20", desde: "2026-12-01", nota: "x" })), "empieza_despues");
  // Cada cambio queda en el historial del cliente.
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM auditoria WHERE empresa_id = ${empresa} AND tabla = 'impuestos' AND accion IN ('update', 'insert') AND fecha > now() - interval '1 minute'`;
  assert.ok(n >= 2);
});

test("una retención nueva conserva su código del 606 y del IR-17", conBase, async () => {
  const [ret] = await en((tx) => tx`SELECT nombre, codigo_606, codigo_ir17 FROM retenciones WHERE impuesto = 'isr' AND vigente_hasta IS NULL AND codigo_ir17 IS NOT NULL LIMIT 1`);
  assert.ok(ret, "la configuración sugerida trae retenciones de ISR");
  assert.equal(await en((tx) => cargarTasaNueva(tx, { clase: "retencion", nombre: ret.nombre, nuevoNombre: `${ret.nombre} (nueva)`, tasa: "12", desde: "2027-02-01", nota: "x" })), "aplicada");
  const [nueva] = await en((tx) => tx`SELECT codigo_606, codigo_ir17, tasa::text FROM retenciones WHERE nombre = ${`${ret.nombre} (nueva)`}`);
  assert.equal(nueva.codigo_606, ret.codigo_606);
  assert.equal(nueva.codigo_ir17, ret.codigo_ir17);
});

test("el calendario fiscal y las prórrogas dan la fecha límite", conBase, async () => {
  const vence = (f, p) => en(async (tx) => (await tx`SELECT vencimiento_fiscal(${f}, ${p})::text AS v`)[0].v);
  assert.equal(await vence("606", "202610"), "2026-11-15");
  assert.equal(await vence("IT-1", "202610"), "2026-11-20");
  assert.equal(await vence("IR-17", "202610"), "2026-11-10");
  assert.equal(await vence("IR-2", "202612"), "2027-04-30");
  await sql`UPDATE calendario_fiscal SET dia = 31 WHERE firma_id = ${firma} AND formato = '607'`;
  assert.equal(await vence("607", "202601"), "2026-02-28", "si el día no existe, vence el último del mes");
  await sql`INSERT INTO prorrogas_fiscales (firma_id, formato, periodo, vence, motivo) VALUES (${firma}, 'IT-1', '202610', '2026-11-23', 'Feriado')`;
  assert.equal(await vence("IT-1", "202610"), "2026-11-23", "la prórroga manda");
  assert.equal(await vence("IT-1", "202611"), "2026-12-20", "solo en su mes");
});

test("una revisión registrada no se cambia", conBase, async () => {
  const [{ id }] = await sql`INSERT INTO revisiones_normas (firma_id, fecha, revisado) VALUES (${firma}, '2026-11-01', 'Avisos de octubre') RETURNING id`;
  await assert.rejects(sql`UPDATE revisiones_normas SET revisado = 'otra cosa' WHERE id = ${id}`, /no se cambia/);
});

test("agrupar, vigencia y avisos", () => {
  const filas = [{ clase: "impuesto", nombre: "ITBIS", tipo: "itbis", tasa: "18.0000", desde: "2000-01-01", hasta: null, activo: true }];
  const c = agrupar([{ empresa: { id: "a", nombre: "A" }, filas }, { empresa: { id: "b", nombre: "B" }, filas }]);
  assert.equal(c.length, 1);
  assert.equal(c[0].tasa, "18");
  assert.equal(c[0].empresas.length, 2);
  assert.equal(diaAntes("2027-03-01"), "2027-02-28");
  const hoy = "2026-11-07";
  assert.equal(estadoVigencia({ desde: "2026-12-01", hasta: null, activo: true }, hoy), "proxima");
  assert.equal(estadoVigencia({ desde: "2020-01-01", hasta: "2026-06-30", activo: true }, hoy), "cerrada");
  const proxima = { ...c[0], nombre: "ITBIS 19 %", tasa: "19", desde: "2026-12-01" };
  const lejana = { ...c[0], nombre: "ITBIS 20 %", tasa: "20", desde: "2027-06-01" };
  const av = avisosDeNormas({ firmaId: "f", hoy, conceptos: [c[0], proxima, lejana], prorrogas: [], ultimaRevision: "2026-11-01", responsable: "Patricia" });
  assert.equal(av.length, 1, "solo la que cambia en los próximos 30 días");
  assert.match(av[0].texto, /ITBIS 19 %.*19 %.*2 empresas/);
  const sinRevisar = avisosDeNormas({ firmaId: "f", hoy, conceptos: [], prorrogas: [], ultimaRevision: "2026-10-01", responsable: "Patricia" });
  assert.match(sinRevisar[0].texto, /Hace 37 días.*Patricia/);
  assert.equal(sinRevisar[0].nivel, "aviso");
  assert.equal(avisosDeNormas({ firmaId: "f", hoy, conceptos: [], prorrogas: [], ultimaRevision: "2026-08-01", responsable: null })[0].nivel, "urgente");
  assert.match(avisosDeNormas({ firmaId: "f", hoy, conceptos: [], prorrogas: [], ultimaRevision: null, responsable: null })[0].texto, /Aún no/);
  const pr = avisosDeNormas({ firmaId: "f", hoy, conceptos: [], prorrogas: [{ id: "p", formato: "IT-1", periodo: "202610", vence: "2026-11-23", motivo: "Feriado", creado_por: null }], ultimaRevision: hoy, responsable: null });
  assert.match(pr[0].texto, /IT-1 de 10\/2026 vence/);
});
