import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { deCentavos } from "./montos.ts";

// Lectura de los estados de cuenta que dan los bancos (Excel, CSV u OFX), como el «Import a Statement» de Xero y el
// «Upload from file» de QuickBooks Online: el archivo se convierte en una tabla, se indica una vez qué columna es cada
// dato (fecha, descripción, referencia, débito y crédito o un solo monto, saldo) y de ahí salen los movimientos.
// El archivo se lee como datos: no se ejecuta nada de lo que traiga (fórmulas, macros).

export type TipoArchivo = "csv" | "xlsx" | "ofx";
export const MIME: Record<TipoArchivo, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ofx: "application/x-ofx",
};
export const NOMBRE_TIPO: Record<TipoArchivo, string> = { csv: "CSV", xlsx: "Excel", ofx: "OFX" };

const decodificar = (b: Uint8Array): string | null => {
  let t: string;
  try {
    t = new TextDecoder("utf-8", { fatal: true }).decode(b).replace(/^﻿/, "");
  } catch {
    t = new TextDecoder("windows-1252").decode(b); // muchos bancos exportan en Windows-1252 (tildes y ñ)
  }
  // Con bytes de control no es un archivo de texto (PDF, imagen…).
  return /[\x00-\x08\x0e-\x1a\x1c-\x1f]/.test(t) ? null : t;
};

// Reconoce el tipo por el contenido, no por el nombre.
export function tipoEstadoCuenta(b: Uint8Array): TipoArchivo | "xls" | null {
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "xlsx";
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "xls"; // Excel 97-2003
  if (String.fromCharCode(...b.subarray(0, 5)) === "%PDF-") return null;
  const t = decodificar(b.subarray(0, 65536));
  if (t === null) return null;
  if (/OFXHEADER|<OFX>/i.test(t.slice(0, 4000))) return "ofx";
  return t.trim() ? "csv" : null;
}

export const MENSAJE_XLS = "Ese archivo es de Excel 97-2003 (.xls). Ábrelo y guárdalo como «Libro de Excel (.xlsx)» o «CSV», y súbelo de nuevo.";

// ───────────── Archivo → tabla ─────────────

export type Celda = string | number | Date | null;

export function leerCsv(texto: string): string[][] {
  const lineas = texto.split(/\r\n|\n|\r/).slice(0, 20);
  const cuenta = (sep: string) => lineas.reduce((s, l) => s + (l.replace(/"[^"]*"/g, "").split(sep).length - 1), 0);
  const sep = [",", ";", "\t", "|"].sort((a, b) => cuenta(b) - cuenta(a))[0];
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { celda += '"'; i++; }
      else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"' && celda.trim() === "") { celda = ""; comillas = true; }
    else if (c === sep) { fila.push(celda.trim()); celda = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(celda.trim()); filas.push(fila); fila = []; celda = "";
    } else celda += c;
  }
  if (celda !== "" || fila.length) { fila.push(celda.trim()); filas.push(fila); }
  return filas.filter((f) => f.some((x) => x !== ""));
}

const valorCelda = (v: ExcelJS.CellValue): Celda => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string" || v instanceof Date) return v;
  if (typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if ("result" in v) return valorCelda(v.result as ExcelJS.CellValue); // fórmula: solo el resultado guardado
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
  }
  return null;
};

export async function leerXlsx(b: Uint8Array): Promise<Celda[][]> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(Buffer.from(b) as unknown as ArrayBuffer);
  // La primera hoja que tenga datos.
  for (const hoja of libro.worksheets) {
    const filas: Celda[][] = [];
    hoja.eachRow({ includeEmpty: false }, (row) => {
      const valores: Celda[] = [];
      for (let c = 1; c <= row.cellCount; c++) valores.push(valorCelda(row.getCell(c).value));
      if (valores.some((x) => x !== null && String(x).trim() !== "")) filas.push(valores);
    });
    if (filas.length) return filas;
  }
  return [];
}

// OFX (SGML o XML): cada <STMTTRN> es un movimiento. Se arma una tabla con encabezado para usar el mismo camino.
export function leerOfx(texto: string): string[][] {
  const etiqueta = (bloque: string, nombre: string) => bloque.match(new RegExp(`<${nombre}>([^<\\r\\n]*)`, "i"))?.[1]?.trim() ?? "";
  const filas: string[][] = [["Fecha", "Descripción", "Referencia", "Monto"]];
  for (const m of texto.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi)) {
    const b = m[1];
    const desc = [etiqueta(b, "NAME"), etiqueta(b, "MEMO")].filter(Boolean).join(" · ");
    filas.push([etiqueta(b, "DTPOSTED").slice(0, 8), desc, etiqueta(b, "CHECKNUM") || etiqueta(b, "FITID"), etiqueta(b, "TRNAMT")]);
  }
  return filas;
}

export async function leerTabla(b: Uint8Array, tipo: TipoArchivo): Promise<Celda[][]> {
  if (tipo === "xlsx") return leerXlsx(b);
  const texto = decodificar(b) ?? "";
  return tipo === "ofx" ? leerOfx(texto) : leerCsv(texto);
}

// ───────────── Formato: qué columna es cada dato ─────────────

export type Formato = {
  encabezado: number;          // fila del encabezado (0 = primera)
  fecha: string;               // nombre de la columna, como aparece en el encabezado
  descripcion: string;
  referencia: string | null;
  debito: string | null;       // salidas (retiros, cheques, cargos)
  credito: string | null;      // entradas (depósitos, créditos)
  monto: string | null;        // un solo monto con signo, en vez de débito y crédito
  saldo: string | null;
  orden: "dma" | "mda" | "amd"; // cómo vienen las fechas numéricas: 31/12/2026, 12/31/2026 o 2026-12-31
  invertir: boolean;           // el banco muestra los retiros en positivo y los depósitos en negativo
};

export const CAMPOS: [clave: keyof Formato, nombre: string][] = [
  ["fecha", "Fecha"], ["descripcion", "Descripción"], ["referencia", "Referencia"], ["debito", "Débito (sale)"],
  ["credito", "Crédito (entra)"], ["monto", "Monto con signo"], ["saldo", "Saldo o balance"],
];

export const normal = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const PISTAS: [campo: keyof Formato, patron: RegExp][] = [
  ["fecha", /^(fecha|date|f\. ?(transaccion|operacion|posteo)|dtposted)/],
  ["debito", /(debito|retiro|cargo|debit|egreso|salida|withdraw)/],
  ["credito", /(credito|deposito|abono|credit|ingreso|entrada)/],
  ["saldo", /(saldo|balance)/],
  ["monto", /(monto|importe|valor|amount|trnamt)/],
  ["referencia", /(referencia|^ref|documento|^no\.? ?doc|numero|cheque|serial|fitid)/],
  ["descripcion", /(descripcion|concepto|detalle|transaccion|description|memo|narrativa|name)/],
];

// Fila del encabezado: la primera (de las 30 primeras) con una columna de fecha y al menos tres datos.
export function buscarEncabezado(filas: Celda[][]): number {
  const i = filas.slice(0, 30).findIndex((f) => f.filter((c) => normal(c) !== "").length >= 3 && f.some((c) => PISTAS[0][1].test(normal(c))));
  return i < 0 ? 0 : i;
}

export const columnas = (filas: Celda[][], encabezado: number): string[] =>
  (filas[encabezado] ?? []).map((c, i) => (normal(c) === "" ? `Columna ${i + 1}` : String(c).trim()));

export function sugerirFormato(filas: Celda[][]): Formato {
  const encabezado = buscarEncabezado(filas);
  const cols = columnas(filas, encabezado);
  const f: Formato = { encabezado, fecha: "", descripcion: "", referencia: null, debito: null, credito: null, monto: null, saldo: null, orden: "dma", invertir: false };
  const usadas = new Set<string>();
  for (const [campo, patron] of PISTAS) {
    const col = cols.find((c) => !usadas.has(c) && patron.test(normal(c)));
    if (col) { (f as Record<string, unknown>)[campo] = col; usadas.add(col); }
  }
  if (f.debito && f.credito) f.monto = null;
  else if (!f.monto && (f.debito || f.credito)) { f.monto = f.debito ?? f.credito; f.debito = f.credito = null; }
  // Fechas ISO (2026-12-31) o de OFX (20261231): año primero.
  const ejemplo = filas.slice(encabezado + 1, encabezado + 6).map((r) => r[cols.indexOf(f.fecha)]).find((x) => typeof x === "string" && x);
  if (typeof ejemplo === "string" && /^\d{4}[-/]?\d{2}[-/]?\d{2}/.test(ejemplo.trim())) f.orden = "amd";
  return f;
}

export function revisarFormato(f: Formato, cols: string[]): string | null {
  if (!f.fecha || !cols.includes(f.fecha)) return "Indica cuál columna tiene la fecha.";
  if (!f.descripcion || !cols.includes(f.descripcion)) return "Indica cuál columna tiene la descripción.";
  const montos = [f.debito, f.credito, f.monto].filter(Boolean) as string[];
  if (!f.monto && !(f.debito && f.credito)) return "Indica las columnas de débito y crédito, o la del monto con signo.";
  for (const c of [...montos, f.referencia, f.saldo]) if (c && !cols.includes(c)) return `El archivo no tiene la columna «${c}».`;
  return null;
}

// ───────────── Celdas → fecha y monto ─────────────

const MESES: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};

const armar = (a: number, m: number, d: number): string | null => {
  if (a < 100) a += 2000;
  const fecha = new Date(Date.UTC(a, m - 1, d));
  if (fecha.getUTCFullYear() !== a || fecha.getUTCMonth() !== m - 1 || fecha.getUTCDate() !== d || a < 1990 || a > 2100) return null;
  return fecha.toISOString().slice(0, 10);
};

export function leerFecha(v: Celda, orden: Formato["orden"] = "dma"): string | null {
  if (v === null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10); // exceljs da las fechas en UTC
  if (typeof v === "number") {
    // Número de serie de Excel (días desde 1899-12-30).
    if (v < 20000 || v > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
  }
  const s = normal(v);
  let m = s.match(/^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})(?:\D|$)/);
  if (m && orden === "amd") return armar(+m[1], +m[2], +m[3]);
  if (m && s.length >= 8 && /^\d{4}[-/.]/.test(s)) return armar(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ]([a-z]{3})[a-z]*\.?[-/. ](\d{2,4})(?:\D|$)/);
  if (m && MESES[m[2]]) return armar(+m[3], MESES[m[2]], +m[1]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\D|$)/);
  if (m) return orden === "mda" ? armar(+m[3], +m[1], +m[2]) : armar(+m[3], +m[2], +m[1]);
  if (orden === "amd") {
    m = s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) return armar(+m[1], +m[2], +m[3]);
  }
  return null;
}

// Monto en centavos: acepta «1,234.56», «1.234,56», «RD$ 1,234.56», «(1,234.56)», «-1234.5», «1234.56-».
export function leerImporte(v: Celda): bigint | null {
  if (v === null || v instanceof Date) return null;
  if (typeof v === "number") return Number.isFinite(v) ? BigInt(Math.round(v * 100)) : null;
  let s = v.replace(/ /g, " ").trim().toUpperCase().replace(/RD\$|US\$|DOP|USD|\$|\s/g, "");
  if (s === "" || s === "-") return null;
  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { negativo = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { negativo = !negativo; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  const coma = s.lastIndexOf(","), punto = s.lastIndexOf(".");
  if (coma >= 0 && punto >= 0) s = coma > punto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (coma >= 0) s = /,\d{1,2}$/.test(s) && s.split(",").length === 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  else if (s.split(".").length > 2) s = s.replace(/\./g, "");
  const m = s.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const c = BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
  return negativo ? -c : c;
}

// ───────────── Tabla → movimientos ─────────────

export type Movimiento = {
  fecha: string; descripcion: string; referencia: string | null; monto: bigint; saldo: bigint | null;
  orden: number; fila: number; huella: string; ocurrencia: number;
};
export type Lectura = { movimientos: Movimiento[]; errores: { fila: number; texto: string }[]; ignoradas: number; avisos: string[] };

export const huellaMovimiento = (fecha: string, monto: bigint, descripcion: string, referencia: string | null) =>
  createHash("sha256").update(`${fecha}|${deCentavos(monto)}|${normal(descripcion)}|${normal(referencia)}`).digest("hex").slice(0, 32);

const texto = (v: Celda) => (v === null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());

export function armarMovimientos(filas: Celda[][], f: Formato): Lectura {
  const cols = columnas(filas, f.encabezado);
  const idx = (c: string | null) => (c ? cols.indexOf(c) : -1);
  const [iF, iD, iR, iDeb, iCre, iM, iS] = [f.fecha, f.descripcion, f.referencia, f.debito, f.credito, f.monto, f.saldo].map(idx);
  const lectura: Lectura = { movimientos: [], errores: [], ignoradas: 0, avisos: [] };
  for (let n = f.encabezado + 1; n < filas.length; n++) {
    const r = filas[n];
    const fecha = leerFecha(r[iF] ?? null, f.orden);
    let monto: bigint | null;
    if (iM >= 0) {
      monto = leerImporte(r[iM] ?? null);
      if (monto !== null && f.invertir) monto = -monto;
    } else {
      const deb = leerImporte(r[iDeb] ?? null), cre = leerImporte(r[iCre] ?? null);
      monto = deb === null && cre === null ? null : (cre === null ? 0n : cre < 0n ? -cre : cre) - (deb === null ? 0n : deb < 0n ? -deb : deb);
    }
    // Filas que no son movimientos: totales, «saldo anterior», líneas en blanco o de pie de página.
    if (fecha === null || monto === null || monto === 0n) {
      if (fecha === null && monto !== null && monto !== 0n && texto(r[iF] ?? null) !== "") {
        lectura.errores.push({ fila: n + 1, texto: `No se entiende la fecha «${texto(r[iF] ?? null)}».` });
      } else lectura.ignoradas++;
      continue;
    }
    const descripcion = texto(r[iD] ?? null).slice(0, 300) || "(sin descripción)";
    const referencia = iR >= 0 ? texto(r[iR] ?? null).slice(0, 100) || null : null;
    lectura.movimientos.push({
      fecha, descripcion, referencia, monto, saldo: iS >= 0 ? leerImporte(r[iS] ?? null) : null,
      orden: 0, fila: n + 1, huella: huellaMovimiento(fecha, monto, descripcion, referencia), ocurrencia: 1,
    });
  }
  // Muchos bancos ponen lo más reciente arriba: se ordena de lo más viejo a lo más nuevo.
  const ms = lectura.movimientos;
  if (ms.length > 1 && ms[0].fecha > ms[ms.length - 1].fecha) ms.reverse();
  const vistas = new Map<string, number>();
  ms.forEach((m, i) => {
    m.orden = i + 1;
    m.ocurrencia = (vistas.get(m.huella) ?? 0) + 1;
    vistas.set(m.huella, m.ocurrencia);
  });
  // Si el banco da el saldo, cada movimiento debe cuadrar con el anterior (detecta columnas cambiadas o signos al revés).
  let roturas = 0;
  for (let i = 1; i < ms.length; i++) {
    const a = ms[i - 1].saldo, b = ms[i].saldo;
    if (a !== null && b !== null && a + ms[i].monto !== b) roturas++;
  }
  if (roturas > 0) {
    lectura.avisos.push(`En ${roturas} movimiento${roturas > 1 ? "s" : ""} el saldo del banco no cuadra con el anterior más el monto. Revisa que débito y crédito no estén cambiados.`);
  }
  return lectura;
}

// Saldo inicial del archivo (el del banco antes del primer movimiento) si el banco da la columna de saldo.
export function saldosDelArchivo(ms: Movimiento[]): { inicial: bigint | null; final: bigint | null } {
  if (!ms.length || ms[0].saldo === null || ms[ms.length - 1].saldo === null) return { inicial: null, final: null };
  return { inicial: ms[0].saldo - ms[0].monto, final: ms[ms.length - 1].saldo };
}
