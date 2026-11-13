// Factura electrónica con emisión propia, entrega E2a: certificado cifrado, XML de E31/E32/E34 según el esquema de la DGII, firma
// XMLDSig RSA-SHA256 verificable, código de seguridad, conexión con la DGII (simulada) y XML de prueba desde una factura del sistema.
// Usa un certificado de prueba generado aquí; nunca uno real.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import forge from "node-forge";
import postgres from "postgres";
import { CATALOGO_RD, nivelDeCodigo, TIPO_POR_CLASE } from "../lib/catalogo-rd.ts";
import { leerP12 } from "../lib/ecf-certificado.ts";
import { cifrar, descifrar, hayLlave, nuevaLlave } from "../lib/ecf-cifrado.ts";
import { consultarResultado, enviarEcf, ErrorDgii, obtenerToken } from "../lib/ecf-dgii.ts";
import { abrirCertificado, certificadoActivo, certificadosDeEmpresa, compartirCertificado, datosDeFactura, guardarCertificado, miCertificado, probarConexion, retirarCertificado, xmlDePrueba } from "../lib/ecf-emision.ts";
import { codigoSeguridad, firmaValida, firmarXml } from "../lib/ecf-firma.ts";
import { armarXml, calcularTotales, enlaceQr, escapar, fechaHoraFirma, revisarEcf } from "../lib/ecf-xml.ts";
import { guardarBorradorFactura } from "../lib/ventas.ts";

process.env.ECF_LLAVE = nuevaLlave();

// Certificado de prueba (.p12) con el campo SN como los de la Cámara de Comercio.
function p12DePrueba(clave, vence = "2028-01-01") {
  const k = forge.pki.rsa.generateKeyPair(2048);
  const c = forge.pki.createCertificate();
  c.publicKey = k.publicKey; c.serialNumber = "0A";
  c.validity.notBefore = new Date("2026-01-01"); c.validity.notAfter = new Date(vence);
  c.setSubject([{ name: "commonName", value: "PERSONA DE PRUEBA" }, { type: "2.5.4.5", value: "IDCDO-00100000001" }]);
  c.setIssuer([{ name: "commonName", value: "CA de prueba" }]);
  c.sign(k.privateKey, forge.md.sha256.create());
  return Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(k.privateKey, [c], clave, { algorithm: "3des" })).getBytes(), "binary");
}
const P12 = p12DePrueba("clave-prueba");
const CERT = leerP12(P12, "clave-prueba");

const emisor = { rnc: "133097346", razonSocial: "Empire Tax'N Legal SRL", direccion: "Plaza Coral Garden, local K01", correo: "empire@x.do" };
const e31 = {
  tipo: "31", encf: "E310000000001", venceSecuencia: "2027-12-31", tipoIngresos: "01", tipoPago: 2, fechaLimitePago: "2026-12-15", emisor,
  fechaEmision: "2026-11-15", comprador: { rnc: "132151119", razonSocial: "Goemhy Services SRL" },
  items: [{ nombre: "Iguala & <asesoría>", indicador: 1, bienServicio: 2, cantidad: 10000n, precio: 1500000n, monto: 1500000n },
          { nombre: "Trámite", indicador: 4, bienServicio: 2, cantidad: 20000n, precio: 50000n, monto: 100000n }],
};

test("cifrado: ida y vuelta, y no abre con otra llave ni alterado", () => {
  const g = cifrar(Buffer.from("secreto"));
  assert.equal(descifrar(g).toString(), "secreto");
  assert.throws(() => descifrar(g, nuevaLlave()), /llave ECF_LLAVE cambió/);
  g[g.length - 1] ^= 1;
  assert.throws(() => descifrar(g), /alteró/);
  assert.equal(hayLlave(""), false);
});

test("certificado: titular, identificación, vigencia y contraseña errada", () => {
  assert.equal(CERT.titular, "PERSONA DE PRUEBA");
  assert.equal(CERT.identificacion, "IDCDO-00100000001");
  assert.deepEqual([CERT.desde, CERT.vence], ["2026-01-01", "2028-01-01"]);
  assert.throws(() => leerP12(P12, "otra"), /contraseña/);
  assert.throws(() => leerP12(Buffer.from("no es un p12"), "x"), /no es un certificado/);
});

test("XML: orden del esquema, escapado, totales y sin etiquetas vacías", () => {
  const t = calcularTotales(e31.items);
  assert.deepEqual([t.gravado[0], t.exento, t.itbis[0], t.total], [1500000n, 100000n, 270000n, 1870000n]);
  const x = armarXml(e31, "15-11-2026 10:30:05");
  assert.match(x, /^<\?xml version="1\.0" encoding="utf-8"\?><ECF><Encabezado><Version>1\.0<\/Version><IdDoc><TipoeCF>31<\/TipoeCF><eNCF>E310000000001<\/eNCF><FechaVencimientoSecuencia>31-12-2027<\/FechaVencimientoSecuencia>/);
  assert.match(x, /<MontoGravadoTotal>15000\.00<\/MontoGravadoTotal><MontoGravadoI1>15000\.00<\/MontoGravadoI1><MontoExento>1000\.00<\/MontoExento><ITBIS1>18<\/ITBIS1><TotalITBIS>2700\.00<\/TotalITBIS><TotalITBIS1>2700\.00<\/TotalITBIS1><MontoTotal>18700\.00<\/MontoTotal>/);
  assert.match(x, /<NombreItem>Iguala &amp; &lt;asesoría&gt;<\/NombreItem>/);
  assert.match(x, /<FechaHoraFirma>15-11-2026 10:30:05<\/FechaHoraFirma><\/ECF>$/);
  assert.doesNotMatch(x, /<(\w+)><\/\1>/, "sin etiquetas vacías");
  assert.equal(escapar(`"'©`), "&quot;&apos;&#169;");
  assert.equal(fechaHoraFirma(new Date("2026-11-15T14:30:05Z")), "15-11-2026 10:30:05");
});

test("revisión: E32 menor de 250,000 va con el RFCE, E31 sin comprador, E34 sin referencia, dirección vacía", () => {
  const e32 = { ...e31, tipo: "32", encf: "E320000000001", venceSecuencia: null, comprador: null };
  assert.ok(revisarEcf(e32).some((m) => /RFCE/.test(m)));
  assert.ok(revisarEcf({ ...e31, comprador: null }).some((m) => /comprador/.test(m)));
  assert.ok(revisarEcf({ ...e31, tipo: "34", encf: "E340000000001" }).some((m) => /factura que modifica/.test(m)));
  assert.ok(revisarEcf({ ...e31, emisor: { ...emisor, direccion: " " } }).some((m) => /dirección/.test(m)));
  assert.throws(() => armarXml({ ...e31, items: [{ ...e31.items[0], cantidad: 12345n }] }, "x"), /2 decimales/);
});

test("firma: válida, se rompe al alterar y da el código de seguridad de 6 caracteres", () => {
  const firmado = firmarXml(armarXml(e31, "15-11-2026 10:30:05"), CERT);
  assert.ok(firmaValida(firmado, CERT.certPem));
  assert.match(firmado, /<SignatureMethod Algorithm="http:\/\/www\.w3\.org\/2001\/04\/xmldsig-more#rsa-sha256"\/>/);
  assert.match(firmado, /<Reference URI="">/);
  assert.match(firmado, /<X509Certificate>[A-Za-z0-9+/=]+<\/X509Certificate>/);
  assert.ok(firmado.indexOf("</FechaHoraFirma><Signature") > 0, "la firma va al final");
  assert.equal(firmaValida(firmado.replace("18700.00", "18700.01"), CERT.certPem), false);
  const codigo = codigoSeguridad(firmado);
  assert.equal(codigo.length, 6);
  assert.match(enlaceQr({ ambiente: "testecf", rncEmisor: "133097346", rncComprador: "132151119", encf: "E310000000001", fechaEmision: "2026-11-15", total: 1870000n, fechaFirma: "15-11-2026 10:30:05", codigo }),
    /^https:\/\/ecf\.dgii\.gov\.do\/testecf\/ConsultaTimbre\?RncEmisor=133097346&RncComprador=132151119&ENCF=E310000000001&FechaEmision=15-11-2026&MontoTotal=18700\.00&FechaFirma=15-11-2026%2010%3A30%3A05&CodigoSeguridad=/);
});

// DGII simulada: semilla, token, recepción y resultado, como en la «Descripción Técnica Servicios DGII».
function dgiiSimulada(registro) {
  return async (url, o) => {
    registro.push({ url, metodo: o.method, auth: o.headers?.authorization ?? null, cuerpo: o.body instanceof FormData ? await o.body.get("xml").text() : null });
    if (url.endsWith("/autenticacion/semilla")) return new Response(`<?xml version="1.0" encoding="utf-8"?><SemillaModel xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><valor>abc123</valor><fecha>2026-11-15T10:00:00</fecha></SemillaModel>`, { status: 200 });
    if (url.endsWith("/validarsemilla")) return new Response(JSON.stringify({ token: "tok-1", expira: "2026-11-15T11:00:00Z", expedido: "2026-11-15T10:00:00Z" }), { status: 200 });
    if (url.endsWith("/facturaselectronicas")) return new Response(JSON.stringify({ trackId: "trk-9" }), { status: 200 });
    if (url.includes("/consultas/estado")) return new Response(JSON.stringify({ trackId: "trk-9", codigo: 4, estado: "Aceptado Condicional", secuenciaUtilizada: true, mensajes: [{ codigo: 1, valor: "Observación de prueba" }] }), { status: 200 });
    return new Response("no", { status: 404 });
  };
}

test("DGII simulada: token con la semilla firmada, envío con Bearer y resultado condicional", async () => {
  const r = [];
  const pedir = dgiiSimulada(r);
  const t = await obtenerToken("testecf", CERT, { pedir });
  assert.equal(t.token, "tok-1");
  assert.equal(r[0].url, "https://ecf.dgii.gov.do/testecf/autenticacion/api/autenticacion/semilla");
  assert.ok(firmaValida(r[1].cuerpo, CERT.certPem), "la semilla va firmada");
  const firmado = firmarXml(armarXml(e31, "15-11-2026 10:30:05"), CERT);
  assert.equal(await enviarEcf("testecf", t.token, "133097346E310000000001.xml", firmado, { pedir }), "trk-9");
  assert.equal(r[2].auth, "Bearer tok-1");
  const res = await consultarResultado("testecf", t.token, "trk-9", { pedir });
  assert.deepEqual(res, { estado: "aceptado_condicional", secuenciaUtilizada: true, mensajes: [{ codigo: 1, valor: "Observación de prueba" }] });
});

test("DGII que rechaza la conexión: mensaje claro de que no acepta el servidor", async () => {
  const pedir = async () => { const e = new TypeError("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e; };
  await assert.rejects(obtenerToken("testecf", CERT, { pedir }), (e) => e instanceof ErrorDgii && e.tipo === "conexion" && /fuera del país/.test(e.message));
});

// ───── Con la base ─────
const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const conBase = { skip: !sql && "sin DATABASE_URL" };
const marca = Date.now();
let ana, beto, firma, empresa, imp, cliente;
const leer = (fn) => sql.begin(async (tx) => {
  await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
  await tx`SELECT set_config('app.usuario_id', ${ana}, true)`;
  await tx`SET LOCAL ROLE contable_app`;
  return fn(tx);
});
const padre = (c) => (c.length === 1 ? null : c.length === 2 ? c[0] : c.slice(0, -2));

before(async () => {
  if (!sql) return;
  [{ id: ana }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`ana-e2a-${marca}@x.do`}, 'Ana', 'x') RETURNING id`;
  [{ id: beto }] = await sql`INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${`beto-e3a-${marca}@x.do`}, 'Beto', 'x') RETURNING id`;
  await sql.begin(async (tx) => {
    [{ id: firma }] = await tx`INSERT INTO firmas (nombre) VALUES (${`Firma E2a ${marca}`}) RETURNING id`;
    [{ id: empresa }] = await tx`INSERT INTO empresas (nombre, firma_id, rnc, direccion, lleva_contabilidad) VALUES ('Empire Prueba SRL', ${firma}, '133097346', 'Plaza Coral Garden, local K01', true) RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${empresa}, true)`;
    const ids = new Map();
    for (const [codigo, n] of CATALOGO_RD) {
      const [c] = await tx`INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${empresa}, ${codigo}, ${n}, ${TIPO_POR_CLASE[codigo[0]]}, ${ids.get(padre(codigo)) ?? null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6}) RETURNING id`;
      ids.set(codigo, c.id);
    }
    await tx`SELECT configurar_cuentas_empresa(${empresa})`;
    await tx`SELECT configurar_tributaria(${empresa})`;
  });
  await leer(async (tx) => {
    imp = Object.fromEntries((await tx`SELECT id, nombre FROM impuestos`).map((r) => [r.nombre, r.id]));
    [{ id: cliente }] = await tx`INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion) VALUES (${empresa}, 'Goemhy Services SRL', '132151119', 'rnc') RETURNING id`;
    await tx`INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence) VALUES (${empresa}, 'E31', 1, 100, 7, '2027-12-31')`;
  });
});

after(async () => {
  if (!sql) return;
  try {
    await sql`DELETE FROM empresas WHERE id = ${empresa}`;
    await sql`DELETE FROM firmas WHERE id = ${firma}`;
    await sql`DELETE FROM usuarios WHERE id IN (${ana}, ${beto})`;
  } finally {
    await sql.end();
  }
});

test("certificado guardado cifrado: se abre con la llave, no con otra, y reemplaza al anterior", conBase, async () => {
  await assert.rejects(leer((tx) => guardarCertificado(tx, { empresaId: empresa, usuarioId: ana, bytes: P12, clave: "mala", hoy: "2026-11-15" })), /contraseña/);
  const vencido = p12DePrueba("c", "2026-06-01");
  await assert.rejects(leer((tx) => guardarCertificado(tx, { empresaId: empresa, usuarioId: ana, bytes: vencido, clave: "c", hoy: "2026-11-15" })), /no está vigente/);
  await leer((tx) => guardarCertificado(tx, { empresaId: empresa, usuarioId: ana, bytes: P12, clave: "clave-prueba", hoy: "2026-11-15", principal: true }));
  // Al reemplazarlo sigue siendo el principal.
  await leer((tx) => guardarCertificado(tx, { empresaId: empresa, usuarioId: ana, bytes: P12, clave: "clave-prueba", hoy: "2026-11-15" }));
  const c = await leer((tx) => certificadoActivo(tx));
  assert.equal(c.titular, "PERSONA DE PRUEBA");
  assert.equal(c.usuario_id, ana);
  const filas = await leer((tx) => tx`SELECT activo, archivo, clave FROM certificados_ecf`);
  assert.deepEqual(filas.map((f) => f.activo).sort(), [false, true]);
  assert.ok(!filas[0].archivo.equals(P12), "el archivo no está en claro");
  assert.notEqual(filas[0].clave.toString("utf8"), "clave-prueba");
});

test("XML de prueba desde una factura: E31 con el siguiente número sin tomarlo, firmado y guardado", conBase, async () => {
  const facturaId = await leer((tx) => guardarBorradorFactura(tx, {
    empresaId: empresa, usuarioId: ana, clienteId: cliente, tipo: "B01", fecha: "2026-11-15", vence: "2026-12-15", moneda: "DOP", tasa: 10000n, notas: null,
    lineas: [{ servicioId: null, descripcion: "Iguala mensual", cantidad: 10000n, precio: 1500000n, impuestoIds: [imp["ITBIS 18 %"]] }],
  }));
  const r = await leer((tx) => xmlDePrueba(tx, { empresaId: empresa, usuarioId: ana, facturaId, ahora: new Date("2026-11-15T14:30:05Z") }));
  assert.equal(r.encf, "E310000000007");
  assert.equal(r.firma, "15-11-2026 10:30:05");
  const [envio] = await leer((tx) => tx`SELECT xml, prueba, estado FROM ecf_envios WHERE id = ${r.id}`);
  assert.deepEqual([envio.prueba, envio.estado], [true, "firmado"]);
  assert.ok(firmaValida(envio.xml, CERT.certPem));
  assert.match(envio.xml, /<TipoPago>2<\/TipoPago><FechaLimitePago>15-12-2026<\/FechaLimitePago>/);
  assert.match(envio.xml, /<RNCComprador>132151119<\/RNCComprador>/);
  const [{ siguiente }] = await leer((tx) => tx`SELECT siguiente::int FROM secuencias_ncf WHERE tipo = 'E31'`);
  assert.equal(siguiente, 7, "no tomó el número");
  const [f] = await leer((tx) => tx`SELECT estado, ncf FROM facturas WHERE id = ${facturaId}`);
  assert.deepEqual([f.estado, f.ncf], ["borrador", null], "la factura no cambió");
});

test("datos de la factura: avisa si el ITBIS redondeado por línea no da el total de la DGII", conBase, async () => {
  const facturaId = await leer((tx) => guardarBorradorFactura(tx, {
    empresaId: empresa, usuarioId: ana, clienteId: cliente, tipo: "B01", fecha: "2026-11-15", vence: "2026-11-15", moneda: "DOP", tasa: 10000n, notas: null,
    lineas: [1, 2, 3].map(() => ({ servicioId: null, descripcion: "Línea", cantidad: 10000n, precio: 1003n, impuestoIds: [imp["ITBIS 18 %"]] })),
  }));
  // 3 líneas de 10.03: ITBIS por línea 1.81 × 3 = 5.43; sobre el total 30.09 × 18 % = 5.42.
  await assert.rejects(leer((tx) => datosDeFactura(tx, facturaId, "E310000000001", "2027-12-31")), /no coincide/);
});

test("probar conexión con la DGII simulada: usa el certificado guardado y el ambiente de la empresa", conBase, async () => {
  const r = [];
  const texto = await leer((tx) => probarConexion(tx, { empresaId: empresa, usuarioId: ana }, { pedir: dgiiSimulada(r) }));
  assert.match(texto, /aceptó el certificado/);
  assert.match(r[0].url, /\/testecf\//);
});

// ───── Entrega E3a: un certificado por firmante ─────
test("E3a: cada usuario firma con el suyo; sin uno propio, con el principal compartido", conBase, async () => {
  const xmlDe = async (usuarioId) => {
    const facturaId = await leer((tx) => guardarBorradorFactura(tx, {
      empresaId: empresa, usuarioId, clienteId: cliente, tipo: "B01", fecha: "2026-11-15", vence: "2026-11-15", moneda: "DOP", tasa: 10000n, notas: null,
      lineas: [{ servicioId: null, descripcion: "Servicio", cantidad: 10000n, precio: 100000n, impuestoIds: [imp["ITBIS 18 %"]] }],
    }));
    const r = await leer((tx) => xmlDePrueba(tx, { empresaId: empresa, usuarioId, facturaId, ahora: new Date("2026-11-15T14:30:05Z") }));
    const [v] = await leer((tx) => tx`SELECT creado_por, certificado_id, firmante FROM ecf_envios WHERE id = ${r.id}`);
    return v;
  };
  const deAna = await leer((tx) => miCertificado(tx, ana));
  // Beto no tiene certificado: firma con el principal de Ana, y queda que lo hizo él con el certificado de ella.
  assert.equal(await leer((tx) => miCertificado(tx, beto)), null);
  let v = await xmlDe(beto);
  assert.deepEqual([v.creado_por, v.certificado_id, v.firmante], [beto, deAna.id, "PERSONA DE PRUEBA"]);
  // Beto sube el suyo: firma con él. No puede compartirlo mientras Ana comparta el de ella.
  const otro = p12DePrueba("otra");
  await assert.rejects(leer((tx) => guardarCertificado(tx, { empresaId: empresa, usuarioId: beto, bytes: otro, clave: "otra", hoy: "2026-11-15", principal: true })), /ya es el de/);
  await leer((tx) => guardarCertificado(tx, { empresaId: empresa, usuarioId: beto, bytes: otro, clave: "otra", hoy: "2026-11-15" }));
  const deBeto = await leer((tx) => miCertificado(tx, beto));
  v = await xmlDe(beto);
  assert.equal(v.certificado_id, deBeto.id);
  assert.equal((await leer((tx) => certificadosDeEmpresa(tx))).length, 2);
  // Beto no retira el de Ana sin el permiso «empresa»; con él, sí.
  await assert.rejects(leer((tx) => retirarCertificado(tx, { empresaId: empresa, usuarioId: beto, certificadoId: deAna.id })), /no es tuyo/);
  // Ana deja de compartirlo: Beto sigue con el suyo; sin el suyo, ya no puede firmar.
  await leer((tx) => compartirCertificado(tx, { empresaId: empresa, usuarioId: ana, principal: false }));
  assert.equal(await leer((tx) => certificadoActivo(tx)), null);
  await leer((tx) => retirarCertificado(tx, { empresaId: empresa, usuarioId: beto }));
  await assert.rejects(leer((tx) => abrirCertificado(tx, beto)), /No tienes certificado/);
  // Ana firma con el suyo aunque no lo comparta; un administrador retira el de Ana.
  assert.equal((await leer((tx) => abrirCertificado(tx, ana))).id, deAna.id);
  await leer((tx) => retirarCertificado(tx, { empresaId: empresa, usuarioId: beto, certificadoId: deAna.id, deOtros: true }));
  assert.equal((await leer((tx) => certificadosDeEmpresa(tx))).length, 0);
  // Lo firmado antes conserva con qué certificado se firmó.
  const [{ n }] = await leer((tx) => tx`SELECT count(*)::int AS n FROM ecf_envios WHERE certificado_id IS NOT NULL`);
  assert.ok(n >= 3);
});
