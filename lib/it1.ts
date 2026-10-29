import { createHash } from "node:crypto";
import { aPesos, tasaDeTexto } from "./calculos.ts";
import type { Tx } from "./db";
import { COLUMNA_COBRO, formato606, movimientos, periodoAnterior, type Aviso, type Empresa, type Periodo } from "./formatos-dgii.ts";
import { aCentavos, deCentavos, leerMonto } from "./montos.ts";

// Borrador del IT-1 (Declaración Jurada y/o Pago del ITBIS, formulario IT-1 2020 con su Anexo A), con las casillas,
// nombres y fórmulas del formulario oficial de la DGII y su instructivo de llenado. Lo que el sistema sabe se sugiere
// (y se puede corregir); lo que no sabe (importaciones, constructoras, comisionistas, penalidades…) se escribe a mano.
// Claves: «A11» = casilla 11 del Anexo A; «A1c» su cantidad; «A34t» total facturado; «A45l/s/i» compras locales,
// servicios e importaciones; «I21» = casilla 21 del IT-1; «I35p» porcentaje de la casilla 35.

export type Tipo = "monto" | "cantidad" | "porcentaje";
export type Columna = { clave: string; tipo: Tipo; editable: boolean };
export type Renglon = { n: number; texto: string; columnas: Columna[] };
export type Seccion = { hoja: "A" | "I"; titulo: string; encabezados: string[]; renglones: Renglon[] };

const m = (clave: string, editable = false): Columna => ({ clave, tipo: "monto", editable });
const c = (clave: string, editable = false): Columna => ({ clave, tipo: "cantidad", editable });
const pct = (clave: string): Columna => ({ clave, tipo: "porcentaje", editable: true });
const ix = (n: number, editable: boolean): Columna[] => [m(`A${n}l`, editable), m(`A${n}s`, editable), m(`A${n}i`, editable), m(`A${n}`)];

export const SECCIONES: Seccion[] = [
  { hoja: "A", titulo: "II. Operaciones reportadas en el 607 por tipo de NCF", encabezados: ["Cantidad", "Monto"], renglones: [
    { n: 1, texto: "Comprobantes válido para crédito fiscal (01 y 31)", columnas: [c("A1c"), m("A1")] },
    { n: 2, texto: "Comprobantes consumo (02 y 32)", columnas: [c("A2c"), m("A2")] },
    { n: 3, texto: "Comprobantes nota de débito (03 y 33)", columnas: [c("A3c"), m("A3")] },
    { n: 4, texto: "Comprobantes nota de crédito (04 y 34)", columnas: [c("A4c"), m("A4")] },
    { n: 5, texto: "Comprobantes registro único de ingresos (12)", columnas: [c("A5c"), m("A5")] },
    { n: 6, texto: "Comprobantes registro regímenes especiales (14 y 44)", columnas: [c("A6c"), m("A6")] },
    { n: 7, texto: "Comprobantes gubernamentales (15 y 45)", columnas: [c("A7c"), m("A7")] },
    { n: 8, texto: "Comprobantes para exportaciones (16 y 46)", columnas: [c("A8c"), m("A8")] },
    { n: 9, texto: "Otras operaciones (positivas)", columnas: [c("A9c", true), m("A9", true)] },
    { n: 10, texto: "Otras operaciones (negativas)", columnas: [c("A10c", true), m("A10", true)] },
    { n: 11, texto: "Total operaciones (1+2+3−4+5+6+7+8+9−10)", columnas: [c("A11c"), m("A11")] },
  ] },
  { hoja: "A", titulo: "III. Operaciones por tipo de venta (monto total incluyendo impuestos)", encabezados: ["Monto bruto"], renglones: [
    { n: 12, texto: "Efectivo", columnas: [m("A12", true)] },
    { n: 13, texto: "Cheque / transferencia", columnas: [m("A13", true)] },
    { n: 14, texto: "Tarjeta débito / crédito", columnas: [m("A14", true)] },
    { n: 15, texto: "A crédito", columnas: [m("A15", true)] },
    { n: 16, texto: "Bonos o certificado de regalo", columnas: [m("A16", true)] },
    { n: 17, texto: "Permutas", columnas: [m("A17", true)] },
    { n: 18, texto: "Otras formas de venta", columnas: [m("A18", true)] },
    { n: 19, texto: "Total operaciones por tipo de venta (12 a 18)", columnas: [m("A19")] },
  ] },
  { hoja: "A", titulo: "IV. Operaciones por tipo de ingreso", encabezados: ["Monto"], renglones: [
    { n: 20, texto: "Ingresos por operaciones (no financieros)", columnas: [m("A20", true)] },
    { n: 21, texto: "Ingresos financieros", columnas: [m("A21", true)] },
    { n: 22, texto: "Ingresos extraordinarios", columnas: [m("A22", true)] },
    { n: 23, texto: "Ingresos por arrendamientos", columnas: [m("A23", true)] },
    { n: 24, texto: "Ingresos por ventas de activos depreciables", columnas: [m("A24", true)] },
    { n: 25, texto: "Otros ingresos", columnas: [m("A25", true)] },
    { n: 26, texto: "Total por tipo de ingreso (20 a 25)", columnas: [m("A26")] },
  ] },
  { hoja: "A", titulo: "V. Pagos computables por retenciones/percepción", encabezados: ["Monto"], renglones: [
    { n: 27, texto: "Pagos computables por retenciones (Norma 08-04, tarjetas)", columnas: [m("A27", true)] },
    { n: 28, texto: "Pagos computables por ventas de pasajes aéreos (Norma 02-05) (BSP-IATA)", columnas: [m("A28", true)] },
    { n: 29, texto: "Pagos computables por otras retenciones (Norma 02-05)", columnas: [m("A29", true)] },
    { n: 30, texto: "Pagos computables por ventas de paquetes de alojamiento y ocupación", columnas: [m("A30", true)] },
    { n: 31, texto: "Crédito por retención realizada por entidades del Estado", columnas: [m("A31", true)] },
    { n: 32, texto: "Pagos computables por ITBIS percibido", columnas: [m("A32")] },
    { n: 33, texto: "Total pagos computables por retenciones/percepción (27 a 32)", columnas: [m("A33")] },
  ] },
  { hoja: "A", titulo: "VI. Operaciones de constructoras", encabezados: ["Total facturado", "Monto"], renglones: [
    { n: 34, texto: "Dirección técnica (Art. 4 Norma 07-07)", columnas: [m("A34t", true), m("A34")] },
    { n: 35, texto: "Contrato de administración (Art. 4 Párrafo I, Norma 07-07)", columnas: [m("A35t", true), m("A35", true)] },
    { n: 36, texto: "Asesorías / honorarios", columnas: [m("A36t"), m("A36", true)] },
    { n: 37, texto: "Total operaciones constructoras", columnas: [m("A37t"), m("A37")] },
    { n: 38, texto: "Operaciones no sujetas a ITBIS por servicios de construcción", columnas: [m("A38t"), m("A38")] },
  ] },
  { hoja: "A", titulo: "VII. Operaciones de comisionistas", encabezados: ["Total facturado", "Monto"], renglones: [
    { n: 39, texto: "Ventas de bienes por comisión", columnas: [m("A39t", true), m("A39", true)] },
    { n: 40, texto: "Ventas de servicios en nombre de terceros", columnas: [m("A40t", true), m("A40", true)] },
    { n: 41, texto: "Total operaciones comisionistas (39+40)", columnas: [m("A41t"), m("A41")] },
    { n: 42, texto: "Operaciones no sujetas a ITBIS por comisiones", columnas: [m("A42t"), m("A42")] },
  ] },
  { hoja: "A", titulo: "VIII. Datos informativos", encabezados: ["Monto"], renglones: [
    { n: 43, texto: "Total notas de crédito emitidas con más de 30 días desde la facturación (Art. 338 CT)", columnas: [m("A43", true)] },
    { n: 44, texto: "Total facturas en comprobantes para regímenes especiales (proviene del 606)", columnas: [m("A44")] },
  ] },
  { hoja: "A", titulo: "IX. ITBIS pagado", encabezados: ["Compras locales", "Servicios", "Importaciones", "Total"], renglones: [
    { n: 45, texto: "No deducible: en operaciones de productores de bienes o servicios exentos", columnas: ix(45, true) },
    { n: 46, texto: "No deducible: a incluir en activos (categoría I)", columnas: ix(46, true) },
    { n: 47, texto: "No deducible: otros ITBIS pagados no deducibles", columnas: ix(47, true) },
    { n: 48, texto: "Total ITBIS no deducible (45+46+47)", columnas: ix(48, false) },
    { n: 49, texto: "Deducible: en la producción y/o venta de bienes exportados", columnas: ix(49, true) },
    { n: 50, texto: "Deducible: en la producción y/o venta de bienes gravados", columnas: ix(50, true) },
    { n: 51, texto: "Deducible: en la prestación de servicios gravados", columnas: ix(51, true) },
    { n: 52, texto: "Total ITBIS deducible no sujeto a proporcionalidad (49+50+51)", columnas: ix(52, false) },
    { n: 53, texto: "ITBIS sujeto a proporcionalidad (Art. 349 CT)", columnas: ix(53, true) },
    { n: 54, texto: "Coeficiente de proporcionalidad ((casillas 2+5+10 del IT-1) / casilla 1 del IT-1 × 100), si aplica", columnas: [pct("A54")] },
    { n: 55, texto: "ITBIS admitido por aplicación de proporcionalidad (53 × 54)", columnas: ix(55, false) },
    { n: 56, texto: "Total ITBIS deducible (52+55)", columnas: ix(56, false) },
  ] },
  { hoja: "I", titulo: "II. Ingresos por operaciones", encabezados: ["Monto"], renglones: [
    { n: 1, texto: "Total de operaciones del período (casilla 11 del Anexo A)", columnas: [m("I1")] },
    { n: 2, texto: "No gravadas: ingresos por exportaciones de bienes según Art. 342 CT", columnas: [m("I2", true)] },
    { n: 3, texto: "No gravadas: ingresos por exportaciones de servicios según Art. 344 CT y Art. 14 literal j), Reglamento 293-11", columnas: [m("I3", true)] },
    { n: 4, texto: "No gravadas: ingresos por ventas locales de bienes o servicios exentos Art. 343 y Art. 344 CT", columnas: [m("I4", true)] },
    { n: 5, texto: "No gravadas: ingresos por ventas de bienes o servicios exentos por destino", columnas: [m("I5", true)] },
    { n: 6, texto: "No sujetas a ITBIS por servicios de construcción (casilla 38 del Anexo A)", columnas: [m("I6")] },
    { n: 7, texto: "No sujetas a ITBIS por comisiones (casilla 42 del Anexo A)", columnas: [m("I7")] },
    { n: 8, texto: "Ingresos por ventas locales de bienes exentos según párrafos III y IV, Art. 343 CT", columnas: [m("I8", true)] },
    { n: 9, texto: "Total ingresos por operaciones no gravadas (2 a 8)", columnas: [m("I9")] },
    { n: 10, texto: "Total ingresos por operaciones gravadas (1−9)", columnas: [m("I10")] },
    { n: 11, texto: "Operaciones gravadas al 18%", columnas: [m("I11", true)] },
    { n: 12, texto: "Operaciones gravadas al 16%", columnas: [m("I12", true)] },
    { n: 13, texto: "Operaciones gravadas al 9% (Ley 690-16)", columnas: [m("I13", true)] },
    { n: 14, texto: "Operaciones gravadas al 8% (Ley 690-16)", columnas: [m("I14", true)] },
    { n: 15, texto: "Operaciones gravadas por ventas de activos depreciables (categoría 2 y 3)", columnas: [m("I15", true)] },
  ] },
  { hoja: "I", titulo: "III. Liquidación", encabezados: ["Monto"], renglones: [
    { n: 16, texto: "ITBIS cobrado (18% de la casilla 11)", columnas: [m("I16")] },
    { n: 17, texto: "ITBIS cobrado (16% de la casilla 12)", columnas: [m("I17")] },
    { n: 18, texto: "ITBIS cobrado (9% de la casilla 13)", columnas: [m("I18")] },
    { n: 19, texto: "ITBIS cobrado (8% de la casilla 14)", columnas: [m("I19")] },
    { n: 20, texto: "ITBIS cobrado por ventas de activos depreciables (18% de la casilla 15)", columnas: [m("I20")] },
    { n: 21, texto: "Total ITBIS cobrado (16 a 20)", columnas: [m("I21")] },
    { n: 22, texto: "ITBIS pagado en compras locales (casilla 56 del Anexo A)", columnas: [m("I22")] },
    { n: 23, texto: "ITBIS pagado por servicios deducibles (casilla 56 del Anexo A)", columnas: [m("I23")] },
    { n: 24, texto: "ITBIS pagado en importaciones (casilla 56 del Anexo A)", columnas: [m("I24")] },
    { n: 25, texto: "Total ITBIS deducible (22+23+24)", columnas: [m("I25")] },
    { n: 26, texto: "Impuesto a pagar (si 21−25 es positivo)", columnas: [m("I26")] },
    { n: 27, texto: "Saldo a favor (si 21−25 es negativo)", columnas: [m("I27")] },
    { n: 28, texto: "Saldos compensables autorizados (otros impuestos) y/o reembolsos", columnas: [m("I28", true)] },
    { n: 29, texto: "Saldo a favor anterior", columnas: [m("I29", true)] },
    { n: 30, texto: "Total pagos computables por retenciones (casilla 33 del Anexo A)", columnas: [m("I30")] },
    { n: 31, texto: "Otros pagos computables a cuenta", columnas: [m("I31", true)] },
    { n: 32, texto: "Compensaciones y/o reembolsos autorizados", columnas: [m("I32", true)] },
    { n: 33, texto: "Diferencia a pagar (si 26−28−29−30−31−32 es positivo)", columnas: [m("I33")] },
    { n: 34, texto: "Nuevo saldo a favor", columnas: [m("I34")] },
  ] },
  { hoja: "I", titulo: "IV. Penalidades y V. Monto a pagar", encabezados: ["%", "Monto"], renglones: [
    { n: 35, texto: "Recargos", columnas: [pct("I35p"), m("I35")] },
    { n: 36, texto: "Interés indemnizatorio", columnas: [pct("I36p"), m("I36")] },
    { n: 37, texto: "Sanciones", columnas: [m("I37x"), m("I37", true)] },
    { n: 38, texto: "Total a pagar (33+35+36+37)", columnas: [m("I38x"), m("I38")] },
  ] },
  { hoja: "I", titulo: "A. ITBIS retenido / ITBIS percibido (retenciones que hizo la empresa)", encabezados: ["Monto"], renglones: [
    { n: 39, texto: "Servicios sujetos a retención personas físicas", columnas: [m("I39", true)] },
    { n: 40, texto: "Servicios sujetos a retención entidades no lucrativas (Norma 01-11)", columnas: [m("I40", true)] },
    { n: 41, texto: "Total servicios sujetos a retención a personas físicas y entidades no lucrativas", columnas: [m("I41")] },
    { n: 42, texto: "Servicios sujetos a retención sociedades (Norma 07-09)", columnas: [m("I42", true)] },
    { n: 43, texto: "Servicios sujetos a retención sociedades (Norma 02-05 y 07-07)", columnas: [m("I43", true)] },
    { n: 44, texto: "Bienes o servicios sujetos a retención a contribuyentes del RST (gravadas al 18%)", columnas: [m("I44", true)] },
    { n: 45, texto: "Bienes o servicios sujetos a retención a contribuyentes del RST (gravadas al 16%)", columnas: [m("I45", true)] },
    { n: 46, texto: "Total bienes o servicios sujetos a retención a contribuyentes del RST (44+45)", columnas: [m("I46")] },
    { n: 47, texto: "Bienes sujetos a retención de comprobante de compras (gravadas al 18%) (Normas 08-10 y 05-19)", columnas: [m("I47", true)] },
    { n: 48, texto: "Bienes sujetos a retención de comprobante de compras (gravadas al 16%) (Normas 08-10 y 05-19)", columnas: [m("I48", true)] },
    { n: 49, texto: "Total bienes sujetos a retención comprobantes de compras (47+48)", columnas: [m("I49")] },
    { n: 50, texto: "ITBIS por servicios sujetos a retención personas físicas y entidades no lucrativas (18% de la casilla 41)", columnas: [m("I50")] },
    { n: 51, texto: "ITBIS por servicios sujetos a retención sociedades (18% de la casilla 42)", columnas: [m("I51")] },
    { n: 52, texto: "ITBIS por servicios sujetos a retención sociedades (18% de la casilla 43 por 0.30)", columnas: [m("I52")] },
    { n: 53, texto: "ITBIS retenido a contribuyentes del RST (18% de la casilla 44)", columnas: [m("I53")] },
    { n: 54, texto: "ITBIS retenido a contribuyentes del RST (16% de la casilla 45)", columnas: [m("I54")] },
    { n: 55, texto: "Total ITBIS retenido a contribuyentes del RST (53+54)", columnas: [m("I55")] },
    { n: 56, texto: "ITBIS por bienes sujetos a retención de comprobante de compras (18% de la casilla 47)", columnas: [m("I56")] },
    { n: 57, texto: "ITBIS por bienes sujetos a retención de comprobante de compras (16% de la casilla 48)", columnas: [m("I57")] },
    { n: 58, texto: "Total por bienes sujetos a retención comprobante de compras (56+57)", columnas: [m("I58")] },
    { n: 59, texto: "Total ITBIS percibido en venta", columnas: [m("I59")] },
    { n: 60, texto: "Impuesto a pagar (50+51+52+55+58+59)", columnas: [m("I60")] },
    { n: 61, texto: "Pagos computables a cuenta", columnas: [m("I61", true)] },
    { n: 62, texto: "Diferencia a pagar (si 60−61 es positivo)", columnas: [m("I62")] },
    { n: 63, texto: "Nuevo saldo a favor (si 60−61 es negativo)", columnas: [m("I63")] },
  ] },
  { hoja: "I", titulo: "B. Penalidades, C. Monto a pagar y total general", encabezados: ["%", "Monto"], renglones: [
    { n: 64, texto: "Recargos", columnas: [pct("I64p"), m("I64")] },
    { n: 65, texto: "Interés indemnizatorio", columnas: [pct("I65p"), m("I65")] },
    { n: 66, texto: "Sanciones", columnas: [m("I66x"), m("I66", true)] },
    { n: 67, texto: "Total a pagar (62+64+65+66)", columnas: [m("I67x"), m("I67")] },
    { n: 68, texto: "TOTAL GENERAL (38+67)", columnas: [m("I68x"), m("I68")] },
  ] },
];

// Las columnas «x» son de relleno (sin valor) para alinear la tabla de dos columnas.
export const esRelleno = (clave: string) => clave.endsWith("x");
export const EDITABLES = new Set(SECCIONES.flatMap((s) => s.renglones.flatMap((r) => r.columnas.filter((col) => col.editable).map((col) => col.clave))));

// ───── Utilidades de cálculo (centavos) ─────

// Porcentaje con dos decimales guardado en centésimas (18% = 1800).
export const porTasa = (base: bigint, centesimas: bigint) => {
  const x = base * centesimas;
  return (x >= 0n ? x + 5000n : x - 5000n) / 10000n;
};
const mas = (a: bigint) => (a > 0n ? a : 0n);

export type Resultado = {
  valores: Record<string, bigint>;    // montos y cantidades en centavos (cantidades ×100) y porcentajes en centésimas
  sugeridos: Record<string, bigint>;  // lo que el sistema calculó para las casillas que se pueden escribir
  origen: Record<string, string>;     // de dónde sale cada sugerencia
  avisos: Aviso[];
  huella: string;
};

// Clasificación por tipo de comprobante (los dos últimos dígitos de la serie B o E) → casilla del Anexo A.
const CASILLA_NCF: Record<string, number> = { "01": 1, "31": 1, "02": 2, "32": 2, "03": 3, "33": 3, "04": 4, "34": 4, "12": 5, "14": 6, "44": 6, "15": 7, "45": 7, "16": 8, "46": 8 };

export async function calcularIt1(tx: Tx, p: Periodo, manuales: Record<string, string>): Promise<Resultado> {
  const [empresa] = await tx<Empresa[]>`SELECT rnc, contribuye_itbis FROM empresas WHERE id = empresa_actual()`;
  const s: Record<string, bigint> = {};
  const origen: Record<string, string> = {};
  const avisos: Aviso[] = [];
  const sumar = (k: string, v: bigint) => (s[k] = (s[k] ?? 0n) + v);

  // ── Ventas del mes: facturas y notas de crédito emitidas, no anuladas (lo mismo que alimenta el 607) ──
  const facturas = await tx<{
    id: string; tipo: string; tipo_ingreso: string; tasa: string; subtotal: string; total: string; fecha: string; fecha_origen: string | null;
    exento: string; gravado: Record<string, string> | null;
  }[]>`
    SELECT f.id, f.tipo_ncf AS tipo, f.tipo_ingreso, f.tasa::text, f.subtotal::text, f.total::text, to_char(f.fecha, 'YYYY-MM-DD') AS fecha,
           to_char(o.fecha, 'YYYY-MM-DD') AS fecha_origen,
           (SELECT COALESCE(sum(l.subtotal), 0) FROM lineas_factura l WHERE l.factura_id = f.id
               AND EXISTS (SELECT 1 FROM impuestos_linea_factura i WHERE i.linea_id = l.id AND i.tipo = 'exento'))::text AS exento,
           (SELECT json_object_agg(t.tasa, t.base) FROM (
              SELECT round(i.tasa)::text AS tasa, sum(l.subtotal)::text AS base FROM lineas_factura l
                JOIN impuestos_linea_factura i ON i.linea_id = l.id AND i.tipo = 'itbis'
               WHERE l.factura_id = f.id GROUP BY round(i.tasa)) t) AS gravado
      FROM facturas f LEFT JOIN facturas o ON o.id = f.factura_origen_id
     WHERE f.estado = 'emitida' AND NOT f.anulada AND f.fecha BETWEEN ${p.inicio} AND ${p.fin}
     ORDER BY f.fecha`;
  const ids = facturas.map((f) => f.id);
  const cobros = movimientos(await tx`
    SELECT a.factura_id AS documento, c.id AS pago, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.forma_pago AS forma, a.monto::text AS aplicado,
           c.retencion_itbis::text AS ret_itbis, c.retencion_isr::text AS ret_isr, NULL::int AS codigo_isr
      FROM aplicaciones_cobro a JOIN cobros c ON c.id = a.cobro_id
     WHERE NOT c.anulado AND c.fecha <= ${p.fin}
       AND c.id IN (SELECT a2.cobro_id FROM aplicaciones_cobro a2 WHERE a2.factura_id = ANY(${ids}::uuid[]))`);
  const dias = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86_400_000;
  let tardias = 0n, nTardias = 0n, exportaciones = 0n;
  for (const f of facturas) {
    const tasa = tasaDeTexto(f.tasa);
    const pesos = (x: string) => aPesos(aCentavos(x), tasa);
    const sub = pesos(f.subtotal), total = pesos(f.total);
    const serie = f.tipo.slice(1);
    const casilla = CASILLA_NCF[serie];
    if (casilla) { sumar(`A${casilla}c`, 100n); sumar(`A${casilla}`, sub); }
    const nota = serie === "04" || serie === "34";
    // Notas de crédito con más de 30 días desde la factura: no reducen las operaciones (Art. 338 CT); van en la
    // casilla 43 y se devuelven en «otras operaciones (positivas)» (instructivo, casilla 9).
    const tardia = nota && f.fecha_origen !== null && dias(f.fecha, f.fecha_origen) > 30;
    if (tardia) { tardias += sub; nTardias += 100n; }
    const signo = nota ? (tardia ? 0n : -1n) : 1n;
    // Ventas gravadas por tasa (las de activo depreciable, tipo de ingreso 05, van aparte en la casilla 15).
    for (const [t, base] of Object.entries(f.gravado ?? {})) {
      const k = f.tipo_ingreso === "05" ? "I15" : ({ "18": "I11", "16": "I12", "9": "I13", "8": "I14" } as Record<string, string>)[t];
      if (k) sumar(k, signo * pesos(base));
      else avisos.push({ nivel: "aviso", texto: `Una factura tiene ITBIS al ${t}%, que el IT-1 no tiene como casilla. Revísala.`, enlace: `/facturas/${f.id}` });
    }
    // Lo facturado exento: exportaciones (B16), ventas exentas por destino a regímenes especiales (B14) o exentas
    // locales (Art. 343 CT). Lo que lleva ITBIS ya quedó en las casillas 11 a 15.
    const exento = signo * pesos(f.exento);
    if (serie === "16" || serie === "46") exportaciones += exento;
    else if (serie === "14" || serie === "44") sumar("I5", exento);
    else sumar("I4", exento);
    if (nota) continue;
    // III. Formas de venta (con impuestos): lo cobrado hasta el cierre por forma de cobro; el resto, a crédito.
    let cobrado = 0n;
    for (const mv of cobros.filter((x) => x.documento === f.id)) {
      const v = aPesos(mv.aplicado, tasa);
      cobrado += v;
      sumar({ efectivo: "A12", cheque: "A13", tarjeta: "A14", otrasFormas: "A18" }[COLUMNA_COBRO[mv.forma] ?? "otrasFormas"], v);
    }
    sumar("A15", mas(total - cobrado));
    // IV. Por tipo de ingreso (sin impuestos).
    sumar(`A${19 + Number(f.tipo_ingreso)}`, sub);
  }
  s.A9 = tardias; s.A9c = nTardias; s.A43 = tardias;
  if (tardias > 0n) origen.A9 = origen.A43 = "Notas de crédito emitidas con más de 30 días desde su factura";
  // Exportaciones (B16): el sistema no sabe si son de bienes (casilla 2) o de servicios (casilla 3).
  s.I2 = 0n; s.I3 = 0n;
  if (exportaciones !== 0n) avisos.push({ nivel: "aviso", texto: `Hay ${deCentavos(exportaciones)} en facturas de exportación (B16): repártelos entre la casilla 2 (bienes) y la 3 (servicios) del IT-1.` });

  // V. Retenciones que nos hicieron los clientes este mes: a facturas gubernamentales (B15), casilla 31; las demás, 29.
  for (const mv of cobros.filter((x) => x.fecha >= p.inicio && x.itbis > 0n)) {
    const f = facturas.find((x) => x.id === mv.documento)!;
    sumar(["15", "45"].includes(f.tipo.slice(1)) ? "A31" : "A29", aPesos(mv.itbis, tasaDeTexto(f.tasa)));
  }
  // Retenciones de este mes sobre facturas de meses anteriores.
  const anteriores = await tx<{ tipo: string; tasa: string; retenido: string }[]>`
    SELECT f.tipo_ncf AS tipo, f.tasa::text,
           (SELECT sum(c.retencion_itbis * a.monto / NULLIF((SELECT sum(a2.monto) FROM aplicaciones_cobro a2 WHERE a2.cobro_id = c.id), 0))
              FROM aplicaciones_cobro a JOIN cobros c ON c.id = a.cobro_id
             WHERE a.factura_id = f.id AND NOT c.anulado AND c.fecha BETWEEN ${p.inicio} AND ${p.fin})::numeric(18,2)::text AS retenido
      FROM facturas f WHERE f.estado = 'emitida' AND NOT f.anulada AND f.fecha < ${p.inicio}
       AND EXISTS (SELECT 1 FROM aplicaciones_cobro a JOIN cobros c ON c.id = a.cobro_id
                    WHERE a.factura_id = f.id AND NOT c.anulado AND c.fecha BETWEEN ${p.inicio} AND ${p.fin} AND c.retencion_itbis > 0)`;
  for (const f of anteriores) sumar(["15", "45"].includes(f.tipo.slice(1)) ? "A31" : "A29", aPesos(aCentavos(f.retenido ?? "0"), tasaDeTexto(f.tasa)));
  origen.A29 = "ITBIS que te retuvieron tus clientes este mes (cobros)";
  origen.A31 = "ITBIS que te retuvieron entidades del Estado (facturas B15)";

  // ── Compras: ITBIS pagado del mes por bienes (compras locales) y por servicios, deducible o llevado al costo ──
  const compras = await tx<{ id: string; tipo: string; tasa: string; al_costo: boolean; bienes: string; servicios: string }[]>`
    SELECT c.id, c.tipo_comprobante AS tipo, c.tasa::text, c.itbis_al_costo AS al_costo,
           (SELECT COALESCE(sum(l.itbis) FILTER (WHERE l.clase = 'bien'), 0) FROM lineas_compra l WHERE l.compra_id = c.id)::text AS bienes,
           (SELECT COALESCE(sum(l.itbis) FILTER (WHERE l.clase = 'servicio'), 0) FROM lineas_compra l WHERE l.compra_id = c.id)::text AS servicios
      FROM compras c WHERE c.estado = 'registrada' AND NOT c.anulada AND c.fecha BETWEEN ${p.inicio} AND ${p.fin}`;
  for (const k of ["A45", "A46", "A47", "A49", "A50", "A51", "A53"]) for (const col of ["l", "s", "i"]) s[`${k}${col}`] = 0n;
  for (const cp of compras) {
    const tasa = tasaDeTexto(cp.tasa);
    const signo = ["B04", "E34"].includes(cp.tipo) ? -1n : 1n;
    const b = signo * aPesos(aCentavos(cp.bienes), tasa), sv = signo * aPesos(aCentavos(cp.servicios), tasa);
    if (cp.al_costo || !empresa.contribuye_itbis) { sumar("A47l", b); sumar("A47s", sv); }
    else { sumar("A50l", b); sumar("A51s", sv); }
  }
  origen.A47l = origen.A47s = "ITBIS de compras llevado al costo o gasto (606)";
  origen.A50l = "ITBIS de compras de bienes con crédito (606)";
  origen.A51s = "ITBIS de compras de servicios con crédito (606)";

  // 606 del mes: compras de regímenes especiales (casilla 44) y retenciones que hizo la empresa (sección A del IT-1).
  const f606 = await formato606(tx, p, empresa);
  s.A44 = f606.filas.filter((f) => !f.reenvio && f.ncf.slice(1, 3) === "14").reduce((t, f) => t + f.totalFacturado, 0n);
  let retenido606 = 0n;
  for (const k of ["I39", "I42", "I43", "I47"]) s[k] = 0n;
  for (const f of f606.filas.filter((x) => x.itbisRetenido > 0n)) {
    retenido606 += f.itbisRetenido;
    const parte = f.itbisFacturado > 0n ? (f.itbisRetenido * 100n) / f.itbisFacturado : 0n; // % retenido del ITBIS
    // Comprobante de compras (B11): bienes en la 47, servicios en la 39. Retención del 30 % del ITBIS (Normas 02-05 y
    // 07-07): casilla 43. Del 100 %: a personas físicas, 39; a sociedades, 42.
    if (f.ncf.slice(1, 3) === "11") { sumar("I47", f.bienes); sumar("I39", f.servicios); }
    else if (parte <= 30n) sumar("I43", f.servicios + f.bienes);
    else if (f.tipoId === "2") sumar("I39", f.servicios + f.bienes);
    else sumar("I42", f.servicios + f.bienes);
  }
  origen.I39 = "Servicios a personas físicas a las que retuviste ITBIS (606)";
  origen.I42 = "Servicios a sociedades con retención del 100 % del ITBIS (606)";
  origen.I43 = "Servicios a sociedades con retención del 30 % del ITBIS (606)";
  origen.I47 = "Bienes comprados con comprobante de compras (B11) con retención (606)";

  // Saldo a favor anterior: casilla 34 del IT-1 del mes anterior marcado como presentado.
  const anterior = periodoAnterior(`${p.inicio.slice(0, 4)}-${p.inicio.slice(5, 7)}-01`);
  const [prev] = await tx<{ casillas: Record<string, string> | null }[]>`
    SELECT casillas FROM envios_dgii WHERE formato = 'IT-1' AND periodo = ${anterior}`;
  s.I29 = prev?.casillas?.I34 ? aCentavos(prev.casillas.I34) : 0n;
  if (prev?.casillas) origen.I29 = `Casilla 34 del IT-1 de ${anterior} (presentado)`;

  // ── Valores: lo escrito a mano manda sobre lo sugerido ──
  const sugeridos: Record<string, bigint> = {};
  for (const k of EDITABLES) sugeridos[k] = s[k] ?? 0n;
  const v: Record<string, bigint> = { ...s };
  for (const [k, txt] of Object.entries(manuales)) {
    if (!EDITABLES.has(k)) continue;
    // Montos en centavos, cantidades ×100 y porcentajes en centésimas: todos se leen igual (dos decimales).
    const n = leerMonto(txt);
    if (n !== null) v[k] = aCentavos(n);
  }
  const g = (k: string) => v[k] ?? 0n;
  const set = (k: string, x: bigint) => (v[k] = x);

  // Anexo A
  set("A11c", g("A1c") + g("A2c") + g("A3c") - g("A4c") + g("A5c") + g("A6c") + g("A7c") + g("A8c") + g("A9c") - g("A10c"));
  set("A11", g("A1") + g("A2") + g("A3") - g("A4") + g("A5") + g("A6") + g("A7") + g("A8") + g("A9") - g("A10"));
  set("A19", [12, 13, 14, 15, 16, 17, 18].reduce((t, n) => t + g(`A${n}`), 0n));
  set("A26", [20, 21, 22, 23, 24, 25].reduce((t, n) => t + g(`A${n}`), 0n));
  set("A32", 0n);
  set("A33", [27, 28, 29, 30, 31, 32].reduce((t, n) => t + g(`A${n}`), 0n));
  set("A34", porTasa(g("A34t"), 1000n)); // 10% del total facturado (Norma 07-07)
  set("A36t", 0n);
  set("A37t", g("A34t") + g("A35t"));
  set("A37", g("A34") + g("A35") + g("A36"));
  set("A38", mas(g("A37t") - g("A37"))); set("A38t", 0n);
  set("A41t", g("A39t") + g("A40t")); set("A41", g("A39") + g("A40"));
  set("A42", mas(g("A41t") - g("A41"))); set("A42t", 0n);
  const fila = (n: number) => set(`A${n}`, g(`A${n}l`) + g(`A${n}s`) + g(`A${n}i`));
  for (const n of [45, 46, 47, 49, 50, 51, 53]) fila(n);
  for (const col of ["l", "s", "i"]) {
    set(`A48${col}`, g(`A45${col}`) + g(`A46${col}`) + g(`A47${col}`));
    set(`A52${col}`, g(`A49${col}`) + g(`A50${col}`) + g(`A51${col}`));
  }
  fila(48); fila(52);

  // IT-1: ingresos
  set("I1", g("A11"));
  set("I6", g("A38")); set("I7", g("A42"));
  set("I9", [2, 3, 4, 5, 6, 7, 8].reduce((t, n) => t + g(`I${n}`), 0n));
  set("I10", g("I1") - g("I9"));
  // Coeficiente de proporcionalidad (casilla 54 del Anexo A): (2+5+10) / 1 × 100, con dos decimales.
  const coef = g("I1") > 0n ? ((g("I2") + g("I5") + g("I10")) * 10000n) / g("I1") : 0n;
  sugeridos.A54 = coef;
  if (manuales.A54 === undefined) set("A54", coef);
  for (const col of ["l", "s", "i"]) {
    set(`A55${col}`, porTasa(g(`A53${col}`), g("A54")));
    set(`A56${col}`, g(`A52${col}`) + g(`A55${col}`));
  }
  fila(55); fila(56);

  // Liquidación
  set("I16", porTasa(g("I11"), 1800n)); set("I17", porTasa(g("I12"), 1600n)); set("I18", porTasa(g("I13"), 900n));
  set("I19", porTasa(g("I14"), 800n)); set("I20", porTasa(g("I15"), 1800n));
  set("I21", g("I16") + g("I17") + g("I18") + g("I19") + g("I20"));
  set("I22", g("A56l")); set("I23", g("A56s")); set("I24", g("A56i"));
  set("I25", g("I22") + g("I23") + g("I24"));
  set("I26", mas(g("I21") - g("I25"))); set("I27", mas(g("I25") - g("I21")));
  set("I30", g("A33"));
  const resto = g("I26") - g("I28") - g("I29") - g("I30") - g("I31") - g("I32");
  set("I33", g("I26") > 0n ? mas(resto) : 0n);
  set("I34", g("I26") > 0n ? mas(-resto) : g("I27") + g("I28") + g("I29") + g("I30") + g("I31") + g("I32"));
  set("I35", porTasa(g("I33"), g("I35p"))); set("I36", porTasa(g("I33"), g("I36p")));
  set("I38", g("I33") + g("I35") + g("I36") + g("I37"));

  // Retenciones que hizo la empresa
  set("I41", g("I39") + g("I40")); set("I46", g("I44") + g("I45")); set("I49", g("I47") + g("I48"));
  set("I50", porTasa(g("I41"), 1800n)); set("I51", porTasa(g("I42"), 1800n)); set("I52", porTasa(porTasa(g("I43"), 1800n), 3000n));
  set("I53", porTasa(g("I44"), 1800n)); set("I54", porTasa(g("I45"), 1600n)); set("I55", g("I53") + g("I54"));
  set("I56", porTasa(g("I47"), 1800n)); set("I57", porTasa(g("I48"), 1600n)); set("I58", g("I56") + g("I57"));
  set("I59", 0n);
  set("I60", g("I50") + g("I51") + g("I52") + g("I55") + g("I58") + g("I59"));
  set("I62", mas(g("I60") - g("I61"))); set("I63", mas(g("I61") - g("I60")));
  set("I64", porTasa(g("I62"), g("I64p"))); set("I65", porTasa(g("I62"), g("I65p")));
  set("I67", g("I62") + g("I64") + g("I65") + g("I66"));
  set("I68", g("I38") + g("I67"));

  // ── Revisión, con las validaciones que hace la Oficina Virtual según el instructivo ──
  const suma1115 = g("I11") + g("I12") + g("I13") + g("I14") + g("I15");
  if (suma1115 !== g("I10")) {
    avisos.push({ nivel: "error", texto: `Las casillas 11 a 15 (${deCentavos(suma1115)}) deben sumar lo mismo que la casilla 10 (${deCentavos(g("I10"))}). Clasifica las operaciones no gravadas (casillas 2 a 8) o las gravadas por tasa.` });
  }
  const adelantar606 = f606.filas.filter((f) => !f.reenvio).reduce((t, f) => t + f.itbisAdelantar, 0n);
  if (g("A56l") + g("A56s") > adelantar606) {
    avisos.push({ nivel: "error", texto: `El ITBIS deducible en compras locales y servicios (${deCentavos(g("A56l") + g("A56s"))}) no puede ser mayor que el «ITBIS por adelantar» del 606 (${deCentavos(adelantar606)}).` });
  }
  if (g("I60") < retenido606) {
    avisos.push({ nivel: "error", texto: `El impuesto por retenciones (casilla 60: ${deCentavos(g("I60"))}) es menor que el ITBIS retenido del 606 (${deCentavos(retenido606)}): la Oficina Virtual no lo acepta. Revisa las casillas 39 a 48.` });
  } else if (g("I60") !== retenido606) {
    avisos.push({ nivel: "aviso", texto: `La casilla 60 (${deCentavos(g("I60"))}) no coincide con el ITBIS retenido del 606 (${deCentavos(retenido606)}).` });
  }
  if (manuales.A54 !== undefined && g("A54") !== coef) {
    avisos.push({ nivel: "error", texto: `El coeficiente de proporcionalidad debe ser ${deCentavos(coef)}% según las casillas 1, 2, 5 y 10 del IT-1.` });
  }
  const sinCoef = g("I2") + g("I3") + g("I4") + g("I5") + g("I8") > 0n && g("I10") > 0n;
  if (sinCoef && g("A54") === 0n) avisos.push({ nivel: "aviso", texto: "Tienes ingresos gravados y exentos: el instructivo pide declarar el coeficiente de proporcionalidad (casilla 54 del Anexo A)." });
  if (g("A9") > 0n) avisos.push({ nivel: "aviso", texto: "Hay notas de crédito con más de 30 días desde su factura: se pusieron en las casillas 9 y 43 del Anexo A y no reducen el ITBIS (Art. 338 CT)." });
  avisos.push({ nivel: "aviso", texto: "Las importaciones (ITBIS pagado en la DGA), las operaciones de constructoras y comisionistas, la proporcionalidad, los pagos a cuenta y las penalidades se escriben a mano." });

  const huella = createHash("sha256").update(JSON.stringify(Object.entries(v).sort(), (_, x) => (typeof x === "bigint" ? x.toString() : x))).digest("hex");
  return { valores: v, sugeridos, origen, avisos, huella };
}
