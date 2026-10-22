import ExcelJS from "exceljs";
import { verMonto } from "./montos";

// Modelo común de los reportes descargables: un encabezado y una tabla.
export type Columna = { titulo: string; num?: boolean; ancho?: number };
export type Celda = string | number | null;
export type Tabla = {
  titulo: string;
  empresa: string;
  detalle: string; // período, filtros
  generado: string; // quién y cuándo
  columnas: Columna[];
  filas: Celda[][];
  totales?: Celda[];
  horizontal?: boolean;
};

const numero = (v: Celda) => (v === null || v === "" ? null : Number(v));

export async function aXlsx(t: Tabla): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = "Contable-System";
  const hoja = libro.addWorksheet(t.titulo.slice(0, 31), { pageSetup: { orientation: t.horizontal ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  hoja.addRow([t.empresa]).font = { bold: true, size: 13 };
  hoja.addRow([t.titulo]).font = { bold: true, size: 12 };
  hoja.addRow([t.detalle]);
  hoja.addRow([t.generado]).font = { italic: true, color: { argb: "FF666666" } };
  hoja.addRow([]);
  const cab = hoja.addRow(t.columnas.map((c) => c.titulo));
  cab.font = { bold: true };
  cab.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF2F6" } }; c.border = { bottom: { style: "thin" } }; });
  const inicio = hoja.rowCount + 1;
  for (const f of t.filas) hoja.addRow(f.map((v, i) => (t.columnas[i]?.num ? numero(v) : v)));
  if (t.totales) {
    const r = hoja.addRow(t.totales.map((v, i) => (t.columnas[i]?.num ? numero(v) : v)));
    r.font = { bold: true };
    r.eachCell((c) => { c.border = { top: { style: "thin" } }; });
  }
  t.columnas.forEach((c, i) => {
    const col = hoja.getColumn(i + 1);
    col.width = c.ancho ?? (c.num ? 16 : 24);
    if (c.num) {
      col.numFmt = "#,##0.00;[Red]-#,##0.00";
      col.alignment = { horizontal: "right" };
    }
  });
  hoja.views = [{ state: "frozen", ySplit: inicio - 1 }];
  hoja.autoFilter = { from: { row: inicio - 1, column: 1 }, to: { row: inicio - 1, column: t.columnas.length } };
  return Buffer.from(await libro.xlsx.writeBuffer());
}

type PdfMake = {
  setFonts(f: unknown): void;
  setUrlAccessPolicy(cb: (url: string) => boolean): void;
  setLocalAccessPolicy(cb: (path: string) => boolean): void;
  createPdf(d: unknown): { getBuffer(): Promise<Buffer> };
};

export async function aPdf(t: Tabla): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfmake: PdfMake = require("pdfmake");
  // Fuentes estándar del PDF (no se incrustan archivos) y sin acceso a recursos externos.
  const fuentes = { normal: "Helvetica", bold: "Helvetica-Bold", italics: "Helvetica-Oblique", bolditalics: "Helvetica-BoldOblique" };
  pdfmake.setFonts({ Helvetica: fuentes });
  pdfmake.setUrlAccessPolicy(() => false);
  // Solo los nombres de las fuentes estándar; ningún otro archivo local.
  pdfmake.setLocalAccessPolicy((ruta) => (Object.values(fuentes) as string[]).includes(ruta));
  const celda = (v: Celda, i: number, negrita = false) => ({
    text: v === null ? "" : t.columnas[i]?.num ? (v === "" ? "" : verMonto(String(v))) : String(v),
    alignment: t.columnas[i]?.num ? "right" : "left",
    bold: negrita,
  });
  const cuerpo = [
    t.columnas.map((c) => ({ text: c.titulo, bold: true, fillColor: "#eff2f6", alignment: c.num ? "right" : "left" })),
    ...t.filas.map((f) => f.map((v, i) => celda(v, i))),
    ...(t.totales ? [t.totales.map((v, i) => celda(v, i, true))] : []),
  ];
  const doc = {
    pageSize: "LETTER",
    pageOrientation: t.horizontal ? "landscape" : "portrait",
    pageMargins: [32, 40, 32, 40],
    defaultStyle: { font: "Helvetica", fontSize: 8 },
    info: { title: `${t.titulo} · ${t.empresa}`, creator: "Contable-System" },
    content: [
      { text: t.empresa, bold: true, fontSize: 12 },
      { text: t.titulo, bold: true, fontSize: 11, margin: [0, 2, 0, 0] },
      { text: t.detalle, margin: [0, 2, 0, 0] },
      { text: t.generado, italics: true, color: "#666666", margin: [0, 2, 0, 10] },
      {
        table: {
          headerRows: 1,
          widths: t.columnas.map((c) => (c.num ? "auto" : "*")),
          body: cuerpo,
        },
        layout: { hLineWidth: (i: number) => (i === 1 ? 0.8 : 0.3), vLineWidth: () => 0, hLineColor: () => "#cccccc", paddingTop: () => 3, paddingBottom: () => 3 },
      },
    ],
    footer: (actual: number, total: number) => ({ text: `Página ${actual} de ${total}`, alignment: "right", margin: [0, 10, 32, 0], fontSize: 7, color: "#666666" }),
  };
  return pdfmake.createPdf(doc).getBuffer();
}

export function aCsv(t: Tabla): string {
  const celda = (v: Celda) => {
    let s = v === null ? "" : String(v);
    if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; // evita fórmulas inyectadas en Excel
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const filas = [[t.empresa], [t.titulo], [t.detalle], [t.generado], [], t.columnas.map((c) => c.titulo), ...t.filas, ...(t.totales ? [t.totales] : [])];
  return "﻿" + filas.map((f) => f.map(celda).join(",")).join("\r\n");
}
