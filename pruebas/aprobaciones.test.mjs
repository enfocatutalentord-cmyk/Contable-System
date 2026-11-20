// Prioridad 2.1 (P2a): permisos con tres niveles y bandeja «Por aprobar» (facturas y compras). Lo que se prepara con un permiso «con
// aprobación» espera; al aprobarse se emite o se registra; al devolverse queda con su motivo y su historial.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import {
  aprobacionDe, aprobar, cancelarAccion, capturarCampos, cerrarSiPendiente, devolver, formularioDe, historialDe, liberarAccion, listarAprobaciones, pedirAccion,
  reclamarAccion, registrarAprobada, solicitarAprobacion, tituloDe,
} from "../lib/aprobaciones.ts";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { guardarBorradorCompra } from "../lib/compras.ts";
import { emitir, guardarBorradorFactura } from "../lib/ventas.ts";
import { CON_APROBACION, guardarNivel, leerNiveles, nivelDe, PERMISOS, TODOS_LOS_PERMISOS } from "../lib/permisos.ts";
import { leerPermisosPersona } from "../lib/permisos-persona.ts";

test("tres niveles por permiso: no puede, puede, puede con aprobación", () => {
  assert.ok(PERMISOS.some((p) => p.clave === "aprobar"), "existe el permiso de aprobar");
  assert.deepEqual(CON_APROBACION, ["contabilizar", "revertir", "cerrar", "impuestos"]);
  assert.equal(guardarNivel("contabilizar", "aprob"), "contabilizar~aprob");
  assert.equal(guardarNivel("contabilizar", "si"), "contabilizar");
  assert.equal(guardarNivel("contabilizar", "no"), null);
  assert.equal(guardarNivel("ver", "aprob"), "ver", "los permisos sin tercer nivel quedan como «puede»");
  const l = leerNiveles(["ver", "registrar", "contabilizar~aprob", "cerrar", "no-existe", "ver~aprob", "usuarios~aprob"]);
  assert.deepEqual([...l.permisos].sort(), ["cerrar", "contabilizar", "registrar", "ver"].sort(), "un sufijo de aprobación en un permiso que no lo admite se ignora");
  assert.deepEqual(l.conAprobacion, ["contabilizar"]);
  assert.equal(nivelDe(["contabilizar~aprob"], "contabilizar"), "aprob");
  assert.equal(nivelDe(["contabilizar"], "contabilizar"), "si");
  assert.equal(nivelDe(["ver"], "contabilizar"), "no");
  assert.equal(leerNiveles(["contabilizar", "contabilizar~aprob"]).conAprobacion[0], "contabilizar", "si aparece con aprobación, manda la aprobación");
});

test("las casillas de Personas y accesos traen el nivel de cada permiso", () => {
  const fd = new FormData();
  fd.set("clientes_activo", "on");
  fd.set("c_nivel|ver", "si");
  fd.set("c_nivel|registrar", "si");
  fd.set("c_nivel|contabilizar", "aprob");
  fd.set("c_nivel|cerrar", "no");
  fd.set("c_nivel|aprobar", "si");
  fd.set("alcance", "todos");
  const p = leerPermisosPersona(fd);
  assert.deepEqual([...p.clientes.permisos].sort(), ["aprobar", "contabilizar~aprob", "registrar", "ver"].sort());
  const solo = new FormData();
  solo.set("clientes_activo", "on");
  solo.set("c_nivel|contabilizar", "aprob");
  assert.ok(leerPermisosPersona(solo).clientes.permisos.includes("ver"), "sin «ver» no tiene sentido entrar: se le da");
  assert.ok(TODOS_LOS_PERMISOS.includes("aprobar"));
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, bea, firma, empresa, imp, cliente, proveedor, cuentas;
const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));
const como = (usuario) => (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${usuario}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
let comoAna, comoBea;

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-apr-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: bea }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`bea-apr-${marca}@x.do`}, 'Bea', 'x') RETURNING id`;
  comoAna = como(ana);
  await sql.begin(async (tx) => {
    [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma aprobaciones ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, firma_id) VALUES ('Cliente Aprobaciones SRL', ${firma}) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    const ids = new Map();
    for (const [codigo, n] of CATALOGO_RD) {
      const [c] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${empresa}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${ids.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6})
        RETURNING id`;
      ids.set(codigo, c.id);
    }
    cuentas = Object.fromEntries(ids);
    await tx`SELECT configurar_cuentas_empresa(${empresa})`;
    await tx`SELECT configurar_tributaria(${empresa})`;
  });
  comoBea = como(bea);
  await comoAna(async (tx) => {
    const i = Object.fromEntries((await tx`SELECT id, nombre FROM impuestos`).map((r) => [r.nombre, r.id]));
    imp = i["ITBIS 18 %"];
    [{ id: cliente }] = await tx`INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion) VALUES (${empresa}, 'Cliente SRL', '101000001', 'rnc') RETURNING id`;
    [{ id: proveedor }] = await tx`INSERT INTO proveedores (empresa_id, nombre, rnc, tipo_identificacion) VALUES (${empresa}, 'Abogados SRL', '101000002', 'rnc') RETURNING id`;
    await tx`INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence) VALUES (${empresa}, 'B01', 1, 100, 1, '2027-12-31')`;
  });
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id IN (${ana}, ${bea})`;
  } finally { await sql.end(); }
});

const nuevaFactura = () => comoAna((tx) => guardarBorradorFactura(tx, {
  empresaId: empresa, usuarioId: ana, clienteId: cliente, tipo: "B01", fecha: "2026-10-05", vence: "2026-10-05", moneda: "DOP", tasa: 10000n, notas: null,
  lineas: [{ servicioId: null, descripcion: "Asesoría", cantidad: 10000n, precio: 1000000n, impuestoIds: [imp] }],
}));
const pedir = async (tipo, id) => comoAna(async (tx) => solicitarAprobacion(tx, { empresaId: empresa, usuarioId: ana, tipo, referenciaId: id, ...(await tituloDe(tx, tipo, id)) }));
const estadoFactura = (id) => comoAna((tx) => tx`SELECT estado, ncf FROM facturas WHERE id = ${id}`).then((f) => ({ ...f[0] }));

test("pedir aprobación deja el borrador quieto: no se edita, no se descarta y no se pide dos veces", conBase, async () => {
  const id = await nuevaFactura();
  const a = await pedir("factura", id);
  const x = await comoAna((tx) => aprobacionDe(tx, "factura", id));
  assert.equal(x.estado, "pendiente");
  assert.match(x.titulo, /Emitir B01 a Cliente SRL/);
  assert.deepEqual(await estadoFactura(id), { estado: "borrador", ncf: null }, "no salió ningún NCF");
  await assert.rejects(pedir("factura", id), /Ya está esperando/);
  const datos = { empresaId: empresa, usuarioId: ana, clienteId: cliente, tipo: "B01", fecha: "2026-10-05", vence: "2026-10-05", moneda: "DOP", tasa: 10000n, notas: "cambio", lineas: [{ servicioId: null, descripcion: "X", cantidad: 10000n, precio: 100n, impuestoIds: [imp] }], facturaId: id };
  await assert.rejects(comoAna((tx) => guardarBorradorFactura(tx, datos)), /esperando aprobación/);
  const { descartarBorradorFactura } = await import("../lib/ventas.ts");
  await assert.rejects(comoAna((tx) => descartarBorradorFactura(tx, id)), /esperando aprobación/);
  assert.ok(a);
});

test("quien lo preparó no lo aprueba ni lo devuelve; otra persona lo aprueba y se emite", conBase, async () => {
  const id = await nuevaFactura();
  const apr = await pedir("factura", id);
  await assert.rejects(comoAna((tx) => aprobar(tx, { empresaId: empresa, usuarioId: ana, id: apr })), /otra persona/);
  await assert.rejects(comoAna((tx) => devolver(tx, { empresaId: empresa, usuarioId: ana, id: apr, motivo: "Está mal" })), /no lo devuelve/);
  await comoBea((tx) => aprobar(tx, { empresaId: empresa, usuarioId: bea, id: apr }));
  const f = await estadoFactura(id);
  assert.equal(f.estado, "emitida");
  assert.match(f.ncf, /^B01/);
  const [e] = await comoBea((tx) => tx`SELECT emitida_por FROM facturas WHERE id = ${id}`);
  assert.equal(e.emitida_por, bea, "la emitió quien aprobó");
  const x = await comoBea((tx) => aprobacionDe(tx, "factura", id));
  assert.equal(x.estado, "aprobada");
  assert.equal(x.resueltoPor, "Bea");
  await assert.rejects(comoBea((tx) => aprobar(tx, { empresaId: empresa, usuarioId: bea, id: apr })), /ya no está pendiente/);
});

test("devolver pide qué corregir, cuenta las veces y se puede volver a enviar; el historial queda", conBase, async () => {
  const id = await nuevaFactura();
  const apr = await pedir("factura", id);
  await assert.rejects(comoBea((tx) => devolver(tx, { empresaId: empresa, usuarioId: bea, id: apr, motivo: " " })), /qué hay que corregir/);
  await comoBea((tx) => devolver(tx, { empresaId: empresa, usuarioId: bea, id: apr, motivo: "El cliente es otro" }));
  let x = await comoAna((tx) => aprobacionDe(tx, "factura", id));
  assert.deepEqual([x.estado, x.vecesDevuelta, x.motivo], ["devuelta", 1, "El cliente es otro"]);
  assert.equal((await estadoFactura(id)).estado, "borrador", "sigue siendo borrador");
  // Devuelto, ya se puede editar y volver a pedir.
  const datos = { empresaId: empresa, usuarioId: ana, clienteId: cliente, tipo: "B01", fecha: "2026-10-05", vence: "2026-10-05", moneda: "DOP", tasa: 10000n, notas: "corregido", lineas: [{ servicioId: null, descripcion: "X", cantidad: 10000n, precio: 100000n, impuestoIds: [imp] }], facturaId: id };
  await comoAna((tx) => guardarBorradorFactura(tx, datos));
  assert.equal(await pedir("factura", id), apr, "es el mismo trabajo");
  await comoBea((tx) => devolver(tx, { empresaId: empresa, usuarioId: bea, id: apr, motivo: "Falta el vencimiento" }));
  x = await comoAna((tx) => aprobacionDe(tx, "factura", id));
  assert.equal(x.vecesDevuelta, 2);
  await pedir("factura", id);
  await comoBea((tx) => aprobar(tx, { empresaId: empresa, usuarioId: bea, id: apr }));
  const h = await comoAna((tx) => historialDe(tx, apr));
  assert.deepEqual(h.map((e) => e.evento), ["solicitada", "devuelta", "reenviada", "devuelta", "reenviada", "aprobada"]);
  assert.equal(h[1].nota, "El cliente es otro");
  assert.equal(h[1].quien, "Bea");
  await assert.rejects(comoAna((tx) => tx`UPDATE aprobaciones_eventos SET nota = 'x'`), /no se cambia|permission denied/);
  assert.equal((await comoAna((tx) => aprobacionDe(tx, "factura", id))).vecesDevuelta, 2, "las devoluciones quedan contadas");
});

test("una compra también espera, se aprueba y queda registrada; la lista muestra lo pendiente", conBase, async () => {
  const compra = await comoAna((tx) => guardarBorradorCompra(tx, {
    empresaId: empresa, usuarioId: ana, proveedorId: proveedor, tipo: "B01", ncf: "B0100000099", fecha: "2026-10-05", vence: "2026-10-05", moneda: "DOP", tasa: 10000n,
    tipoGasto: "02", itbisAlCosto: false, notas: null,
    lineas: [{ descripcion: "Honorarios", clase: "servicio", cantidad: 10000n, precio: 500000n, cuentaId: cuentas["610205"], impuestoIds: [imp] }],
  }));
  const apr = await pedir("compra", compra);
  const lista = await comoBea((tx) => listarAprobaciones(tx, ["pendiente"]));
  assert.ok(lista.some((a) => a.id === apr && a.tipo === "compra"));
  await comoBea((tx) => aprobar(tx, { empresaId: empresa, usuarioId: bea, id: apr }));
  const [c] = await comoBea((tx) => tx`SELECT estado FROM compras WHERE id = ${compra}`);
  assert.equal(c.estado, "registrada");
  assert.equal((await comoBea((tx) => listarAprobaciones(tx, ["pendiente"]))).some((a) => a.id === apr), false);
});

test("si alguien con el permiso completo lo emite directo, la solicitud pendiente queda aprobada por él", conBase, async () => {
  const id = await nuevaFactura();
  const apr = await pedir("factura", id);
  await comoBea(async (tx) => {
    await emitir(tx, { empresaId: empresa, usuarioId: bea, facturaId: id });
    await cerrarSiPendiente(tx, { empresaId: empresa, usuarioId: bea, tipo: "factura", referenciaId: id });
  });
  const x = await comoBea((tx) => aprobacionDe(tx, "factura", id));
  assert.deepEqual([x.estado, x.resueltoPor], ["aprobada", "Bea"]);
  const h = await comoBea((tx) => historialDe(tx, apr));
  assert.deepEqual(h.map((e) => e.evento), ["solicitada", "aprobada"]);
  assert.equal((await comoBea((tx) => listarAprobaciones(tx, ["pendiente"]))).some((a) => a.id === apr), false);
});

test("los campos de un formulario se guardan y se vuelven a armar tal cual; un archivo no se puede guardar", () => {
  const fd = new FormData();
  fd.append("monto", "1,500.00");
  fd.append("categoria", "Nómina");
  fd.append("$ACTION_ID_abc", "x");
  fd.append("vacio", "");
  fd.append("archivo", new File([], "vacio.pdf"));
  const campos = capturarCampos(fd);
  assert.deepEqual(campos, [["monto", "1,500.00"], ["categoria", "Nómina"], ["vacio", ""]], "sin lo interno de Next ni archivos vacíos");
  const otra = formularioDe(campos);
  assert.equal(otra.get("monto"), "1,500.00");
  assert.equal(otra.get("categoria"), "Nómina");
  const con = new FormData();
  con.append("constancia", new File(["contenido"], "c.pdf"));
  assert.throws(() => capturarCampos(con), /lleva un archivo/);
});

test("una acción guardada espera, otra persona la reclama, si falla vuelve a quedar pendiente y quien la pidió puede descartarla", conBase, async () => {
  const id = await comoAna((tx) => pedirAccion(tx, {
    empresaId: empresa, usuarioId: ana, accion: "registrarSalida", args: ["a1"], titulo: "Registrar salida: Gasto de oficina de RD$1,500.00",
    fd: Object.assign(new FormData(), {}),
  }));
  const x = (await comoBea((tx) => listarAprobaciones(tx, ["pendiente"]))).find((a) => a.id === id);
  assert.deepEqual([x.tipo, x.estado, x.titulo], ["accion", "pendiente", "Registrar salida: Gasto de oficina de RD$1,500.00"]);
  await assert.rejects(comoAna((tx) => reclamarAccion(tx, { empresaId: empresa, usuarioId: ana, id })), /otra persona/);
  const r = await comoBea((tx) => reclamarAccion(tx, { empresaId: empresa, usuarioId: bea, id }));
  assert.deepEqual([r.payload.accion, r.payload.args], ["registrarSalida", ["a1"]]);
  assert.equal((await comoBea((tx) => aprobacionDe(tx, "accion", x.referenciaId))).estado, "aprobada", "reclamada: nadie más la ejecuta");
  await assert.rejects(comoBea((tx) => reclamarAccion(tx, { empresaId: empresa, usuarioId: bea, id })), /ya no está pendiente/);
  // Falló al ejecutarla: vuelve a quedar pendiente.
  await comoBea((tx) => liberarAccion(tx, id));
  assert.equal((await comoBea((tx) => aprobacionDe(tx, "accion", x.referenciaId))).estado, "pendiente");
  await assert.rejects(comoBea((tx) => cancelarAccion(tx, { empresaId: empresa, usuarioId: bea, id })), /Solo quien lo pidió/);
  await comoAna((tx) => cancelarAccion(tx, { empresaId: empresa, usuarioId: ana, id }));
  assert.equal((await comoAna((tx) => aprobacionDe(tx, "accion", x.referenciaId))).estado, "cancelada");
  assert.equal((await comoAna((tx) => listarAprobaciones(tx, ["pendiente", "devuelta"]))).some((a) => a.id === id), false, "descartada ya no sale en la bandeja");
  // Una aprobada de verdad deja su evento.
  const otra = await comoAna((tx) => pedirAccion(tx, { empresaId: empresa, usuarioId: ana, accion: "fijarBloqueo", args: [], titulo: "Cerrar el período contable" }));
  await comoBea(async (tx) => { await reclamarAccion(tx, { empresaId: empresa, usuarioId: bea, id: otra }); await registrarAprobada(tx, { empresaId: empresa, usuarioId: bea, id: otra }); });
  assert.deepEqual((await comoBea((tx) => historialDe(tx, otra))).map((e) => e.evento), ["solicitada", "aprobada"]);
  // Las acciones se pueden devolver como cualquier otra solicitud.
  const dev = await comoAna((tx) => pedirAccion(tx, { empresaId: empresa, usuarioId: ana, accion: "anularCompra", args: ["c1"], titulo: "Anular una compra" }));
  await comoBea((tx) => devolver(tx, { empresaId: empresa, usuarioId: bea, id: dev, motivo: "Falta el motivo" }));
  assert.equal((await comoAna((tx) => listarAprobaciones(tx, ["devuelta"]))).find((a) => a.id === dev).motivo, "Falta el motivo");
});
