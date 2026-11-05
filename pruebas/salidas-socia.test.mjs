// Bloque 7, entrega 7a: cada salida de dinero a su cuenta (oficina, personal, deuda, ahorro, traspaso), plantillas de asientos
// (sin programar y mensuales como borrador), estado de cuenta de la socia y liquidación al cierre (dividendos con retención o
// cuenta por cobrar), con los dividendos en la casilla 5 del IR-17. Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { insertarAsiento } from "../lib/asientos.ts";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { periodoDe } from "../lib/formatos-dgii.ts";
import { pestanaDeRuta, pestanasAGuardar, pestanasDelRol, TODAS_LAS_PESTANAS } from "../lib/pestanas.ts";
import { calcularIr17 } from "../lib/ir17.ts";
import { borradoresDePlantillas, contabilizarDePlantilla, prepararRecurrentes, primeraFecha, revisarPlantilla } from "../lib/plantillas.ts";
import { anularSalida, conceptoSalida, lineasSalida, registrarSalida, revisarSalida } from "../lib/salidas.ts";
import { brutoDeNeto, deshacerLiquidacion, estadoDeCuenta, liquidar, saldoSocia } from "../lib/socia.ts";

// ───── Sin base ─────

test("cada tipo de salida pide lo suyo y arma el asiento a su cuenta", () => {
  const base = { fecha: "2026-03-10", origenId: "banco", destinoId: "socia", monto: 250000n };
  assert.match(revisarSalida({ ...base, tipo: "personal" }), /categoría/);
  assert.match(revisarSalida({ ...base, tipo: "deuda", categoria: "x" }), /a quién/);
  assert.match(revisarSalida({ ...base, tipo: "traspaso", destinoId: "banco" }), /distintas/);
  assert.equal(revisarSalida({ ...base, tipo: "personal", categoria: "Alimentación" }), null);
  const d = { ...base, tipo: "personal", categoria: "Alimentación", descripcion: "Supermercado" };
  assert.deepEqual(conceptoSalida(d, "Cuenta corriente – Patricia"), { concepto: "Gasto personal: Alimentación — Supermercado", categoria: "Alimentación" });
  const [debe, haber] = lineasSalida(d, "Alimentación");
  assert.deepEqual([debe.cuentaId, debe.debe, debe.categoria, haber.cuentaId, haber.haber, haber.categoria], ["socia", 250000n, "Alimentación", "banco", 250000n, null]);
  assert.equal(conceptoSalida({ ...base, tipo: "deuda", acreedor: "Banco BHD" }, "x").categoria, "Pago de deuda");
});

test("dividendo bruto: el neto más la retención del 10 % del IR-17", () => {
  assert.deepEqual(brutoDeNeto(900000n), { bruto: 1000000n, retencion: 100000n });
  const { bruto, retencion } = brutoDeNeto(1234567n);
  assert.equal(bruto - retencion, 1234567n, "llega exacto el neto");
  assert.ok(retencion - (bruto * 1000n) / 10000n <= 1n, "la retención es el 10 % del bruto, al centavo");
});

test("plantilla mensual: cuadra, tiene montos y día", () => {
  const l = (debe, haber, cuentaId = "c") => ({ cuentaId, descripcion: "", debe, haber });
  const p = { nombre: "Depreciación", concepto: "Depreciación del mes", frecuencia: "mensual", dia: 30, proxima: "2026-01-30" };
  assert.match(revisarPlantilla({ ...p, lineas: [l("100", "")] }), /dos líneas/);
  assert.match(revisarPlantilla({ ...p, lineas: [l("", ""), l("", "")] }), /montos/);
  assert.match(revisarPlantilla({ ...p, lineas: [l("100", ""), l("", "90")] }), /cuadrar/);
  assert.equal(revisarPlantilla({ ...p, lineas: [l("100", ""), l("", "100")] }), null);
  assert.equal(revisarPlantilla({ ...p, frecuencia: "ninguna", dia: null, proxima: null, lineas: [l("", ""), l("", "")] }), null, "sin programar puede ir sin montos");
  assert.equal(primeraFecha("2026-02", 30), "2026-02-28");
  assert.equal(primeraFecha("2026-01", 30), "2026-01-31", "el 30 es el último día");
  assert.equal(primeraFecha("2026-02", 15), "2026-02-15");
});

test("lo de la socia solo lo ve el rol Administrador o un rol que lo tenga marcado", () => {
  assert.equal(pestanasDelRol(null, true), null, "Administrador: todo");
  const soloLectura = pestanasDelRol(null, false);
  assert.ok(!soloLectura.includes("/socia") && !soloLectura.includes("/salidas") && soloLectura.includes("/plantillas"));
  assert.deepEqual(pestanasDelRol(["/facturas", "/socia", "/no-existe"], false), ["/facturas", "/socia"], "marcada a propósito");
  const comunes = TODAS_LAS_PESTANAS.filter((r) => r !== "/socia" && r !== "/salidas");
  assert.equal(pestanasAGuardar(comunes), null, "todas las comunes = «todas»");
  assert.deepEqual(pestanasAGuardar(TODAS_LAS_PESTANAS), TODAS_LAS_PESTANAS, "con las privadas se guarda la lista");
  assert.equal(pestanaDeRuta("/exportar/socia"), "/socia", "la descarga pide la misma pestaña");
});

// ───── Con la base ─────

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
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-socia-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma socia ${marca}`}) RETURNING id`;
  c = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, firma_id) VALUES ('Empire Prueba SRL', ${firma}) RETURNING id`;
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
  // Ganancias de años anteriores en resultados acumulados.
  await leer((tx) => insertarAsiento(tx, { empresaId: empresa, usuarioId: ana, fecha: "2025-01-15", concepto: "Apertura", origen: "manual", lineas: [
    { cuentaId: c["110103"], debe: 50000000n, haber: 0n }, { cuentaId: c["310301"], debe: 0n, haber: 50000000n }] }));
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("salidas: personal a la cuenta de la socia con su categoría, oficina al gasto, y se anulan", conBase, async () => {
  const s = (d) => leer((tx) => registrarSalida(tx, empresa, ana, { fecha: "2025-05-10", origenId: c["110103"], ...d }));
  const p = await s({ tipo: "personal", destinoId: c["110204"], monto: 600000n, categoria: "Alimentación", descripcion: "Supermercado" });
  await s({ tipo: "deuda", destinoId: c["110204"], monto: 300000n, acreedor: "Tarjeta BHD" });
  await s({ tipo: "oficina", destinoId: c["610202"], monto: 450000n, descripcion: "Luz de la oficina" });
  await s({ tipo: "ahorro", destinoId: c["110104"], monto: 1000000n });
  await assert.rejects(s({ tipo: "oficina", destinoId: c["110204"], monto: 100n }), /gasto o costo/);
  await assert.rejects(s({ tipo: "personal", destinoId: c["610202"], monto: 100n, categoria: "Salud" }), /cuenta corriente de una socia/);
  const errada = await s({ tipo: "personal", destinoId: c["110204"], monto: 10000n, categoria: "Salud" });
  await leer((tx) => anularSalida(tx, errada.id, ana, "Monto equivocado"));
  const [l] = await leer((tx) => tx`SELECT categoria_personal, debe::text FROM lineas_asiento l JOIN salidas s ON s.asiento_id = l.asiento_id WHERE s.id = ${p.id} AND l.debe > 0`);
  assert.deepEqual({ ...l }, { categoria_personal: "Alimentación", debe: "6000.00" });
  assert.equal(await leer((tx) => saldoSocia(tx, c["110204"], "2025-12-31")), 900000n, "la anulada no cuenta");
  const e = await leer((tx) => estadoDeCuenta(tx, c["110204"], "2025-01-01", "2025-12-31"));
  assert.deepEqual(e.porCategoria, [["Alimentación", 600000n], ["Pago de deuda", 300000n]]);
  assert.equal(e.final, 900000n);
  const [g] = await leer((tx) => tx`SELECT sum(debe)::text AS s FROM lineas_asiento l JOIN asientos a ON a.id = l.asiento_id WHERE l.cuenta_id = ${c["610202"]} AND a.estado = 'contabilizado'`);
  assert.equal(g.s, "4500.00", "el gasto de oficina sí va al gasto");
});

test("liquidación: dividendos con retención (casilla 5 del IR-17) o cuenta por cobrar; se deshace", conBase, async () => {
  const base = { empresaId: empresa, usuarioId: ana, cuentaId: c["110204"], fin: "2025-12-31", hoy: "2026-11-05", fecha: "2026-01-01", nota: null };
  await assert.rejects(leer((tx) => liquidar(tx, { ...base, modo: "dividendos", neto: 1000000n })), /más que el saldo/);
  await assert.rejects(leer((tx) => liquidar(tx, { ...base, fin: "2026-12-31", modo: "dividendos", neto: null })), /no ha terminado/);
  const r = await leer((tx) => liquidar(tx, { ...base, modo: "dividendos", neto: null }));
  assert.ok(r.asiento > 0);
  const lineas = await leer((tx) => tx`SELECT c.codigo, l.debe::text, l.haber::text FROM lineas_asiento l JOIN cuentas c ON c.id = l.cuenta_id
                                          JOIN liquidaciones_socia q ON q.asiento_id = l.asiento_id WHERE q.id = ${r.id} ORDER BY l.orden`);
  assert.deepEqual(lineas.map((x) => [x.codigo, x.debe, x.haber]), [["310301", "10000.00", "0.00"], ["110204", "0.00", "9000.00"], ["210203", "0.00", "1000.00"]]);
  assert.equal(await leer((tx) => saldoSocia(tx, c["110204"], "2026-01-31")), 0n, "la cuenta corriente queda en cero");
  const ir17 = await leer((tx) => calcularIr17(tx, periodoDe("202601"), {}));
  assert.equal(ir17.valores.R5, 1000000n);
  assert.equal(ir17.valores.R5i, 100000n, "10 % de retención");
  await assert.rejects(leer((tx) => liquidar(tx, { ...base, modo: "cuenta_por_cobrar" })), /ya tiene su liquidación/);
  await leer((tx) => deshacerLiquidacion(tx, r.id, ana));
  assert.equal(await leer((tx) => saldoSocia(tx, c["110204"], "2026-01-31")), 900000n);
  const q = await leer((tx) => liquidar(tx, { ...base, modo: "cuenta_por_cobrar", nota: "Se cobra en 2026" }));
  assert.equal(q.asiento, null, "dejarla como cuenta por cobrar no hace asiento");
});

test("plantilla mensual: prepara un borrador por mes sin repetir y se contabiliza", conBase, async () => {
  const lineas = [{ cuentaId: c["610212"], descripcion: "", debe: "1500", haber: "" }, { cuentaId: c["120103"], descripcion: "", debe: "", haber: "1500" }];
  await leer((tx) => tx`INSERT INTO plantillas_asiento (empresa_id, nombre, concepto, lineas, frecuencia, dia, proxima, hasta, creado_por)
                        VALUES (${empresa}, 'Depreciación', 'Depreciación del mes', ${tx.json(lineas)}, 'mensual', 30, '2026-08-31', '2026-10-31', ${ana})`);
  const r = await leer((tx) => prepararRecurrentes(tx, empresa, ana, "2026-11-05"));
  assert.deepEqual(r.creados.map((x) => x.fecha), ["2026-08-31", "2026-09-30", "2026-10-31"]);
  const otra = await leer((tx) => prepararRecurrentes(tx, empresa, ana, "2026-11-05"));
  assert.equal(otra.creados.length, 0, "no repite");
  const [{ activa }] = await leer((tx) => tx`SELECT activa FROM plantillas_asiento WHERE nombre = 'Depreciación'`);
  assert.equal(activa, false, "pasó su fecha final");
  const b = await leer((tx) => borradoresDePlantillas(tx));
  assert.equal(b.length, 3);
  assert.equal(b[0].concepto, "Depreciación del mes · agosto 2026");
  await assert.rejects(leer((tx) => contabilizarDePlantilla(tx, empresa, b[0].id, ana, true)), /otra persona/);
  assert.ok(await leer((tx) => contabilizarDePlantilla(tx, empresa, b[0].id, ana, false)) > 0);
});
