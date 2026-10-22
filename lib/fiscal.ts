// Configuración tributaria: catálogos de comprobantes y obligaciones de la DGII, y el cálculo de impuestos y retenciones.
// Montos en centavos (bigint) y tasas en diezmilésimas de punto porcentual (18 % = 180000n). Nunca floats.

import { redondearDiv } from "./calculos.ts";
import type { Tx } from "./db";

export const TIPOS_IMPUESTO: Record<string, string> = {
  itbis: "ITBIS",
  exento: "Exento de ITBIS",
  isc: "Selectivo al consumo (ISC)",
  propina: "Propina legal",
  otro: "Otro impuesto o cargo",
};

export const IMPUESTOS_RETENIDOS: Record<string, string> = {
  itbis: "ITBIS (porcentaje del ITBIS facturado)",
  isr: "ISR (porcentaje del monto sin ITBIS)",
};

// Tipo de retención de ISR que pide el formato 606.
export const CODIGOS_606: Record<number, string> = {
  1: "Alquileres",
  2: "Honorarios por servicios",
  3: "Otras rentas",
  4: "Otras rentas (rentas presuntas)",
  5: "Intereses pagados a personas jurídicas",
  6: "Intereses pagados a personas físicas",
  7: "Retención por proveedores del Estado",
  8: "Juegos telefónicos",
};

export type Uso = "venta" | "compra";
export type TipoComprobante = { nombre: string; uso: Uso; detalle: string; equivalente?: string };

// Comprobantes fiscales (Norma General 06-2018 y 05-19) y sus equivalentes electrónicos (e-CF).
export const COMPROBANTES: Record<string, TipoComprobante> = {
  B01: { nombre: "Crédito fiscal", uso: "venta", detalle: "Ventas a empresas o personas que sustentan costos y gastos o el crédito del ITBIS", equivalente: "E31" },
  B02: { nombre: "Consumo", uso: "venta", detalle: "Ventas a consumidores finales", equivalente: "E32" },
  B03: { nombre: "Nota de débito", uso: "venta", detalle: "Aumenta el valor de un comprobante ya emitido", equivalente: "E33" },
  B04: { nombre: "Nota de crédito", uso: "venta", detalle: "Descuentos, devoluciones o anulación parcial de un comprobante emitido", equivalente: "E34" },
  B11: { nombre: "Compras", uso: "compra", detalle: "Lo emite el comprador al adquirir de personas físicas que no emiten comprobantes", equivalente: "E41" },
  B12: { nombre: "Registro único de ingresos", uso: "venta", detalle: "Registra en un solo comprobante las ventas del día a consumidores finales" },
  B13: { nombre: "Gastos menores", uso: "compra", detalle: "Gastos menores del personal en funciones de la empresa (peajes, parqueos, combustible…)", equivalente: "E43" },
  B14: { nombre: "Régimen especial", uso: "venta", detalle: "Ventas a personas o entidades exentas o en regímenes especiales (zonas francas, etc.)", equivalente: "E44" },
  B15: { nombre: "Gubernamental", uso: "venta", detalle: "Ventas al Estado", equivalente: "E45" },
  B16: { nombre: "Exportaciones", uso: "venta", detalle: "Ventas de bienes al exterior", equivalente: "E46" },
  B17: { nombre: "Pagos al exterior", uso: "compra", detalle: "Lo emite quien paga a personas o empresas no residentes", equivalente: "E47" },
};

// Los e-CF llevan el mismo nombre que su equivalente impreso.
for (const [b, t] of Object.entries({ ...COMPROBANTES })) {
  if (t.equivalente) COMPROBANTES[t.equivalente] = { ...t, equivalente: b, detalle: `Electrónico. ${t.detalle}` };
}

export const esElectronico = (tipo: string) => tipo.startsWith("E");
export const digitosSecuencia = (tipo: string) => (esElectronico(tipo) ? 10 : 8);
export const numeroComprobante = (tipo: string, n: bigint | number | string) => tipo + String(n).padStart(digitosSecuencia(tipo), "0");

export type PerfilFiscal = {
  tipo_persona: "juridica" | "fisica"; regimen: string; contribuye_itbis: boolean; agente_retencion: boolean;
  emisor_ecf: boolean; ecf_desde: string | null;
};

export type Obligacion = {
  clave: string; nombre: string; formulario: string; periodicidad: "Mensual" | "Anual"; vence: string;
  sugerida: (p: PerfilFiscal) => boolean; motivo: string;
};

// Obligaciones más comunes ante la DGII. La firma marca cuáles aplican a cada cliente; la sugerencia sale del perfil fiscal.
export const OBLIGACIONES: Obligacion[] = [
  { clave: "it1", nombre: "Declaración y pago del ITBIS", formulario: "IT-1", periodicidad: "Mensual", vence: "Día 20 del mes siguiente",
    sugerida: (p) => p.contribuye_itbis && p.regimen !== "rst", motivo: "Contribuyente de ITBIS fuera del RST" },
  { clave: "ir17", nombre: "Retenciones y retribuciones complementarias", formulario: "IR-17", periodicidad: "Mensual", vence: "Día 10 del mes siguiente",
    sugerida: (p) => p.agente_retencion, motivo: "Agente de retención" },
  { clave: "ir3", nombre: "Retenciones a asalariados", formulario: "IR-3", periodicidad: "Mensual", vence: "Día 10 del mes siguiente",
    sugerida: () => false, motivo: "Márcala si la empresa tiene empleados" },
  { clave: "f606", nombre: "Compras de bienes y servicios", formulario: "606", periodicidad: "Mensual", vence: "Día 15 del mes siguiente",
    sugerida: (p) => p.regimen !== "rst", motivo: "Norma General 07-2018 (se envía aunque no haya operaciones)" },
  { clave: "f607", nombre: "Ventas de bienes y servicios", formulario: "607", periodicidad: "Mensual", vence: "Día 15 del mes siguiente",
    sugerida: (p) => p.regimen !== "rst", motivo: "Norma General 07-2018 (se envía aunque no haya operaciones)" },
  { clave: "f608", nombre: "Comprobantes anulados", formulario: "608", periodicidad: "Mensual", vence: "Día 15 del mes siguiente",
    sugerida: (p) => p.regimen !== "rst", motivo: "Norma General 07-2018 (se envía aunque no haya operaciones)" },
  { clave: "f609", nombre: "Pagos al exterior", formulario: "609", periodicidad: "Mensual", vence: "Día 15 del mes siguiente",
    sugerida: () => false, motivo: "Márcala si la empresa paga a personas o empresas del exterior" },
  { clave: "anticipo", nombre: "Anticipo del impuesto sobre la renta", formulario: "Anticipo ISR", periodicidad: "Mensual", vence: "Día 15 del mes siguiente",
    sugerida: (p) => p.tipo_persona === "juridica" && p.regimen === "ordinario", motivo: "Persona jurídica del régimen ordinario" },
  { clave: "ir2", nombre: "Impuesto sobre la renta de sociedades", formulario: "IR-2", periodicidad: "Anual", vence: "120 días después del cierre fiscal",
    sugerida: (p) => p.tipo_persona === "juridica" && p.regimen !== "rst", motivo: "Persona jurídica" },
  { clave: "ir1", nombre: "Impuesto sobre la renta de personas físicas", formulario: "IR-1", periodicidad: "Anual", vence: "En marzo, según el calendario de la DGII",
    sugerida: (p) => p.tipo_persona === "fisica" && p.regimen !== "rst", motivo: "Persona física" },
  { clave: "rst", nombre: "Declaración jurada del Régimen Simplificado", formulario: "RST", periodicidad: "Anual", vence: "Según el calendario de la DGII",
    sugerida: (p) => p.regimen === "rst", motivo: "Inscrita en el RST" },
];

export const CLAVES_OBLIGACION = new Set(OBLIGACIONES.map((o) => o.clave));

// ───── Tasas ─────

// "18", "18.5", "18.0000" -> 180000n. Devuelve null si no es una tasa válida entre 0 y 100.
export function leerPorcentaje(v: string): bigint | null {
  const s = v.replace(",", ".").replace("%", "").trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(s)) return null;
  const [e, d = ""] = s.split(".");
  const n = BigInt(e) * 10000n + BigInt(d.padEnd(4, "0"));
  return n <= 1000000n ? n : null;
}

export function porcentajeTexto(t: bigint): string {
  const e = t / 10000n;
  const d = (t % 10000n).toString().padStart(4, "0").replace(/0+$/, "");
  return d ? `${e}.${d}` : `${e}`;
}

export const verPorcentaje = (t: string | bigint) => `${porcentajeTexto(typeof t === "bigint" ? t : leerPorcentaje(t) ?? 0n)} %`;

// Porcentaje de un monto en centavos, redondeado al centavo (mitad hacia arriba).
export function aplicarTasa(centavos: bigint, tasa: bigint): bigint {
  return redondearDiv(centavos * tasa, 1000000n);
}

// ───── Cálculo de una operación ─────

export type ImpuestoCalculo = { tasa: bigint; tipo: string };
export type LineaCalculo = { monto: bigint; impuestos: ImpuestoCalculo[] };
export type RetencionCalculo = { impuesto: "itbis" | "isr"; tasa: bigint };

// Cada línea puede llevar varios impuestos sobre el mismo monto (p. ej. ITBIS 18 % y propina legal 10 %), calculados por línea.
// Las retenciones van sobre el total: las de ITBIS sobre el ITBIS facturado, las de ISR sobre el monto sin impuestos.
export function calcularOperacion(lineas: LineaCalculo[], retenciones: RetencionCalculo[]) {
  const detalle = lineas.map((l) => ({ ...l, montos: l.impuestos.map((i) => aplicarTasa(l.monto, i.tasa)) }));
  const suma = (filtro: (tipo: string) => boolean) =>
    detalle.reduce((s, l) => s + l.montos.reduce((t, m, i) => t + (filtro(l.impuestos[i].tipo) ? m : 0n), 0n), 0n);
  const subtotal = detalle.reduce((s, l) => s + l.monto, 0n);
  const itbis = suma((t) => t === "itbis");
  const otros = suma((t) => t !== "itbis");
  const total = subtotal + itbis + otros;
  const retenido = retenciones.map((r) => ({ ...r, monto: aplicarTasa(r.impuesto === "itbis" ? itbis : subtotal, r.tasa) }));
  const totalRetenido = retenido.reduce((s, r) => s + r.monto, 0n);
  return { lineas: detalle, subtotal, itbis, otros, total, retenciones: retenido, totalRetenido, neto: total - totalRetenido };
}

// ───── Lectura de la configuración ─────

export type Impuesto = {
  id: string; nombre: string; tipo: string; tasa: string; cuenta_ventas_id: string | null; cuenta_compras_id: string | null;
  vigente_desde: string; vigente_hasta: string | null; activo: boolean; nota: string | null;
};
export type Retencion = {
  id: string; nombre: string; impuesto: "itbis" | "isr"; tasa: string; cuenta_por_terceros_id: string; cuenta_a_terceros_id: string;
  codigo_606: number | null; vigente_desde: string; vigente_hasta: string | null; activo: boolean; nota: string | null;
};

export async function listarImpuestos(tx: Tx, vigentesAl?: string): Promise<Impuesto[]> {
  return tx<Impuesto[]>`
    SELECT id, nombre, tipo, tasa::text, cuenta_ventas_id, cuenta_compras_id, to_char(vigente_desde, 'YYYY-MM-DD') AS vigente_desde,
           to_char(vigente_hasta, 'YYYY-MM-DD') AS vigente_hasta, activo, nota
      FROM impuestos
     WHERE ${vigentesAl ?? null}::date IS NULL
        OR (activo AND vigente_desde <= ${vigentesAl ?? null}::date AND (vigente_hasta IS NULL OR vigente_hasta >= ${vigentesAl ?? null}::date))
     ORDER BY activo DESC, tipo <> 'itbis', tipo, tasa DESC, vigente_desde DESC`;
}

export async function listarRetenciones(tx: Tx, vigentesAl?: string): Promise<Retencion[]> {
  return tx<Retencion[]>`
    SELECT id, nombre, impuesto, tasa::text, cuenta_por_terceros_id, cuenta_a_terceros_id, codigo_606,
           to_char(vigente_desde, 'YYYY-MM-DD') AS vigente_desde, to_char(vigente_hasta, 'YYYY-MM-DD') AS vigente_hasta, activo, nota
      FROM retenciones
     WHERE ${vigentesAl ?? null}::date IS NULL
        OR (activo AND vigente_desde <= ${vigentesAl ?? null}::date AND (vigente_hasta IS NULL OR vigente_hasta >= ${vigentesAl ?? null}::date))
     ORDER BY activo DESC, impuesto DESC, tasa, vigente_desde DESC`;
}

export function vigenciaTexto(desde: string, hasta: string | null, verFecha: (f: string) => string): string {
  if (desde <= "2000-01-01" && !hasta) return "Sin límite";
  if (desde <= "2000-01-01") return `Hasta el ${verFecha(hasta!)}`;
  return hasta ? `Del ${verFecha(desde)} al ${verFecha(hasta)}` : `Desde el ${verFecha(desde)}`;
}

export async function perfilFiscal(tx: Tx): Promise<PerfilFiscal> {
  const [p] = await tx<PerfilFiscal[]>`
    SELECT tipo_persona, regimen, contribuye_itbis, agente_retencion, emisor_ecf, to_char(ecf_desde, 'YYYY-MM-DD') AS ecf_desde
      FROM empresas WHERE id = empresa_actual()`;
  return p;
}

// Obligaciones con lo guardado por la firma o, si nunca se guardó, la sugerencia del perfil.
export async function obligacionesDeEmpresa(tx: Tx, perfil: PerfilFiscal) {
  const guardadas = new Map((await tx<{ clave: string; activa: boolean }[]>`SELECT clave, activa FROM obligaciones_empresa`)
    .map((o) => [o.clave, o.activa]));
  return OBLIGACIONES.map((o) => ({
    ...o,
    sugeridaAhora: o.sugerida(perfil),
    activa: guardadas.get(o.clave) ?? o.sugerida(perfil),
    confirmada: guardadas.has(o.clave),
  }));
}
