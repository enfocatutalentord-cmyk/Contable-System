// Reglas que hace cumplir la base de datos. Uso: DATABASE_URL=... npm test (base de pruebas, se limpia sola).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
let usuario, empresaA, empresaB, cuentasA, cuentasB;

async function conEmpresa(id, fn) {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
    await tx`SET LOCAL ROLE contable_app`;
    return fn(tx);
  });
}

async function crearEmpresa(nombre) {
  return sql.begin(async (tx) => {
    const [{ id }] = await tx`INSERT INTO empresas (nombre) VALUES (${nombre}) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
    await tx`INSERT INTO miembros (empresa_id, usuario_id, rol) VALUES (${id}, ${usuario}, 'dueno')`;
    const [banco] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, nivel) VALUES (${id}, '110103', 'Banco', 'activo', 4) RETURNING id`;
    const [capital] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, nivel) VALUES (${id}, '310101', 'Capital', 'patrimonio', 4) RETURNING id`;
    const [grupo] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, nivel, de_detalle) VALUES (${id}, '1101', 'Efectivo', 'activo', 3, false) RETURNING id`;
    return { id, cuentas: { banco: banco.id, capital: capital.id, grupo: grupo.id } };
  });
}

let siguiente = 1;
async function asiento(empresa, fecha, lineas) {
  return conEmpresa(empresa, async (tx) => {
    const [{ id }] = await tx`
      INSERT INTO asientos (empresa_id, numero, fecha, concepto, creado_por)
      VALUES (${empresa}, ${siguiente++}, ${fecha}, 'Prueba', ${usuario}) RETURNING id`;
    for (const [i, [cuenta, debe, haber]] of lineas.entries()) {
      await tx`INSERT INTO lineas_asiento (asiento_id, empresa_id, orden, cuenta_id, debe, haber)
               VALUES (${id}, ${empresa}, ${i + 1}, ${cuenta}, ${debe}, ${haber})`;
    }
    return id;
  });
}

before(async () => {
  [{ id: usuario }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`prueba-${Date.now()}@x.do`}, 'Prueba', 'x') RETURNING id`;
  ({ id: empresaA, cuentas: cuentasA } = await crearEmpresa("Empresa A"));
  ({ id: empresaB, cuentas: cuentasB } = await crearEmpresa("Empresa B"));
});

after(async () => {
  // Limpieza: se quita el cierre y se borran las empresas (el borrado en cascada sí puede quitar sus asientos).
  try {
    await sql`UPDATE empresas SET fecha_bloqueo = NULL WHERE id IN (${empresaA}, ${empresaB})`;
    await sql`DELETE FROM empresas WHERE id IN (${empresaA}, ${empresaB})`;
    await sql`DELETE FROM usuarios WHERE id = ${usuario}`;
  } finally {
    await sql.end();
  }
});

test("un asiento que cuadra se registra", async () => {
  await asiento(empresaA, "2026-01-05", [[cuentasA.banco, "1000.00", 0], [cuentasA.capital, 0, "1000.00"]]);
});

test("un asiento que no cuadra se rechaza", async () => {
  await assert.rejects(
    asiento(empresaA, "2026-01-05", [[cuentasA.banco, "1000.00", 0], [cuentasA.capital, 0, "999.99"]]),
    /no cuadra/,
  );
});

test("un asiento de una sola línea se rechaza", async () => {
  await assert.rejects(asiento(empresaA, "2026-01-05", [[cuentasA.banco, "0.00", "0.00"]]), /check|líneas/);
});

test("no se puede usar una cuenta de grupo", async () => {
  await assert.rejects(
    asiento(empresaA, "2026-01-05", [[cuentasA.grupo, "10.00", 0], [cuentasA.capital, 0, "10.00"]]),
    /no es de detalle/,
  );
});

test("no se puede usar una cuenta de otra empresa", async () => {
  await assert.rejects(
    asiento(empresaA, "2026-01-05", [[cuentasB.banco, "10.00", 0], [cuentasA.capital, 0, "10.00"]]),
    /no existe|row-level|violates/,
  );
});

test("una empresa no ve los datos de otra", async () => {
  await asiento(empresaB, "2026-01-06", [[cuentasB.banco, "50.00", 0], [cuentasB.capital, 0, "50.00"]]);
  const vistos = await conEmpresa(empresaA, (tx) => tx`SELECT DISTINCT empresa_id FROM asientos`);
  assert.deepEqual(vistos.map((r) => r.empresa_id), [empresaA]);
  const cuentas = await conEmpresa(empresaA, (tx) => tx`SELECT count(*)::int AS n FROM cuentas WHERE empresa_id = ${empresaB}`);
  assert.equal(cuentas[0].n, 0);
  const empresas = await conEmpresa(empresaA, (tx) => tx`SELECT id FROM empresas`);
  assert.deepEqual(empresas.map((r) => r.id), [empresaA]);
});

test("sin empresa en curso no se ve nada", async () => {
  const filas = await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE contable_app`;
    return tx`SELECT id FROM asientos`;
  });
  assert.equal(filas.length, 0);
});

test("el rol de la app no puede leer contraseñas", async () => {
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`SELECT clave_hash FROM usuarios`), /permission denied/);
});

test("los asientos no se borran", async () => {
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`DELETE FROM asientos`), /permission denied|no se borran/);
  await assert.rejects(sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${empresaA}, true)`;
    await tx`DELETE FROM asientos`;
  }), /no se borran/);
});

test("el período cerrado no acepta asientos nuevos, cambios ni anulaciones", async () => {
  const id = await asiento(empresaA, "2026-02-10", [[cuentasA.banco, "20.00", 0], [cuentasA.capital, 0, "20.00"]]);
  await conEmpresa(empresaA, (tx) => tx`UPDATE empresas SET fecha_bloqueo = '2026-02-28' WHERE id = ${empresaA}`);
  await assert.rejects(
    asiento(empresaA, "2026-02-15", [[cuentasA.banco, "5.00", 0], [cuentasA.capital, 0, "5.00"]]),
    /período está cerrado/,
  );
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`UPDATE asientos SET anulado = true WHERE id = ${id}`), /período está cerrado/);
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`UPDATE asientos SET fecha = '2026-03-01' WHERE id = ${id}`), /período está cerrado/);
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`UPDATE lineas_asiento SET debe = '30.00' WHERE asiento_id = ${id} AND debe > 0`), /período está cerrado/);
  // Después de la fecha de cierre sí se puede.
  await asiento(empresaA, "2026-03-01", [[cuentasA.banco, "5.00", 0], [cuentasA.capital, 0, "5.00"]]);
  // Tampoco se puede mover un asiento abierto hacia el período cerrado.
  const abierto = await asiento(empresaA, "2026-03-02", [[cuentasA.banco, "1.00", 0], [cuentasA.capital, 0, "1.00"]]);
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`UPDATE asientos SET fecha = '2026-02-01' WHERE id = ${abierto}`), /período está cerrado/);
});
