// IR-2 2026, parte 3 (entrega 3): anexos H-1 y H-2. La lectura y la revisión no necesitan base; lo guardado y lo que
// viene de la ficha del cliente sí (crea su propia firma y la borra al final).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { datosSociedad, leerSociedad, revisarSociedad, TABLAS_H } from "../lib/ir2-sociedad.ts";

const fd = (campos) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const textos = (avisos, nivel) => avisos.filter((a) => a.nivel === nivel).map((a) => a.texto);

test("límites de filas del formulario oficial", () => {
  assert.deepEqual(TABLAS_H.map((t) => [t.clave, t.max]), [["B", 15], ["C", 30], ["D", 15], ["E", 5], ["F", 10]]);
});

test("leer: filas vacías fuera, porcentajes normalizados, correo y participación validados", () => {
  const d = leerSociedad(fd({
    A_telefono1: " 809-555-0101 ", A_correo: "info@ferreteria.do", A_calle: "Av.  Duarte", A_municipio: "Santo Domingo Este", A_provincia: "Santo Domingo",
    B0_id: "001-0000001-1", B0_nombre: "Ana Pérez", B0_participacion: "60%", B1_id: "", B1_nombre: "",
    B2_id: "101000001", B2_nombre: "Inversiones SRL", B2_participacion: "40",
    C0_id: "00100000011", C0_nombre: "Ana Pérez", C0_participacion: "60",
    E0_nombre: "Venta de materiales de construcción",
  }));
  assert.equal(typeof d, "object");
  assert.equal(d.contacto.calle, "Av. Duarte", "espacios de más fuera");
  assert.equal(d.contacto.telefono1, "809-555-0101");
  assert.equal(d.B.length, 2, "la fila vacía no se guarda");
  assert.equal(d.B[0].participacion, "60.00");
  assert.equal(d.B[1].nombre, "Inversiones SRL", "las filas guardadas se compactan");
  assert.match(leerSociedad(fd({ A_correo: "sin-arroba" })), /correo/);
  assert.match(leerSociedad(fd({ B0_id: "1", B0_nombre: "X", B0_participacion: "120" })), /porcentaje de 0 a 100/);
  assert.match(leerSociedad(fd({ S_declaracion: "123", S_fecha: "31/12/2025" })), /fecha/);
});

test("revisar: suma de participaciones, persona física con 20 % o más fuera de C, filas incompletas y sin cambios", () => {
  const base = { A_telefono1: "809", A_correo: "a@b.do", A_calle: "C", A_municipio: "M", A_provincia: "P", E0_nombre: "Comercio" };
  const bien = leerSociedad(fd({ ...base, B0_id: "00100000011", B0_nombre: "Ana", B0_participacion: "60", B1_id: "101000001", B1_nombre: "Inversiones SRL", B1_participacion: "40",
    C0_id: "001-0000001-1", C0_nombre: "Ana", C0_participacion: "60" }));
  assert.deepEqual(revisarSociedad(bien), [], "una sociedad (RNC de 9 dígitos) no va en C; Ana está en C");
  const mal = leerSociedad(fd({ ...base, B0_id: "00100000011", B0_nombre: "Ana", B0_participacion: "70", C0_id: "00200000022", C0_nombre: "Luis", C0_participacion: "10", D0_nombre: "Sin cédula" }));
  const avisos = textos(revisarSociedad(mal), "aviso");
  assert.ok(avisos.some((t) => /suma 70.00 %/.test(t)));
  assert.ok(avisos.some((t) => /Ana tiene 70.00 % y parece persona física/.test(t)));
  assert.ok(avisos.some((t) => /Luis tiene menos del 20 %/.test(t)));
  assert.deepEqual(textos(revisarSociedad(mal), "error"), ["H-2 D, fila 1: falta cédula, pasaporte, rnc o identificación tributaria."]);
  // Sin cambios desde la última declaración: no pide el resto, pero sí la fecha.
  assert.deepEqual(revisarSociedad(leerSociedad(fd({ S_declaracion: "IR2-2025-001", S_fecha: "2026-04-28" }))), []);
  assert.equal(textos(revisarSociedad(leerSociedad(fd({ S_declaracion: "IR2-2025-001" }))), "error").length, 1);
});

// ───── Con la base ─────

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, empresa, otra;
const leer = (eid, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${eid}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-ir2h-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  const [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma ir2h ${marca}`}) RETURNING id`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id, telefono, correo, direccion, actividad_economica)
    VALUES ('Ferretería H SRL', '130000009', ${firma}, '809-555-0199', 'ventas@ferreteria-h.do', 'Calle 1 #2', 'Ferretería') RETURNING id`;
  [{ id: otra }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Otra SRL', '130000010', ${firma}) RETURNING id`;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id IN (${empresa}, ${otra})`;
    await sql`DELETE FROM firmas WHERE nombre = ${`Firma ir2h ${marca}`}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("sin guardar: contacto y actividad vienen de la ficha; guardado: se lee igual y queda en el historial y aislado", conBase, async () => {
  const r = await leer(empresa, datosSociedad);
  assert.equal(r.deLaFicha, true);
  assert.equal(r.datos.contacto.telefono1, "809-555-0199");
  assert.equal(r.datos.contacto.correo, "ventas@ferreteria-h.do");
  assert.equal(r.datos.contacto.calle, "Calle 1 #2");
  assert.deepEqual(r.datos.E, [{ nombre: "Ferretería" }]);
  const d = leerSociedad(fd({ A_telefono1: "809-555-0100", B0_id: "00100000011", B0_nombre: "Ana", B0_participacion: "100" }));
  await leer(empresa, (tx) => tx`INSERT INTO sociedad_ir2 (empresa_id, datos, actualizado_por) VALUES (${empresa}, ${tx.json(d)}, ${ana})`);
  const g = await leer(empresa, datosSociedad);
  assert.equal(g.deLaFicha, false);
  assert.equal(g.datos.B[0].nombre, "Ana");
  assert.equal(g.datos.contacto.telefono1, "809-555-0100");
  assert.deepEqual(g.datos.C, []);
  assert.equal((await leer(otra, (tx) => tx`SELECT 1 FROM sociedad_ir2`)).length, 0, "otra empresa no lo ve");
  const [h] = await sql`SELECT count(*)::int AS n FROM auditoria WHERE tabla = 'sociedad_ir2' AND empresa_id = ${empresa}`;
  assert.equal(h.n, 1);
});
