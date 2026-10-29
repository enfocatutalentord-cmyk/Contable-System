import { createHash } from "node:crypto";
import { aPesos, tasaDeTexto } from "./calculos.ts";
import type { Tx } from "./db";
import { FORMAS_PAGO } from "./compras.ts";
import { CONCEPTOS_IR17 } from "./fiscal.ts";
import { periodoAnterior, type Aviso, type Periodo } from "./formatos-dgii.ts";
import { porTasa, type Columna, type Resultado, type Seccion } from "./it1.ts";
import { aCentavos, deCentavos, leerMonto } from "./montos.ts";

// Borrador del IR-17 (Declaración Jurada y/o Pago de Otras Retenciones y Retribuciones Complementarias), formulario
// oficial «IR-17-2026, desde julio 2026 en adelante» de la DGII, con sus conceptos, códigos, tasas y fórmulas, y su anexo
// IR-6 (detalle por beneficiario). Claves: «R2» = monto imponible de la casilla 2; «R2i» su impuesto; «R27» = casilla 27.

export const TASA_RETRIBUCIONES = 2700n; // casilla 28: 27 %

const m = (clave: string, editable = false): Columna => ({ clave, tipo: "monto", editable });
const pct = (clave: string): Columna => ({ clave, tipo: "porcentaje", editable: false });
const vacia = (clave: string): Columna => ({ clave: `${clave}x`, tipo: "monto", editable: false });

export const SECCIONES_IR17: Seccion[] = [
  { hoja: "I", titulo: "II. Otras retenciones", encabezados: ["Monto imponible", "Tasa", "Impuesto"], renglones: [
    ...CONCEPTOS_IR17.map(([texto], i) => ({ n: i + 1, texto, columnas: [m(`R${i + 1}`, true), pct(`R${i + 1}t`), m(`R${i + 1}i`)] })),
    { n: 25, texto: "Total otras retenciones (casillas 1 a 24)", columnas: [vacia("R25a"), vacia("R25b"), m("R25")] },
  ] },
  { hoja: "I", titulo: "III a V. Convenios, total y retribuciones complementarias", encabezados: ["Monto imponible", "Tasa", "Monto"], renglones: [
    { n: 26, texto: "Otras retenciones en convenios y acuerdos internacionales (casilla 35 del anexo R9C)", columnas: [vacia("R26a"), vacia("R26b"), m("R26", true)] },
    { n: 27, texto: "Total de otras retenciones (25+26)", columnas: [vacia("R27a"), vacia("R27b"), m("R27")] },
    { n: 28, texto: "Retribuciones complementarias (total del mes del anexo IR-9)", columnas: [m("R28", true), pct("R28t"), m("R28i")] },
  ] },
  { hoja: "I", titulo: "VI. Liquidación, VII. Penalidades y VIII. Monto a pagar", encabezados: ["Monto"], renglones: [
    { n: 29, texto: "Impuesto a pagar (27+28)", columnas: [m("R29")] },
    { n: 30, texto: "Saldos compensables autorizados (otros impuestos)", columnas: [m("R30", true)] },
    { n: 31, texto: "Pagos computables a cuenta", columnas: [m("R31", true)] },
    { n: 32, texto: "Saldo a favor anterior", columnas: [m("R32", true)] },
    { n: 33, texto: "Diferencia a pagar (si 29−30−31−32 es positivo)", columnas: [m("R33")] },
    { n: 34, texto: "Nuevo saldo a favor (si 29−30−31−32 es negativo)", columnas: [m("R34")] },
    { n: 35, texto: "Recargos", columnas: [m("R35", true)] },
    { n: 36, texto: "Interés indemnizatorio", columnas: [m("R36", true)] },
    { n: 37, texto: "Total a pagar (33+35+36)", columnas: [m("R37")] },
  ] },
];
export const EDITABLES_IR17 = new Set(SECCIONES_IR17.flatMap((s) => s.renglones.flatMap((r) => r.columnas.filter((c) => c.editable).map((c) => c.clave))));

// Anexo IR-6: una fila por retención de ISR hecha en el mes (fecha, forma de pago, beneficiario, concepto, montos).
export type FilaIr6 = {
  fecha: string; formaPago: string; beneficiario: string; identificacion: string; direccion: string; codigo: number | null;
  montoPago: bigint; sujeto: bigint; tasa: bigint; retenido: bigint; retencion: string; pagoNumero: number;
};

export async function anexoIr6(tx: Tx, p: Periodo): Promise<FilaIr6[]> {
  const filas = await tx<{
    fecha: string; forma_pago: string; tasa_cambio: string; nombre: string; rnc: string | null; direccion: string | null;
    codigo_ir17: number | null; retencion: string; tasa: string; monto: string; aplicado: string; numero: number;
  }[]>`
    SELECT to_char(p.fecha, 'YYYY-MM-DD') AS fecha, p.forma_pago, p.tasa::text AS tasa_cambio, pr.nombre, pr.rnc, pr.direccion,
           r.codigo_ir17, r.nombre AS retencion, rp.tasa::text, rp.monto::text, p.numero,
           (SELECT COALESCE(sum(a.monto), 0) FROM aplicaciones_pago a WHERE a.pago_id = p.id)::text AS aplicado
      FROM retenciones_pago rp JOIN pagos p ON p.id = rp.pago_id JOIN proveedores pr ON pr.id = p.proveedor_id
      JOIN retenciones r ON r.id = rp.retencion_id
     WHERE rp.impuesto = 'isr' AND NOT p.anulado AND p.fecha BETWEEN ${p.inicio} AND ${p.fin}
     ORDER BY p.fecha, p.numero`;
  return filas.map((f) => {
    const cambio = tasaDeTexto(f.tasa_cambio);
    const retenido = aPesos(aCentavos(f.monto), cambio);
    const tasa = aCentavos(f.tasa); // porcentaje en centésimas (15 % = 1500)
    // Monto sujeto a retención: lo retenido dividido entre la tasa aplicada (la retención de ISR es % del monto sin impuestos).
    const sujeto = tasa > 0n ? (retenido * 10000n + tasa / 2n) / tasa : 0n;
    return {
      fecha: f.fecha, formaPago: FORMAS_PAGO[f.forma_pago] ?? f.forma_pago, beneficiario: f.nombre, identificacion: f.rnc ?? "",
      direccion: f.direccion ?? "", codigo: f.codigo_ir17, montoPago: aPesos(aCentavos(f.aplicado), cambio), sujeto, tasa, retenido,
      retencion: f.retencion, pagoNumero: f.numero,
    };
  });
}

export async function calcularIr17(tx: Tx, p: Periodo, manuales: Record<string, string>): Promise<Resultado & { ir6: FilaIr6[] }> {
  const s: Record<string, bigint> = {};
  const origen: Record<string, string> = {};
  const avisos: Aviso[] = [];
  const ir6 = await anexoIr6(tx, p);
  const retenidoPorConcepto: Record<number, bigint> = {};
  for (const f of ir6) {
    if (f.codigo === null) {
      avisos.push({ nivel: "error", texto: `La retención «${f.retencion}» (pago ${f.pagoNumero}) no tiene concepto del IR-17. Elígelo en Retenciones.`, enlace: "/fiscal/retenciones" });
      continue;
    }
    s[`R${f.codigo}`] = (s[`R${f.codigo}`] ?? 0n) + f.sujeto;
    retenidoPorConcepto[f.codigo] = (retenidoPorConcepto[f.codigo] ?? 0n) + f.retenido;
    origen[`R${f.codigo}`] = "Retenciones de ISR hechas en los pagos del mes (anexo IR-6)";
    const tasaForm = CONCEPTOS_IR17[f.codigo - 1][1];
    if (f.tasa !== tasaForm) {
      avisos.push({ nivel: "aviso", texto: `Pago ${f.pagoNumero}: «${f.retencion}» se retuvo al ${deCentavos(f.tasa)} %, pero el formulario usa el ${deCentavos(tasaForm)} % para la casilla ${f.codigo}.` });
    }
  }
  // Saldo a favor anterior: casilla 34 del IR-17 del mes anterior marcado como presentado.
  const anterior = periodoAnterior(`${p.inicio.slice(0, 7)}-01`);
  const [prev] = await tx<{ casillas: Record<string, string> | null }[]>`SELECT casillas FROM envios_dgii WHERE formato = 'IR-17' AND periodo = ${anterior}`;
  s.R32 = prev?.casillas?.R34 ? aCentavos(prev.casillas.R34) : 0n;
  if (prev?.casillas) origen.R32 = `Casilla 34 del IR-17 de ${anterior} (presentado)`;

  const sugeridos: Record<string, bigint> = {};
  for (const k of EDITABLES_IR17) sugeridos[k] = s[k] ?? 0n;
  const v: Record<string, bigint> = { ...s };
  for (const [k, txt] of Object.entries(manuales)) {
    if (!EDITABLES_IR17.has(k)) continue;
    const n = leerMonto(txt);
    if (n !== null) v[k] = aCentavos(n);
  }
  const g = (k: string) => v[k] ?? 0n;
  let total = 0n;
  CONCEPTOS_IR17.forEach(([, tasa], i) => {
    const n = i + 1;
    v[`R${n}t`] = tasa;
    v[`R${n}i`] = porTasa(g(`R${n}`), tasa);
    total += v[`R${n}i`];
    const real = retenidoPorConcepto[n] ?? 0n;
    // Diferencias de redondeo de un peso o menos entre lo retenido y lo calculado por el formulario no se avisan.
    const dif = v[`R${n}i`] - real;
    if (real > 0n && (dif > 100n || dif < -100n)) {
      avisos.push({ nivel: "aviso", texto: `Casilla ${n}: el formulario calcula ${deCentavos(v[`R${n}i`])} y en los pagos se retuvo ${deCentavos(real)}.` });
    }
  });
  v.R25 = total;
  v.R27 = v.R25 + g("R26");
  v.R28t = TASA_RETRIBUCIONES;
  v.R28i = porTasa(g("R28"), TASA_RETRIBUCIONES);
  v.R29 = v.R27 + v.R28i;
  const resto = v.R29 - g("R30") - g("R31") - g("R32");
  v.R33 = resto > 0n ? resto : 0n;
  v.R34 = resto < 0n ? -resto : 0n;
  v.R37 = v.R33 + g("R35") + g("R36");
  if (p.periodo < "202607") {
    avisos.push({ nivel: "aviso", texto: "Este borrador usa el formulario IR-17 de julio 2026 en adelante (tasas de la Ley 30-26). Para meses anteriores, revisa las tasas con el formulario de ese período." });
  }
  avisos.push({ nivel: "aviso", texto: "Las retribuciones complementarias (casilla 28, anexo IR-9), los convenios internacionales (26), los pagos a cuenta y las penalidades se escriben a mano." });
  const huella = createHash("sha256").update(JSON.stringify(Object.entries(v).sort(), (_, x) => (typeof x === "bigint" ? x.toString() : x))).digest("hex");
  return { valores: v, sugeridos, origen, avisos, huella, ir6 };
}
