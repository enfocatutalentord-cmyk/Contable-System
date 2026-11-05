// Bloque 1, entrega 1b: empresa propia de la firma, ficha única conectada con su facturación, unidades de negocio en las
// líneas y estado de resultados por unidad; lista maestra de clientes. Crea sus propias firmas y las borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { leerUnidad, prepararEmpresaPropia } from "../lib/empresa-propia.ts";
import { estadoResultados } from "../lib/estados.ts";
import { filtrarClientes, leerFiltrosLista, resumenLista } from "../lib/lista-maestra.ts";
import { emitir, guardarBorradorFactura } from "../lib/ventas.ts";

// ───── Sin base ─────

test("unidad del formulario: vacía, un id o no válida", () => {
  assert.equal(leerUnidad(""), null);
  assert.equal(leerUnidad(undefined), null);
  assert.equal(leerUnidad("0b3f6c2e-1d2a-4c5b-9e8f-112233445566"), "0b3f6c2e-1d2a-4c5b-9e8f-112233445566");
  assert.equal(leerUnidad("x'; DROP"), undefined);
});

const cli = (extra) => ({
  propia: false, activa: true, nombre: "Cliente", rnc: null, responsable_id: null, categoria: null, tipo_cliente: null,
  estado_cliente: "activo", modalidad: null, fecha_inicio_contrato: null, formalizado: false, creada: "2026-01-10", ...extra,
});

test("lista maestra: resumen sin la empresa propia y filtros", () => {
  const lista = [
    cli({ nombre: "Empire Tax’N Legal SRL", propia: true, creada: "2026-11-01" }),
    cli({ nombre: "Ferretería Higüey", rnc: "130000021", categoria: "mediana", tipo_cliente: "iguala", formalizado: true, fecha_inicio_contrato: "2026-11-03" }),
    cli({ nombre: "Colmado Pérez", estado_cliente: "en_cero", creada: "2026-11-02" }),
    cli({ nombre: "Taller Gómez", estado_cliente: "retirado", responsable_id: "r1" }),
    cli({ nombre: "Farmacia Sur", activa: false }),
  ];
  assert.deepEqual(resumenLista(lista, "2026-11-04"), { activos: 1, nuevos: 2, retiradosOEnCero: 2, noFormalizados: 2, prospectos: 0 });
  const f = (sp) => filtrarClientes(lista, leerFiltrosLista(sp)).map((c) => c.nombre);
  assert.deepEqual(f({ categoria: "mediana" }), ["Ferretería Higüey"]);
  assert.deepEqual(f({ categoria: "ninguno", estado: "activo" }), ["Empire Tax’N Legal SRL", "Farmacia Sur"]);
  assert.deepEqual(f({ formalizacion: "si" }), ["Ferretería Higüey"]);
  assert.deepEqual(f({ responsable: "r1" }), ["Taller Gómez"]);
  assert.deepEqual(f({ buscar: "higuey" }), ["Ferretería Higüey"], "sin acentos ni mayúsculas");
  assert.deepEqual(f({ buscar: "1300000" }), ["Ferretería Higüey"], "por RNC");
  assert.deepEqual(f({ formalizacion: "quizas" }).length, 5, "un valor no válido no filtra");
});

// ───── Con la base ─────

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, firma, otraFirma, propia, ferreteria, colmado, ajena, cuentas;

const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));
const leer = (id, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
// Como el dueño de la conexión (lo de la firma), con quién lo hace para el historial.
const comoFirma = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  return fn(tx);
});

async function empresa(firmaId, nombre, datos = {}) {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
    const [{ id }] = await tx`INSERT INTO empresas ${tx({ nombre, firma_id: firmaId, ...datos })} RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${id}, true)`;
    const ids = new Map();
    for (const [codigo, n] of CATALOGO_RD) {
      const [c] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${id}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${ids.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6})
        RETURNING id`;
      ids.set(codigo, c.id);
    }
    await tx`SELECT configurar_cuentas_empresa(${id})`;
    await tx`SELECT configurar_tributaria(${id})`;
    return { id, cuentas: Object.fromEntries(ids) };
  });
}
const clientesDe = (eid) => leer(eid, (tx) => tx`SELECT nombre, rnc, email, telefono, empresa_vinculada_id FROM clientes ORDER BY nombre`);

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-propia-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma propia ${marca}`}) RETURNING id`;
  [{ id: otraFirma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma ajena ${marca}`}) RETURNING id`;
  ({ id: propia, cuentas } = await empresa(firma, "Empire Prueba SRL", { rnc: "133097346" }));
  ({ id: ferreteria } = await empresa(firma, "Ferretería Prueba SRL", { rnc: "130000021", correo: "ferre@x.do", telefono: "809-555-0101" }));
  ({ id: colmado } = await empresa(firma, "Colmado Prueba"));
  ({ id: ajena } = await empresa(otraFirma, "Empresa de otra firma"));
});

after(async () => {
  if (!sql) return;
  try {
    await sql`UPDATE firmas SET empresa_propia_id = NULL WHERE id IN (${firma}, ${otraFirma})`;
    // Primero la empresa propia: al borrar las demás, su registro de cliente se desenlaza (y eso va al historial de la propia).
    await sql`DELETE FROM empresas WHERE id = ${propia}`;
    await sql`DELETE FROM empresas WHERE firma_id IN (${firma}, ${otraFirma})`;
    await sql`DELETE FROM firmas WHERE id IN (${firma}, ${otraFirma})`;
    await sql`DELETE FROM usuarios WHERE id = ${ana}`;
  } finally {
    await sql.end();
  }
});

test("empresa propia: cada cliente de la firma queda en su facturación, sin duplicar el que ya estaba", conBase, async () => {
  // La ferretería ya era cliente de Empire (mismo RNC) antes de marcar la empresa propia.
  await leer(propia, (tx) => tx`INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion) VALUES (${propia}, 'Ferre (vieja)', '130000021', 'rnc')`);
  await assert.rejects(comoFirma((tx) => tx`UPDATE firmas SET empresa_propia_id = ${ajena} WHERE id = ${firma}`), /debe ser una de las empresas de la firma/);
  await comoFirma((tx) => tx`UPDATE firmas SET empresa_propia_id = ${propia} WHERE id = ${firma}`);
  const c = await clientesDe(propia);
  assert.deepEqual(c.map((x) => [x.nombre, x.rnc, x.empresa_vinculada_id]), [
    ["Colmado Prueba", null, colmado],
    ["Ferretería Prueba SRL", "130000021", ferreteria],
  ], "la ferretería vieja se enlaza y toma el nombre de la ficha; la propia no es su propio cliente");
  assert.equal(c[1].email, "ferre@x.do");
  // Una empresa de otra firma no ve nada de esto.
  assert.equal((await clientesDe(ajena)).length, 0);
});

test("ficha única: si la ficha cambia, el registro de facturación cambia con ella; un cliente nuevo se crea solo", conBase, async () => {
  await leer(ferreteria, (tx) => tx`UPDATE empresas SET nombre = 'Ferretería Higüey SRL', telefono = '809-555-0199' WHERE id = ${ferreteria}`);
  const [f] = (await clientesDe(propia)).filter((x) => x.empresa_vinculada_id === ferreteria);
  assert.equal(f.nombre, "Ferretería Higüey SRL");
  assert.equal(f.telefono, "809-555-0199");
  const { id: nuevo } = await empresa(firma, "Farmacia Nueva", { rnc: "00100000011", tipo_identificacion: "cedula" });
  const [n] = (await clientesDe(propia)).filter((x) => x.empresa_vinculada_id === nuevo);
  assert.equal(n.rnc, "00100000011");
  const [h] = await sql`SELECT count(*)::int AS n FROM auditoria WHERE empresa_id = ${propia} AND tabla = 'clientes'`;
  assert.ok(h.n >= 4, "cada alta y cambio queda en el historial de la empresa propia");
});

test("preparar la empresa propia: unidades, ingresos por unidad, bancos y cuenta corriente de la socia; sin repetir", conBase, async () => {
  await leer(propia, (tx) => tx`INSERT INTO socios_empresa (empresa_id, orden, nombre, porcentaje) VALUES (${propia}, 1, 'Patricia Paulino', 100)`);
  const r = await leer(propia, (tx) => prepararEmpresaPropia(tx, propia));
  assert.deepEqual(r.unidades, ["Firma contable", "Laboratorio de Imperios", "Sistema"]);
  assert.ok(r.cuentas.some((c) => /^4101\d\d Ingresos – Firma contable$/.test(c)), r.cuentas.join("; "));
  assert.ok(r.cuentas.some((c) => /^1101\d\d Banco Popular – cuenta corriente$/.test(c)));
  assert.ok(r.cuentas.some((c) => /^1102\d\d Cuenta corriente – Patricia Paulino$/.test(c)));
  const [socia] = await leer(propia, (tx) => tx`SELECT tipo, de_detalle FROM cuentas WHERE nombre = 'Cuenta corriente – Patricia Paulino'`);
  assert.deepEqual({ ...socia }, { tipo: "activo", de_detalle: true }, "cuenta por cobrar a la socia");
  const u = await leer(propia, (tx) => tx`SELECT u.nombre, c.nombre AS cuenta FROM unidades_negocio u JOIN cuentas c ON c.id = u.cuenta_ingreso_id ORDER BY u.orden`);
  assert.deepEqual(u.map((x) => x.cuenta), ["Ingresos – Firma contable", "Ingresos – Laboratorio de Imperios", "Ingresos – Sistema"]);
  const otra = await leer(propia, (tx) => prepararEmpresaPropia(tx, propia));
  assert.deepEqual(otra, { unidades: [], cuentas: [], avisos: [] }, "la segunda vez no crea nada");
  assert.equal((await leer(ferreteria, (tx) => tx`SELECT 1 FROM unidades_negocio`)).length, 0, "las unidades son de cada empresa");
});

test("unidades en las líneas: la factura lleva su unidad al asiento y a su cuenta de ingreso; el estado de resultados se separa por unidad", conBase, async () => {
  const unidades = Object.fromEntries((await leer(propia, (tx) => tx`SELECT id, nombre FROM unidades_negocio`)).map((u) => [u.nombre, u.id]));
  const { imp, cliente } = await leer(propia, async (tx) => {
    await tx`INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence) VALUES (${propia}, 'B01', 1, 100, 1, '2027-12-31')`;
    const [i] = await tx`SELECT id FROM impuestos WHERE nombre = 'ITBIS 18 %'`;
    const [c] = await tx`SELECT id FROM clientes WHERE empresa_vinculada_id = ${ferreteria}`;
    return { imp: i.id, cliente: c.id };
  });
  const linea = (descripcion, precio, unidadId) => ({ servicioId: null, descripcion, cantidad: 10000n, precio, impuestoIds: [imp], unidadId });
  const asiento = await leer(propia, async (tx) => {
    const facturaId = await guardarBorradorFactura(tx, {
      empresaId: propia, usuarioId: ana, clienteId: cliente, tipo: "B01", fecha: "2026-11-04", vence: "2026-12-04", moneda: "DOP", tasa: 10000n, notas: null,
      lineas: [linea("Iguala de noviembre", 2000000n, unidades["Firma contable"]), linea("Taller Laboratorio", 500000n, unidades["Laboratorio de Imperios"]),
               linea("Otro servicio", 100000n, null)],
    });
    await emitir(tx, { empresaId: propia, usuarioId: ana, facturaId });
    const [{ asiento_id }] = await tx`SELECT asiento_id FROM facturas WHERE id = ${facturaId}`;
    return tx`SELECT c.nombre, u.nombre AS unidad, l.haber::text FROM lineas_asiento l JOIN cuentas c ON c.id = l.cuenta_id
               LEFT JOIN unidades_negocio u ON u.id = l.unidad_id WHERE l.asiento_id = ${asiento_id} AND l.haber > 0 ORDER BY l.haber DESC`;
  });
  assert.deepEqual(asiento.map((l) => [l.nombre, l.unidad, l.haber]), [
    ["Ingresos – Firma contable", "Firma contable", "20000.00"],
    ["Ingresos – Laboratorio de Imperios", "Laboratorio de Imperios", "5000.00"],
    ["ITBIS por pagar", null, "4680.00"],
    ["Ingresos por servicios", null, "1000.00"],
  ]);
  const ingresos = async (columnas) => {
    const e = await leer(propia, (tx) => estadoResultados(tx, columnas, "cuentas"));
    return e.filas.find((f) => f.texto === "Total ingresos operacionales").valores;
  };
  const mes = { desde: "2026-11-01", hasta: "2026-11-30" };
  assert.deepEqual(await ingresos([
    { titulo: "Firma contable", ...mes, unidad: unidades["Firma contable"] }, { titulo: "Sin unidad", ...mes, unidad: "sin" }, { titulo: "Total", ...mes },
  ]), [2000000n, 100000n, 2600000n]);
  // Una unidad de otra empresa o inactiva no se puede usar.
  const [{ id: deOtra }] = await leer(ferreteria, (tx) => tx`INSERT INTO unidades_negocio (empresa_id, nombre) VALUES (${ferreteria}, 'Tienda') RETURNING id`);
  await leer(propia, (tx) => tx`UPDATE unidades_negocio SET activa = false WHERE id = ${unidades["Sistema"]}`);
  for (const u of [deOtra, unidades["Sistema"]]) {
    await assert.rejects(leer(propia, (tx) => guardarBorradorFactura(tx, {
      empresaId: propia, usuarioId: ana, clienteId: cliente, tipo: "B01", fecha: "2026-11-04", vence: "2026-11-04", moneda: "DOP", tasa: 10000n, notas: null,
      lineas: [linea("X", 100000n, u)],
    })), /unidad de negocio no existe o está inactiva/);
  }
});
