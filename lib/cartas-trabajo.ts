import { strToU8, zipSync } from "fflate";
import { aCentavos, verMonto } from "./montos.ts";
import { guardarPlantilla, plantillasDeFirma, verRnc } from "./plantillas-documento.ts";
import { fechaConAnio } from "./plantillas-word.ts";
import { antiguedad, verAntiguedad } from "./prestaciones.ts";

// Prioridad 3 · P3i · Cartas de trabajo. Usan las plantillas de Word de la P3d: el sistema suma los espacios del empleado ({{empleado}}, {{empleado_cargo}},
// {{empleado_sueldo_letras}}…), que se llenan al elegir al empleado de la ficha del cliente, y ofrece tres cartas de ejemplo (constancia de trabajo, comunicación de
// desahucio y aviso de vacaciones) que la firma agrega con un clic, revisa y ajusta. Los textos citan los artículos del Código de Trabajo (Ley 16-92).

// ───────────── Monto en letras ─────────────

const UNIDADES = ["cero", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho",
  "diecinueve", "veinte", "veintiún", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const DECENAS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

// 1 a 999, con «un» y «veintiún» porque siempre sigue «mil», «millón» o «pesos».
function menosDeMil(n: number): string {
  if (n === 100) return "cien";
  const c = Math.floor(n / 100), r = n % 100;
  const partes = c ? [CENTENAS[c]] : [];
  if (r) partes.push(r < 30 ? UNIDADES[r] : `${DECENAS[Math.floor(r / 10)]}${r % 10 ? ` y ${UNIDADES[r % 10]}` : ""}`);
  return partes.join(" ");
}
function hastaMillon(n: number): string {
  const t = Math.floor(n / 1000), r = n % 1000;
  return [t ? (t === 1 ? "mil" : `${menosDeMil(t)} mil`) : "", r ? menosDeMil(r) : ""].filter(Boolean).join(" ");
}
export function enLetrasEntero(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) throw new Error("Monto fuera del rango que se escribe en letras.");
  if (n === 0) return "cero";
  const millones = Math.floor(n / 1e6), resto = n % 1e6;
  return [millones ? (millones === 1 ? "un millón" : `${hastaMillon(millones)} millones`) : "", resto ? hastaMillon(resto) : ""].filter(Boolean).join(" ");
}

// 5000050 centavos → «cincuenta mil pesos dominicanos con 50/100».
export function montoEnLetras(centavos: bigint): string {
  if (centavos < 0n) throw new Error("Un monto en letras no puede ser negativo.");
  const pesos = Number(centavos / 100n), cc = String(centavos % 100n).padStart(2, "0");
  const letras = enLetrasEntero(pesos);
  if (pesos === 1) return `${letras} peso dominicano con ${cc}/100`;
  return `${letras} ${pesos > 0 && pesos % 1e6 === 0 ? "de pesos" : "pesos"} dominicanos con ${cc}/100`;
}

// ───────────── Datos del empleado para los espacios ─────────────

export type EmpleadoFicha = { nombre: string; cedula: string | null; cargo: string | null; fecha_ingreso: string | null; sueldo: string | null };

// Lo que se llena al elegir al empleado. Lo que la ficha no tiene va vacío (se escribe a mano al generar).
export function valoresDeEmpleado(e: EmpleadoFicha, hoy: string): Record<string, string> {
  const ingreso = e.fecha_ingreso && /^\d{4}-\d{2}-\d{2}$/.test(e.fecha_ingreso) ? e.fecha_ingreso : null;
  const sueldo = e.sueldo ? aCentavos(e.sueldo) : null;
  return {
    empleado: e.nombre, empleado_cedula: verRnc(e.cedula), empleado_cargo: e.cargo ?? "",
    empleado_fecha_ingreso: ingreso ? fechaConAnio(ingreso) : "", empleado_fecha_ingreso_corta: ingreso ? `${ingreso.slice(8)}/${ingreso.slice(5, 7)}/${ingreso.slice(0, 4)}` : "",
    empleado_antiguedad: ingreso && ingreso <= hoy ? verAntiguedad(antiguedad(ingreso, hoy)) : "",
    empleado_sueldo: sueldo !== null ? `RD$${verMonto(sueldo)}` : "", empleado_sueldo_letras: sueldo !== null ? montoEnLetras(sueldo) : "",
  };
}

// ───────────── Un .docx sencillo a partir de párrafos ─────────────

export type Parrafo = { texto: string; negrita?: boolean; alinear?: "both" | "center" | "right" | "left"; tam?: number; antes?: number; despues?: number };

const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function docxDeParrafos(parrafos: Parrafo[]): Uint8Array {
  const cuerpo = parrafos.map((p) => `<w:p><w:pPr><w:spacing w:before="${p.antes ?? 0}" w:after="${p.despues ?? 160}" w:line="276" w:lineRule="auto"/><w:jc w:val="${p.alinear ?? "both"}"/></w:pPr>`
    + `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>${p.negrita ? "<w:b/>" : ""}<w:sz w:val="${(p.tam ?? 11) * 2}"/></w:rPr><w:t xml:space="preserve">${escapar(p.texto)}</w:t></w:r></w:p>`).join("");
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/_rels/document.xml.rels": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${ns}><w:body>${cuerpo}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`),
  });
}

// ───────────── Las cartas de ejemplo ─────────────

const ENCABEZADO: Parrafo[] = [
  { texto: "{{nombre_empresa}}", negrita: true, alinear: "center", tam: 14, despues: 0 },
  { texto: "RNC {{rnc}}", alinear: "center", despues: 240 },
  { texto: "Ref.: {{referencia}}", alinear: "right", despues: 0 },
  { texto: "{{fecha}}", alinear: "right", despues: 360 },
];
const FIRMA = (cargo: string): Parrafo[] => [
  { texto: "Atentamente,", antes: 240, despues: 720, alinear: "left" },
  { texto: "______________________________", alinear: "left", despues: 0 },
  { texto: "{{gerente}}", negrita: true, alinear: "left", despues: 0 },
  { texto: `${cargo}, {{nombre_empresa}}`, alinear: "left", despues: 0 },
];

export type Carta = { nombre: string; codigo: string; descripcion: string; parrafos: Parrafo[] };
export const CARTAS: Carta[] = [
  {
    nombre: "Constancia de trabajo", codigo: "CT",
    descripcion: "Ejemplo para revisar: certifica que la persona trabaja en la empresa, desde cuándo, su cargo y su salario. Se llena al elegir al empleado de la ficha.",
    parrafos: [
      ...ENCABEZADO,
      { texto: "CONSTANCIA DE TRABAJO", negrita: true, alinear: "center", tam: 13, despues: 240 },
      { texto: "A quien pueda interesar:", alinear: "left" },
      { texto: "Por medio de la presente, {{nombre_empresa}}, titular del RNC {{rnc}}, hace constar que {{empleado}}, portador(a) de la cédula de identidad y electoral número {{empleado_cedula}}, presta sus servicios en esta empresa desde el {{empleado_fecha_ingreso}} ({{empleado_antiguedad}} de servicio), desempeñando el cargo de {{empleado_cargo}}, con un salario mensual de {{empleado_sueldo}} ({{empleado_sueldo_letras}})." },
      { texto: "Se expide la presente constancia a solicitud de la parte interesada, a los {{dia}} días del mes de {{mes}} de {{anio}}." },
      ...FIRMA("Gerente"),
    ],
  },
  {
    nombre: "Comunicación de desahucio", codigo: "DE",
    descripcion: "Ejemplo para revisar con los artículos 75 a 80 y 86 del Código de Trabajo: el empleador comunica por escrito que pone término al contrato por tiempo indefinido. Se escribe a mano la fecha de terminación y los días de preaviso (el cálculo está en Prestaciones laborales).",
    parrafos: [
      ...ENCABEZADO,
      { texto: "COMUNICACIÓN DE DESAHUCIO", negrita: true, alinear: "center", tam: 13, despues: 240 },
      { texto: "Señor(a) {{empleado}}", negrita: true, alinear: "left", despues: 0 },
      { texto: "Cédula de identidad y electoral número {{empleado_cedula}}", alinear: "left", despues: 0 },
      { texto: "Cargo: {{empleado_cargo}}", alinear: "left", despues: 240 },
      { texto: "Distinguido(a) señor(a):", alinear: "left" },
      { texto: "Por medio de la presente, y en ejercicio del derecho de desahucio que reconocen los artículos 75 y siguientes del Código de Trabajo (Ley 16-92), {{nombre_empresa}} le comunica su decisión de poner término al contrato de trabajo por tiempo indefinido que la une con usted, con efecto a partir del {{fecha_terminacion}}." },
      { texto: "De acuerdo con el artículo 76 del Código de Trabajo, el plazo de preaviso que le corresponde, según su tiempo de servicio ({{empleado_antiguedad}}), es de {{dias_preaviso}} días. Si el preaviso no se otorga en su totalidad, se le pagará la indemnización que establece el artículo 79." },
      { texto: "Se le pagarán el auxilio de cesantía que le corresponde conforme al artículo 80, las vacaciones no disfrutadas y el salario de Navidad en proporción al tiempo trabajado, junto con las demás sumas que la ley le reconozca. Las indemnizaciones por omisión del preaviso y por cesantía se pagarán dentro de los diez (10) días siguientes a la terminación del contrato, según el artículo 86." },
      { texto: "Esta comunicación se hace por escrito, conforme al artículo 77, y será participada al Departamento de Trabajo o a la autoridad local que ejerza sus funciones dentro de las cuarenta y ocho (48) horas siguientes." },
      ...FIRMA("Gerente"),
      { texto: "Recibido por el trabajador: ______________________________", antes: 480, alinear: "left", despues: 0 },
      { texto: "Fecha: ____ / ____ / ________", alinear: "left", despues: 0 },
    ],
  },
  {
    nombre: "Aviso de vacaciones", codigo: "VA",
    descripcion: "Ejemplo para revisar con los artículos 177 a 182 del Código de Trabajo: comunica al empleado cuándo disfruta sus vacaciones. Se escriben a mano los días y las fechas.",
    parrafos: [
      ...ENCABEZADO,
      { texto: "AVISO DE VACACIONES", negrita: true, alinear: "center", tam: 13, despues: 240 },
      { texto: "Señor(a) {{empleado}}", negrita: true, alinear: "left", despues: 0 },
      { texto: "Cargo: {{empleado_cargo}}", alinear: "left", despues: 240 },
      { texto: "Distinguido(a) señor(a):", alinear: "left" },
      { texto: "Por medio de la presente le comunicamos que, de acuerdo con los artículos 177 y siguientes del Código de Trabajo (Ley 16-92), disfrutará de {{dias_vacaciones}} días laborables de vacaciones, desde el {{vacaciones_desde}} hasta el {{vacaciones_hasta}}, y deberá reintegrarse a sus labores el {{vacaciones_regreso}}." },
      { texto: "Conforme al artículo 181, el salario correspondiente al período de vacaciones se le pagará el día anterior al de su inicio, junto con los salarios que a esa fecha hubiera ganado." },
      { texto: "Le recordamos que, según el artículo 182, durante el período de vacaciones no puede prestar servicios, remunerados o no, a ningún empleador." },
      ...FIRMA("Gerente"),
      { texto: "Recibido por el trabajador: ______________________________", antes: 480, alinear: "left", despues: 0 },
      { texto: "Fecha: ____ / ____ / ________", alinear: "left", despues: 0 },
    ],
  },
];

// Agrega a la firma las cartas de ejemplo que todavía no tenga (por nombre). Devuelve las que agregó.
export async function agregarCartasDeEjemplo(firmaId: string, usuarioId: string): Promise<string[]> {
  const ya = new Set((await plantillasDeFirma(firmaId)).map((p) => p.nombre.toLowerCase()));
  const agregadas: string[] = [];
  for (const c of CARTAS) {
    if (ya.has(c.nombre.toLowerCase())) continue;
    await guardarPlantilla(firmaId, usuarioId, {
      nombre: c.nombre, codigo: c.codigo, carpeta: "06", descripcion: c.descripcion,
      archivo: { nombre: `${c.nombre}.docx`, bytes: docxDeParrafos(c.parrafos) },
    });
    agregadas.push(c.nombre);
  }
  return agregadas;
}

// Una plantilla es «de trabajo» si usa algún espacio del empleado.
export const esCartaDeTrabajo = (campos: string[]) => campos.some((c) => c.startsWith("empleado"));
