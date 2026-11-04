// IR-2 2026, parte 3 (entrega 2): depreciación fiscal (anexo D sección III), categoría 1 (D-1) y ajuste por inflación
// (D-2) con las fórmulas del Excel oficial. Funciones puras: no necesitan base.
import assert from "node:assert/strict";
import { test } from "node:test";
import { calcularDepreciacion, sugerirDepreciacion } from "../lib/ir2-depreciacion.ts";

const P = (pesos) => BigInt(Math.round(pesos * 100));
const calcular = (entradas) => {
  const v = Object.fromEntries(Object.entries(entradas).map(([k, x]) => [k, P(x)]));
  const sugeridos = {}, avisos = [];
  calcularDepreciacion(v, sugeridos, (k) => k in entradas, avisos);
  return { v, sugeridos, avisos };
};

test("D-2: patrimonio fiscal, base menor de 32 y 33, ajuste y su reparto entre los activos no monetarios", () => {
  const { v } = calcular({ T1: 500000, T5: 100000, T10: 50000, T16: 60000, T21: 100000, T27: 200000, T35p: 5, T37: 40000 });
  assert.equal(v.T26, P(510000), "1 − 5 − 10 + 16 + 21");
  assert.equal(v.T31, P(200000));
  assert.equal(v.T32, P(310000));
  assert.equal(v.T39, P(60000), "39 viene de la 16");
  assert.equal(v.T43, P(100000), "43 viene de la 21");
  assert.equal(v.T49, P(200000));
  assert.equal(v.T34, P(200000), "el menor entre 32 y 33");
  assert.equal(v.T35, P(10000), "5 % de la base");
  assert.deepEqual([v.T37a, v.T39a, v.T43a, v.T49a], [P(2000), P(3000), P(5000), P(10000)]);
  assert.deepEqual([v.T37m, v.T39m, v.T43m], [2000n, 3000n, 5000n], "20 %, 30 % y 50 %");
});

test("anexo D, sección III: ajuste del D-2, 25 % y 15 % de uso propio, adición no depreciada sugerida y 33", () => {
  const { v, sugeridos } = calcular({ T16: 60000, T35p: 5, D9b: 60000, D11b: 10000, D17c: 10000 });
  // Base del D-2: solo la categoría 2 (60,000); patrimonio 60,000: ajuste 3,000, todo a la categoría 2.
  assert.equal(v.D10b, P(3000));
  assert.equal(v.D13b, P(73000), "9 + 10 + 11 − 12");
  assert.equal(v.D14b, P(18250), "25 %");
  assert.equal(sugeridos.D15b, P(10000), "adición no depreciada = adición imponible (las dos son el 50 %)");
  assert.equal(v.D16b, P(64750), "13 − 14 + 15");
  assert.equal(v.D22c, P(3000), "arrendamiento categoría 3: 30 %");
  assert.equal(v.D24c, P(7000));
  assert.equal(v.D33b, P(64750));
  assert.equal(v.D33c, P(7000));
  // Lo escrito manda: sin adición no depreciada.
  assert.equal(calcular({ D9b: 1000, D11b: 100, D15b: 0 }).v.D16b, P(1100 - 275));
});

test("D-1: categoría 1 desde el D-2, 5 % sugerido, detalle de adquisiciones y totales", () => {
  const { v, sugeridos } = calcular({ T15: 80000, U8v: 20000, U8d: 1000, U18v: 5000, U28v: 2000, U28d: 100 });
  assert.equal(v.U1, P(80000), "casilla 38 del D-2 = casilla 15");
  assert.equal(v.U5, P(80000));
  assert.equal(sugeridos.U6, P(4000), "5 % (art. 287)");
  assert.equal(v.U7, P(76000));
  assert.equal(v.U8c, P(19000), "valor − depreciación");
  assert.deepEqual([v.UAv, v.UBv, v.UCv], [P(20000), P(5000), P(2000)]);
  assert.equal(v.UTd, P(4000 + 1000 + 100), "6 + depreciación de adquisiciones, mejoras y retiros, como el Excel");
  assert.equal(v.UTc, P(76000 + 19000 + 5000 + 1900));
});

test("sugerencias: patrimonio del D-2 desde el A-1 al inicio y costos fiscales del IR-2 anterior", () => {
  const s = {}, origen = {};
  const a1 = { 6: P(500000), "2.3": P(50000), "5.3": P(10000), 7: P(150000), 8: P(50000), "1.5": P(40000) };
  const prev = { D16b: P(64750), D24c: P(7000), UTc: P(95000) };
  sugerirDepreciacion(s, origen, a1, (k) => prev[k] ?? 0n, "202612");
  assert.equal(s.T1, P(500000));
  assert.equal(s.T10, P(40000), "2.3 − 5.3");
  assert.equal(s.T27, P(200000), "7 + 8 + 9");
  assert.equal(s.T37, P(40000), "inventarios del A-1");
  assert.equal(s.D9b, P(64750), "casilla 16 del año anterior");
  assert.equal(s.T16, P(64750));
  assert.equal(s.D17c, P(7000));
  assert.equal(s.T15, P(95000), "costo final del D-1 anterior");
  assert.match(origen.D9b, /IR-2 del ejercicio 2026 \(presentado\)/);
  // Sin IR-2 anterior presentado no se sugiere nada del año anterior.
  const s2 = {};
  sugerirDepreciacion(s2, {}, a1, () => 0n, null);
  assert.equal(s2.D9b, undefined);
});
