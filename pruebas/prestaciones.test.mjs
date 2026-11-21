// Prioridad 3 · P3g: prestaciones laborales. Las reglas son las de los artículos del Código de Trabajo (Ley 16-92) y su Reglamento 258-93 tal como los publica
// el Ministerio de Trabajo; los valores esperados se calcularon aparte, a mano, con aritmética exacta.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  antiguedad, calcular, DECISIONES, diasCesantia, diasPreaviso, diasVacacionesDelAnio, diasVacacionesFraccion, diasVacacionesPendientes, fechaValidaISO, leerEntrada,
  REGLAS, sumarDias, sumarMeses, TERMINACIONES, verAntiguedad,
} from "../lib/prestaciones.ts";

const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const a = (anios, meses, dias = 0) => ({ anios, meses, dias });
const entrada = (o = {}) => ({
  nombre: "Ana", ingreso: "2020-03-01", termino: "2026-03-31", sueldo: 5000000n, promedio: null, terminacion: "desahucio",
  preavisoDado: 0, vacacionesPendientes: 1, devengadoAnio: null, salarioMinimo: null, ...o,
});
const concepto = (r, clave) => r.conceptos.find((c) => c.clave === clave);

test("las fechas: meses con día que no existe y fechas inválidas", () => {
  assert.equal(sumarMeses("2026-01-31", 1), "2026-02-28");
  assert.equal(sumarMeses("2024-01-31", 1), "2024-02-29");
  assert.equal(sumarMeses("2025-11-15", 3), "2026-02-15");
  assert.equal(sumarDias("2026-12-31", 10), "2027-01-10");
  assert.equal(fechaValidaISO("2026-02-29"), false);
  assert.equal(fechaValidaISO("2028-02-29"), true);
  assert.equal(fechaValidaISO("2026-13-01"), false);
  assert.equal(fechaValidaISO("26-1-1"), false);
});

test("la antigüedad cuenta del día de ingreso al último día trabajado, inclusive", () => {
  assert.deepEqual(antiguedad("2024-01-01", "2026-03-15"), a(2, 2, 15));
  assert.deepEqual(antiguedad("2025-01-01", "2025-12-31"), a(1, 0, 0));
  assert.deepEqual(antiguedad("2025-01-01", "2025-12-30"), a(0, 11, 30));
  assert.deepEqual(antiguedad("2026-03-10", "2026-03-10"), a(0, 0, 1));
  assert.deepEqual(antiguedad("2020-03-01", "2026-03-31"), a(6, 1, 0));
  assert.equal(verAntiguedad(a(2, 2, 15)), "2 años, 2 meses, 15 días");
  assert.equal(verAntiguedad(a(1, 0, 1)), "1 año, 1 día");
  assert.equal(verAntiguedad(a(0, 0, 0)), "0 días");
});

test("Art. 76: el preaviso es de 7, 14 o 28 días", () => {
  assert.equal(diasPreaviso(a(0, 2, 30)), 0);
  assert.equal(diasPreaviso(a(0, 3)), 7);
  assert.equal(diasPreaviso(a(0, 6)), 7, "seis meses justos: aún no «exceden» de seis");
  assert.equal(diasPreaviso(a(0, 6, 1)), 14);
  assert.equal(diasPreaviso(a(0, 11, 30)), 14);
  assert.equal(diasPreaviso(a(1, 0)), 28);
  assert.equal(diasPreaviso(a(25, 4)), 28);
});

test("Art. 80: la cesantía por escalones, años y fracciones", () => {
  assert.equal(diasCesantia(a(0, 2, 30)), 0);
  assert.equal(diasCesantia(a(0, 3)), 6);
  assert.equal(diasCesantia(a(0, 5, 29)), 6);
  assert.equal(diasCesantia(a(0, 6)), 13);
  assert.equal(diasCesantia(a(0, 11)), 13);
  assert.equal(diasCesantia(a(1, 0)), 21);
  assert.equal(diasCesantia(a(1, 3)), 21, "tres meses justos no son «mayor de tres meses»");
  assert.equal(diasCesantia(a(1, 3, 1)), 27);
  assert.equal(diasCesantia(a(1, 5, 30)), 27);
  assert.equal(diasCesantia(a(1, 6)), 34);
  assert.equal(diasCesantia(a(4, 11)), 21 * 4 + 13);
  assert.equal(diasCesantia(a(5, 0)), 115);
  assert.equal(diasCesantia(a(5, 4)), 121);
  assert.equal(diasCesantia(a(10, 0)), 230);
});

test("Arts. 177 a 180: vacaciones por período y por fracción", () => {
  assert.equal(diasVacacionesDelAnio(1), 14);
  assert.equal(diasVacacionesDelAnio(4), 14);
  assert.equal(diasVacacionesDelAnio(5), 18);
  assert.equal(diasVacacionesFraccion(a(0, 5)), 0, "cinco meses justos: no pasa de cinco");
  assert.equal(diasVacacionesFraccion(a(0, 5, 1)), 6);
  assert.equal(diasVacacionesFraccion(a(3, 6)), 6);
  assert.equal(diasVacacionesFraccion(a(0, 6, 1)), 7);
  assert.equal(diasVacacionesFraccion(a(0, 8, 15)), 9);
  assert.equal(diasVacacionesFraccion(a(0, 11)), 11);
  assert.equal(diasVacacionesFraccion(a(0, 11, 1)), 12);
  assert.equal(diasVacacionesFraccion(a(2, 2, 15)), 0);
  assert.equal(diasVacacionesPendientes(a(6, 1), 0), 0);
  assert.equal(diasVacacionesPendientes(a(6, 1), 1), 18);
  assert.equal(diasVacacionesPendientes(a(6, 1), 2), 36);
  assert.equal(diasVacacionesPendientes(a(6, 1), 3), 50, "los años 4, 5 y 6: 14 + 18 + 18");
  assert.equal(diasVacacionesPendientes(a(2, 0), 2), 28);
});

test("un desahucio de 6 años y 1 mes con 50,000 al mes", () => {
  const r = calcular(entrada());
  assert.equal(r.antiguedad, "6 años, 1 mes");
  assert.equal(r.salarioDiario, "2098.20");
  assert.equal(concepto(r, "preaviso").dias, 28);
  assert.equal(concepto(r, "preaviso").monto, "58749.48");
  assert.equal(concepto(r, "cesantia").dias, 138);
  assert.equal(concepto(r, "cesantia").monto, "289550.99");
  assert.equal(concepto(r, "vacaciones").dias, 18);
  assert.equal(concepto(r, "vacaciones").monto, "37767.52");
  assert.equal(concepto(r, "navidad").monto, "12500.00");
  assert.equal(r.total, "398567.99");
  assert.equal(r.fechaLimite, "2026-04-10");
  assert.match(concepto(r, "preaviso").articulos, /76/);
  assert.match(concepto(r, "cesantia").articulos, /80/);
  assert.match(concepto(r, "navidad").nota, /Estimado/);
  assert.match(concepto(r, "navidad").nota, /no se aplicó/);
});

test("si el preaviso se dio, no hay indemnización; si se dio a medias, se paga lo que falta", () => {
  assert.equal(concepto(calcular(entrada({ preavisoDado: 28 })), "preaviso").monto, "0.00");
  assert.match(concepto(calcular(entrada({ preavisoDado: 28 })), "preaviso").nota, /completo/);
  const parcial = concepto(calcular(entrada({ preavisoDado: 14 })), "preaviso");
  assert.equal(parcial.dias, 14);
  assert.equal(parcial.monto, "29374.74"); // 14 días × 50,000 ÷ 23.83
  assert.equal(concepto(calcular(entrada({ preavisoDado: 60 })), "preaviso").dias, 0);
});

test("sin cesantía: solo vacaciones y Navidad", () => {
  assert.equal(TERMINACIONES.sin_cesantia.conCesantia, false);
  const r = calcular(entrada({ terminacion: "sin_cesantia" }));
  assert.equal(concepto(r, "preaviso").monto, "0.00");
  assert.equal(concepto(r, "cesantia").monto, "0.00");
  assert.equal(r.total, "50267.52");
});

test("el despido injustificado calcula lo mismo que el desahucio y avisa de los salarios de la demanda", () => {
  const d = calcular(entrada()), j = calcular(entrada({ terminacion: "despido_injustificado" }));
  assert.equal(j.total, d.total);
  assert.ok(j.advertencias.some((x) => /Art\. 95/.test(x)));
  assert.ok(!d.advertencias.some((x) => /Art\. 95/.test(x)));
});

test("menos de tres meses: ni preaviso ni cesantía; la Navidad es proporcional", () => {
  const r = calcular(entrada({ ingreso: "2026-01-10", termino: "2026-03-09", vacacionesPendientes: 0 }));
  assert.equal(r.antiguedad, "2 meses");
  assert.equal(concepto(r, "preaviso").monto, "0.00");
  assert.equal(concepto(r, "cesantia").monto, "0.00");
  assert.equal(concepto(r, "vacaciones").monto, "0.00");
  assert.equal(concepto(r, "navidad").monto, "8333.33");
  assert.equal(r.total, "8333.33");
  assert.ok(r.advertencias.some((x) => /menos de tres meses/.test(x)));
});

test("el promedio del último año manda en el preaviso y la cesantía, no en las vacaciones ni la Navidad", () => {
  const r = calcular(entrada({ promedio: 6000000n }));
  assert.equal(concepto(r, "preaviso").monto, "70499.37");
  assert.equal(concepto(r, "cesantia").monto, "347461.18");
  assert.equal(concepto(r, "vacaciones").monto, "37767.52");
  assert.equal(concepto(r, "navidad").monto, "12500.00");
  assert.equal(r.total, "468228.07");
  assert.ok(r.advertencias.some((x) => /promedio/.test(x)));
});

test("Navidad: lo devengado escrito manda y el tope de cinco salarios mínimos se aplica si se da el mínimo", () => {
  const real = concepto(calcular(entrada({ devengadoAnio: 6000000n })), "navidad");
  assert.equal(real.monto, "5000.00");
  assert.ok(!/Estimado/.test(real.nota ?? ""));
  const tope = concepto(calcular(entrada({ salarioMinimo: 200000n })), "navidad");
  assert.equal(tope.monto, "10000.00");
  assert.match(tope.nota, /tope del Art\. 219/);
  assert.equal(concepto(calcular(entrada({ salarioMinimo: 2000000n })), "navidad").monto, "12500.00");
});

test("vacaciones pendientes de más años de los que tiene se recortan y se avisa", () => {
  const r = calcular(entrada({ ingreso: "2024-01-01", termino: "2026-03-15", vacacionesPendientes: 5 }));
  assert.equal(concepto(r, "vacaciones").dias, 28);
  assert.ok(r.advertencias.some((x) => /Solo hay 2 años completos/.test(x)));
});

test("quien entró antes del Código de Trabajo lleva su aviso", () => {
  assert.ok(calcular(entrada({ ingreso: "1990-01-15" })).advertencias.some((x) => /1992/.test(x)));
  assert.ok(!calcular(entrada({ ingreso: "1992-06-01" })).advertencias.some((x) => /1992/.test(x)));
});

test("el formulario se lee con sus validaciones", () => {
  const ok = leerEntrada(fd({ nombre: "María", ingreso: "2020-03-01", termino: "2026-03-31", sueldo: "50,000.00", terminacion: "desahucio", vacaciones_pendientes: "1", preaviso_dado: "", promedio: "", devengado: "", minimo: "" }));
  assert.equal(ok.sueldo, 5000000n);
  assert.equal(ok.promedio, null);
  assert.equal(ok.vacacionesPendientes, 1);
  assert.equal(ok.preavisoDado, 0);
  assert.equal(ok.devengadoAnio, null);
  assert.equal(calcular(ok).total, "398567.99");
  const base = { ingreso: "2020-03-01", termino: "2026-03-31", sueldo: "50000", terminacion: "desahucio" };
  assert.match(leerEntrada(fd({ ...base, ingreso: "2026-02-30" })), /fecha de ingreso/);
  assert.match(leerEntrada(fd({ ...base, termino: "2019-01-01" })), /anterior a la de ingreso/);
  assert.match(leerEntrada(fd({ ...base, terminacion: "otra" })), /cómo terminó/);
  assert.match(leerEntrada(fd({ ...base, sueldo: "" })), /Salario mensual/);
  assert.match(leerEntrada(fd({ ...base, sueldo: "0" })), /mayor que cero/);
  assert.match(leerEntrada(fd({ ...base, sueldo: "abc" })), /no es válido/);
  assert.match(leerEntrada(fd({ ...base, promedio: "x" })), /Promedio/);
  assert.match(leerEntrada(fd({ ...base, preaviso_dado: "-3" })), /número entero/);
  assert.match(leerEntrada(fd({ ...base, vacaciones_pendientes: "99" })), /no puede pasar de 60/);
  assert.equal(leerEntrada(fd({ ...base, nombre: "" })).nombre, "Empleado");
});

test("las reglas y las decisiones están a la vista, con su artículo", () => {
  for (const art of ["Art. 76", "Art. 80", "Arts. 177", "Arts. 219"]) assert.ok(REGLAS.some((r) => r.articulo.startsWith(art)), art);
  assert.ok(DECISIONES.length >= 5);
});

test("la hoja en PDF lleva el empleado, cada concepto con su artículo y el total", async () => {
  const { docPrestaciones } = await import("../lib/pdf-prestaciones.ts");
  const e = entrada({ nombre: "María Pérez ’Ñ’" });
  const { nombre, doc } = docPrestaciones({ empresa: "Salón Rosa SRL", rnc: "130000001", entrada: e, resultado: calcular(e), preparadoPor: "Ana", logo: null });
  assert.equal(nombre, "prestaciones-Maria-Perez-N-2026-03-31.pdf");
  const todo = JSON.stringify(doc.content);
  for (const parte of ["Cálculo de prestaciones laborales", "María Pérez", "Preaviso omitido", "Arts. 76, 79 y 85", "Auxilio de cesantía", "398567.99".replace("398567.99", "398,567.99"), "Plazo de pago (Art. 86)", "Reglas aplicadas", "Fuente:"]) {
    assert.ok(todo.includes(parte), parte);
  }
  assert.ok(!todo.includes('"image"'));
});
