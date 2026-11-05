// Bloque 2, entrega 2b: igualas y facturas recurrentes. Cálculo del mes sin base; preparación de borradores, aumento confirmado,
// plantillas y aislamiento con la base (crea su propia firma y la borra al final).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { avisosAcuerdo, fechaFacturacion, igualaDelMes, siguienteFecha } from "../lib/igualas.ts";
import { confirmarAumento, crearRecurrenteDesdeFactura, prepararIgualas, prepararRecurrenteAhora, prepararRecurrentes } from "../lib/igualas-db.ts";

const acuerdo = (extra = {}) => ({
  tipo: "normal", monto: "15000.00", tarifa_especial: null, tarifa_hasta: null, cuota: null, deuda_hasta: null,
  inicio: "2025-11-10", dia_facturacion: 30, ...extra,
});
const precios = (m) => m?.lineas.map((l) => l.precio);

test("día de facturación: el 30 de febrero es el último día del mes", () => {
  assert.equal(fechaFacturacion("202602", 30), "2026-02-28");
  assert.equal(fechaFacturacion("202611", 30), "2026-11-30");
  assert.equal(fechaFacturacion("202611", 5), "2026-11-05");
});

test("iguala del mes: normal, aniversario con 10 % de descuento y antes del contrato", () => {
  assert.equal(igualaDelMes(acuerdo(), "202510"), null, "antes del inicio no se factura");
  assert.deepEqual(precios(igualaDelMes(acuerdo(), "202511")), [1500000n], "el mes del inicio no es aniversario");
  const aniv = igualaDelMes(acuerdo(), "202611");
  assert.deepEqual(precios(aniv), [1350000n], "15,000 − 10 % = 13,500");
  assert.ok(aniv.aniversario && /10 % de descuento por fidelidad \(RD\$1,500\.00\)/.test(aniv.lineas[0].descripcion), aniv.lineas[0].descripcion);
  assert.deepEqual(precios(igualaDelMes(acuerdo(), "202612")), [1500000n]);
});

test("tarifas especiales, mes gratis, cuota de acuerdo especial y declaración en cero", () => {
  const gratis = acuerdo({ tipo: "arranque", inicio: "2026-11-01", tarifa_especial: "0.00", tarifa_hasta: "2026-11-30" });
  assert.equal(igualaDelMes(gratis, "202611").total, 0n, "Plan de Arranque: mes gratis");
  assert.equal(igualaDelMes(gratis, "202611").nota, "Mes gratis (Plan de Arranque)");
  assert.deepEqual(precios(igualaDelMes(gratis, "202612")), [1500000n], "después, la iguala normal pactada");
  const ajuste = acuerdo({ tipo: "ajuste", inicio: "2026-06-15", tarifa_especial: "8000.00", tarifa_hasta: "2026-12-31" });
  assert.deepEqual(precios(igualaDelMes(ajuste, "202612")), [800000n]);
  assert.deepEqual(precios(igualaDelMes(ajuste, "202701")), [1500000n]);
  const especial = acuerdo({ tipo: "especial", inicio: "2026-06-15", cuota: "2000.00", deuda_hasta: "2027-01-31" });
  assert.deepEqual(precios(igualaDelMes(especial, "202701")), [1500000n, 200000n], "iguala + cuota de la deuda");
  assert.deepEqual(precios(igualaDelMes(especial, "202702")), [1500000n], "la cuota termina en enero");
  assert.match(igualaDelMes(acuerdo({ tipo: "cero", monto: "1200.00" }), "202612").lineas[0].descripcion, /^Declaración en cero de diciembre 2026$/);
});

test("avisos: aniversario a 60 días, aumento por confirmar y fin de tarifa especial", () => {
  const claves = (a, hoy, c = []) => avisosAcuerdo(a, hoy, c).map((x) => x.clave);
  assert.deepEqual(claves(acuerdo(), "2026-09-20"), ["aniversario"], "faltan 51 días");
  assert.deepEqual(claves(acuerdo(), "2026-09-01"), [], "faltan 70 días");
  const aumento = avisosAcuerdo(acuerdo(), "2026-11-15", []).find((x) => x.clave === "aumento");
  assert.equal(aumento.nuevo, "16500.00");
  assert.equal(aumento.aniversario, "2026-11-10");
  assert.deepEqual(claves(acuerdo(), "2026-11-15", ["2026-11-10"]), [], "ya confirmado");
  assert.deepEqual(claves(acuerdo({ inicio: "2026-03-01" }), "2026-11-15"), [], "antes del primer aniversario no hay aumento");
  assert.deepEqual(claves(acuerdo({ inicio: "2026-03-01", tarifa_especial: "9000.00", tarifa_hasta: "2026-12-01" }), "2026-11-15"), ["tarifa"]);
});

test("próxima fecha de una plantilla", () => {
  assert.equal(siguienteFecha("2026-01-31", "mensual"), "2026-02-28");
  assert.equal(siguienteFecha("2026-02-28", "mensual", 31), "2026-03-31", "vuelve al día original");
  assert.equal(siguienteFecha("2026-11-01", "quincenal"), "2026-11-16");
  assert.equal(siguienteFecha("2026-11-30", "trimestral"), "2027-02-28");
  assert.equal(siguienteFecha("2026-11-04", "anual"), "2027-11-04");
});

// ───── Con la base ─────

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, empresa, otra, conRnc, nuevo, servicio, acuerdoId;

const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));
const leer = (id, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
async function crearEmpresa(nombre) {
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

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-igualas-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma igualas ${marca}`}) RETURNING id`;
  empresa = await crearEmpresa("Empire Igualas SRL");
  otra = await crearEmpresa("Otra Igualas SRL");
  await leer(empresa, async (tx) => {
    const [i] = await tx`SELECT id FROM impuestos WHERE nombre = 'ITBIS 18 %'`;
    [{ id: servicio }] = await tx`INSERT INTO servicios (empresa_id, nombre, precio, impuesto_id) VALUES (${empresa}, 'Iguala contable mensual', 15000, ${i.id}) RETURNING id`;
    [{ id: conRnc }] = await tx`INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion, dias_credito) VALUES (${empresa}, 'Ferretería Iguala', '130000041', 'rnc', 5) RETURNING id`;
    [{ id: nuevo }] = await tx`INSERT INTO clientes (empresa_id, nombre) VALUES (${empresa}, 'Colmado Nuevo') RETURNING id`;
    [{ id: acuerdoId }] = await tx`INSERT INTO acuerdos_cliente (empresa_id, cliente_id, tipo, servicio_id, monto, inicio, dia_facturacion)
      VALUES (${empresa}, ${conRnc}, 'normal', ${servicio}, 15000, '2025-11-10', 30) RETURNING id`;
    await tx`INSERT INTO acuerdos_cliente (empresa_id, cliente_id, tipo, servicio_id, monto, tarifa_especial, tarifa_hasta, inicio, dia_facturacion)
      VALUES (${empresa}, ${nuevo}, 'arranque', ${servicio}, 9000, 0, '2026-11-30', '2026-11-01', 30)`;
  });
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("preparar las igualas del mes: solo desde el día de facturación, sin repetir, mes gratis aparte", conBase, async () => {
  const preparar = (soloHastaHoy, hoy = "2026-11-04") => leer(empresa, (tx) => prepararIgualas(tx, { empresaId: empresa, usuarioId: ana, periodo: "202611", hoy, soloHastaHoy }));
  assert.deepEqual(await preparar(true), { creadas: 0, yaEstaban: 0, gratis: [], errores: [] }, "el 4 todavía no es día 30");
  assert.deepEqual(await preparar(false), { creadas: 1, yaEstaban: 0, gratis: ["Colmado Nuevo"], errores: [] });
  assert.deepEqual(await preparar(true, "2026-11-30"), { creadas: 0, yaEstaban: 1, gratis: ["Colmado Nuevo"], errores: [] }, "no se repite");
  const [f] = await leer(empresa, (tx) => tx`SELECT estado, tipo_ncf, subtotal::text, total::text, to_char(fecha, 'YYYY-MM-DD') AS fecha,
    to_char(vence, 'YYYY-MM-DD') AS vence, periodo, notas FROM facturas WHERE acuerdo_id = ${acuerdoId}`);
  assert.deepEqual({ ...f }, { estado: "borrador", tipo_ncf: "B01", subtotal: "13500.00", total: "15930.00", fecha: "2026-11-30", vence: "2026-12-05",
    periodo: "202611", notas: "Mes del aniversario: 10 % de descuento por fidelidad" }, "borrador con el comprobante habitual (tiene RNC) y el ITBIS del servicio");
});

test("aumento de 10 %: solo confirmado, una vez por aniversario, y la iguala siguiente ya lo trae", conBase, async () => {
  const confirmar = (hoy) => leer(empresa, (tx) => confirmarAumento(tx, { empresaId: empresa, usuarioId: ana, acuerdoId, hoy }));
  await assert.rejects(confirmar("2026-10-01"), /no tiene un aumento pendiente/, "antes del aniversario no hay aumento");
  assert.equal(await confirmar("2026-11-15"), "16500.00");
  await assert.rejects(confirmar("2026-11-20"), /no tiene un aumento pendiente/);
  await leer(empresa, (tx) => prepararIgualas(tx, { empresaId: empresa, usuarioId: ana, periodo: "202612", hoy: "2026-12-30", soloHastaHoy: true }));
  const [f] = await leer(empresa, (tx) => tx`SELECT subtotal::text FROM facturas WHERE acuerdo_id = ${acuerdoId} AND periodo = '202612'`);
  assert.equal(f.subtotal, "16500.00");
});

test("facturas recurrentes: la plantilla copia la factura, prepara lo atrasado y avanza; a solicitud al momento", conBase, async () => {
  const [{ id: facturaId }] = await leer(empresa, (tx) => tx`SELECT id FROM facturas WHERE acuerdo_id = ${acuerdoId} AND periodo = '202611'`);
  const plantilla = await leer(empresa, (tx) => crearRecurrenteDesdeFactura(tx, {
    empresaId: empresa, facturaId, nombre: "Alquiler local", frecuencia: "mensual", proxima: "2026-10-05", hasta: null,
  }));
  const r = await leer(empresa, (tx) => prepararRecurrentes(tx, { empresaId: empresa, usuarioId: ana, hoy: "2026-11-04" }));
  assert.deepEqual(r, { creadas: 1, yaEstaban: 0, gratis: [], errores: [] }, "solo la del 5 de octubre: la de noviembre todavía no toca");
  const [p] = await leer(empresa, (tx) => tx`SELECT to_char(proxima, 'YYYY-MM-DD') AS proxima FROM facturas_recurrentes WHERE id = ${plantilla}`);
  assert.equal(p.proxima, "2026-11-05");
  assert.equal((await leer(empresa, (tx) => prepararRecurrentes(tx, { empresaId: empresa, usuarioId: ana, hoy: "2026-11-04" }))).creadas, 0);
  const [b] = await leer(empresa, (tx) => tx`SELECT estado, subtotal::text, to_char(fecha, 'YYYY-MM-DD') AS fecha FROM facturas WHERE recurrente_id = ${plantilla}`);
  assert.deepEqual({ ...b }, { estado: "borrador", subtotal: "13500.00", fecha: "2026-10-05" });
  await leer(empresa, (tx) => prepararRecurrenteAhora(tx, { empresaId: empresa, usuarioId: ana, recurrenteId: plantilla, hoy: "2026-11-04" }));
  await leer(empresa, (tx) => prepararRecurrenteAhora(tx, { empresaId: empresa, usuarioId: ana, recurrenteId: plantilla, hoy: "2026-11-04" }));
  const [{ n }] = await leer(empresa, (tx) => tx`SELECT count(*)::int AS n FROM facturas WHERE recurrente_id = ${plantilla}`);
  assert.equal(n, 3, "a solicitud se puede preparar varias veces el mismo día");
});

test("aislamiento: otra empresa no ve los acuerdos ni puede usar un cliente ajeno", conBase, async () => {
  assert.equal((await leer(otra, (tx) => tx`SELECT 1 FROM acuerdos_cliente`)).length, 0);
  await assert.rejects(leer(otra, (tx) => tx`INSERT INTO acuerdos_cliente (empresa_id, cliente_id, tipo, servicio_id, monto, inicio)
    VALUES (${otra}, ${conRnc}, 'normal', ${servicio}, 1, '2026-01-01')`), /no es de esta empresa/);
});
