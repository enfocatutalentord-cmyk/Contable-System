// Bloque 4, entrega 4a: impuestos del mes por cliente. Vencimientos, monto sugerido, revisión de compras, presentación con
// constancia y monto (crea la notificación de pago) y cuándo el mes queda listo para cerrar. Crea su propia firma y la borra.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { guardarBorradorCompra, registrarCompra } from "../lib/compras.ts";
import { estadoDelMes, finDeMes, guardarPresentacion, montoSugerido, quitarPresentacion, revisarCompra, venceMensual } from "../lib/impuestos-mes.ts";

test("vencimientos del mes siguiente y monto sugerido de cada declaración", () => {
  assert.equal(venceMensual("202610", 15), "2026-11-15");
  assert.equal(venceMensual("202612", 20), "2027-01-20", "diciembre vence en enero del año siguiente");
  assert.equal(finDeMes("202602"), "2026-02-28");
  assert.equal(montoSugerido("IT-1", { I68: 1234500n, I33: 99n }), "12345.00", "IT-1: total general (68)");
  assert.equal(montoSugerido("IR-2", { I31: 100000n, X45: 50000n }), "1500.00", "IR-2: ISR (31) + activos (45)");
  assert.equal(montoSugerido("606", {}), "0.00");
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, empresa, firma, cuentas, compraId;

const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));
const presentar = (formato, extra = {}) => leer((tx) => guardarPresentacion(tx, {
  empresaId: empresa, usuarioId: ana, formato, periodo: "202610", nombre: formato, enCero: false, referencia: null, huella: "h",
  registros: 0, casillas: null, monto: null, fechaLimite: null, constancia: null, ...extra,
}));

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-imp-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  await sql.begin(async (tx) => {
    [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma impuestos ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Colmado Impuestos SRL', '130000016', ${firma}) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    const m = new Map();
    for (const [codigo, n] of CATALOGO_RD) {
      const [c] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${empresa}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${m.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6})
        RETURNING id`;
      m.set(codigo, c.id);
    }
    cuentas = Object.fromEntries(m);
    await tx`SELECT configurar_cuentas_empresa(${empresa})`;
    await tx`SELECT configurar_tributaria(${empresa})`;
    await tx`INSERT INTO obligaciones_empresa (empresa_id, clave, activa) VALUES (${empresa}, 'f606', true), (${empresa}, 'it1', true), (${empresa}, 'ir17', false)`;
  });
  await leer(async (tx) => {
    const [{ id: itbis }] = await tx`SELECT id FROM impuestos WHERE nombre = 'ITBIS 18 %'`;
    const [{ id: prov }] = await tx`INSERT INTO proveedores (empresa_id, nombre, tipo_identificacion, rnc) VALUES (${empresa}, 'Distribuidora SRL', 'rnc', '101000003') RETURNING id`;
    compraId = await guardarBorradorCompra(tx, {
      empresaId: empresa, usuarioId: ana, moneda: "DOP", tasa: 10000n, tipoGasto: "09", itbisAlCosto: false, notas: null,
      proveedorId: prov, tipo: "B01", ncf: "B0100000777", fecha: "2026-10-10", vence: "2026-11-10",
      lineas: [{ descripcion: "Mercancía", clase: "bien", cantidad: 10000n, precio: 1000000n, cuentaId: cuentas["110301"], impuestoIds: [itbis] }],
    });
    await registrarCompra(tx, { empresaId: empresa, usuarioId: ana, compraId });
  });
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

test("el mes: solo lo que el cliente declara, compras por revisar, constancia con monto y listo para cerrar", conBase, async () => {
  const estado = () => leer((tx) => estadoDelMes(tx, "202610", "2026-11-18"));
  let e = await estado();
  assert.deepEqual(e.declaraciones.map((d) => [d.formato, d.estado, d.vence]), [["606", "vencida", "2026-11-15"], ["IT-1", "pendiente", "2026-11-20"]],
    "el IR-17 desactivado no cuenta; el 606 venció el 15");
  assert.deepEqual([e.compras, e.revisadas, e.listo, e.cerrado], [1, 0, false, false]);

  await assert.rejects(leer((tx) => revisarCompra(tx, { empresaId: empresa, compraId, usuarioId: ana, estado: "corregir", nota: " " })), /qué hay que corregir/);
  await leer((tx) => revisarCompra(tx, { empresaId: empresa, compraId, usuarioId: ana, estado: "corregir", nota: "El ITBIS es al costo" }));
  assert.equal((await estado()).corregir, 1);
  await leer((tx) => revisarCompra(tx, { empresaId: empresa, compraId, usuarioId: ana, estado: "revisada", nota: null }));
  e = await estado();
  assert.deepEqual([e.revisadas, e.corregir], [1, 0], "revisarla otra vez reemplaza la anterior");

  await presentar("606", { registros: 1 });
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  await assert.rejects(presentar("IT-1", { monto: "1800.00", fechaLimite: null }), /fecha límite/);
  await presentar("IT-1", { monto: "1800.00", fechaLimite: "2026-11-20", constancia: { nombre: "it1.pdf", bytes: pdf } });
  await assert.rejects(presentar("IT-1"), /ya está marcado/);
  e = await estado();
  assert.deepEqual(e.declaraciones.map((d) => d.estado), ["presentada", "presentada"]);
  assert.equal(e.aPagar, "1800.00");
  assert.equal(e.listo, true, "todo presentado: se puede cerrar");

  const [n] = await leer((tx) => tx`SELECT n.tipo, n.periodo, n.monto::text, to_char(n.fecha_limite, 'YYYY-MM-DD') AS f, n.estado,
      (SELECT count(*)::int FROM documentos d WHERE d.entidad = 'notificacion' AND d.entidad_id = n.id) AS docs
    FROM notificaciones_pago n`);
  assert.deepEqual({ ...n }, { tipo: "dgii", periodo: "202610", monto: "1800.00", f: "2026-11-20", estado: "pendiente", docs: 1 },
    "con monto nace la notificación de pago con la constancia");

  await leer((tx) => tx`UPDATE empresas SET fecha_bloqueo = '2026-10-31' WHERE id = ${empresa}`);
  e = await estado();
  assert.deepEqual([e.cerrado, e.listo], [true, false]);
  await leer((tx) => tx`UPDATE empresas SET fecha_bloqueo = NULL WHERE id = ${empresa}`);

  await leer((tx) => quitarPresentacion(tx, "IT-1", "202610"));
  const quedan = await leer((tx) => tx`SELECT count(*)::int AS n FROM notificaciones_pago`);
  assert.equal(quedan[0].n, 0, "al quitar la marca, la notificación sin enviar se va");
  assert.equal((await estado()).listo, false);
});
