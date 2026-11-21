import { aCentavos, deCentavos, leerMonto, verMonto } from "./montos.ts";
import { cedulaValida } from "./validar-fiscal.ts";

// Prioridad 3 · P3h · Nómina del mes y archivo de autodeterminación de la TSS. Todo en centavos con bigint.
// Fuentes oficiales (leídas el 21-nov-2026):
//  · Guía de Usuario 2026 de la Tesorería de la Seguridad Social (tss.gob.do/documentos/instructivos): porcentajes, componentes cotizables, topes y
//    salario mínimo nacional (RD$23,223.00 desde el 1-feb-2026), INFOTEP y plazos.
//  · «Instructivo para construcción de archivos de autodeterminación y novedades» v6.0 de la TSS (25-jun-2025): estructura del archivo AM/AR.
//  · Escala de retención de asalariados 2026 de la DGII (Comunidad de Ayuda, CA687, y página «Impuesto sobre la Renta»).
// Lo que las fuentes no dicen (cómo se pasa la escala anual a la retención mensual, el redondeo del SUIR) está en `DECISIONES` para que lo confirme quien firma.

// Tasas en puntos base (1 % = 100). Trabajador: AFP 2.87 %, SFS 3.04 %; empleador: AFP 7.10 %, SFS 7.09 %, riesgos laborales 1 % fijo más 0.10 a 0.30 % según el
// factor de riesgo de la empresa; INFOTEP 1 % (del empleador).
export const TASAS = { afpTrabajador: 287n, sfsTrabajador: 304n, afpEmpleador: 710n, sfsEmpleador: 709n, srlFija: 100n, infotep: 100n } as const;
export const SMN_2026 = 2322300n; // RD$23,223.00, vigente desde el 1-feb-2026
// Topes de cotización en salarios mínimos: riesgos laborales 4, salud 10, pensiones 20.
export const TOPES = { srl: 4n, sfs: 10n, afp: 20n } as const;

// Escala anual de retención de asalariados 2026 (centavos): hasta 416,220.00 exento; 15 % del excedente hasta 624,329.00; 31,216.00 más 20 % del excedente
// hasta 867,123.00; 79,776.00 más 25 % del excedente.
export const ESCALA_2026 = {
  exento: 41622000n,
  tramo2: { desde: 41622001n, hasta: 62432900n, tasa: 15n, fija: 0n },
  tramo3: { desde: 62432901n, hasta: 86712300n, tasa: 20n, fija: 3121600n },
  tramo4: { desde: 86712301n, tasa: 25n, fija: 7977600n },
} as const;

export const TIPOS_INGRESO: Record<string, string> = {
  "0001": "Normal", "0002": "Trabajador ocasional (no fijo)", "0003": "Asalariado por hora o tiempo parcial", "0004": "No laboró el mes completo",
  "0005": "Salario prorrateado semanal o bisemanal", "0006": "Pensionado antes de la Ley 87-01", "0007": "Exento por ley de pago al SDSS", "0008": "Salario sectorizado",
};

export type FilaEntrada = {
  nombre: string; cedula: string;
  salario: bigint;        // salario ordinario del mes (lo realmente devengado)
  comisiones: bigint;
  vacaciones: bigint;     // vacaciones por ley pagadas en el mes
  otras: bigint;          // incentivos, horas extras, bonos y otras retribuciones (aplican al ISR)
  regalia: bigint;        // regalía pascual (exenta de ISR)
  indemnizacion: bigint;  // preaviso, cesantía, viáticos e indemnizaciones por accidente (exentos de ISR)
  pension: bigint;        // retención de pensión alimenticia (exenta)
  isrManual: bigint | null; // si se escribe, manda sobre el estimado
  tipoIngreso: string;
};
export type Entrada = { periodo: string; proceso: "AM" | "AR"; smn: bigint; srlVariable: bigint; filas: FilaEntrada[]; rncEmpleador: string };

export type FilaCalculo = FilaEntrada & {
  salarioSS: bigint; salarioISR: bigint; otrasISR: bigint;
  afpTrabajador: bigint; sfsTrabajador: bigint; isr: bigint; isrEstimado: bigint; descuentos: bigint; neto: bigint;
  afpEmpleador: bigint; sfsEmpleador: bigint; srl: bigint; infotep: bigint;
};
export type Totales = Record<"bruto" | "salarioSS" | "afpTrabajador" | "sfsTrabajador" | "isr" | "descuentos" | "neto" | "afpEmpleador" | "sfsEmpleador" | "srl" | "infotep" | "totalTSS" | "costoEmpleador", bigint>;
export type ResultadoNomina = { filas: FilaCalculo[]; totales: Totales; topes: { srl: bigint; sfs: bigint; afp: bigint }; advertencias: string[] };

// ───────────── Cálculo ─────────────

const redondear = (a: bigint, b: bigint) => (2n * a + b) / (2n * b);
const porcentaje = (base: bigint, bp: bigint) => redondear(base * bp, 10000n);
const menor = (a: bigint, b: bigint) => (a < b ? a : b);

// ISR anual de un asalariado con la escala de 2026.
export function isrAnual2026(renta: bigint): bigint {
  const e = ESCALA_2026;
  if (renta <= e.exento) return 0n;
  if (renta <= e.tramo2.hasta) return redondear((renta - (e.tramo2.desde)) * e.tramo2.tasa, 100n);
  if (renta <= e.tramo3.hasta) return e.tramo3.fija + redondear((renta - e.tramo3.desde) * e.tramo3.tasa, 100n);
  return e.tramo4.fija + redondear((renta - e.tramo4.desde) * e.tramo4.tasa, 100n);
}

// Retención mensual estimada: (ingresos gravables del mes − aportes del trabajador) × 12, con la escala anual, ÷ 12.
export function isrMensual(gravable: bigint, aportes: bigint): bigint {
  const renta = (gravable - aportes) * 12n;
  return renta <= 0n ? 0n : redondear(isrAnual2026(renta), 12n);
}

export function calcularNomina(e: Entrada): ResultadoNomina {
  const topes = { srl: TOPES.srl * e.smn, sfs: TOPES.sfs * e.smn, afp: TOPES.afp * e.smn };
  const advertencias: string[] = [];
  const filas = e.filas.map((f): FilaCalculo => {
    const salarioSS = f.salario + f.comisiones + f.vacaciones;
    const salarioISR = f.salario + f.comisiones;
    const otrasISR = f.vacaciones + f.otras;
    const afpTrabajador = porcentaje(menor(salarioSS, topes.afp), TASAS.afpTrabajador);
    const sfsTrabajador = porcentaje(menor(salarioSS, topes.sfs), TASAS.sfsTrabajador);
    const isrEstimado = isrMensual(salarioISR + otrasISR, afpTrabajador + sfsTrabajador);
    const isr = f.isrManual ?? isrEstimado;
    const descuentos = afpTrabajador + sfsTrabajador + isr + f.pension;
    return {
      ...f, salarioSS, salarioISR, otrasISR, afpTrabajador, sfsTrabajador, isr, isrEstimado, descuentos,
      neto: salarioISR + otrasISR - afpTrabajador - sfsTrabajador - isr - f.pension + f.regalia + f.indemnizacion,
      afpEmpleador: porcentaje(menor(salarioSS, topes.afp), TASAS.afpEmpleador),
      sfsEmpleador: porcentaje(menor(salarioSS, topes.sfs), TASAS.sfsEmpleador),
      srl: porcentaje(menor(salarioSS, topes.srl), TASAS.srlFija + e.srlVariable),
      infotep: porcentaje(f.salario + f.comisiones, TASAS.infotep),
    };
  });
  const suma = (k: keyof FilaCalculo) => filas.reduce((t, f) => t + (f[k] as bigint), 0n);
  const t: Totales = {
    bruto: filas.reduce((s, f) => s + f.salarioISR + f.otrasISR, 0n), salarioSS: suma("salarioSS"),
    afpTrabajador: suma("afpTrabajador"), sfsTrabajador: suma("sfsTrabajador"), isr: suma("isr"), descuentos: suma("descuentos"), neto: suma("neto"),
    afpEmpleador: suma("afpEmpleador"), sfsEmpleador: suma("sfsEmpleador"), srl: suma("srl"), infotep: suma("infotep"), totalTSS: 0n, costoEmpleador: 0n,
  };
  t.totalTSS = t.afpTrabajador + t.sfsTrabajador + t.afpEmpleador + t.sfsEmpleador + t.srl;
  t.costoEmpleador = t.afpEmpleador + t.sfsEmpleador + t.srl + t.infotep;

  if (!e.periodo.startsWith("2026-")) advertencias.push("La escala de retención del ISR que usa esta nómina es la de 2026. Para otros años hay que revisarla: la Ley 30-26, Art. 10, cambia los tramos desde el ejercicio 2027.");
  if (e.smn !== SMN_2026) advertencias.push(`El salario mínimo nacional usado (RD$${verMonto(deCentavos(e.smn))}) no es el de la Guía de la TSS de 2026 (RD$23,223.00): los topes de cotización se calculan con él.`);
  const sobreTope = filas.filter((f) => f.salarioSS > topes.srl).length;
  if (sobreTope) advertencias.push(`${sobreTope} ${sobreTope === 1 ? "empleado pasa" : "empleados pasan"} el tope de riesgos laborales (4 salarios mínimos); salud y pensiones tienen topes más altos y se aplican por separado.`);
  if (t.infotep > 0n && t.infotep < 30000n) advertencias.push("El 1 % de INFOTEP de toda la nómina no llega a RD$300.00: la TSS no genera esa liquidación y la acumula con los meses siguientes.");
  if (filas.some((f) => f.isrManual !== null)) advertencias.push("Hay empleados con el ISR escrito a mano: manda sobre el estimado.");
  return { filas, totales: t, topes, advertencias };
}

// ───────────── Formulario ─────────────

const soloDigitos = (v: string) => v.replace(/\D/g, "");

export function leerNomina(fd: FormData, rncEmpleador: string): Entrada | string {
  const txt = (n: string) => String(fd.get(n) ?? "").trim();
  const periodo = txt("periodo");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return "Elige el mes de la nómina.";
  const proceso = txt("proceso") === "AR" ? "AR" : "AM";
  const smnTxt = leerMonto(txt("smn") || "23223");
  if (smnTxt === null || aCentavos(smnTxt) <= 0n) return "Salario mínimo nacional: el monto no es válido.";
  const varTxt = txt("srl_variable") || "0.10";
  if (!/^\d(\.\d{1,2})?$/.test(varTxt)) return "Riesgos laborales, porcentaje variable: escribe un número como 0.10.";
  const srlVariable = BigInt(Math.round(Number(varTxt) * 100));
  if (srlVariable > 100n) return "Riesgos laborales, porcentaje variable: el máximo es 1.";
  const n = Number(txt("n"));
  if (!Number.isInteger(n) || n < 0 || n > 300) return "La lista de empleados no es válida.";
  const filas: FilaEntrada[] = [];
  for (let i = 0; i < n; i++) {
    if (txt(`p${i}_incluir`) !== "on") continue;
    const cual = `Empleado ${filas.length + 1}`;
    const monto = (campo: string, nombre: string, opcional = true): bigint | null | string => {
      const t = txt(`p${i}_${campo}`);
      if (!t) return opcional ? 0n : `${cual}: escribe ${nombre}.`;
      const m = leerMonto(t);
      return m === null ? `${cual}: ${nombre} no es válido.` : aCentavos(m);
    };
    const nombre = txt(`p${i}_nombre`).slice(0, 120);
    const cedula = soloDigitos(txt(`p${i}_cedula`));
    if (!nombre) return `${cual}: escribe el nombre.`;
    if (!cedulaValida(cedula)) return `${nombre}: la cédula no es válida (11 dígitos con su dígito verificador). Los extranjeros sin cédula se reportan en el SUIR Plus.`;
    const campos = {} as Record<string, bigint | null>;
    for (const [campo, titulo, opcional] of [["salario", "el salario del mes", false], ["comisiones", "las comisiones", true], ["vacaciones", "las vacaciones por ley", true], ["otras", "las otras remuneraciones", true],
      ["regalia", "la regalía pascual", true], ["indemnizacion", "la indemnización", true], ["pension", "la pensión alimenticia", true]] as const) {
      const v = monto(campo, titulo, opcional);
      if (typeof v === "string") return v;
      campos[campo] = v;
    }
    const isrTxt = txt(`p${i}_isr`);
    let isrManual: bigint | null = null;
    if (isrTxt) { const m = leerMonto(isrTxt); if (m === null) return `${nombre}: el ISR no es válido.`; isrManual = aCentavos(m); }
    const tipoIngreso = txt(`p${i}_tipo`) || "0001";
    if (!(tipoIngreso in TIPOS_INGRESO)) return `${nombre}: el tipo de ingreso no es válido.`;
    if ((campos.salario ?? 0n) <= 0n) return `${nombre}: el salario del mes tiene que ser mayor que cero.`;
    filas.push({ nombre, cedula, salario: campos.salario!, comisiones: campos.comisiones!, vacaciones: campos.vacaciones!, otras: campos.otras!, regalia: campos.regalia!, indemnizacion: campos.indemnizacion!,
      pension: campos.pension!, isrManual, tipoIngreso });
  }
  if (!filas.length) return "Marca al menos un empleado para la nómina.";
  const cedulas = filas.map((f) => f.cedula);
  const repetida = cedulas.find((c, i) => cedulas.indexOf(c) !== i);
  if (repetida) return `La cédula ${repetida} está dos veces.`;
  return { periodo, proceso, smn: aCentavos(smnTxt), srlVariable, filas, rncEmpleador: soloDigitos(rncEmpleador) };
}

// ───────────── Archivo de autodeterminación de la TSS (AM o AR) ─────────────

// 16 posiciones: 13 enteros, punto y 2 decimales (9999999999999.99).
export function monto16(c: bigint): string {
  if (c < 0n) throw new Error("Un monto del archivo no puede ser negativo.");
  return `${(c / 100n).toString().padStart(13, "0")}.${(c % 100n).toString().padStart(2, "0")}`;
}
// 18 posiciones: código de dos dígitos y el monto de 16.
const conCodigo = (codigo: string, c: bigint) => `${codigo}${monto16(c)}`;

export function nombreArchivoTSS(e: Entrada): string {
  const [a, m] = e.periodo.split("-");
  return `${e.proceso}_${e.rncEmpleador}_${m}${a}.txt`;
}

// Encabezado (E), un detalle (D) por trabajador y sumario (S). Posiciones del instructivo v6.0 de la TSS: el detalle mide 312 caracteres, y 366 si algún trabajador
// lleva ingresos exentos (regalía pascual, preaviso y cesantía o pensión alimenticia), que se agregan al final con sus códigos 01, 02 y 03.
export function archivoTSS(e: Entrada, r: ResultadoNomina): string {
  if (!/^\d{9}$|^\d{11}$/.test(e.rncEmpleador)) throw new Error("El RNC (o la cédula) de la empresa no está en su ficha o no es válido.");
  const [a, m] = e.periodo.split("-");
  const exentos = r.filas.some((f) => f.regalia > 0n || f.indemnizacion > 0n || f.pension > 0n);
  const blanco = (n: number) => " ".repeat(n);
  const lineas = [`E${e.proceso}${e.rncEmpleador.padStart(11, " ")}${m}${a}`];
  for (const f of r.filas) {
    const distintoISR = f.salarioISR !== f.salarioSS;
    const infotepDistinto = f.salario + f.comisiones !== f.salarioSS;
    const cero = monto16(0n);
    let d = "D" + "001" + "C" + f.cedula.padEnd(25, " ")
      + blanco(50) + blanco(40) + blanco(40) + blanco(1) + blanco(8) // nombres, apellidos, sexo y nacimiento (solo obligatorios para extranjeros sin cédula)
      + monto16(f.salarioSS) + cero                                       // salario SS y aporte voluntario
      + (distintoISR ? monto16(f.salarioISR) : cero)                       // salario ISR, solo si es diferente del de la SS
      + monto16(f.otrasISR) + blanco(11) + cero                           // otras remuneraciones, agente de retención y remuneraciones de otros empleadores
      + cero + cero                                                        // ingresos exentos (se detallan al final) y saldo a favor
      + (infotepDistinto ? monto16(f.salario + f.comisiones) : cero)      // salario cotizable de INFOTEP, solo si es diferente del de la SS
      + f.tipoIngreso;
    if (exentos) d += conCodigo("01", f.regalia) + conCodigo("02", f.indemnizacion) + conCodigo("03", f.pension);
    lineas.push(d);
  }
  lineas.push(`S${String(lineas.length + 1).padStart(6, "0")}`);
  return lineas.join("\r\n");
}

// ───────────── Hoja de la nómina (Excel y PDF) ─────────────

export function tablaNomina(e: Entrada, r: ResultadoNomina, empresa: string, generado: string) {
  const m = (c: bigint) => deCentavos(c);
  const [a, mes] = e.periodo.split("-");
  const nombreMes = new Date(Date.UTC(Number(a), Number(mes) - 1, 1)).toLocaleDateString("es-DO", { month: "long", year: "numeric", timeZone: "UTC" });
  return {
    titulo: `Nómina de ${nombreMes}`, empresa, generado, horizontal: true,
    detalle: `Aportes y retenciones según la Guía de la TSS 2026 y la escala de ISR 2026 de la DGII (estimado) · salario mínimo RD$${verMonto(m(e.smn))}`,
    columnas: [
      { titulo: "Empleado", ancho: 30 }, { titulo: "Cédula", ancho: 14 }, { titulo: "Salario cotizable SS", num: true }, { titulo: "Ingresos gravables", num: true },
      { titulo: "AFP 2.87 %", num: true }, { titulo: "SFS 3.04 %", num: true }, { titulo: "ISR", num: true }, { titulo: "Pensión", num: true }, { titulo: "Neto a pagar", num: true },
      { titulo: "AFP 7.10 %", num: true }, { titulo: "SFS 7.09 %", num: true }, { titulo: "Riesgos lab.", num: true }, { titulo: "INFOTEP 1 %", num: true },
    ],
    filas: r.filas.map((f) => [f.nombre, f.cedula, m(f.salarioSS), m(f.salarioISR + f.otrasISR), m(f.afpTrabajador), m(f.sfsTrabajador), m(f.isr), m(f.pension), m(f.neto),
      m(f.afpEmpleador), m(f.sfsEmpleador), m(f.srl), m(f.infotep)]),
    totales: ["Totales", "", m(r.totales.salarioSS), m(r.totales.bruto), m(r.totales.afpTrabajador), m(r.totales.sfsTrabajador), m(r.totales.isr), m(r.filas.reduce((s, f) => s + f.pension, 0n)),
      m(r.totales.neto), m(r.totales.afpEmpleador), m(r.totales.sfsEmpleador), m(r.totales.srl), m(r.totales.infotep)],
  };
}

// ───────────── Reglas y decisiones, a la vista ─────────────

export const FUENTES_NOMINA = [
  "Tesorería de la Seguridad Social, Guía de Usuario 2026 (tss.gob.do › Documentos › Instructivos): porcentajes, componentes cotizables, topes y plazos.",
  "Tesorería de la Seguridad Social, Instructivo para construcción de archivos de autodeterminación y novedades, versión 6.0 (25-jun-2025).",
  "DGII, escala de retención de asalariados 2026 (Comunidad de Ayuda CA687 y página «Impuesto sobre la Renta»).",
];
export const REGLAS_NOMINA: { titulo: string; texto: string }[] = [
  { titulo: "Aportes del trabajador (se le descuentan)", texto: "Pensiones (AFP) 2.87 % y salud (SFS) 3.04 % del salario cotizable. Riesgos laborales no se le descuenta: lo cubre el empleador." },
  { titulo: "Aportes del empleador", texto: "AFP 7.10 %, SFS 7.09 % y riesgos laborales 1 % fijo más 0.10 a 0.30 % según el factor de riesgo de la empresa (el SUIR lo asigna: se escribe el de su notificación). INFOTEP: 1 % del salario ordinario más comisiones de toda la nómina; si ese 1 % no pasa de RD$300.00 no se genera y se acumula." },
  { titulo: "Salario cotizable", texto: "Seguridad social: salario ordinario + comisiones + vacaciones por ley. ISR e INFOTEP: salario ordinario + comisiones. Otras remuneraciones (incentivos, horas extras, bonos, bonificaciones y vacaciones por ley) aplican al ISR." },
  { titulo: "Topes de cotización", texto: "Riesgos laborales 4 salarios mínimos, salud 10 y pensiones 20. Con el salario mínimo nacional de RD$23,223.00 (desde el 1-feb-2026): RD$92,892.00, RD$232,230.00 y RD$464,460.00. Cada seguro se calcula hasta su tope." },
  { titulo: "Escala anual del ISR de asalariados 2026", texto: "Hasta RD$416,220.00 exento; hasta RD$624,329.00, 15 % del excedente de RD$416,220.01; hasta RD$867,123.00, RD$31,216.00 más 20 % del excedente de RD$624,329.01; desde ahí, RD$79,776.00 más 25 % del excedente de RD$867,123.01." },
  { titulo: "Plazos", texto: "La notificación de la TSS se paga hasta el tercer día laborable del mes siguiente; después lleva recargo de 0.3 % más la rentabilidad de la cuenta individual. Las retenciones de ISR se declaran a más tardar el día 10 del mes siguiente." },
  { titulo: "Archivo de la TSS", texto: "Autodeterminación mensual (AM) o retroactiva (AR): un registro E, uno D por trabajador y uno S, con las posiciones del instructivo v6.0. Lleva los salarios y la TSS calcula los aportes; el nombre sugerido es AM_RNC_MMAAAA.txt. Cada envío sustituye al anterior. Se carga en el SUIR Plus, en «Gestión de archivos»." },
];
export const DECISIONES_NOMINA: string[] = [
  "El ISR mensual es un estimado: (ingresos gravables del mes − AFP − SFS del trabajador) × 12, con la escala anual, ÷ 12. Las páginas de la DGII dan la escala anual pero no explican cómo se pasa a la retención mensual, y el cálculo oficial lo hace la DGII con lo que reporta la TSS. Por eso cada empleado permite escribir el ISR a mano.",
  "En la escala se usa como exceso el que dice la DGII («del excedente de RD$416,220.01», «RD$624,329.01», «RD$867,123.01») y las sumas fijas de RD$31,216.00 y RD$79,776.00 tal como las publica.",
  "Cada aporte se redondea al centavo por separado (la TSS no publica cómo redondea el SUIR).",
  "El archivo de la TSS deja en blanco los nombres, apellidos, sexo y fecha de nacimiento: solo son obligatorios para los extranjeros sin cédula, que no se incluyen aquí y se reportan en el SUIR Plus.",
  "Los campos del archivo que no aplican van en ceros; los textos y fechas opcionales, en blanco; las líneas se separan con salto de línea de Windows. El instructivo no precisa esto: conviene probar el primer archivo en el SUIR Plus antes de usarlo cada mes.",
  "Si algún trabajador lleva regalía pascual, indemnizaciones o pensión alimenticia, todos los detalles del archivo llevan las tres columnas finales (366 posiciones), con ceros para quien no tiene.",
  "El salario del mes es lo realmente devengado: si alguien entró o salió a mitad de mes, se escribe la parte proporcional (el instructivo lo exige) y el tipo de ingreso suele ser 0004.",
];

