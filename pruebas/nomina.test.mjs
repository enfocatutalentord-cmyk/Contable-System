// Prioridad 3 · P3h: nómina del mes y archivo de autodeterminación de la TSS. Los valores esperados se calcularon aparte, con aritmética exacta, a partir de las
// tasas, topes y escala de las fuentes oficiales de la TSS y la DGII.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  archivoTSS, calcularNomina, DECISIONES_NOMINA, isrAnual2026, isrMensual, leerNomina, monto16, nombreArchivoTSS, REGLAS_NOMINA, SMN_2026, tablaNomina, TIPOS_INGRESO,
} from "../lib/nomina.ts";

const CEDULA = "40212345678";
const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const fila = (o = {}) => ({
  nombre: "Ana Pérez", cedula: CEDULA, salario: 5000000n, comisiones: 0n, vacaciones: 0n, otras: 0n, regalia: 0n, indemnizacion: 0n, pension: 0n, isrManual: null, tipoIngreso: "0001", ...o,
});
const entrada = (filas = [fila()], o = {}) => ({ periodo: "2026-03", proceso: "AM", smn: SMN_2026, srlVariable: 10n, rncEmpleador: "133097346", filas, ...o });

test("la escala anual del ISR de asalariados 2026", () => {
  assert.equal(isrAnual2026(41622000n), 0n, "hasta 416,220.00 exento");
  assert.equal(isrAnual2026(41622001n), 0n, "el primer centavo del tramo no paga todavía: el excedente es de 416,220.01");
  assert.equal(isrAnual2026(41622101n), 15n, "un peso más de excedente = 15 centavos");
  assert.equal(isrAnual2026(62432900n), 3121635n, "15 % del excedente de 416,220.01 hasta 624,329.00");
  assert.equal(isrAnual2026(62432901n), 3121600n, "empieza el tramo con RD$31,216.00 fijos");
  assert.equal(isrAnual2026(86712300n), 7977480n, "31,216.00 más el 20 % del excedente de 624,329.01 hasta 867,123.00")
  assert.equal(isrAnual2026(86712301n), 7977600n, "desde 867,123.01: RD$79,776.00 más el 25 % del excedente");
  assert.equal(isrAnual2026(87712301n), 7977600n + 250000n, "RD$10,000 de excedente = 2,500.00");
});

test("el ISR mensual se anualiza después de quitar los aportes del trabajador", () => {
  assert.equal(isrMensual(5000000n, 143500n + 152000n), 185400n, "50,000 al mes: (50,000 − 2,955) × 12 = 564,540 → 22,248.00 al año → 1,854.00");
  assert.equal(isrMensual(3000000n, 86100n + 91200n), 0n, "30,000 al mes queda bajo el mínimo exento");
  assert.equal(isrMensual(0n, 0n), 0n);
});

test("aportes de un salario de 50,000", () => {
  const r = calcularNomina(entrada());
  const f = r.filas[0];
  assert.equal(f.afpTrabajador, 143500n); // 2.87 %
  assert.equal(f.sfsTrabajador, 152000n); // 3.04 %
  assert.equal(f.isr, 185400n);
  assert.equal(f.neto, 4519100n);
  assert.equal(f.afpEmpleador, 355000n);  // 7.10 %
  assert.equal(f.sfsEmpleador, 354500n);  // 7.09 %
  assert.equal(f.srl, 55000n);            // 1 % fijo + 0.10 % variable
  assert.equal(f.infotep, 50000n);        // 1 %
  assert.equal(r.totales.totalTSS, 143500n + 152000n + 355000n + 354500n + 55000n);
  assert.equal(r.totales.costoEmpleador, 355000n + 354500n + 55000n + 50000n);
  assert.deepEqual(r.topes, { srl: 9289200n, sfs: 23223000n, afp: 46446000n });
});

test("cada seguro se calcula hasta su propio tope", () => {
  const f = calcularNomina(entrada([fila({ salario: 30000000n })])).filas[0]; // 300,000 al mes
  assert.equal(f.afpTrabajador, 861000n, "pensiones: 300,000 está bajo el tope de 464,460");
  assert.equal(f.sfsTrabajador, 705979n, "salud: tope de 232,230 × 3.04 %");
  assert.equal(f.isr, 5966549n);
  assert.equal(f.afpEmpleador, 2130000n);
  assert.equal(f.sfsEmpleador, 1646511n);
  assert.equal(f.srl, 102181n, "riesgos laborales: tope de 92,892 × 1.10 %");
  assert.equal(f.infotep, 300000n, "INFOTEP sobre todo el salario");
  const g = calcularNomina(entrada([fila({ salario: 100000000n })])).filas[0]; // 1,000,000 al mes
  assert.equal(g.afpTrabajador, 1333000n, "pensiones: tope de 464,460 × 2.87 %");
  assert.equal(g.afpEmpleador, 3297666n);
  assert.equal(g.isr, 23348549n);
});

test("las vacaciones por ley cotizan a la seguridad social y van entre las otras remuneraciones del ISR", () => {
  const f = calcularNomina(entrada([fila({ vacaciones: 1000000n, otras: 500000n, comisiones: 200000n })])).filas[0];
  assert.equal(f.salarioSS, 5000000n + 200000n + 1000000n);
  assert.equal(f.salarioISR, 5200000n);
  assert.equal(f.otrasISR, 1500000n);
  assert.equal(f.infotep, 52000n, "INFOTEP: salario ordinario más comisiones");
  assert.equal(f.afpTrabajador, 177940n, "2.87 % de 62,000")
});

test("regalía, indemnización y pensión: no pagan ISR y la pensión se descuenta del neto", () => {
  const sin = calcularNomina(entrada()).filas[0];
  const con = calcularNomina(entrada([fila({ regalia: 5000000n, indemnizacion: 1000000n, pension: 200000n })])).filas[0];
  assert.equal(con.isr, sin.isr, "lo exento no cambia el ISR");
  assert.equal(con.afpTrabajador, sin.afpTrabajador, "ni la seguridad social");
  assert.equal(con.neto, sin.neto + 5000000n + 1000000n - 200000n);
});

test("el ISR escrito a mano manda sobre el estimado", () => {
  const r = calcularNomina(entrada([fila({ isrManual: 123400n })]));
  assert.equal(r.filas[0].isr, 123400n);
  assert.equal(r.filas[0].isrEstimado, 185400n);
  assert.ok(r.advertencias.some((x) => /a mano/.test(x)));
});

test("avisos: otro año, otro salario mínimo, tope, INFOTEP bajo", () => {
  assert.ok(calcularNomina(entrada([fila()], { periodo: "2027-01" })).advertencias.some((x) => /2027/.test(x)));
  assert.ok(calcularNomina(entrada([fila()], { smn: 2500000n })).advertencias.some((x) => /salario mínimo/.test(x)));
  assert.ok(calcularNomina(entrada([fila({ salario: 10000000n })])).advertencias.some((x) => /tope de riesgos laborales/.test(x)));
  assert.ok(calcularNomina(entrada([fila({ salario: 2000000n })])).advertencias.some((x) => /RD\$300/.test(x)));
  assert.equal(calcularNomina(entrada()).advertencias.length, 0);
});

test("montos del archivo: 16 posiciones con punto y dos decimales", () => {
  assert.equal(monto16(5000000n), "0000000050000.00");
  assert.equal(monto16(5n), "0000000000000.05");
  assert.equal(monto16(0n), "0000000000000.00");
  assert.equal(monto16(123456789012345n).length, 16);
  assert.throws(() => monto16(-1n));
});

test("el archivo AM: encabezado, un detalle de 312 posiciones y sumario", () => {
  const e = entrada();
  const txt = archivoTSS(e, calcularNomina(e));
  const l = txt.split("\r\n");
  assert.equal(l.length, 3);
  assert.equal(l[0], "EAM  13309734603" + "2026", "E + AM + RNC a la derecha en 11 + MMAAAA");
  assert.equal(l[0].length, 20);
  const d = l[1];
  assert.equal(d.length, 312);
  assert.equal(d.slice(0, 1), "D");
  assert.equal(d.slice(1, 4), "001");
  assert.equal(d.slice(4, 5), "C");
  assert.equal(d.slice(5, 30), CEDULA.padEnd(25, " "));
  assert.equal(d.slice(30, 160).trim(), "", "nombres y apellidos en blanco");
  assert.equal(d.slice(169, 185), "0000000050000.00", "salario SS, posiciones 170 a 185");
  assert.equal(d.slice(185, 201), "0000000000000.00", "aporte voluntario");
  assert.equal(d.slice(201, 217), "0000000000000.00", "salario ISR: igual al de la SS, va en ceros");
  assert.equal(d.slice(217, 233), "0000000000000.00", "otras remuneraciones");
  assert.equal(d.slice(233, 244), " ".repeat(11), "agente de retención");
  assert.equal(d.slice(292, 308), "0000000000000.00", "INFOTEP: igual al de la SS, va en ceros");
  assert.equal(d.slice(308, 312), "0001", "tipo de ingreso");
  assert.equal(l[2], "S000003", "el sumario cuenta encabezado, detalle y sumario");
});

test("si el salario ISR o el de INFOTEP difieren del de la SS, se reportan", () => {
  const e = entrada([fila({ vacaciones: 1000000n, otras: 500000n })]);
  const d = archivoTSS(e, calcularNomina(e)).split("\r\n")[1];
  assert.equal(d.slice(169, 185), "0000000060000.00", "SS: ordinario + vacaciones por ley");
  assert.equal(d.slice(201, 217), "0000000050000.00", "ISR: solo el ordinario");
  assert.equal(d.slice(217, 233), "0000000015000.00", "otras remuneraciones: vacaciones + otras");
  assert.equal(d.slice(292, 308), "0000000050000.00", "INFOTEP: solo el ordinario");
});

test("con ingresos exentos, todos los detalles miden 366 y llevan los códigos 01, 02 y 03", () => {
  const e2 = entrada([fila({ regalia: 200000n }), fila({ cedula: "00100000001", nombre: "Sin exentos" })]);
  const l = archivoTSS(e2, calcularNomina(e2)).split("\r\n");
  assert.equal(l.length, 4);
  for (const d of l.slice(1, 3)) assert.equal(d.length, 366);
  assert.equal(l[1].slice(312, 330), "010000000002000.00", "regalía pascual, posiciones 313 a 330");
  assert.equal(l[1].slice(330, 348), "020000000000000.00");
  assert.equal(l[1].slice(348, 366), "030000000000000.00");
  assert.equal(l[2].slice(312, 330), "010000000000000.00", "quien no tiene exentos lleva ceros");
  assert.equal(l[3], "S000004");
});

test("el nombre del archivo y la retroactiva", () => {
  assert.equal(nombreArchivoTSS(entrada()), "AM_133097346_032026.txt");
  const ar = entrada([fila()], { proceso: "AR", periodo: "2025-12" });
  assert.equal(nombreArchivoTSS(ar), "AR_133097346_122025.txt");
  assert.ok(archivoTSS(ar, calcularNomina(ar)).startsWith("EAR  133097346122025"));
});

test("sin el RNC de la empresa no hay archivo", () => {
  const e = entrada([fila()], { rncEmpleador: "" });
  assert.throws(() => archivoTSS(e, calcularNomina(e)), /RNC/);
});

test("el formulario se lee con sus validaciones", () => {
  const base = { periodo: "2026-03", proceso: "AM", smn: "23,223.00", srl_variable: "0.20", n: "2", p0_incluir: "on", p0_nombre: "Ana Pérez", p0_cedula: "402-1234567-8", p0_salario: "50,000.00", p0_tipo: "0001" };
  const ok = leerNomina(fd(base), "133-09734-6");
  assert.equal(ok.filas.length, 1, "la fila 2 no está marcada");
  assert.equal(ok.filas[0].cedula, CEDULA);
  assert.equal(ok.filas[0].salario, 5000000n);
  assert.equal(ok.smn, 2322300n);
  assert.equal(ok.srlVariable, 20n);
  assert.equal(ok.rncEmpleador, "133097346");
  assert.match(leerNomina(fd({ ...base, periodo: "marzo" }), "1"), /mes de la nómina/);
  assert.match(leerNomina(fd({ ...base, smn: "x" }), "1"), /Salario mínimo/);
  assert.match(leerNomina(fd({ ...base, srl_variable: "abc" }), "1"), /porcentaje variable/);
  assert.match(leerNomina(fd({ ...base, srl_variable: "2" }), "1"), /máximo es 1/);
  assert.match(leerNomina(fd({ ...base, p0_cedula: "402-1234567-9" }), "1"), /cédula no es válida/);
  assert.match(leerNomina(fd({ ...base, p0_nombre: "" }), "1"), /escribe el nombre/);
  assert.match(leerNomina(fd({ ...base, p0_salario: "" }), "1"), /salario del mes/);
  assert.match(leerNomina(fd({ ...base, p0_salario: "0" }), "1"), /mayor que cero/);
  assert.match(leerNomina(fd({ ...base, p0_otras: "abc" }), "1"), /otras remuneraciones no es válido/);
  assert.match(leerNomina(fd({ ...base, p0_tipo: "0099" }), "1"), /tipo de ingreso/);
  assert.match(leerNomina(fd({ ...base, p0_incluir: "" }), "1"), /al menos un empleado/);
  assert.match(leerNomina(fd({ ...base, p1_incluir: "on", p1_nombre: "Otra", p1_cedula: CEDULA, p1_salario: "1000" }), "1"), /dos veces/);
  assert.equal(leerNomina(fd({ ...base, p0_isr: "1,234.00" }), "1").filas[0].isrManual, 123400n);
  assert.equal(leerNomina(fd({ ...base, proceso: "AR" }), "1").proceso, "AR");
});

test("la hoja de la nómina lleva una fila por empleado y los totales", () => {
  const e = entrada([fila(), fila({ nombre: "Luis", cedula: "00100000001", salario: 3000000n })]);
  const t = tablaNomina(e, calcularNomina(e), "Salón Rosa SRL", "Generado por Ana");
  assert.match(t.titulo, /Nómina de marzo de 2026/);
  assert.equal(t.filas.length, 2);
  assert.equal(t.filas[0][2], "50000.00");
  assert.equal(t.filas[0][6], "1854.00");
  assert.equal(t.totales[2], "80000.00");
  assert.equal(t.totales[6], "1854.00");
  assert.equal(t.columnas.length, t.filas[0].length);
});

test("las reglas, las fuentes y las decisiones están a la vista", () => {
  assert.ok(REGLAS_NOMINA.length >= 6);
  assert.ok(DECISIONES_NOMINA.length >= 5);
  assert.equal(Object.keys(TIPOS_INGRESO).length, 8);
});
