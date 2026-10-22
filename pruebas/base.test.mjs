// Reglas que hace cumplir la base de datos. Uso: DATABASE_URL=... npm test (base de pruebas, se limpia sola).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
let usuario, empresaA, empresaB, cuentasA, cuentasB;

async function conEmpresa(id, fn) {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
    await tx`SELECT set_config('app.usuario_id', ${usuario}, true)`;
    await tx`SET LOCAL ROLE contable_app`;
    return fn(tx);
  });
}

async function crearEmpresa(nombre) {
  return sql.begin(async (tx) => {
    const [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${"Firma " + nombre}) RETURNING id`;
    await tx`SELECT crear_perfiles_firma(${firma})`;
    const [{ id: perfil }] = await tx`SELECT id FROM perfiles WHERE firma_id = ${firma} AND nombre = 'Administrador'`;
    const [{ id }] = await tx`INSERT INTO empresas (nombre, firma_id) VALUES (${nombre}, ${firma}) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
    await tx`INSERT INTO miembros (empresa_id, usuario_id, perfil_id) VALUES (${id}, ${usuario}, ${perfil})`;
    const [banco] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, nivel) VALUES (${id}, '110103', 'Banco', 'activo', 4) RETURNING id`;
    const [capital] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, nivel) VALUES (${id}, '310101', 'Capital', 'patrimonio', 4) RETURNING id`;
    const [grupo] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, nivel, de_detalle) VALUES (${id}, '1101', 'Efectivo', 'activo', 3, false) RETURNING id`;
    return { id, cuentas: { banco: banco.id, capital: capital.id, grupo: grupo.id } };
  });
}

let siguiente = 1;
// Crea el asiento como borrador y, salvo que se pida lo contrario, lo contabiliza (como hace la app).
async function asiento(empresa, fecha, lineas, { contabilizar = true, revierteA = null } = {}) {
  return conEmpresa(empresa, async (tx) => {
    const [{ id }] = await tx`
      INSERT INTO asientos (empresa_id, fecha, concepto, creado_por, revierte_a)
      VALUES (${empresa}, ${fecha}, 'Prueba', ${usuario}, ${revierteA}) RETURNING id`;
    for (const [i, [cuenta, debe, haber]] of lineas.entries()) {
      await tx`INSERT INTO lineas_asiento (asiento_id, empresa_id, orden, cuenta_id, debe, haber)
               VALUES (${id}, ${empresa}, ${i + 1}, ${cuenta}, ${debe}, ${haber})`;
    }
    if (contabilizar) {
      await tx`UPDATE asientos SET estado = 'contabilizado', numero = ${siguiente++}, aprobado_por = ${usuario}, aprobado_en = now()
               WHERE id = ${id}`;
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
    await sql`DELETE FROM firmas WHERE nombre IN ('Firma Empresa A', 'Firma Empresa B')`;
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

test("los asientos contabilizados no se borran", async () => {
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`DELETE FROM asientos WHERE estado = 'contabilizado'`), /no se borran/);
});

test("un borrador puede guardarse sin cuadrar, pero no contabilizarse", async () => {
  const id = await asiento(empresaA, "2026-01-07", [[cuentasA.banco, "10.00", 0]], { contabilizar: false });
  await assert.rejects(
    conEmpresa(empresaA, (tx) => tx`UPDATE asientos SET estado = 'contabilizado', numero = 999 WHERE id = ${id}`),
    /líneas|no cuadra/,
  );
  // Y un borrador sí se puede descartar (queda en el historial).
  await conEmpresa(empresaA, (tx) => tx`DELETE FROM asientos WHERE id = ${id}`);
  const [h] = await conEmpresa(empresaA, (tx) => tx`SELECT count(*)::int AS n FROM auditoria WHERE registro_id = ${id} AND accion = 'delete'`);
  assert.equal(h.n, 1);
});

test("lo contabilizado no se edita ni vuelve a borrador", async () => {
  const id = await asiento(empresaA, "2026-01-08", [[cuentasA.banco, "7.00", 0], [cuentasA.capital, 0, "7.00"]]);
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`UPDATE asientos SET concepto = 'Cambiado' WHERE id = ${id}`), /no se puede modificar/);
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`UPDATE asientos SET estado = 'borrador' WHERE id = ${id}`), /no vuelve a borrador/);
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`UPDATE lineas_asiento SET debe = '8.00' WHERE asiento_id = ${id} AND debe > 0`), /no se pueden modificar/);
  await assert.rejects(
    conEmpresa(empresaA, (tx) => tx`INSERT INTO lineas_asiento (asiento_id, empresa_id, orden, cuenta_id, debe, haber)
                                    VALUES (${id}, ${empresaA}, 9, ${cuentasA.banco}, 1, 0)`),
    /no se pueden modificar/,
  );
});

test("la reversión queda enlazada y solo se puede revertir una vez", async () => {
  const id = await asiento(empresaA, "2026-01-09", [[cuentasA.banco, "3.00", 0], [cuentasA.capital, 0, "3.00"]]);
  await asiento(empresaA, "2026-01-10", [[cuentasA.banco, 0, "3.00"], [cuentasA.capital, "3.00", 0]], { revierteA: id });
  await assert.rejects(
    asiento(empresaA, "2026-01-10", [[cuentasA.banco, 0, "3.00"], [cuentasA.capital, "3.00", 0]], { revierteA: id }),
    /duplicate key|unique/,
  );
});

test("el historial guarda quién, cuándo, antes y después", async () => {
  const id = await asiento(empresaA, "2026-01-11", [[cuentasA.banco, "2.00", 0], [cuentasA.capital, 0, "2.00"]], { contabilizar: false });
  await conEmpresa(empresaA, (tx) => tx`UPDATE asientos SET concepto = 'Concepto corregido' WHERE id = ${id}`);
  const filas = await conEmpresa(empresaA, (tx) => tx`
    SELECT accion, usuario_id, antes->>'concepto' AS antes, despues->>'concepto' AS despues
      FROM auditoria WHERE tabla = 'asientos' AND registro_id = ${id} ORDER BY id`);
  assert.deepEqual(filas.map((f) => f.accion), ["insert", "update"]);
  assert.equal(filas[1].antes, "Prueba");
  assert.equal(filas[1].despues, "Concepto corregido");
  assert.ok(filas.every((f) => f.usuario_id === usuario));
  // Las líneas quedan ligadas a su asiento.
  const [l] = await conEmpresa(empresaA, (tx) => tx`SELECT count(*)::int AS n FROM auditoria WHERE tabla = 'lineas_asiento' AND padre_id = ${id}`);
  assert.equal(l.n, 2);
  // Nadie puede alterar el historial.
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`DELETE FROM auditoria`), /permission denied/);
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`UPDATE auditoria SET accion = 'insert'`), /permission denied/);
  // Y una empresa no ve el historial de otra.
  const otros = await conEmpresa(empresaB, (tx) => tx`SELECT count(*)::int AS n FROM auditoria WHERE empresa_id = ${empresaA}`);
  assert.equal(otros[0].n, 0);
});

test("los documentos se aíslan por empresa y no se borran", async () => {
  const id = await asiento(empresaA, "2026-01-12", [[cuentasA.banco, "1.00", 0], [cuentasA.capital, 0, "1.00"]]);
  const [{ id: doc }] = await conEmpresa(empresaA, (tx) => tx`
    INSERT INTO documentos (empresa_id, entidad, entidad_id, nombre, tipo, tamano, sha256, contenido, subido_por)
    VALUES (${empresaA}, 'asiento', ${id}, 'f.pdf', 'application/pdf', 4, 'abc', ${Buffer.from("%PDF")}, ${usuario}) RETURNING id`);
  const vistos = await conEmpresa(empresaB, (tx) => tx`SELECT id FROM documentos`);
  assert.equal(vistos.length, 0);
  await assert.rejects(conEmpresa(empresaA, (tx) => tx`DELETE FROM documentos WHERE id = ${doc}`), /permission denied/);
  await assert.rejects(
    conEmpresa(empresaA, (tx) => tx`
      INSERT INTO documentos (empresa_id, entidad, entidad_id, nombre, tipo, tamano, sha256, contenido, subido_por)
      VALUES (${empresaA}, 'asiento', ${id}, 'x.exe', 'application/x-msdownload', 4, 'def', ${Buffer.from("MZ")}, ${usuario})`),
    /check/,
  );
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
