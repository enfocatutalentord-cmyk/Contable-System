// Integración con Vendario, parte 2 (acuerdo, sección 9): de un evento contable a su asiento y a sus documentos fiscales. Puro: sin base.
// Montos en centavos (bigint), nunca con decimales flotantes.

export const CUENTAS_NEUTRALES: Record<string, string> = {
  CAJA: "Efectivo", BANCO: "Transferencias y depósitos", TARJETAS_POR_COBRAR: "Ventas con tarjeta pendientes de liquidar",
  CXC_CLIENTES: "Cuentas por cobrar", ANTICIPOS_CLIENTES: "Saldo a favor de clientes", INVENTARIO: "Mercancía", CXP_SUPLIDORES: "Cuentas por pagar",
  ITBIS_POR_PAGAR: "ITBIS cobrado en ventas", ITBIS_ADELANTADO: "ITBIS pagado en compras y gastos", VENTAS: "Ventas (sin ITBIS)",
  DEVOLUCIONES_VENTAS: "Devoluciones de ventas", COSTO_VENTAS: "Costo de lo vendido", AJUSTE_INVENTARIO: "Pérdidas, daños y sobrantes de inventario",
  FALTANTE_CAJA: "Faltante del cierre de caja", SOBRANTE_CAJA: "Sobrante del cierre de caja", RETIROS_CAJA: "Retiros y depósitos de caja",
  OTROS_INGRESOS: "Entradas manuales de efectivo", REDONDEO: "Centavos de redondeo",
  // Propuestas para la v1.1 (retenciones); se mapean igual si llegan.
  RETENCION_ITBIS_POR_PAGAR: "ITBIS retenido a suplidores (v1.1)", RETENCION_ISR_POR_PAGAR: "ISR retenido a suplidores (v1.1)",
};

// Sugerencias del catálogo dominicano para las cuentas evidentes. Las demás (tarjetas, ajustes, caja, retiros, redondeo y cada gasto) las
// elige el contable: no se adivinan.
export const SUGERIDAS: Record<string, string> = {
  CAJA: "110101", BANCO: "110103", CXC_CLIENTES: "110201", ANTICIPOS_CLIENTES: "210501", INVENTARIO: "110301", CXP_SUPLIDORES: "210101",
  ITBIS_POR_PAGAR: "210201", ITBIS_ADELANTADO: "110401", VENTAS: "410102", DEVOLUCIONES_VENTAS: "410103", COSTO_VENTAS: "510101",
  OTROS_INGRESOS: "420201", RETENCION_ITBIS_POR_PAGAR: "210202", RETENCION_ISR_POR_PAGAR: "210203",
};

export const NOMBRE_EVENTO: Record<string, string> = {
  "sale.posted": "Venta", "sale.voided": "Anulación de venta", "sale.returned": "Devolución de venta", "receivable.paid": "Cobro de cuenta por cobrar",
  "customer.advance": "Saldo a favor recibido", "customer.advance_refund": "Saldo a favor devuelto", "purchase.received": "Compra recibida",
  "purchase.returned": "Devolución a suplidor", "payable.paid": "Pago a suplidor", "expense.posted": "Gasto", "expense.voided": "Anulación de gasto",
  "inventory.adjusted": "Ajuste de inventario", "cash.movement": "Movimiento de caja", "cash.closed": "Cierre de caja",
};

export class Pendiente extends Error {}

const MONTO = /^-?\d+(\.\d{1,2})?$/;
export function centavos(v: unknown): bigint {
  const t = typeof v === "number" ? v.toFixed(2) : String(v ?? "0");
  if (!MONTO.test(t)) throw new Pendiente(`Monto no válido: ${t}`);
  const [e, d = ""] = t.replace("-", "").split(".");
  const c = BigInt(e) * 100n + BigInt((d + "00").slice(0, 2));
  return t.startsWith("-") ? -c : c;
}
export const texto = (c: bigint) => `${c < 0n ? "-" : ""}${(c < 0n ? -c : c) / 100n}.${String((c < 0n ? -c : c) % 100n).padStart(2, "0")}`;

export type LineaNeutral = { cuenta: string; debe: bigint; haber: bigint };

// El «entry» del evento: cada línea con su cuenta neutral; debe cuadrar al centavo.
export function leerEntry(entry: unknown): LineaNeutral[] {
  if (!Array.isArray(entry)) throw new Pendiente("El evento no trae su asiento («entry»)");
  const lineas = entry.map((l) => {
    const o = (l ?? {}) as Record<string, unknown>;
    if (typeof o.account !== "string" || !o.account) throw new Pendiente("Una línea del asiento no trae la cuenta");
    return { cuenta: o.account, debe: centavos(o.debit ?? o.d ?? "0"), haber: centavos(o.credit ?? o.c ?? "0") };
  }).filter((l) => l.debe !== 0n || l.haber !== 0n);
  if (lineas.some((l) => l.debe < 0n || l.haber < 0n)) throw new Pendiente("El asiento trae montos negativos");
  const debe = lineas.reduce((s, l) => s + l.debe, 0n), haber = lineas.reduce((s, l) => s + l.haber, 0n);
  if (debe !== haber) throw new Pendiente(`El asiento no cuadra: débitos ${texto(debe)} y créditos ${texto(haber)}`);
  return lineas;
}

// Las cuentas del asiento pasadas al catálogo del cliente. Las que no estén mapeadas se piden al contable.
export function mapearLineas(lineas: LineaNeutral[], mapeo: Map<string, string>) {
  const faltan = [...new Set(lineas.map((l) => l.cuenta).filter((c) => !mapeo.has(c)))];
  if (faltan.length) throw new Pendiente(`Cuenta sin mapear: ${faltan.join(", ")}`);
  return lineas.map((l) => ({ cuentaId: mapeo.get(l.cuenta)!, debe: l.debe, haber: l.haber, descripcion: l.cuenta }));
}

// NCF del evento: B + 10 dígitos o E + 12 dígitos; el tipo son sus tres primeros caracteres (B01, E31…).
export function leerNcf(ncf: unknown): { ncf: string; tipo: string } | null {
  if (typeof ncf !== "string") return null;
  const n = ncf.trim().toUpperCase();
  if (!/^(B\d{10}|E\d{12})$/.test(n)) return null;
  return { ncf: n, tipo: n.slice(0, 3) };
}

// Impuestos del evento por tasa: base e ITBIS (exento = tasa 0 o sin tasa con ITBIS 0).
export type PorTasa = { tasa: string | null; base: bigint; itbis: bigint };
export function impuestos(amounts: unknown): { subtotal: bigint; total: bigint; tasas: PorTasa[] } {
  const a = (amounts ?? {}) as Record<string, unknown>;
  const subtotal = centavos(a.subtotal), descuento = centavos(a.discount ?? "0"), total = centavos(a.total);
  const lista = Array.isArray(a.taxes) ? a.taxes as Record<string, unknown>[] : [];
  const tasas: PorTasa[] = lista.map((t) => {
    const r = t.rate === null || t.rate === undefined ? null : String(Number(t.rate));
    return { tasa: r, base: centavos(t.base ?? "0"), itbis: centavos(t.tax ?? "0") };
  }).filter((t) => t.base !== 0n || t.itbis !== 0n);
  const itbis = tasas.reduce((s, t) => s + t.itbis, 0n);
  const base = tasas.reduce((s, t) => s + t.base, 0n);
  // En Vendario el subtotal ya viene sin el descuento (la cuenta VENTAS lleva el subtotal); por si acaso, también se acepta restándolo.
  const neto = subtotal + itbis === total ? subtotal : subtotal - descuento;
  if (neto + itbis !== total) throw new Pendiente(`El total ${texto(total)} no es subtotal ${texto(neto)} + ITBIS ${texto(itbis)}`);
  // Lo que no está en ninguna tasa (o si no viene el detalle) va como exento.
  if (base < neto) tasas.push({ tasa: "0", base: neto - base, itbis: 0n });
  return { subtotal: neto, total, tasas };
}

// Tasa de ITBIS que se busca en la configuración del cliente. null: la tasa no viene (gastos): se deduce de base e impuesto.
export function tasaDe(t: PorTasa): number {
  if (t.itbis === 0n) return 0;
  if (t.tasa !== null && Number(t.tasa) > 0) return Number(t.tasa);
  const p = Number((t.itbis * 10000n) / (t.base || 1n)) / 100;
  return [18, 16].reduce((a, b) => (Math.abs(b - p) < Math.abs(a - p) ? b : a), 18);
}

// Formas de cobro y de pago (acuerdo, sección 9: kind de cada forma de pago de Vendario).
export const FORMA_COBRO: Record<string, string | null> = { cash: "efectivo", transfer: "transferencia", card: "tarjeta", credit: null, balance: "otro", other: "otro" };
// 606: 01 efectivo, 02 cheques/transferencias/depósito, 03 tarjeta, 04 a crédito, 05 permuta, 06 notas de crédito, 07 mixto.
export const FORMA_606: Record<string, string> = { cash: "01", transfer: "02", card: "03", credit: "04", balance: "06", other: "01" };

export type Pago = { kind: string; amount: bigint; reference: string | null };
export function pagos(payments: unknown): Pago[] {
  return (Array.isArray(payments) ? payments : []).map((p: Record<string, unknown>) => ({
    kind: typeof p.kind === "string" ? p.kind : "other", amount: centavos(p.amount ?? "0"), reference: typeof p.reference === "string" ? p.reference : null,
  })).filter((p) => p.amount > 0n);
}

// Tipo de gasto del 606 de una compra o un gasto: el que trae Vendario; si no, 09 para mercancía (propuesta v1.1) y 02 para gastos.
export function tipoGasto(d: Record<string, unknown>, evento: string): string {
  const cat = (d.category ?? {}) as Record<string, unknown>;
  const v = String(d.dgii_606_type ?? cat.dgii_606_type ?? "").padStart(2, "0");
  if (/^(0[1-9]|1[01])$/.test(v)) return v;
  return evento === "purchase.received" ? "09" : "02";
}

// Identificación de la contraparte.
export function contraparte(party: unknown): { nombre: string | null; doc: string | null; tipo: "rnc" | "cedula" | null } {
  const p = (party ?? {}) as Record<string, unknown>;
  const doc = typeof p.doc === "string" ? p.doc.replace(/[-\s]/g, "") : "";
  const tipo = /^\d{9}$/.test(doc) ? "rnc" : /^\d{11}$/.test(doc) ? "cedula" : null;
  return { nombre: typeof p.name === "string" && p.name.trim() ? p.name.trim() : null, doc: tipo ? doc : null, tipo };
}
