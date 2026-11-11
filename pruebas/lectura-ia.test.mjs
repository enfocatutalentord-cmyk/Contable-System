// Entrega 8c: la lectura con IA. Sin llamar a Google: se prueba con respuestas simuladas qué se envía, qué se acepta y qué se marca.
import assert from "node:assert/strict";
import { test } from "node:test";
import { combinar, ErrorLectura, interpretar, leerFactura, MODELO_IA, textoDeRespuesta } from "../lib/lectura-ia.ts";

const buena = { es_factura: true, legibilidad: "clara", nombre_emisor: "Ferretería Uno", rnc_emisor: "101-01781-3", nombre_comprador: "Salón Rosa", rnc_comprador: "132151119", ncf: "B0100000777", fecha: "2026-10-15", subtotal: "2,000.00", itbis: "360.00", total: "2360.00", dudosos: [] };
const respuesta = (o) => ({ object: "interaction", status: "completed", steps: [{ type: "thought" }, { type: "model_output", content: [{ type: "text", text: JSON.stringify(o) }] }] });
const vacio = { rnc: null, nombre: null, ncf: null, fecha: null, subtotal: null, itbis: null, total: null };

test("toma el texto del paso correcto y rechaza lo incompleto", () => {
  assert.equal(JSON.parse(textoDeRespuesta(respuesta({ a: 1 }))).a, 1);
  assert.throws(() => textoDeRespuesta({ status: "incomplete", steps: [] }), ErrorLectura);
  assert.throws(() => textoDeRespuesta({ status: "completed", steps: [] }), ErrorLectura);
});

test("normaliza lo bueno y descarta lo que no tiene forma", () => {
  const l = interpretar(buena);
  assert.equal(l.rncEmisor, "101017813");
  assert.equal(l.subtotal, "2000.00");
  const m = interpretar({ ...buena, rnc_emisor: "123", ncf: "X99", fecha: "15/10/2026", total: "mucho", dudosos: ["itbis", "inventado"] });
  assert.equal(m.rncEmisor, null); assert.equal(m.ncf, null); assert.equal(m.fecha, null); assert.equal(m.total, null);
  assert.deepEqual([...m.dudosos].sort(), ["fecha", "itbis", "ncf", "rnc_emisor", "total"]);
  assert.equal(interpretar({ ...buena, fecha: "2026-02-30" }).fecha, null, "fecha imposible");
});

test("imagen poco clara o RNC con dígito malo: todo a revisar", () => {
  const mala = interpretar({ ...buena, legibilidad: "mala" });
  assert.equal(mala.legible, false);
  assert.equal(mala.dudosos.length, 9);
  const c = combinar(vacio, "gasto", mala, null);
  assert.match(c.marcas[0].texto, /no se ve del todo claro/);
  assert.equal(c.valores.ncf, "B0100000777", "llena, pero marcado");
  assert.ok(c.marcas.some((m) => m.campo === "ncf"));
  const d = interpretar({ ...buena, rnc_emisor: "101000080" });
  assert.equal(d.rncEmisor, "101000080"); assert.ok(d.dudosos.includes("rnc_emisor"));
  assert.equal(interpretar({ ...buena, legibilidad: undefined }).legible, false, "sin respuesta, no se da por clara");
});

test("llena solo lo vacío; lo que había se respeta y se avisa", () => {
  const l = interpretar(buena);
  const c = combinar({ ...vacio, ncf: "B0100000999" }, "gasto", l, "132151119");
  assert.equal(c.valores.ncf, "B0100000999");
  assert.equal(c.valores.rnc, "101017813");
  assert.ok(!c.llenados.includes("ncf"));
  assert.match(c.marcas.find((m) => m.campo === "ncf").texto, /B0100000999.*B0100000777/);
  assert.equal(combinar({ ...vacio, total: "2360" }, "gasto", l, null).marcas.length, 0, "2360 y 2360.00 son iguales");
});

test("venta: la contraparte es el comprador", () => {
  const c = combinar(vacio, "ingreso", interpretar({ ...buena, rnc_emisor: "132151119", rnc_comprador: "101017813", nombre_comprador: "Cliente X" }), "132151119");
  assert.equal(c.valores.rnc, "101017813"); assert.equal(c.valores.nombre, "Cliente X");
  assert.equal(c.marcas.length, 0);
});

test("avisos: otra empresa, no cuadra, dudoso y no es factura", () => {
  const otra = combinar(vacio, "gasto", interpretar(buena), "999999999");
  assert.equal(otra.marcas[0].nivel, "error"); assert.match(otra.marcas[0].texto, /otra empresa/);
  assert.match(combinar(vacio, "gasto", interpretar({ ...buena, total: "2500.00" }), null).marcas[0].texto, /diferencia de RD\$140\.00/);
  assert.equal(combinar(vacio, "gasto", interpretar({ ...buena, dudosos: ["ncf"] }), null).marcas[0].campo, "ncf");
  const no = combinar(vacio, "gasto", interpretar({ ...buena, es_factura: false }), null);
  assert.equal(no.valores.ncf, null); assert.deepEqual(no.llenados, []);
});

test("reintenta cuando Google está saturado y avisa si sigue", async () => {
  let n = 0;
  const pedir = async () => (++n < 3 ? new Response("{}", { status: 503 }) : new Response(JSON.stringify(respuesta(buena)), { status: 200 }));
  const l = await leerFactura({ tipo: "image/png", bytes: new Uint8Array([1]) }, { llave: "s", pedir, esperaMs: 0 });
  assert.equal(l.ncf, "B0100000777"); assert.equal(n, 3);
  n = 0;
  await assert.rejects(leerFactura({ tipo: "image/png", bytes: new Uint8Array([1]) }, { llave: "s", esperaMs: 0, pedir: async () => { n++; return new Response("{}", { status: 503 }); } }), /saturado/);
  assert.equal(n, 4);
});

test("el pedido a Google lleva modelo, archivo y formato, y los errores no dicen la llave", async () => {
  let pedido;
  const ok = async (url, o) => { pedido = { url, o }; return new Response(JSON.stringify(respuesta(buena)), { status: 200 }); };
  const l = await leerFactura({ tipo: "application/pdf", bytes: new Uint8Array([1, 2, 3]) }, { llave: "secreta", pedir: ok });
  assert.equal(l.ncf, "B0100000777");
  const b = JSON.parse(pedido.o.body);
  assert.equal(b.model, MODELO_IA);
  assert.deepEqual(b.input[0], { type: "document", data: "AQID", mime_type: "application/pdf" });
  assert.equal(b.response_format.mime_type, "application/json");
  assert.equal(pedido.o.headers["x-goog-api-key"], "secreta");
  await leerFactura({ tipo: "image/png", bytes: new Uint8Array([1]) }, { llave: "s", pedir: ok });
  assert.equal(JSON.parse(pedido.o.body).input[0].type, "image");
  for (const [status, re] of [[429, /cupo/], [403, /llave/], [400, /no pudo leer/]]) {
    await assert.rejects(leerFactura({ tipo: "image/png", bytes: new Uint8Array([1]) }, { llave: "secreta", pedir: async () => new Response("{}", { status }) }), (e) => re.test(e.message) && !e.message.includes("secreta"));
  }
  await assert.rejects(leerFactura({ tipo: "image/png", bytes: new Uint8Array([1]) }, { llave: "s", pedir: async () => { throw new Error("red"); } }), /hablar/);
  await assert.rejects(leerFactura({ tipo: "image/png", bytes: new Uint8Array([1]) }, { llave: "" , pedir: ok }), /llave/);
});
