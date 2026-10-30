// Fase 5, parte 1: cuentas bancarias e importación de estados de cuenta, con la base (crea su propia firma y la borra).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { confirmarImportacion, deshacerImportacion, leerImportacion, listarCuentasBancarias, vistaPrevia } from "../lib/bancos.ts";
import { armarMovimientos } from "../lib/archivos-banco.ts";

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, empresa, cuentas, banco;

function leer(fn) {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
    await tx`SET LOCAL ROLE contable_app`;
    return fn(tx);
  });
}
const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));

const subir = (texto) => leer(async (tx) => {
  const b = Buffer.from(texto);
  const [i] = await tx`INSERT INTO importaciones_banco (empresa_id, cuenta_bancaria_id, nombre, tipo, tamano, sha256, contenido, creado_por)
    VALUES (${empresa}, ${banco}, 'estado.csv', 'csv', ${b.length}, ${createHash("sha256").update(b).digest("hex")}, ${b}, ${ana}) RETURNING id`;
  return i.id;
});

const SEPT = `Fecha;Descripción;Referencia;Débito;Crédito;Balance
30/09/2026;Depósito anterior;100;;5,000.00;105,000.00
01/10/2026;Depósito cliente;101;;20,000.00;125,000.00
02/10/2026;Cargo 0.20% DGII;;40.00;;124,960.00
02/10/2026;Cargo 0.20% DGII;;40.00;;124,920.00
`;
const OCT = `Fecha;Descripción;Referencia;Débito;Crédito;Balance
02/10/2026;Cargo 0.20% DGII;;40.00;;124,960.00
02/10/2026;Cargo 0.20% DGII;;40.00;;124,920.00
03/10/2026;Transferencia a proveedor;9001;10,000.00;;114,920.00
`;

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-bancos-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  await sql.begin(async (tx) => {
    const [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma bancos ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Bancos SRL', '130000002', ${firma}) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    const m = new Map();
    for (const [codigo, n] of CATALOGO_RD) {
      const [c] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${empresa}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${m.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6})
        RETURNING id`;
      m.set(codigo, c.id);
    }
    cuentas = Object.fromEntries(m);
  });
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE nombre = ${`Firma bancos ${marca}`}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("la cuenta del banco debe ser una cuenta de activo de detalle", conBase, async () => {
  await assert.rejects(
    leer((tx) => tx`INSERT INTO cuentas_bancarias (empresa_id, cuenta_id, banco, nombre, fecha_inicial, creado_por)
                    VALUES (${empresa}, ${cuentas["610214"]}, 'Popular', 'Mal', '2026-10-01', ${ana})`),
    /activo de detalle/,
  );
  [{ id: banco }] = await leer((tx) => tx`INSERT INTO cuentas_bancarias (empresa_id, cuenta_id, banco, nombre, numero, saldo_inicial, fecha_inicial, creado_por)
    VALUES (${empresa}, ${cuentas["110103"]}, 'Banco Popular', 'Popular corriente', '1234', '105000.00', '2026-10-01', ${ana}) RETURNING id`);
  const [c] = await leer((tx) => listarCuentasBancarias(tx));
  assert.equal(c.saldo_banco, "105000.00");
  assert.equal(c.saldo_libros, "0.00");
});

test("importar: lo anterior a la fecha inicial no entra; el saldo cuadra con el del banco", conBase, async () => {
  const id = await subir(SEPT);
  const v = await leer(async (tx) => {
    const { filas, formato, cuenta } = await leerImportacion(tx, id);
    return vistaPrevia(tx, cuenta.id, cuenta.fecha_inicial, armarMovimientos(filas, formato));
  });
  assert.deepEqual([v.nuevos, v.repetidos, v.anteriores, v.entradas, v.salidas], [3, 0, 1, 2000000n, 8000n]);
  await leer((tx) => confirmarImportacion(tx, id, ana));
  const [c] = await leer((tx) => listarCuentasBancarias(tx));
  assert.equal(c.saldo_banco, "124920.00", "el saldo inicial más lo importado da el balance que muestra el banco");
  assert.equal(c.pendientes, 3);
  assert.ok(c.formato?.debito === "Débito", "el formato queda guardado en la cuenta");
  await assert.rejects(leer((tx) => confirmarImportacion(tx, id, ana)), /ya no está en borrador/);
});

test("un archivo que se monta sobre el anterior no repite movimientos, aunque haya dos idénticos el mismo día", conBase, async () => {
  const id = await subir(OCT);
  const v = await leer((tx) => confirmarImportacion(tx, id, ana));
  assert.deepEqual([v.nuevos, v.repetidos], [1, 2]);
  const [c] = await leer((tx) => listarCuentasBancarias(tx));
  assert.equal(c.saldo_banco, "114920.00");
  // El mismo archivo otra vez: nada nuevo.
  const otra = await subir(OCT + "\n");
  await assert.rejects(leer((tx) => confirmarImportacion(tx, otra, ana)), /no trae movimientos nuevos/);
});

test("deshacer quita solo los movimientos de ese archivo; no se deshace lo conciliado ni lo de un período cerrado", conBase, async () => {
  const [ultima] = await leer((tx) => tx`SELECT id FROM importaciones_banco WHERE estado = 'importada' ORDER BY creado DESC LIMIT 1`);
  await leer((tx) => deshacerImportacion(tx, ultima.id, ana));
  let [c] = await leer((tx) => listarCuentasBancarias(tx));
  assert.equal(c.saldo_banco, "124920.00");
  const [primera] = await leer((tx) => tx`SELECT id FROM importaciones_banco WHERE estado = 'importada'`);
  await leer((tx) => tx`UPDATE movimientos_banco SET estado = 'conciliado' WHERE importacion_id = ${primera.id} AND monto > 0`);
  await assert.rejects(leer((tx) => deshacerImportacion(tx, primera.id, ana)), /conciliado/);
  await leer((tx) => tx`UPDATE movimientos_banco SET estado = 'pendiente' WHERE importacion_id = ${primera.id}`);
  await sql`UPDATE empresas SET fecha_bloqueo = '2026-10-31' WHERE id = ${empresa}`;
  await assert.rejects(leer((tx) => deshacerImportacion(tx, primera.id, ana)), /período está cerrado/);
  await sql`UPDATE empresas SET fecha_bloqueo = NULL WHERE id = ${empresa}`;
  [c] = await leer((tx) => listarCuentasBancarias(tx));
  assert.equal(c.pendientes, 3);
});

test("aislamiento: otra empresa no ve las cuentas ni los movimientos", conBase, async () => {
  const otra = await sql.begin(async (tx) => {
    const [{ id }] = await tx`INSERT INTO empresas (nombre, firma_id) SELECT 'Otra', firma_id FROM empresas WHERE id = ${empresa} RETURNING id`;
    return id;
  });
  const n = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${otra}, true)`;
    await tx`SET LOCAL ROLE contable_app`;
    return (await tx`SELECT (SELECT count(*) FROM cuentas_bancarias)::int + (SELECT count(*) FROM movimientos_banco)::int AS n`)[0].n;
  });
  assert.equal(n, 0);
  await sql`DELETE FROM empresas WHERE id = ${otra}`;
});
