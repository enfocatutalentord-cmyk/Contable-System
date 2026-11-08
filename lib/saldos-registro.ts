import type { Tx } from "./db";
import { aCentavos, deCentavos, leerMonto } from "./montos.ts";

// Rediseño R5 (n.º 10 de la Lista de rediseños): a un cliente sin contabilidad no se le hacen asientos. Sus estados financieros salen
// de sus facturas emitidas y compras registradas (ingresos, costos y gastos, cada línea con su cuenta) y de este formulario con los
// saldos que las facturas no traen, a una fecha de corte (por año, o por mes si se quiere).

// Cada concepto va a una cuenta de detalle del catálogo dominicano. «lado»: activo suma; pasivo y patrimonio restan (saldo acreedor).
export const CONCEPTOS_BALANCE = [
  { clave: "efectivo", nombre: "Efectivo en caja y bancos", codigo: "110101", lado: "activo", grupo: "Activos corrientes" },
  { clave: "cxc", nombre: "Cuentas por cobrar a clientes", codigo: "110201", lado: "activo", grupo: "Activos corrientes" },
  { clave: "inventario", nombre: "Inventario", codigo: "110301", lado: "activo", grupo: "Activos corrientes" },
  { clave: "impuestos_favor", nombre: "Impuestos a favor (ITBIS, anticipos y retenciones)", codigo: "110402", lado: "activo", grupo: "Activos corrientes" },
  { clave: "otros_ac", nombre: "Otros activos corrientes (gastos pagados por adelantado)", codigo: "110405", lado: "activo", grupo: "Activos corrientes" },
  { clave: "activos_fijos", nombre: "Mobiliario, equipos, vehículos e inmuebles (neto de depreciación)", codigo: "120103", lado: "activo", grupo: "Activos no corrientes" },
  { clave: "otros_anc", nombre: "Otros activos no corrientes (depósitos, software)", codigo: "120201", lado: "activo", grupo: "Activos no corrientes" },
  { clave: "cxp", nombre: "Cuentas por pagar a proveedores", codigo: "210101", lado: "pasivo", grupo: "Pasivos" },
  { clave: "impuestos_pagar", nombre: "Impuestos por pagar", codigo: "210201", lado: "pasivo", grupo: "Pasivos" },
  { clave: "prestamos_cp", nombre: "Préstamos a corto plazo (menos de un año)", codigo: "210401", lado: "pasivo", grupo: "Pasivos" },
  { clave: "otros_pc", nombre: "Otros pasivos corrientes (sueldos, TSS y gastos por pagar)", codigo: "210502", lado: "pasivo", grupo: "Pasivos" },
  { clave: "prestamos_lp", nombre: "Préstamos a largo plazo", codigo: "220101", lado: "pasivo", grupo: "Pasivos" },
  { clave: "capital", nombre: "Capital", codigo: "310101", lado: "patrimonio", grupo: "Patrimonio" },
  { clave: "acumulados", nombre: "Resultados de años anteriores", codigo: "310301", lado: "patrimonio", grupo: "Patrimonio" },
] as const;
export type ClaveBalance = (typeof CONCEPTOS_BALANCE)[number]["clave"];

// Lee el formulario: montos en positivo (los resultados de años anteriores pueden ser negativos si hubo pérdidas).
export function leerSaldos(fd: FormData): Record<string, string> | string {
  const r: Record<string, string> = {};
  for (const c of CONCEPTOS_BALANCE) {
    const t = String(fd.get(c.clave) ?? "").trim();
    if (!t) continue;
    const m = leerMonto(t.replace(/^-/, ""));
    if (m === null) return `«${c.nombre}»: el monto no es válido.`;
    const v = aCentavos(m) * (t.startsWith("-") ? -1n : 1n);
    if (v < 0n && c.clave !== "acumulados") return `«${c.nombre}» no puede ser negativo.`;
    r[c.clave] = deCentavos(v);
  }
  return r;
}

// Saldo con signo de la cuenta (debe − haber) de un concepto.
export const saldoContable = (lado: string, monto: bigint) => (lado === "activo" ? monto : -monto);

export type Corte = { id: string; fecha: string; montos: Record<string, string>; notas: string | null; por: string | null; en: Date };

export const cortesDe = (tx: Tx) => tx<Corte[]>`
  SELECT s.id, to_char(s.fecha, 'YYYY-MM-DD') AS fecha, s.montos, s.notas, u.nombre AS por, s.actualizado_en AS en
    FROM saldos_registro s LEFT JOIN usuarios u ON u.id = s.actualizado_por ORDER BY s.fecha DESC`;

// El corte vigente a una fecha: el último con fecha igual o anterior.
export const corteA = (cortes: Corte[], fecha: string) => cortes.find((c) => c.fecha <= fecha) ?? null;

// Sugeridos para el formulario a partir de lo registrado: lo que falta por cobrar de las facturas y por pagar de las compras.
export async function sugeridosA(tx: Tx, fecha: string): Promise<Partial<Record<ClaveBalance, string>>> {
  const [r] = await tx<{ cxc: string; cxp: string }[]>`
    SELECT (SELECT COALESCE(sum(round(s.saldo * f.tasa, 2)), 0) FROM facturas f JOIN saldos_factura s ON s.factura_id = f.id
             WHERE f.estado = 'emitida' AND NOT f.anulada AND f.fecha <= ${fecha} AND s.saldo > 0)::text AS cxc,
           (SELECT COALESCE(sum(round(s.saldo * c.tasa, 2)), 0) FROM compras c JOIN saldos_compra s ON s.compra_id = c.id
             WHERE c.estado = 'registrada' AND NOT c.anulada AND c.fecha <= ${fecha} AND s.saldo > 0)::text AS cxp`;
  return { cxc: r.cxc, cxp: r.cxp };
}
