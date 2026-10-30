// Fase 5: lectura de estados de cuenta (CSV, Excel, OFX), sin base de datos.
import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import {
  armarMovimientos, leerCsv, leerFecha, leerImporte, leerOfx, leerTabla, revisarFormato, columnas, saldosDelArchivo, sugerirFormato, tipoEstadoCuenta,
} from "../lib/archivos-banco.ts";

const bytes = (s) => new TextEncoder().encode(s);

test("montos en los formatos que usan los bancos", () => {
  assert.equal(leerImporte("1,234.56"), 123456n);
  assert.equal(leerImporte("1.234,56"), 123456n);
  assert.equal(leerImporte("RD$ 1,234.5"), 123450n);
  assert.equal(leerImporte("(500.00)"), -50000n);
  assert.equal(leerImporte("-75"), -7500n);
  assert.equal(leerImporte("75.10-"), -7510n);
  assert.equal(leerImporte("12,5"), 1250n);
  assert.equal(leerImporte("1,000"), 100000n);
  assert.equal(leerImporte(""), null);
  assert.equal(leerImporte("abc"), null);
  assert.equal(leerImporte(1234.565), 123457n);
});

test("fechas: día/mes/año, ISO, con mes en letras, OFX y Excel", () => {
  assert.equal(leerFecha("05/10/2026"), "2026-10-05");
  assert.equal(leerFecha("05/10/2026", "mda"), "2026-05-10");
  assert.equal(leerFecha("2026-10-05"), "2026-10-05");
  assert.equal(leerFecha("5-oct-26"), "2026-10-05");
  assert.equal(leerFecha("15 ENE 2026"), "2026-01-15");
  assert.equal(leerFecha("20261005120000[-4:AST]", "amd"), "2026-10-05");
  assert.equal(leerFecha(new Date(Date.UTC(2026, 9, 5))), "2026-10-05");
  assert.equal(leerFecha(46300), "2026-10-05");
  assert.equal(leerFecha("31/02/2026"), null);
  assert.equal(leerFecha("Saldo anterior"), null);
});

test("tipo por contenido", () => {
  assert.equal(tipoEstadoCuenta(bytes("Fecha,Descripción,Monto\n")), "csv");
  assert.equal(tipoEstadoCuenta(bytes("OFXHEADER:100\nDATA:OFXSGML\n<OFX>")), "ofx");
  assert.equal(tipoEstadoCuenta(new Uint8Array([0x50, 0x4b, 3, 4, 0])), "xlsx");
  assert.equal(tipoEstadoCuenta(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), "xls");
  assert.equal(tipoEstadoCuenta(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 1, 2])), null);
  assert.equal(tipoEstadoCuenta(bytes("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n")), null);
});

const CSV = `Banco Ejemplo, estado de cuenta
Cuenta: ****1234
Fecha;Descripción;No. Documento;Débito;Crédito;Balance
03/10/2026;Comisión manejo de cuenta;;150.00;;99,850.00
02/10/2026;Depósito cliente;55501;;20,000.00;100,000.00
02/10/2026;Cargo 0.20% DGII;;40.00;;80,000.00
01/10/2026;Transferencia a proveedor;9001;20,000.00;;80,040.00
;Total;;;;
`;

test("CSV con encabezado debajo del título, débito/crédito y lo más reciente arriba", () => {
  const filas = leerCsv(CSV);
  const f = sugerirFormato(filas);
  assert.equal(f.encabezado, 2);
  assert.equal(f.fecha, "Fecha");
  assert.equal(f.descripcion, "Descripción");
  assert.equal(f.referencia, "No. Documento");
  assert.equal(f.debito, "Débito");
  assert.equal(f.credito, "Crédito");
  assert.equal(f.saldo, "Balance");
  assert.equal(revisarFormato(f, columnas(filas, f.encabezado)), null);
  const l = armarMovimientos(filas, f);
  assert.equal(l.errores.length, 0);
  assert.equal(l.ignoradas, 1);
  assert.deepEqual(l.movimientos.map((m) => [m.fecha, m.monto]), [
    ["2026-10-01", -2000000n], ["2026-10-02", -4000n], ["2026-10-02", 2000000n], ["2026-10-03", -15000n],
  ]);
  assert.deepEqual(l.avisos, []);
  assert.deepEqual(saldosDelArchivo(l.movimientos), { inicial: 10004000n, final: 9985000n });
  // Con débito y crédito cambiados, el saldo deja de cuadrar y se avisa.
  const mal = armarMovimientos(filas, { ...f, debito: "Crédito", credito: "Débito" });
  assert.equal(mal.avisos.length, 1);
});

test("movimientos idénticos del mismo archivo se numeran; la huella no cambia con mayúsculas ni espacios", () => {
  const filas = leerCsv("Fecha,Descripción,Monto\n2026-10-01,Cargo ATM,-25\n2026-10-01,CARGO  ATM,-25\n2026-10-02,Depósito,100\n");
  const l = armarMovimientos(filas, sugerirFormato(filas));
  assert.equal(l.movimientos[0].huella, l.movimientos[1].huella);
  assert.deepEqual(l.movimientos.map((m) => m.ocurrencia), [1, 2, 1]);
});

test("fecha que no se entiende con monto: error con el número de fila", () => {
  const filas = leerCsv("Fecha,Descripción,Monto\n2026-13-01,Pago,100\n");
  const l = armarMovimientos(filas, sugerirFormato(filas));
  assert.equal(l.movimientos.length, 0);
  assert.deepEqual(l.errores, [{ fila: 2, texto: "No se entiende la fecha «2026-13-01»." }]);
});

test("OFX", () => {
  const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005<TRNAMT>-1500.00<FITID>A1<NAME>PAGO LUZ
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261006<TRNAMT>3200.50<FITID>A2<NAME>DEPOSITO<MEMO>Cliente X
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const filas = leerOfx(ofx);
  const f = sugerirFormato(filas);
  assert.equal(f.orden, "amd");
  const l = armarMovimientos(filas, f);
  assert.deepEqual(l.movimientos.map((m) => [m.fecha, m.monto, m.descripcion, m.referencia]), [
    ["2026-10-05", -150000n, "PAGO LUZ", "A1"], ["2026-10-06", 320050n, "DEPOSITO · Cliente X", "A2"],
  ]);
});

test("Excel: fechas reales, números y un solo monto con los retiros en positivo", async () => {
  const libro = new ExcelJS.Workbook();
  const h = libro.addWorksheet("Movimientos");
  h.addRow(["Estado de cuenta"]);
  h.addRow(["Fecha", "Concepto", "Referencia", "Monto"]);
  h.addRow([new Date(Date.UTC(2026, 9, 1)), "Retiro cajero", "R1", 500]);
  h.addRow([new Date(Date.UTC(2026, 9, 2)), "Depósito", "D1", -1200.5]);
  const b = new Uint8Array(await libro.xlsx.writeBuffer());
  assert.equal(tipoEstadoCuenta(b), "xlsx");
  const filas = await leerTabla(b, "xlsx");
  const f = { ...sugerirFormato(filas), invertir: true };
  assert.equal(f.encabezado, 1);
  assert.equal(f.monto, "Monto");
  const l = armarMovimientos(filas, f);
  assert.deepEqual(l.movimientos.map((m) => [m.fecha, m.monto]), [["2026-10-01", -50000n], ["2026-10-02", 120050n]]);
});
