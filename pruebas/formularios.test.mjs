// Bloque 6, entrega 6a: formularios en línea (Ficha de Registro, Constitución, Solicitud de Servicio). Validación de lo que envía
// el cliente, enlace por su hash, recepción, revisión antes de cargar a la ficha y solicitudes. Crea su propia firma y la borra.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { db } from "../lib/db.ts";
import {
  aceptarFormulario, cambiarSolicitud, formularioPorToken, leerRespuestas, nuevoToken, ponerEnlace, recibirFormulario,
} from "../lib/formularios.ts";

const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

test("lo que envía el cliente se valida con las reglas de la ficha", () => {
  assert.throws(() => leerRespuestas("ficha", fd({})), /razón social/);
  assert.throws(() => leerRespuestas("ficha", fd({ nombre: "Colmado X", s0_nombre: "Ana", s0_porcentaje: "60" })), /suman 60.00 %/);
  const r = leerRespuestas("ficha", fd({ nombre: "Colmado X SRL", rnc: "1-30-00004-8", s0_nombre: "Ana", s0_porcentaje: "100", campo_raro: "x" }));
  assert.deepEqual(Object.keys(r).sort(), ["nombre", "rnc", "s0_nombre", "s0_porcentaje"], "los campos que no son del formulario se ignoran");
  assert.throws(() => leerRespuestas("constitucion", fd({ n1: "Nueva SRL", capital_social: "50,000", s0_nombre: "Ana", s0_porcentaje: "100", c_gerente_nombre: "Ana" })),
    /al menos RD\$100,000/);
  assert.throws(() => leerRespuestas("solicitud", fd({ prioridad: "alta" })), /Describa/);
  assert.throws(() => leerRespuestas("solicitud", fd({ descripcion: "Carta", servicio_id: "00000000-0000-0000-0000-000000000000" }), new Map()), /Elija el servicio/);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa;

const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const nuevo = async (tipo) => {
  const [{ id }] = await leer((tx) => tx`INSERT INTO formularios (empresa_id, tipo, creado_por) VALUES (${empresa}, ${tipo}, ${ana}) RETURNING id`);
  const token = nuevoToken();
  await leer((tx) => ponerEnlace(tx, id, token));
  return { id, token };
};
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-form-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma formularios ${marca}`}) RETURNING id`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (nombre, firma_id, telefono) VALUES ('Cliente nuevo', ${firma}, '809-555-0000') RETURNING id`;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
    await db().end();
  }
});

test("Ficha de Registro: el enlace la abre, se recibe una vez y al aceptar carga solo lo marcado", conBase, async () => {
  const { id, token } = await nuevo("ficha");
  assert.equal(await formularioPorToken("no-existe-este-enlace-1234567"), null);
  const f = await formularioPorToken(token);
  assert.equal(f?.id, id);
  const r = leerRespuestas("ficha", fd({
    nombre: "Colmado El Sol SRL", rnc: "130000040", municipio: "Higüey", s0_nombre: "Ana Pérez", s0_cedula: "00112345678", s0_porcentaje: "60",
    s1_nombre: "Luis Gómez", s1_porcentaje: "40", c_principal_nombre: "Ana Pérez", c_principal_whatsapp: "8095551234", ventas_mes: "300,000",
  }));
  await leer((tx) => recibirFormulario(tx, f, r, [{ nombre: "rnc.pdf", bytes: PDF }]));
  await assert.rejects(leer((tx) => recibirFormulario(tx, f, r, [])), /ya se envió/);
  const [{ estado }] = await sql`SELECT estado FROM formularios WHERE id = ${id}`;
  assert.equal(estado, "recibido");
  const [e0] = await sql`SELECT nombre FROM empresas WHERE id = ${empresa}`;
  assert.equal(e0.nombre, "Cliente nuevo", "nada entra a la ficha sin revisar");

  await leer((tx) => aceptarFormulario(tx, { formularioId: id, empresaId: empresa, secciones: ["empresa", "socios", "contactos", "adjuntos"], usuarioId: ana }));
  const [e] = await sql`SELECT nombre, rnc, telefono, municipio FROM empresas WHERE id = ${empresa}`;
  assert.deepEqual({ ...e }, { nombre: "Colmado El Sol SRL", rnc: "130000040", telefono: "809-555-0000", municipio: null },
    "el teléfono que no llenó se queda; la sociedad no se marcó");
  const socios = await leer((tx) => tx`SELECT nombre, cedula, porcentaje::text FROM socios_empresa ORDER BY orden`);
  assert.deepEqual(socios.map((s) => [s.nombre, s.cedula, s.porcentaje]), [["Ana Pérez", "001-1234567-8", "60.00"], ["Luis Gómez", null, "40.00"]]);
  const [c] = await leer((tx) => tx`SELECT nombre, whatsapp FROM contactos_empresa WHERE rol = 'principal'`);
  assert.equal(c.whatsapp, "8095551234");
  const [d] = await leer((tx) => tx`SELECT entidad, carpeta FROM documentos WHERE nombre = 'rnc.pdf'`);
  assert.deepEqual({ ...d }, { entidad: "expediente", carpeta: "01" }, "el adjunto pasa al expediente");
  // El mismo archivo otra vez: no se repite en el expediente.
  const otra = await nuevo("ficha");
  const fo = await formularioPorToken(otra.token);
  await leer((tx) => recibirFormulario(tx, fo, { nombre: "Colmado El Sol SRL" }, [{ nombre: "rnc-otra-vez.pdf", bytes: PDF }]));
  await leer((tx) => aceptarFormulario(tx, { formularioId: otra.id, empresaId: empresa, secciones: ["adjuntos"], usuarioId: ana }));
  const [{ n }] = await leer((tx) => tx`SELECT count(*)::int AS n FROM documentos WHERE entidad = 'expediente' AND NOT eliminado`);
  assert.equal(n, 1);
  const g = await leer((tx) => tx`SELECT descripcion FROM gestiones WHERE origen = 'formulario'`);
  assert.ok(g.every((x) => x.descripcion === "Ficha de Registro recibida del cliente por el formulario en línea") && g.length === 2);
  assert.equal(await formularioPorToken(token).then((x) => x?.estado), "aceptado");
});

test("Constitución: al aceptar abre la lista de pasos con los nombres propuestos; la solicitud entra directo", conBase, async () => {
  const c = await nuevo("constitucion");
  const f = await formularioPorToken(c.token);
  const r = leerRespuestas("constitucion", fd({ n1: "Sol Naciente SRL", n2: "Sol Nuevo SRL", capital_social: "100,000", s0_nombre: "Ana Pérez",
    s0_porcentaje: "100", c_gerente_nombre: "Ana Pérez", tiene_tss: "si" }));
  await leer((tx) => recibirFormulario(tx, f, r, []));
  await leer((tx) => aceptarFormulario(tx, { formularioId: c.id, empresaId: empresa, secciones: [], usuarioId: ana }));
  const [p] = await leer((tx) => tx`SELECT nota FROM pasos_constitucion WHERE paso = 1`);
  assert.equal(p.nota, "Nombres propuestos: Sol Naciente SRL / Sol Nuevo SRL");
  const [e] = await sql`SELECT capital_social::text, tiene_tss, en_constitucion FROM empresas WHERE id = ${empresa}`;
  assert.deepEqual({ ...e }, { capital_social: "100000.00", tiene_tss: true, en_constitucion: true });

  const s = await nuevo("solicitud");
  const fs = await formularioPorToken(s.token);
  await leer((tx) => recibirFormulario(tx, fs, leerRespuestas("solicitud", fd({ descripcion: "Carta de ingresos para el banco", fecha_requerida: "2026-11-12", prioridad: "alta" })), []));
  const [sol] = await leer((tx) => tx`SELECT id, origen, estado, prioridad FROM solicitudes`);
  assert.deepEqual([sol.origen, sol.estado, sol.prioridad], ["formulario", "recibida", "alta"]);
  await leer((tx) => cambiarSolicitud(tx, sol.id, "en_proceso"));
  await assert.rejects(leer((tx) => cambiarSolicitud(tx, sol.id, "recibida")), /no es posible/);
  await leer((tx) => cambiarSolicitud(tx, sol.id, "entregada"));
  const g = await leer((tx) => tx`SELECT origen FROM gestiones WHERE origen IN ('solicitud', 'solicitud_entrega') ORDER BY origen`);
  assert.deepEqual(g.map((x) => x.origen), ["solicitud", "solicitud_entrega"]);
});
