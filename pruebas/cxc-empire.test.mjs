// Prioridad 1.2 del prompt de Patricia (20-nov-2026): abono al facturar en porcentaje o en monto.
import assert from "node:assert/strict";
import { test } from "node:test";
import { montoAbono } from "../lib/cxc.ts";

test("abono al facturar: porcentaje redondeado al centavo, monto tope en el total", () => {
  assert.equal(montoAbono(1180000n, "porcentaje", 2500n), 295000n, "25 % de 11,800.00 = 2,950.00");
  assert.equal(montoAbono(100001n, "porcentaje", 5000n), 50001n, "50 % de 1,000.01 redondea a 500.01");
  assert.equal(montoAbono(1180000n, "monto", 500000n), 500000n);
  assert.equal(montoAbono(1180000n, "monto", 9900000n), 1180000n, "no más que el total");
  assert.equal(montoAbono(1180000n, "porcentaje", 0n), 0n);
});
