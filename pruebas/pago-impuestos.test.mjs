// Prioridad 2.2 (P2e): el pago de un impuesto del cliente con su comprobante y, si Empire lo adelantó, el cargo por cobrar en las cuentas por cobrar
// de Empire (sin comprobante fiscal) que se cobra con su recibo. Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { cobrarCargo, leerPagoImpuesto, listarCargos, registrarCargo } from "../lib/cargos.ts";

const fd = (campos) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const CUENTA = "11111111-2222-4333-8444-555555555555";

test("el pago pide quién pagó, la fecha (no futura) y, si lo adelantó Empire, de qué cuenta salió", () => {
  assert.deepEqual(leerPagoImpuesto(fd({ quien: "cliente", fecha: "2026-11-10", referencia: " TRX 123 " }), "2026-11-20"),
    { quien: "cliente", fecha: "2026-11-10", referencia: "TRX 123", cuentaPagoId: null });
  assert.equal(leerPagoImpuesto(fd({ quien: "empire", fecha: "2026-11-20", cuenta_pago: CUENTA }), "2026-11-20").cuentaPagoId, CUENTA);
  assert.throws(() => leerPagoImpuesto(fd({ quien: "empire", fecha: "2026-11-20" }), "2026-11-20"), /banco o la caja/);
  assert.throws(() => leerPagoImpuesto(fd({ quien: "otro", fecha: "2026-11-20" }), "2026-11-20"), /quién pagó/);
  assert.throws(() => leerPagoImpuesto(fd({ quien: "cliente", fecha: "2026-11-21" }), "2026-11-20"), /futura/);
  assert.throws(() => leerPagoImpuesto(fd({ quien: "cliente", fecha: "mañana" }), "2026-11-20"), /fecha del pago/);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, propia, cliente, clienteId, c;
const padre = (codigo) => (codigo.length <= 1 ? null : codigo.length === 2 ? codigo[0] : codigo.length === 4 ? codigo.slice(0, 2) : codigo.slice(0, 4));
const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${propia}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-cargos-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma cargos ${marca}`}) RETURNING id`;
  [{ id: cliente }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Cliente Cargos SRL', '130000097', ${firma}) RETURNING id`;
  c = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
    [{ id: propia }] = await tx`INSERT INTO empresas (nombre, firma_id) VALUES ('Empire Cargos SRL', ${firma}) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${propia}, true)`;
    const ids = new Map();
    for (const [codigo, n] of CATALOGO_RD) {
      const [r] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${propia}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${ids.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6}) RETURNING id`;
      ids.set(codigo, r.id);
    }
    await tx`SELECT configurar_cuentas_empresa(${propia})`;
    [{ id: clienteId }] = await tx`INSERT INTO clientes (empresa_id, nombre, empresa_vinculada_id) VALUES (${propia}, 'Cliente Cargos SRL', ${cliente}) RETURNING id`;
    return Object.fromEntries(ids);
  });
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${cliente}`; // primero el cliente: al irse suelta su vínculo en la facturación de la propia
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally { await sql.end(); }
});

const saldoDe = (cuentaId) => leer(async (tx) => {
  const [r] = await tx`SELECT COALESCE(sum(l.debe - l.haber), 0)::text AS s FROM lineas_asiento l JOIN asientos a ON a.id = l.asiento_id WHERE l.cuenta_id = ${cuentaId} AND a.estado = 'contabilizado'`;
  return r.s;
});

test("el pago de Empire sale del banco contra «Impuestos pagados por cuenta de clientes» y queda un cargo por cobrar", conBase, async () => {
  const cargo = await leer((tx) => registrarCargo(tx, { empresaId: propia, usuarioId: ana, clienteId, concepto: "DGII de 10/2026: IT-1", fecha: "2026-11-15", monto: 1850000n, cuentaPagoId: c["110103"], notificacionId: null }));
  assert.equal(cargo.numero, 1);
  const [cuenta] = await leer((tx) => tx`SELECT id, codigo, tipo FROM cuentas WHERE nombre = 'Impuestos pagados por cuenta de clientes'`);
  assert.equal(cuenta.tipo, "activo");
  assert.match(cuenta.codigo, /^1102/);
  assert.equal(await saldoDe(cuenta.id), "18500.00", "el activo sube");
  assert.equal(await saldoDe(c["110103"]), "-18500.00", "el banco baja");
  const [g] = await leer(listarCargos);
  assert.deepEqual([g.numero, g.cliente, g.estado, g.monto], [1, "Cliente Cargos SRL", "pendiente", "18500.00"]);
  const segundo = await leer((tx) => registrarCargo(tx, { empresaId: propia, usuarioId: ana, clienteId, concepto: "TSS de 10/2026", fecha: "2026-11-16", monto: 500000n, cuentaPagoId: c["110103"], notificacionId: null }));
  assert.equal(segundo.numero, 2, "el número sigue");
  assert.equal((await leer((tx) => tx`SELECT count(*)::int AS n FROM cuentas WHERE nombre = 'Impuestos pagados por cuenta de clientes'`))[0].n, 1, "la cuenta se crea una sola vez");
});

test("cobrar el cargo devuelve el dinero al banco, salda la cuenta y no se cobra dos veces", conBase, async () => {
  const [g] = (await leer(listarCargos)).filter((x) => x.numero === 1);
  await assert.rejects(() => leer((tx) => cobrarCargo(tx, { empresaId: propia, usuarioId: ana, cargoId: g.id, fecha: "2026-11-10", cuentaCobroId: c["110103"], forma: "transferencia", referencia: null })), /antes de la fecha/);
  await assert.rejects(() => leer((tx) => cobrarCargo(tx, { empresaId: propia, usuarioId: ana, cargoId: g.id, fecha: "2026-11-18", cuentaCobroId: c["110103"], forma: "raro", referencia: null })), /forma de cobro/);
  await leer((tx) => cobrarCargo(tx, { empresaId: propia, usuarioId: ana, cargoId: g.id, fecha: "2026-11-18", cuentaCobroId: c["110103"], forma: "transferencia", referencia: "TRX-9" }));
  const [cuenta] = await leer((tx) => tx`SELECT id FROM cuentas WHERE nombre = 'Impuestos pagados por cuenta de clientes'`);
  assert.equal(await saldoDe(cuenta.id), "5000.00", "solo queda el segundo cargo");
  assert.equal(await saldoDe(c["110103"]), "-5000.00");
  const despues = (await leer(listarCargos)).find((x) => x.numero === 1);
  assert.deepEqual([despues.estado, despues.cobrado_en, despues.cobro_forma, despues.cobro_referencia], ["cobrado", "2026-11-18", "transferencia", "TRX-9"]);
  await assert.rejects(() => leer((tx) => cobrarCargo(tx, { empresaId: propia, usuarioId: ana, cargoId: g.id, fecha: "2026-11-19", cuentaCobroId: c["110103"], forma: "efectivo", referencia: null })), /ya se cobró/);
});

test("un cargo no admite monto cero ni una cuenta que no sea de banco o caja, y es de su empresa", conBase, async () => {
  await assert.rejects(() => leer((tx) => registrarCargo(tx, { empresaId: propia, usuarioId: ana, clienteId, concepto: "X", fecha: "2026-11-15", monto: 0n, cuentaPagoId: c["110103"], notificacionId: null })), /mayor que cero/);
  await assert.rejects(() => leer((tx) => registrarCargo(tx, { empresaId: propia, usuarioId: ana, clienteId, concepto: "X", fecha: "2026-11-15", monto: 100n, cuentaPagoId: c["510101"] ?? c["610101"], notificacionId: null })), /banco o caja/);
  const otra = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${cliente}, true)`;
    await tx`SET LOCAL ROLE contable_app`;
    return tx`SELECT 1 FROM cargos_cliente`;
  });
  assert.equal(otra.length, 0, "otra empresa no ve los cargos");
});

test("las notificaciones guardan quién pagó, cuándo, la referencia y el cargo; el comprobante es un documento más", conBase, async () => {
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${cliente}, true)`;
    await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
    await tx`SET LOCAL ROLE contable_app`;
    const [n] = await tx`INSERT INTO notificaciones_pago (empresa_id, tipo, periodo, monto, fecha_limite, creado_por) VALUES (${cliente}, 'dgii', '202610', 18500, '2026-11-20', ${ana}) RETURNING id`;
    await tx`UPDATE notificaciones_pago SET estado = 'pagada', pago_quien = 'empire', pago_fecha = '2026-11-15', pago_referencia = 'TRX', pagada_por = ${ana}, pagada_en = now() WHERE id = ${n.id}`;
    await tx`INSERT INTO documentos (empresa_id, entidad, entidad_id, nombre, tipo, tamano, sha256, contenido, subido_por) VALUES (${cliente}, 'pago_impuesto', ${n.id}, 'c.pdf', 'application/pdf', 4, ${`h-${marca}`}, ${Buffer.from("%PDF")}, ${ana})`;
    await assert.rejects(() => tx.savepoint((s) => s`UPDATE notificaciones_pago SET pago_quien = 'nadie' WHERE id = ${n.id}`), /check/);
  });
});
