// Prioridad 1.5: los trámites cuentan días laborables (lunes a viernes, sin feriados).
import assert from "node:assert/strict";
import { test } from "node:test";
import { esLaborable, laborablesEntre, sumarLaborables } from "../lib/dias-laborables.ts";

const feriados = new Set(["2026-11-09", "2026-12-25"]);

test("lunes a viernes, sin feriados", () => {
  assert.equal(esLaborable("2026-11-20", feriados), true); // viernes
  assert.equal(esLaborable("2026-11-21", feriados), false); // sábado
  assert.equal(esLaborable("2026-11-09", feriados), false); // Constitución, trasladado
});

test("sumar días laborables salta fines de semana y feriados", () => {
  assert.equal(sumarLaborables("2026-11-20", 1, feriados), "2026-11-23", "del viernes al lunes");
  assert.equal(sumarLaborables("2026-11-06", 1, feriados), "2026-11-10", "el lunes 9 es feriado");
  assert.equal(sumarLaborables("2026-12-21", 5, feriados), "2026-12-29", "sin el 25 de diciembre");
  assert.equal(sumarLaborables("2026-11-20", 0, feriados), "2026-11-20");
});

test("días laborables entre dos fechas, negativo si ya pasó", () => {
  assert.equal(laborablesEntre("2026-11-20", "2026-11-27", feriados), 5);
  assert.equal(laborablesEntre("2026-11-27", "2026-11-20", feriados), -5);
  assert.equal(laborablesEntre("2026-11-20", "2026-11-20", feriados), 0);
});
