// Prioridad 1.6 (cierre): gastos pendientes de pago; solo al marcarlos «Pagado» se registra la salida y cuentan en el presupuesto y el banco.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { realDelAnio, sumar } from "../lib/presupuesto.ts";
import { saldosDeBancos } from "../lib/presupuesto-metas.ts";
import { agregarPendiente, descartarPendiente, listarPendientes, marcarPagado, totalPendiente } from "../lib/presupuesto-pendientes.ts";

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa, c;
const padre = (k) => (k.length === 1 ? null : k.length === 2 ? k[0] : k.slice(0, -2));
const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-pend-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma pendientes ${marca}`}) RETURNING id`;
  c = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, firma_id) VALUES ('Empire Pendientes SRL', ${firma}) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    const ids = new Map();
    for (const [codigo, n] of [...CATALOGO_RD, ["110204", "Cuenta corriente – Patricia Paulino"]]) {
      const [r] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${empresa}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${ids.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6})
        RETURNING id`;
      ids.set(codigo, r.id);
    }
    await tx`SELECT configurar_cuentas_empresa(${empresa})`;
    return Object.fromEntries(ids);
  });
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally { await sql.end(); }
});

const nuevo = (d) => leer((tx) => agregarPendiente(tx, empresa, ana, { tipo: "oficina", fecha: "2026-04-10", categoria: "Electricidad oficina", descripcion: "Luz de marzo", monto: 450000n, cuentaId: c["610202"], ...d }));

test("un gasto pendiente no mueve el presupuesto ni el banco; al marcarlo pagado sí, con su asiento", conBase, async () => {
  const id = await nuevo({});
  const lista = await leer((tx) => listarPendientes(tx));
  assert.equal(lista.length, 1);
  assert.equal(totalPendiente(lista, 2026, 4), 450000n);
  assert.equal(totalPendiente(lista, 2026, 5), 0n, "solo cuenta el mes de su fecha");
  assert.equal(sumar((await leer((tx) => realDelAnio(tx, 2026)))[3].oficina), 0n, "pendiente no cuenta como real");
  assert.equal((await leer((tx) => saldosDeBancos(tx, "2026-04-01", "2026-04-30"))).find((x) => x.codigo === "110103").salidas, 0n);

  const s = await leer((tx) => marcarPagado(tx, empresa, ana, id, { origenId: c["110103"], fecha: "2026-04-12", referencia: "Transferencia 123" }));
  assert.ok(s.asiento > 0);
  const real = (await leer((tx) => realDelAnio(tx, 2026)))[3];
  assert.equal(real.oficina.get("Electricidad oficina"), 450000n, "ya cuenta, en su categoría");
  assert.equal((await leer((tx) => saldosDeBancos(tx, "2026-04-01", "2026-04-30"))).find((x) => x.codigo === "110103").salidas, 450000n);
  assert.equal((await leer((tx) => listarPendientes(tx))).length, 0, "ya no está pendiente");
  const [g] = await leer((tx) => listarPendientes(tx, true));
  assert.deepEqual([g.estado, g.salidaNumero], ["pagado", s.numero]);
  await assert.rejects(leer((tx) => marcarPagado(tx, empresa, ana, id, { origenId: c["110103"], fecha: "2026-04-12" })), /ya no está pendiente/);
});

test("pendiente personal va a la cuenta de la socia; descartar no deja rastro en la contabilidad", conBase, async () => {
  await assert.rejects(nuevo({ tipo: "personal", categoria: null, cuentaId: c["110204"] }), /categoría/);
  await assert.rejects(nuevo({ monto: 0n }), /monto/);
  await assert.rejects(nuevo({ cuentaId: "" }), /cuenta de gasto/);
  const id = await nuevo({ tipo: "personal", categoria: "Vivienda", cuentaId: c["110204"], monto: 800000n, descripcion: "Alquiler" });
  await leer((tx) => marcarPagado(tx, empresa, ana, id, { origenId: c["110103"], fecha: "2026-04-15" }));
  assert.equal((await leer((tx) => realDelAnio(tx, 2026)))[3].personal.get("Vivienda"), 800000n);
  const otro = await nuevo({ monto: 100n });
  await leer((tx) => descartarPendiente(tx, otro));
  await assert.rejects(leer((tx) => descartarPendiente(tx, otro)), /ya no está pendiente/);
  await assert.rejects(leer((tx) => marcarPagado(tx, empresa, ana, otro, { origenId: c["110103"], fecha: "2026-04-15" })), /ya no está pendiente/);
  assert.equal((await leer((tx) => listarPendientes(tx))).length, 0);
});

test("pagar con un cuenta que no es de efectivo se rechaza y el gasto sigue pendiente", conBase, async () => {
  const id = await nuevo({ monto: 1234n });
  await assert.rejects(leer((tx) => marcarPagado(tx, empresa, ana, id, { origenId: c["610203"], fecha: "2026-04-15" })), /banco o caja/);
  assert.equal((await leer((tx) => listarPendientes(tx))).length, 1, "sigue pendiente");
});
