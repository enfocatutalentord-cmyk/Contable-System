// Verificación en dos pasos: vectores oficiales de los RFC 4226 y 6238, desfase del reloj y códigos repetidos.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aBase32, codigoHotp, deBase32, enlaceAutenticador, hashCodigo, nuevosCodigosRecuperacion, nuevoSecreto, pasoActual, verificarCodigo,
} from "../lib/dos-pasos.ts";

const CLAVE = Buffer.from("12345678901234567890"); // clave de los RFC

test("HOTP: vectores del RFC 4226", () => {
  const esperados = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  esperados.forEach((c, i) => assert.equal(codigoHotp(CLAVE, BigInt(i)), c));
});

test("TOTP: vectores del RFC 6238 (SHA-1, 8 dígitos)", () => {
  for (const [segundos, codigo] of [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]]) {
    assert.equal(codigoHotp(CLAVE, pasoActual(segundos * 1000), 8), codigo, `t=${segundos}`);
  }
});

test("base32 de ida y vuelta (RFC 4648)", () => {
  assert.equal(aBase32(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.deepEqual(deBase32("MZXW 6YTB OI"), Buffer.from("foobar"));
  const s = nuevoSecreto();
  assert.equal(s.length, 32);
  assert.equal(deBase32(s).length, 20);
});

test("acepta ±30 s de desfase, no un código viejo ni el mismo dos veces", () => {
  const s = aBase32(CLAVE), ms = 1_700_000_000_000;
  const paso = pasoActual(ms);
  const codigo = (p) => codigoHotp(CLAVE, p);
  assert.equal(verificarCodigo(s, codigo(paso), null, ms), paso);
  assert.equal(verificarCodigo(s, codigo(paso - 1n), null, ms), paso - 1n);
  assert.equal(verificarCodigo(s, codigo(paso + 1n), null, ms), paso + 1n);
  assert.equal(verificarCodigo(s, codigo(paso - 2n), null, ms), null, "dos intervalos atrás");
  assert.equal(verificarCodigo(s, codigo(paso), paso, ms), null, "ya usado");
  assert.equal(verificarCodigo(s, "12345", null, ms), null);
  assert.equal(verificarCodigo(s, `${codigo(paso).slice(0, 3)} ${codigo(paso).slice(3)}`, null, ms), paso, "con espacio");
});

test("códigos de recuperación y enlace del QR", () => {
  const cs = nuevosCodigosRecuperacion();
  assert.equal(new Set(cs).size, 10);
  assert.ok(cs.every((c) => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(c)));
  assert.equal(hashCodigo(cs[0]), hashCodigo(cs[0].toUpperCase().replace("-", " ")));
  const u = enlaceAutenticador("ABC", "ana@x.do");
  assert.match(u, /^otpauth:\/\/totp\/Empire%20Tax%E2%80%99N%20Legal%3Aana%40x\.do\?secret=ABC&issuer=Empire/);
});
