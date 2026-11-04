// Bloque 1, entrega 1a: ficha única del cliente. Lectura y validación sin base; guardado, aislamiento y paso de los socios
// al anexo H-1 del IR-2 con la base (crea su propia firma y la borra al final).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import {
  categoriaSugerida, cedula, ErrorFicha, guardarContactos, guardarEmpleados, guardarSocios, leerContactos, leerEmpleados, leerFicha, leerRelacion, leerSocios,
} from "../lib/ficha.ts";
import { datosSociedad } from "../lib/ir2-sociedad.ts";

const fd = (campos) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const P = (pesos) => BigInt(pesos) * 100n;

test("categoría por dos de tres criterios (ventas, facturas y empleados al mes)", () => {
  assert.equal(categoriaSugerida({ ventas: P(400000), facturas: 40, empleados: 3 }), "pequena");
  assert.equal(categoriaSugerida({ ventas: P(500000), facturas: 50, empleados: 30 }), "pequena", "500,000 y 50 todavía son pequeña");
  assert.equal(categoriaSugerida({ ventas: P(500001), facturas: 120, empleados: 3 }), "mediana", "dos de tres en mediana");
  assert.equal(categoriaSugerida({ ventas: P(3000000), facturas: 250, empleados: 10 }), "grande");
  assert.equal(categoriaSugerida({ ventas: P(100000), facturas: 100, empleados: 30 }), null, "los tres distintos: no se sugiere");
  assert.equal(categoriaSugerida({ ventas: P(100000), facturas: null, empleados: null }), null, "con un solo dato no alcanza");
  assert.equal(categoriaSugerida({ ventas: null, facturas: 300, empleados: 25 }), "grande", "dos datos que coinciden bastan");
});

test("cédula: 11 dígitos con o sin guiones; pasaporte con letras tal cual", () => {
  assert.equal(cedula("00100000011", "x"), "001-0000001-1");
  assert.equal(cedula("402-2299374-9", "x"), "402-2299374-9");
  assert.equal(cedula("ab123456", "x"), "AB123456");
  assert.equal(cedula(null, "x"), null);
  assert.throws(() => cedula("123", "Socio 1"), /Socio 1: la cédula debe tener 11 dígitos/);
});

test("socios: filas vacías fuera, cuotas que suman 100 %, nombre obligatorio", () => {
  const s = leerSocios(fd({ s0_nombre: "Ana Pérez", s0_cedula: "00100000011", s0_porcentaje: "60", s2_nombre: "Luis Gómez", s2_porcentaje: "40%" }));
  assert.deepEqual(s.map((x) => [x.nombre, x.cedula, x.porcentaje]), [["Ana Pérez", "001-0000001-1", "60.00"], ["Luis Gómez", null, "40.00"]]);
  assert.throws(() => leerSocios(fd({ s0_nombre: "Ana", s0_porcentaje: "60" })), /suman 60.00 %; deben sumar 100 %/);
  assert.throws(() => leerSocios(fd({ s0_cedula: "00100000011", s0_porcentaje: "100" })), /Socio 1: falta el nombre/);
  assert.deepEqual(leerSocios(fd({})), [], "sin socios no hay error");
});

test("contactos, relación con Empire y empleados: validaciones", () => {
  const c = leerContactos(fd({ c_principal_nombre: "María", c_principal_correo: "maria@cliente.do", c_principal_nacimiento: "1990-05-12", grupo_whatsapp: "Contabilidad Ferretería" }));
  assert.equal(c.contactos.length, 1);
  assert.equal(c.contactos[0].rol, "principal");
  assert.equal(c.grupo_whatsapp, "Contabilidad Ferretería");
  assert.throws(() => leerContactos(fd({ c_gerente_nombre: "Pedro", c_gerente_correo: "sin-arroba" })), /Gerente: el correo no es válido/);
  assert.throws(() => leerContactos(fd({ c_alterno_telefono: "809" })), /Contacto alterno: falta el nombre/);
  const r = leerRelacion(fd({ categoria: "mediana", tipo_cliente: "iguala", dia_facturacion: "30", modalidad: "aplicacion", ficha_firmada: "2026-10-01" }));
  assert.equal(r.estado_cliente, "activo", "sin estado, activo");
  assert.equal(r.dia_facturacion, 30);
  assert.throws(() => leerRelacion(fd({ dia_facturacion: "32" })), ErrorFicha);
  assert.throws(() => leerRelacion(fd({ categoria: "enorme" })), /Categoría: opción no válida/);
  const e = leerEmpleados(fd({ p0_nombre: "José", p0_sueldo: "35,000", p0_fecha_ingreso: "2025-02-01" }));
  assert.equal(e[0].sueldo, "35000.00");
  assert.throws(() => leerEmpleados(fd({ p0_nombre: "José", p0_fecha_ingreso: "01/02/2025" })), /Empleado 1: la fecha no es válida/);
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
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-ficha-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  const [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma ficha ${marca}`}) RETURNING id`;
  [{ id: empresa }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id, municipio, provincia, ventas_mes, facturas_mes, empleados_mes)
    VALUES ('Ferretería Ficha SRL', '130000014', ${firma}, 'Higüey', 'La Altagracia', 600000, 80, 4) RETURNING id`;
  [{ id: otra }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Otra Ficha SRL', '130000015', ${firma}) RETURNING id`;
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id IN (${empresa}, ${otra})`;
    await sql`DELETE FROM firmas WHERE nombre = ${`Firma ficha ${marca}`}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("guardar y leer la ficha: socios, contactos y empleados aislados por cliente, con historial y categoría sugerida", conBase, async () => {
  await leer(empresa, async (tx) => {
    await guardarSocios(tx, empresa, leerSocios(fd({ s0_nombre: "Ana Pérez", s0_cedula: "00100000011", s0_porcentaje: "70", s1_nombre: "Inversiones SRL", s1_porcentaje: "30" })));
    await guardarContactos(tx, empresa, leerContactos(fd({ c_representante_nombre: "Ana Pérez", c_representante_cedula: "00100000011", grupo_whatsapp: "Ferretería · Contabilidad" })));
    await guardarEmpleados(tx, empresa, leerEmpleados(fd({ p0_nombre: "José", p0_sueldo: "35000" })));
  });
  const r = await leer(empresa, (tx) => leerFicha(tx, empresa, true));
  assert.equal(r.socios.length, 2);
  assert.equal(r.contactos[0].rol, "representante");
  assert.equal(r.ficha.grupo_whatsapp, "Ferretería · Contabilidad");
  assert.equal(r.empleados[0].sueldo, "35000.00");
  assert.equal(r.sugerida, "mediana", "ventas de 600,000 y 80 facturas: mediana");
  assert.equal(r.formalizado, false);
  assert.deepEqual((await leer(empresa, (tx) => leerFicha(tx, empresa, false))).empleados, [], "sin el permiso no se leen los empleados");
  assert.equal((await leer(otra, (tx) => tx`SELECT 1 FROM socios_empresa`)).length, 0, "otra empresa no ve los socios");
  const [h] = await sql`SELECT count(*)::int AS n FROM auditoria WHERE empresa_id = ${empresa} AND tabla IN ('socios_empresa', 'contactos_empresa', 'empleados_empresa')`;
  assert.equal(h.n, 4, "cada fila nueva queda en el historial");
  // Guardar de nuevo reemplaza la lista.
  await leer(empresa, (tx) => guardarSocios(tx, empresa, leerSocios(fd({ s0_nombre: "Ana Pérez", s0_porcentaje: "100" }))));
  assert.equal((await leer(empresa, (tx) => leerFicha(tx, empresa, true))).socios.length, 1);
});

test("anexo H-1 del IR-2: sin nada guardado, los accionistas, municipio y provincia salen de la ficha", conBase, async () => {
  await leer(empresa, (tx) => guardarSocios(tx, empresa, leerSocios(fd({ s0_nombre: "Ana Pérez", s0_cedula: "00100000011", s0_porcentaje: "70", s1_nombre: "Inversiones SRL", s1_porcentaje: "30" }))));
  const { datos } = await leer(empresa, datosSociedad);
  assert.deepEqual(datos.B, [{ nombre: "Ana Pérez", id: "001-0000001-1", participacion: "70.00" }, { nombre: "Inversiones SRL", participacion: "30.00" }]);
  assert.equal(datos.contacto.municipio, "Higüey");
  assert.equal(datos.contacto.provincia, "La Altagracia");
});
