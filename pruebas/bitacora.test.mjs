// Bloque 3, entrega 3a: bitácora (a mano y sola), notificaciones de pago y rol Coordinadora. Crea su propia firma y la borra.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { cambiarNotificacion, ErrorBitacora, leerGestion, leerNotificacion, moverMes, nombreMes, porVencer } from "../lib/bitacora.ts";
import { emitir, guardarBorradorFactura } from "../lib/ventas.ts";

const fd = (c) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };

test("gestión del formulario: tipo, descripción, fechas y estado", () => {
  assert.deepEqual(leerGestion(fd({ tipo: "tramite", descripcion: "  Certificación   DGII ", estado: "pendiente", entrega: "2026-11-10" }), "2026-11-05"),
    { fecha: "2026-11-05", tipo: "tramite", descripcion: "Certificación DGII", responsableId: null, entrega: "2026-11-10", estado: "pendiente" });
  assert.throws(() => leerGestion(fd({ tipo: "x", descripcion: "a" }), "2026-11-05"), /tipo de gestión/);
  assert.throws(() => leerGestion(fd({ tipo: "llamada", descripcion: "" }), "2026-11-05"), /Escribe qué se hizo/);
  assert.throws(() => leerGestion(fd({ tipo: "llamada", descripcion: "a", entrega: "10/11/2026" }), "2026-11-05"), ErrorBitacora);
});

test("notificación del formulario y aviso a 3 días", () => {
  assert.deepEqual(leerNotificacion(fd({ tipo: "tss", periodo: "2026-10", monto: "12,450", fecha_limite: "2026-11-03" })),
    { tipo: "tss", periodo: "202610", concepto: null, monto: "12450.00", fechaLimite: "2026-11-03" });
  assert.throws(() => leerNotificacion(fd({ tipo: "ir", periodo: "2026-10", monto: "1", fecha_limite: "2026-11-03" })), /TSS o de la DGII/);
  const n = (fecha_limite, estado = "pendiente") => porVencer({ fecha_limite, estado }, "2026-11-05");
  assert.equal(n("2026-11-04"), "vencida");
  assert.equal(n("2026-11-08"), "por_vencer", "faltan 3 días");
  assert.equal(n("2026-11-09"), null, "faltan 4 días");
  assert.equal(n("2026-11-04", "pagada"), null, "pagada no avisa");
  assert.equal(nombreMes("2026-11"), "noviembre 2026");
  assert.equal(moverMes("2026-01", -1), "2025-12");
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa, otra;

const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));
const leer = (eid, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${eid}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
async function crear(nombre) {
  return sql.begin(async (tx) => {
    const [{ id }] = await tx`INSERT INTO empresas (nombre, firma_id) VALUES (${nombre}, ${firma}) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
    const ids = new Map();
    for (const [codigo, n] of CATALOGO_RD) {
      const [c] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${id}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${ids.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6}) RETURNING id`;
      ids.set(codigo, c.id);
    }
    await tx`SELECT configurar_cuentas_empresa(${id})`;
    await tx`SELECT configurar_tributaria(${id})`;
    return id;
  });
}
const gestiones = (eid) => leer(eid, (tx) => tx`SELECT tipo, origen, descripcion FROM gestiones ORDER BY creado`);

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-bitacora-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma bitácora ${marca}`}) RETURNING id`;
  await sql`SELECT crear_perfiles_firma(${firma})`;
  empresa = await crear("Ferretería Bitácora SRL");
  otra = await crear("Otra Bitácora SRL");
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM perfiles WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("la bitácora se llena sola: factura emitida, declaración presentada y notificación enviada, sin repetir", conBase, async () => {
  await leer(empresa, async (tx) => {
    const [i] = await tx`SELECT id FROM impuestos WHERE nombre = 'ITBIS 18 %'`;
    const [c] = await tx`INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion) VALUES (${empresa}, 'Cliente Bitácora', '130000061', 'rnc') RETURNING id`;
    await tx`INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence) VALUES (${empresa}, 'B01', 1, 100, 1, '2027-12-31')`;
    const f = await guardarBorradorFactura(tx, {
      empresaId: empresa, usuarioId: ana, clienteId: c.id, tipo: "B01", fecha: "2026-11-05", vence: "2026-11-05", moneda: "DOP", tasa: 10000n, notas: null,
      lineas: [{ servicioId: null, descripcion: "Asesoría", cantidad: 10000n, precio: 1000000n, impuestoIds: [i.id] }],
    });
    await emitir(tx, { empresaId: empresa, usuarioId: ana, facturaId: f });
    await tx`INSERT INTO envios_dgii (empresa_id, formato, periodo, referencia, huella, registros, enviado_por)
             VALUES (${empresa}, '606', '202610', 'OV-123', 'x', 3, ${ana})`;
    const [n] = await tx`INSERT INTO notificaciones_pago (empresa_id, tipo, periodo, monto, fecha_limite, creado_por)
                         VALUES (${empresa}, 'tss', '202610', 12450, '2026-11-03', ${ana}) RETURNING id`;
    await cambiarNotificacion(tx, n.id, "enviada", ana);
    await cambiarNotificacion(tx, n.id, "pendiente", ana);
    await cambiarNotificacion(tx, n.id, "enviada", ana);
    await assert.rejects(cambiarNotificacion(tx, n.id, "enviada", ana), /no es posible/);
  });
  const g = await gestiones(empresa);
  assert.deepEqual(g.map((x) => [x.tipo, x.origen]), [["factura", "factura"], ["declaracion", "declaracion"], ["notificacion", "notificacion"]],
    "una sola anotación aunque la notificación se haya vuelto a enviar");
  assert.match(g[0].descripcion, /^Factura B0100000001 a Cliente Bitácora por RD\$11,800\.00$/);
  assert.equal(g[1].descripcion, "Declaración 606 de 10/2026 marcada como presentada (ref. OV-123)");
  assert.match(g[2].descripcion, /TSS de 10\/2026 por RD\$12,450\.00 enviada al cliente \(vence el 03\/11\/2026\)/);
  const [r] = await leer(empresa, (tx) => tx`SELECT responsable_id FROM gestiones LIMIT 1`);
  assert.equal(r.responsable_id, ana, "el responsable es quien lo hizo");
});

test("aislamiento: otra empresa no ve la bitácora ni las notificaciones", conBase, async () => {
  assert.equal((await gestiones(otra)).length, 0);
  assert.equal((await leer(otra, (tx) => tx`SELECT 1 FROM notificaciones_pago`)).length, 0);
  await assert.rejects(leer(otra, (tx) => tx`INSERT INTO gestiones (empresa_id, tipo, descripcion) VALUES (${empresa}, 'otro', 'x')`), /row-level security/);
});

test("rol Coordinadora: sin aprobar declaraciones ni precios", conBase, async () => {
  const [p] = await sql`SELECT permisos, pestanas FROM perfiles WHERE firma_id = ${firma} AND nombre = 'Coordinadora'`;
  assert.ok(p, "existe en la firma");
  assert.ok(!p.permisos.includes("impuestos") && !p.permisos.includes("catalogo") && !p.permisos.includes("empresa"));
  assert.ok(p.pestanas.includes("/bitacora") && p.pestanas.includes("/notificaciones") && p.pestanas.includes("/igualas"));
  assert.ok(!p.pestanas.includes("/servicios"), "no ve la lista de precios para cambiarla");
});
