import assert from "node:assert/strict";
import { test } from "node:test";
import { aCentavos, deCentavos, leerMonto } from "../lib/montos.ts";

test("leerMonto acepta formatos comunes", () => {
  assert.equal(leerMonto("1,234.5"), "1234.50");
  assert.equal(leerMonto("RD$ 100"), "100.00");
  assert.equal(leerMonto(""), "0.00");
  assert.equal(leerMonto("0.05"), "0.05");
});

test("leerMonto rechaza montos inválidos", () => {
  assert.equal(leerMonto("-5"), null);
  assert.equal(leerMonto("1.234"), null);
  assert.equal(leerMonto("abc"), null);
});

test("centavos sin errores de coma flotante", () => {
  const suma = ["0.10", "0.20"].reduce((s, m) => s + aCentavos(m), 0n);
  assert.equal(deCentavos(suma), "0.30");
  assert.equal(deCentavos(-12345n), "-123.45");
});
