import assert from "node:assert/strict";
import { test } from "node:test";
import { aPesos, calcularLinea, leerCantidad, leerTasa } from "../lib/calculos.ts";

test("ITBIS y subtotal por línea redondeados al centavo", () => {
  assert.deepEqual(calcularLinea(leerCantidad("3"), 33333n, 18), { subtotal: 99999n, itbis: 18000n });
  assert.deepEqual(calcularLinea(leerCantidad("0.5"), 101n, 18), { subtotal: 51n, itbis: 9n });
  assert.deepEqual(calcularLinea(leerCantidad("2"), 150000n, 0), { subtotal: 300000n, itbis: 0n });
});

test("conversión de dólares a pesos con tasa de 4 decimales", () => {
  assert.equal(aPesos(10000n, leerTasa("60")), 600000n);
  assert.equal(aPesos(12345n, leerTasa("58.7525")), 725300n);
});

test("cantidades y tasas inválidas", () => {
  assert.equal(leerCantidad("0"), null);
  assert.equal(leerCantidad("-1"), null);
  assert.equal(leerTasa("abc"), null);
});
