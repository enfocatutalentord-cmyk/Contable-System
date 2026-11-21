// Prioridad 2.2 (P2b): chat interno del equipo (conversaciones, sin leer y quién ve qué) y rentabilidad por cliente (tiempo de la bitácora por el costo
// de la hora). Crea su propia firma y la borra al final.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { ErrorBitacora, leerGestion, leerMinutos, verTiempo } from "../lib/bitacora.ts";
import { ErrorChat, HILO_GENERAL, hiloDeCliente, hiloDeTrabajo, leerHilo, leerTexto } from "../lib/chat.ts";
import { cobradoPorHora, costoDe, leerPeriodo, margen } from "../lib/rentabilidad.ts";

const U = "11111111-2222-3333-4444-555555555555";
const V = "66666666-7777-8888-9999-aaaaaaaaaaaa";

test("las conversaciones se leen de su clave y lo que no tiene la forma se descarta", () => {
  assert.deepEqual(leerHilo("general"), HILO_GENERAL);
  assert.deepEqual(leerHilo(` c:${U.toUpperCase()} `), hiloDeCliente(U));
  assert.deepEqual(leerHilo(`t:${U}:${V}`), hiloDeTrabajo(U, V));
  assert.equal(hiloDeTrabajo(U, V).solicitudId, V);
  for (const mala of [null, undefined, "", "x", "c:123", `t:${U}`, `c:${U}:${V}`, `general:${U}`]) assert.equal(leerHilo(mala), null, String(mala));
});

test("el mensaje conserva los renglones, no va vacío ni pasa de 2,000 caracteres", () => {
  assert.equal(leerTexto("  Hola\r\nequipo \n"), "Hola\nequipo");
  assert.throws(() => leerTexto("   \n "), ErrorChat);
  assert.equal(leerTexto("a".repeat(2000)).length, 2000);
  assert.throws(() => leerTexto("a".repeat(2001)), /hasta 2,000|hasta 2\.000/);
});

test("el tiempo de una gestión se escribe en horas y minutos", () => {
  assert.equal(leerMinutos("", ""), null);
  assert.equal(leerMinutos("0", "0"), null, "cero no cuenta como tiempo");
  assert.equal(leerMinutos("1", "30"), 90);
  assert.equal(leerMinutos("", "45"), 45);
  assert.equal(leerMinutos("2", ""), 120);
  assert.equal(leerMinutos("", "100"), 100, "los minutos pueden pasar de 59");
  assert.equal(leerMinutos("24", ""), 1440);
  for (const mal of [["25", ""], ["1", "x"], ["1.5", ""], ["-1", ""], ["", "1500"]]) assert.throws(() => leerMinutos(...mal), ErrorBitacora, mal.join("|"));
  assert.equal(verTiempo(null), "—");
  assert.equal(verTiempo(90), "1 h 30 min");
  assert.equal(verTiempo(120), "2 h");
  assert.equal(verTiempo(45), "45 min");
  const fd = new FormData();
  fd.set("tipo", "llamada"); fd.set("descripcion", "Llamada con el cliente"); fd.set("horas", "1"); fd.set("minutos", "15");
  assert.equal(leerGestion(fd, "2026-11-21").minutos, 75);
});

test("costo, margen y cobrado por hora salen en centavos sin perder nada", () => {
  assert.equal(costoDe(90, 75000n), 112500n, "1 h 30 min a RD$750 la hora = RD$1,125.00");
  assert.equal(costoDe(1, 75000n), 1250n);
  assert.equal(costoDe(0, 75000n), 0n);
  assert.equal(costoDe(7, 10000n), 1167n, "se redondea al centavo");
  assert.equal(margen(500000n, 387500n), "77.5");
  assert.equal(margen(500000n, -250000n), "-50.0");
  assert.equal(margen(0n, 100n), null, "sin cobrado no hay margen");
  assert.equal(cobradoPorHora(500000n, 120), 250000n);
  assert.equal(cobradoPorHora(500000n, 0), null);
});

test("el período es un mes o un año completo", () => {
  assert.deepEqual(leerPeriodo("2026-02", undefined, "2026-11-21"), { tipo: "mes", desde: "2026-02-01", hasta: "2026-02-28", etiqueta: "2026-02", mes: "2026-02", anio: "2026" });
  assert.equal(leerPeriodo(undefined, undefined, "2026-11-21").desde, "2026-11-01");
  assert.equal(leerPeriodo("2028-02", undefined, "2026-11-21").hasta, "2028-02-29");
  assert.equal(leerPeriodo("mal", undefined, "2026-11-21").mes, "2026-11");
  const a = leerPeriodo(undefined, "2026", "2026-11-21");
  assert.deepEqual([a.tipo, a.desde, a.hasta], ["anio", "2026-01-01", "2026-12-31"]);
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, beto, firma, propia, clienteA, clienteB, chat, rent, trabajoA;
const leer = (empresa, fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});

before(async () => {
  if (!sql) return;
  process.env.DATABASE_URL = url;
  chat = await import("../lib/chat.ts");
  rent = await import("../lib/rentabilidad.ts");
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-chat-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: beto }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`beto-chat-${marca}@x.do`}, 'Beto', 'x') RETURNING id`;
  [{ id: firma }] = await sql`INSERT INTO firmas (nombre) VALUES (${`Firma chat ${marca}`}) RETURNING id`;
  [{ id: propia }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Empire Chat SRL', '130000140', ${firma}) RETURNING id`;
  [{ id: clienteA }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Cliente A SRL', '130000141', ${firma}) RETURNING id`;
  [{ id: clienteB }] = await sql`INSERT INTO empresas (nombre, rnc, firma_id) VALUES ('Cliente B SRL', '130000142', ${firma}) RETURNING id`;
  [{ id: trabajoA }] = await leer(clienteA, (tx) => tx`
    INSERT INTO solicitudes (empresa_id, origen, servicio, descripcion) VALUES (${clienteA}, 'escrito', 'Activación de RNC', 'Activar el RNC') RETURNING id`);
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM chat_mensajes WHERE firma_id = ${firma}`;
    await sql`DELETE FROM empresas WHERE firma_id = ${firma}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id IN (${ana}, ${beto})`;
  } finally {
    await sql.end();
    const { db } = await import("../lib/db.ts");
    await db().end();
  }
});

test("una conversación guarda los mensajes en orden y cada quien ve los suyos sin leer", conBase, async () => {
  await chat.enviarMensaje(firma, ana, HILO_GENERAL, "Buenos días, equipo");
  await chat.enviarMensaje(firma, beto, HILO_GENERAL, "Buenos días, Ana\nya reviso lo del IT-1");
  const m = await chat.mensajesDe(firma, "general");
  assert.deepEqual(m.map((x) => [x.autor, x.texto]), [["Ana", "Buenos días, equipo"], ["Beto", "Buenos días, Ana\nya reviso lo del IT-1"]]);
  assert.equal(await chat.sinLeer(firma, ana, [clienteA, clienteB]), 1, "Ana ve solo el de Beto; lo suyo no cuenta");
  assert.equal(await chat.sinLeer(firma, beto, [clienteA, clienteB]), 0, "Beto escribió después del mensaje de Ana: quedó leído");
  await chat.enviarMensaje(firma, ana, HILO_GENERAL, "Gracias");
  assert.equal(await chat.sinLeer(firma, beto, []), 1, "el de Ana que llegó después sí cuenta");
  await chat.marcarLeido(firma, beto, "general");
  assert.equal(await chat.sinLeer(firma, ana, []), 0, "Ana también escribió después: quedó al día");
  await chat.marcarLeido(firma, ana, "general");
  assert.equal(await chat.sinLeer(firma, ana, [clienteA, clienteB]), 0);
  await chat.enviarMensaje(firma, beto, HILO_GENERAL, "Otro más");
  assert.equal(await chat.sinLeer(firma, ana, []), 1, "lo nuevo vuelve a contar");
  assert.equal(await chat.sinLeer(firma, beto, []), 0, "lo suyo no cuenta");
});

test("lo de un cliente solo cuenta y se lista para quien ve a ese cliente", conBase, async () => {
  await chat.enviarMensaje(firma, beto, hiloDeCliente(clienteA), "El cliente A mandó la factura de luz");
  await chat.enviarMensaje(firma, beto, hiloDeCliente(clienteB), "El cliente B pidió una certificación");
  await chat.enviarMensaje(firma, beto, hiloDeTrabajo(clienteA, trabajoA), "Falta la cédula del representante");
  const antes = await chat.sinLeer(firma, ana, [clienteA, clienteB]);
  assert.equal(await chat.sinLeer(firma, ana, [clienteA]), antes - 1, "sin el cliente B se quita su mensaje");
  assert.equal(await chat.sinLeer(firma, ana, []), antes - 3, "sin ningún cliente solo quedan los generales");
  const hilos = await chat.hilosDe(firma, ana, [clienteA]);
  assert.deepEqual(hilos.map((h) => h.clave).sort(), ["general", `c:${clienteA}`, `t:${clienteA}:${trabajoA}`].sort());
  const h = hilos.find((x) => x.clave === `t:${clienteA}:${trabajoA}`);
  assert.equal(h.sin_leer, 1);
  assert.equal(h.ultimo_autor, "Beto");
  assert.equal(h.solicitud_id, trabajoA);
  assert.equal(h.empresa_id, clienteA);
  assert.equal((await chat.titulosDeTrabajos([{ empresaId: clienteA, solicitudId: trabajoA }])).get(trabajoA), "Activación de RNC");
  assert.equal(await chat.existeTrabajo(clienteA, trabajoA), true);
  assert.equal(await chat.existeTrabajo(clienteB, trabajoA), false, "el trabajo es de otro cliente");
});

test("la base rechaza un mensaje con la clave de otra conversación", conBase, async () => {
  await assert.rejects(sql`INSERT INTO chat_mensajes (firma_id, hilo, empresa_id, autor_id, texto) VALUES (${firma}, ${`c:${clienteB}`}, ${clienteA}, ${ana}, 'x')`, /chat_hilo_check/);
  await assert.rejects(sql`INSERT INTO chat_mensajes (firma_id, hilo, autor_id, texto) VALUES (${firma}, ${`c:${clienteA}`}, ${ana}, 'x')`, /chat_hilo_check/);
  await assert.rejects(sql`INSERT INTO chat_mensajes (firma_id, hilo, autor_id, texto) VALUES (${firma}, 'general', ${ana}, '   ')`, /check/);
});

test("la rentabilidad junta lo cobrado y el tiempo anotado de cada cliente", conBase, async () => {
  const cuenta = async (tx, codigo) => (await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, nivel, de_detalle) VALUES (${propia}, ${codigo}, ${`Cuenta ${codigo}`}, 'activo', 1, true) RETURNING id`)[0].id;
  // Un cliente de la propia enlazado a cada empresa y un anticipo recibido del cliente A (el mismo camino que un cobro aplicado a una factura).
  await leer(propia, async (tx) => {
    const [{ id: cl }] = await tx`INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion, empresa_vinculada_id) VALUES (${propia}, 'Cliente A SRL', '130000141', 'rnc', ${clienteA}) RETURNING id`;
    const [b, c] = [await cuenta(tx, "990001"), await cuenta(tx, "990002")];
    await tx`INSERT INTO anticipos (empresa_id, numero, cliente_id, fecha, monto, cuenta_destino_id, cuenta_anticipo_id, forma_pago, creado_por)
             VALUES (${propia}, 1, ${cl}, '2026-11-10', 15000, ${b}, ${c}, 'transferencia', ${ana}),
                    (${propia}, 2, ${cl}, '2026-10-10', 99999, ${b}, ${c}, 'transferencia', ${ana})`;
    await tx`INSERT INTO anticipos (empresa_id, numero, cliente_id, fecha, monto, cuenta_destino_id, cuenta_anticipo_id, forma_pago, anulado, creado_por)
             VALUES (${propia}, 3, ${cl}, '2026-11-12', 5000, ${b}, ${c}, 'transferencia', true, ${ana})`;
  });
  await leer(clienteA, (tx) => tx`
    INSERT INTO gestiones (empresa_id, fecha, tipo, descripcion, minutos) VALUES
      (${clienteA}, '2026-11-05', 'llamada', 'Llamada', 90), (${clienteA}, '2026-11-18', 'carta', 'Carta', 150),
      (${clienteA}, '2026-11-19', 'otro', 'Sin tiempo', NULL), (${clienteA}, '2026-10-02', 'otro', 'Del mes anterior', 600)`);
  await leer(clienteB, (tx) => tx`INSERT INTO gestiones (empresa_id, fecha, tipo, descripcion, minutos) VALUES (${clienteB}, '2026-11-06', 'llamada', 'Llamada', 60)`);

  const p = leerPeriodo("2026-11", undefined, "2026-11-21");
  const clientes = [{ id: clienteA, nombre: "Cliente A SRL" }, { id: clienteB, nombre: "Cliente B SRL" }];
  let filas = await rent.rentabilidadPorCliente(propia, clientes, p, 75000n);
  const a = filas.find((f) => f.empresaId === clienteA);
  assert.deepEqual([a.cobrado, a.minutos, a.gestiones, a.sinTiempo, a.costo, a.ganancia], [1500000n, 240, 3, 1, 300000n, 1200000n],
    "cobrado del mes sin el anulado ni el de octubre; 4 h a RD$750 = RD$3,000");
  const b = filas.find((f) => f.empresaId === clienteB);
  assert.deepEqual([b.cobrado, b.minutos, b.costo, b.ganancia], [0n, 60, 75000n, -75000n], "tiempo sin cobros: pérdida");
  assert.equal(filas[0].empresaId, clienteA, "primero el que más cobró");

  filas = await rent.rentabilidadPorCliente(propia, clientes, p, null);
  assert.deepEqual([filas[0].costo, filas[0].ganancia], [null, null], "sin costo de la hora no hay ganancia");

  filas = await rent.rentabilidadPorCliente(propia, clientes, leerPeriodo(undefined, "2026", "2026-11-21"), 75000n);
  assert.deepEqual([filas.find((f) => f.empresaId === clienteA).cobrado, filas.find((f) => f.empresaId === clienteA).minutos], [11499900n, 840n].map((x, i) => (i ? Number(x) : x)), "el año suma octubre");

  filas = await rent.rentabilidadPorCliente(null, clientes, p, 75000n);
  assert.equal(filas.find((f) => f.empresaId === clienteA).cobrado, 0n, "sin empresa propia no hay cobros que contar");
});

test("el costo de la hora vive en la firma", conBase, async () => {
  await sql`UPDATE firmas SET costo_hora = 750.5 WHERE id = ${firma}`;
  assert.equal((await sql`SELECT costo_hora::text AS c FROM firmas WHERE id = ${firma}`)[0].c, "750.50");
  await assert.rejects(sql`UPDATE firmas SET costo_hora = -1 WHERE id = ${firma}`, /check/);
  await assert.rejects(sql`UPDATE gestiones SET minutos = 1441 WHERE empresa_id = ${clienteB}`, /check/);
});
