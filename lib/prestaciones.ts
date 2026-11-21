import { aCentavos, deCentavos, leerMonto, verMonto } from "./montos.ts";

// Prioridad 3 · P3g · Prestaciones laborales: preaviso, cesantía, vacaciones y salario de Navidad de un empleado que termina su contrato.
// Todas las reglas salen del texto del Código de Trabajo (Ley 16-92) y de su Reglamento 258-93 tal como los publica el Ministerio de Trabajo
// (https://mt.gob.do/wp-content/uploads/2024/07/codigo_de_trabajo.pdf, leído el 21-nov-2026); cada concepto dice su artículo. Montos en centavos con
// bigint, nunca floats. Lo que el texto deja dudoso se resuelve a favor del trabajador y se lista en `DECISIONES` para que lo confirme quien firma.

// Valor de la fórmula del salario diario cuando se paga por mes: salario mensual ÷ 23.83 (Reglamento, arts. 14 e) y 32 d)).
const DIVISOR = 2383n; // 23.83 × 100

export type Terminacion = "desahucio" | "despido_injustificado" | "sin_cesantia";
export const TERMINACIONES: Record<Terminacion, { nombre: string; detalle: string; conCesantia: boolean }> = {
  desahucio: { nombre: "Desahucio por el empleador (sin alegar causa)", detalle: "Preaviso (o su indemnización si no se dio), cesantía, vacaciones y salario de Navidad.", conCesantia: true },
  despido_injustificado: { nombre: "Despido injustificado o dimisión justificada", detalle: "Cuando un tribunal declara que el despido no tuvo justa causa o que la dimisión sí la tuvo: las mismas sumas del desahucio.", conCesantia: true },
  sin_cesantia: { nombre: "Despido con justa causa, dimisión sin justa causa o desahucio del trabajador", detalle: "Solo vacaciones no disfrutadas y salario de Navidad: no hay preaviso a favor del trabajador ni cesantía.", conCesantia: false },
};

export type Entrada = {
  nombre: string; ingreso: string; termino: string;
  sueldo: bigint;             // salario mensual ordinario de hoy (vacaciones y Navidad)
  promedio: bigint | null;    // promedio mensual de los salarios ordinarios del último año (preaviso y cesantía); si falta, el sueldo
  terminacion: Terminacion;
  preavisoDado: number;       // días de preaviso que sí se dieron
  vacacionesPendientes: number; // años completos cuyas vacaciones no se han disfrutado
  devengadoAnio: bigint | null; // salarios ordinarios realmente devengados en el año de la terminación (para Navidad); si falta, se estima
  salarioMinimo: bigint | null; // para el tope de cinco salarios mínimos del salario de Navidad; si falta, no se aplica
};

export type Concepto = { clave: string; nombre: string; articulos: string; dias: number | null; formula: string; monto: string; nota?: string };
export type Resultado = {
  antiguedad: string; salarioDiario: string; salarioDiarioPromedio: string;
  conceptos: Concepto[]; total: string; fechaLimite: string; recargoDiario: string; advertencias: string[];
};

// ───────────── Fechas (sin zonas horarias) ─────────────

const partes = (f: string) => f.split("-").map(Number) as [number, number, number];
const ultimoDia = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const iso = (a: number, m: number, d: number) => `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
// Una fecha AAAA-MM-DD que existe en el calendario (no el 31 de febrero).
export const fechaValidaISO = (f: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const [a, m, d] = partes(f);
  return m >= 1 && m <= 12 && d >= 1 && d <= ultimoDia(a, m);
};
export function sumarMeses(f: string, n: number): string {
  const [a, m, d] = partes(f);
  const t = a * 12 + (m - 1) + n, na = Math.floor(t / 12), nm = (t % 12) + 1;
  return iso(na, nm, Math.min(d, ultimoDia(na, nm)));
}
export const sumarDias = (f: string, n: number) => new Date(Date.parse(f) + n * 86400000).toISOString().slice(0, 10);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export type Antiguedad = { anios: number; meses: number; dias: number };
// Del día de ingreso al último día trabajado, inclusive: años completos, meses completos y días que sobran. Cuenta todo el contrato continuo (Art. 84).
export function antiguedad(ingreso: string, termino: string): Antiguedad {
  const fin = sumarDias(termino, 1);
  let anios = 0;
  while (sumarMeses(ingreso, 12 * (anios + 1)) <= fin) anios++;
  let meses = 0;
  while (meses < 11 && sumarMeses(ingreso, 12 * anios + meses + 1) <= fin) meses++;
  return { anios, meses, dias: diasEntre(sumarMeses(ingreso, 12 * anios + meses), fin) };
}
export const verAntiguedad = (a: Antiguedad) => {
  const p = (n: number, s: string, pl: string) => `${n} ${n === 1 ? s : pl}`;
  return [a.anios ? p(a.anios, "año", "años") : "", a.meses ? p(a.meses, "mes", "meses") : "", a.dias ? p(a.dias, "día", "días") : ""].filter(Boolean).join(", ") || "0 días";
};
const mesesTotales = (a: Antiguedad) => a.anios * 12 + a.meses;
// ¿Pasa de k meses (más de k meses completos, con algún día de sobra)?
const pasaDe = (m: number, d: number, k: number) => m > k || (m === k && d > 0);

// ───────────── Las reglas ─────────────

// Art. 76: preaviso, 7 días si el trabajo continuo no es menor de tres meses ni mayor de seis; 14 si pasa de seis meses y no pasa de un año; 28 después de un año.
export function diasPreaviso(a: Antiguedad): number {
  if (a.anios >= 1) return 28;
  if (pasaDe(a.meses, a.dias, 6)) return 14;
  return a.meses >= 3 ? 7 : 0;
}

// Art. 80: cesantía, 6 días de salario ordinario con 3 a 6 meses; 13 días con 6 meses a un año; 21 días por cada año con uno a cinco años; 23 por cada año con
// cinco o más. Toda fracción de año mayor de tres meses se paga con los ordinales 1 y 2.
export function diasCesantia(a: Antiguedad): number {
  const fraccion = pasaDe(a.meses, a.dias, 3) ? (a.meses >= 6 ? 13 : 6) : 0;
  if (a.anios >= 1) return a.anios * (a.anios >= 5 ? 23 : 21) + fraccion;
  return a.meses >= 6 ? 13 : a.meses >= 3 ? 6 : 0;
}

// Arts. 177 y 180: 14 días laborables de vacaciones con uno a cinco años de trabajo, 18 con cinco o más (cada año cumplido da su período);
// la fracción de año: más de 5 meses 6 días, más de 6 meses 7 … más de 11 meses 12 días.
export const diasVacacionesDelAnio = (anio: number) => (anio >= 5 ? 18 : 14);
export function diasVacacionesFraccion(a: Antiguedad): number {
  let mejor = 0;
  for (let k = 5; k <= 11; k++) if (pasaDe(a.meses, a.dias, k)) mejor = k + 1;
  return mejor;
}
export function diasVacacionesPendientes(a: Antiguedad, periodos: number) {
  let dias = 0;
  for (let y = a.anios - periodos + 1; y <= a.anios; y++) if (y >= 1) dias += diasVacacionesDelAnio(y);
  return dias;
}

// ───────────── El cálculo ─────────────

const redondear = (a: bigint, b: bigint) => (2n * a + b) / (2n * b);
// días × salario mensual ÷ 23.83, redondeado una sola vez al centavo.
const porDias = (mensual: bigint, dias: number | bigint) => redondear(mensual * BigInt(dias) * 100n, DIVISOR);

export function calcular(e: Entrada): Resultado {
  const a = antiguedad(e.ingreso, e.termino);
  const promedio = e.promedio ?? e.sueldo;
  const conCesantia = TERMINACIONES[e.terminacion].conCesantia;
  const diario = (m: bigint) => porDias(m, 1);
  const moneda = (c: bigint) => `RD$${verMonto(deCentavos(c))}`;
  const conceptos: Concepto[] = [];
  const advertencias: string[] = [];

  // Preaviso (Arts. 76 y 79): lo que falta por dar se paga como indemnización.
  const plazo = diasPreaviso(a);
  if (conCesantia) {
    const faltan = Math.max(0, plazo - e.preavisoDado);
    conceptos.push({
      clave: "preaviso", nombre: "Preaviso omitido", articulos: "Arts. 76, 79 y 85", dias: faltan,
      formula: plazo === 0 ? "Menos de tres meses de trabajo: no hay plazo de preaviso."
        : `${e.preavisoDado ? `Plazo de ${plazo} días − ${Math.min(e.preavisoDado, plazo)} dados = ` : ""}${faltan} días × ${moneda(diario(promedio))} de salario diario`,
      monto: deCentavos(porDias(promedio, faltan)),
      nota: faltan === 0 && plazo > 0 ? "El preaviso se dio completo: no hay indemnización." : undefined,
    });
  } else {
    conceptos.push({ clave: "preaviso", nombre: "Preaviso omitido", articulos: "Arts. 76 y 79", dias: null, formula: "No corresponde al trabajador en este tipo de terminación.", monto: "0.00" });
  }

  // Cesantía (Art. 80).
  if (conCesantia) {
    const dias = diasCesantia(a);
    conceptos.push({
      clave: "cesantia", nombre: "Auxilio de cesantía", articulos: "Arts. 80, 85 y 86", dias,
      formula: dias === 0 ? "Menos de tres meses de trabajo: no hay cesantía." : `${dias} días × ${moneda(diario(promedio))} de salario diario`,
      monto: deCentavos(porDias(promedio, dias)),
    });
  } else {
    conceptos.push({ clave: "cesantia", nombre: "Auxilio de cesantía", articulos: "Art. 80", dias: null, formula: "No corresponde en este tipo de terminación (la cesantía es del desahucio del empleador y del despido injustificado).", monto: "0.00" });
  }

  // Vacaciones no disfrutadas (Arts. 177 a 184).
  const periodos = Math.min(e.vacacionesPendientes, a.anios);
  const diasPeriodos = diasVacacionesPendientes(a, periodos), diasFraccion = diasVacacionesFraccion(a);
  const diasVac = diasPeriodos + diasFraccion;
  conceptos.push({
    clave: "vacaciones", nombre: "Vacaciones no disfrutadas", articulos: "Arts. 177 a 184", dias: diasVac,
    formula: diasVac === 0 ? "No hay vacaciones por pagar."
      : [periodos ? `${periodos} ${periodos === 1 ? "período completo" : "períodos completos"} = ${diasPeriodos} días` : "", diasFraccion ? `fracción del año actual = ${diasFraccion} días` : ""].filter(Boolean).join(" + ")
        + `; ${diasVac} días × ${moneda(diario(e.sueldo))} de salario diario`,
    monto: deCentavos(porDias(e.sueldo, diasVac)),
  });

  // Salario de Navidad (Arts. 219 a 222): la duodécima parte de lo ordinario devengado en el año calendario.
  const anioTermino = Number(e.termino.slice(0, 4));
  const desdeAnio = e.ingreso > `${anioTermino}-01-01` ? e.ingreso : `${anioTermino}-01-01`;
  const enAnio = antiguedad(desdeAnio, e.termino);
  const devengado = e.devengadoAnio ?? redondear(e.sueldo * BigInt(30 * mesesTotales(enAnio) + enAnio.dias), 30n);
  let navidad = redondear(devengado, 12n);
  let notaNavidad = e.devengadoAnio === null ? "Estimado con el sueldo de hoy por los meses del año: si el sueldo cambió, escribe lo realmente devengado." : undefined;
  if (e.salarioMinimo !== null && navidad > e.salarioMinimo * 5n) {
    navidad = e.salarioMinimo * 5n;
    notaNavidad = "Se aplicó el tope del Art. 219: cinco salarios mínimos (las partes pueden acordar más: Reglamento, Art. 36).";
  } else if (e.salarioMinimo === null) {
    notaNavidad = [notaNavidad, "El Art. 219 pone un tope de cinco salarios mínimos; no se aplicó porque no se escribió el salario mínimo."].filter(Boolean).join(" ");
  }
  conceptos.push({
    clave: "navidad", nombre: "Salario de Navidad", articulos: "Arts. 219 a 222; Reglamento, Art. 37", dias: null,
    formula: `${moneda(devengado)} devengados en ${anioTermino} ÷ 12`, monto: deCentavos(navidad), nota: notaNavidad,
  });

  const total = conceptos.reduce((s, c) => s + aCentavos(c.monto), 0n);

  if (mesesTotales(a) < 3) advertencias.push("Tiene menos de tres meses de trabajo: no hay preaviso ni cesantía.");
  if (e.ingreso <= "1992-05-29") advertencias.push("Ingresó antes de la promulgación del Código (29 de mayo de 1992): el Art. 80 manda calcular los años anteriores con 15 días de salario por año. Esta calculadora usa la escala actual para todos los años: hay que separar esa parte a mano.");
  if (e.terminacion === "despido_injustificado") advertencias.push("En el despido injustificado, el Art. 95 suma además los salarios desde la demanda hasta la sentencia, hasta seis meses: depende de la sentencia y no está en este cálculo.");
  if (e.vacacionesPendientes > a.anios) advertencias.push(`Solo hay ${a.anios} ${a.anios === 1 ? "año completo" : "años completos"}: se contaron ${periodos} ${periodos === 1 ? "período" : "períodos"} de vacaciones.`);
  if (e.termino > new Date().toISOString().slice(0, 10)) advertencias.push("La fecha de terminación es futura: es un cálculo estimado.");
  if (e.promedio !== null && e.promedio !== e.sueldo) advertencias.push("El preaviso y la cesantía se calcularon con el promedio del último año; las vacaciones y la Navidad, con el sueldo de hoy.");

  return {
    antiguedad: verAntiguedad(a), salarioDiario: deCentavos(diario(e.sueldo)), salarioDiarioPromedio: deCentavos(diario(promedio)),
    conceptos, total: deCentavos(total), fechaLimite: sumarDias(e.termino, 10), recargoDiario: deCentavos(diario(promedio)), advertencias,
  };
}

// ───────────── Formulario ─────────────

const entero = (t: string, nombre: string, max: number): number | string => {
  if (!t.trim()) return 0;
  if (!/^\d+$/.test(t.trim())) return `${nombre}: escribe un número entero.`;
  const n = Number(t);
  return n > max ? `${nombre}: no puede pasar de ${max}.` : n;
};
const dinero = (t: string, nombre: string, obligatorio: boolean): bigint | null | string => {
  if (!t.trim()) return obligatorio ? `${nombre}: escribe el monto.` : null;
  const m = leerMonto(t);
  return m === null ? `${nombre}: el monto no es válido.` : aCentavos(m);
};

export function leerEntrada(fd: FormData): Entrada | string {
  const txt = (n: string) => String(fd.get(n) ?? "").trim();
  const ingreso = txt("ingreso"), termino = txt("termino");
  if (!fechaValidaISO(ingreso)) return "Escribe la fecha de ingreso.";
  if (!fechaValidaISO(termino)) return "Escribe la fecha de terminación.";
  if (termino < ingreso) return "La fecha de terminación es anterior a la de ingreso.";
  const terminacion = txt("terminacion") as Terminacion;
  if (!(terminacion in TERMINACIONES)) return "Elige cómo terminó el contrato.";
  const sueldo = dinero(txt("sueldo"), "Salario mensual", true);
  if (typeof sueldo === "string") return sueldo;
  if (sueldo === null || sueldo <= 0n) return "Salario mensual: tiene que ser mayor que cero.";
  const promedio = dinero(txt("promedio"), "Promedio del último año", false);
  if (typeof promedio === "string") return promedio;
  const devengado = dinero(txt("devengado"), "Salarios devengados en el año", false);
  if (typeof devengado === "string") return devengado;
  const minimo = dinero(txt("minimo"), "Salario mínimo", false);
  if (typeof minimo === "string") return minimo;
  const dado = entero(txt("preaviso_dado"), "Días de preaviso dados", 60);
  if (typeof dado === "string") return dado;
  const pendientes = entero(txt("vacaciones_pendientes"), "Períodos de vacaciones pendientes", 60);
  if (typeof pendientes === "string") return pendientes;
  return {
    nombre: txt("nombre").slice(0, 120) || "Empleado", ingreso, termino, sueldo, promedio: promedio && promedio > 0n ? promedio : null, terminacion,
    preavisoDado: dado, vacacionesPendientes: pendientes, devengadoAnio: devengado, salarioMinimo: minimo && minimo > 0n ? minimo : null,
  };
}

// ───────────── Las reglas, a la vista ─────────────

export const FUENTE = "Código de Trabajo (Ley 16-92) y Reglamento 258-93, texto del Ministerio de Trabajo (mt.gob.do/wp-content/uploads/2024/07/codigo_de_trabajo.pdf)";
export const REGLAS: { articulo: string; titulo: string; texto: string }[] = [
  { articulo: "Art. 76", titulo: "Preaviso", texto: "Quien desahucia da aviso previo: 7 días después de un trabajo continuo no menor de tres meses ni mayor de seis; 14 días si pasa de seis meses y no pasa de un año; 28 días después de un año." },
  { articulo: "Art. 79", titulo: "Preaviso omitido", texto: "Quien omite el preaviso o lo da insuficiente paga una indemnización equivalente a la remuneración del trabajador durante los plazos del Art. 76." },
  { articulo: "Art. 80", titulo: "Auxilio de cesantía (desahucio del empleador)", texto: "6 días de salario ordinario con tres a seis meses; 13 días con seis meses a un año; 21 días por cada año con uno a cinco años; 23 días por cada año con cinco o más. Toda fracción de año mayor de tres meses se paga con los dos primeros escalones. Los años anteriores a la promulgación del Código se calculan a 15 días por año." },
  { articulo: "Art. 85 y Reglamento Art. 14", titulo: "Salario base del preaviso y la cesantía", texto: "Promedio de los salarios ordinarios del último año (o fracción) del contrato, sin horas extras. Si se paga por mes: ese total ÷ meses trabajados ÷ 23.83 = salario diario." },
  { articulo: "Art. 86", titulo: "Plazo de pago", texto: "El preaviso omitido y la cesantía no pagan impuesto sobre la renta y se pagan dentro de diez días desde la terminación; cada día de retraso suma un día de salario." },
  { articulo: "Arts. 177 y 178", titulo: "Vacaciones", texto: "14 días laborables de salario ordinario con uno a cinco años de trabajo continuo; 18 días con cinco o más. El derecho se gana cada vez que se cumple un año." },
  { articulo: "Arts. 179 y 180", titulo: "Vacaciones proporcionales", texto: "Con menos de un año: más de 5 meses, 6 días; más de 6 meses, 7; más de 7, 8; más de 8, 9; más de 9, 10; más de 10, 11; más de 11 meses, 12 días." },
  { articulo: "Arts. 182 y 184", titulo: "Vacaciones no disfrutadas", texto: "Al terminar el contrato, sea cual fuere la causa, se paga una compensación equivalente a los salarios del período de vacaciones que no se disfrutó." },
  { articulo: "Reglamento Art. 32", titulo: "Salario diario de las vacaciones", texto: "Con salario mensual: el salario del mes ÷ 23.83." },
  { articulo: "Arts. 219 a 222", titulo: "Salario de Navidad", texto: "La duodécima parte del salario ordinario devengado en el año calendario, sin horas extras ni participación en los beneficios, con tope de cinco salarios mínimos. Se paga a más tardar el 20 de diciembre aunque el contrato haya terminado, en proporción al tiempo trabajado, y no paga impuesto sobre la renta." },
  { articulo: "Arts. 95 y 101", titulo: "Despido injustificado y dimisión justificada", texto: "Si el contrato es por tiempo indefinido, el tribunal condena a pagar el preaviso y la cesantía y, además, los salarios desde la demanda hasta la sentencia (hasta seis meses)." },
];

// Lo que el texto deja a interpretación y cómo lo resuelve esta calculadora: Patricia lo confirma antes de usarla en un caso real.
export const DECISIONES: string[] = [
  "El último día trabajado cuenta: la antigüedad va del día de ingreso al día de la terminación, inclusive.",
  "Con exactamente seis meses, el Art. 80 cae en dos escalones a la vez (6 y 13 días): se toma el de 13 días, el más favorable al trabajador. En el preaviso, seis meses justos son 7 días (el escalón de 14 pide que «exceda de seis meses»).",
  "Con un año exacto el preaviso es de 28 días («después de un año»), y la cesantía de 21 días.",
  "Con cinco años o más, los 23 días por año se aplican a todos los años de servicio, no solo a los que pasan de cinco.",
  "La fracción de año con más de tres meses se paga con 6 días (hasta seis meses) o 13 días (seis meses o más).",
  "En las vacaciones, el tiempo después del último aniversario se paga con la escala de los Arts. 179 y 180, aunque el trabajador lleve más de un año.",
  "El salario diario de las vacaciones y de la cesantía usa 23.83 días por mes; el salario de Navidad estimado usa el sueldo de hoy por los meses del año (el mes incompleto en días ÷ 30).",
];
