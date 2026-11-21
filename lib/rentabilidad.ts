import { conEmpresa, conEmpresas } from "./db.ts";
import { aCentavos } from "./montos.ts";

// Prioridad 2.2 (P2b): rentabilidad por cliente = lo que Empire cobró del cliente en el período menos el tiempo anotado en su bitácora por el
// costo de la hora de trabajo que pone la dueña. Solo la ven las administradoras de la firma.

export type Periodo = { desde: string; hasta: string; etiqueta: string };

// Un mes (AAAA-MM) o un año completo (AAAA).
export function leerPeriodo(mes: string | undefined, anio: string | undefined, hoy: string): Periodo & { tipo: "mes" | "anio"; mes: string; anio: string } {
  const a = /^\d{4}$/.test(anio ?? "") ? anio! : null;
  if (a) return { tipo: "anio", desde: `${a}-01-01`, hasta: `${a}-12-31`, etiqueta: a, mes: `${a}-${hoy.slice(5, 7)}`, anio: a };
  const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(mes ?? "") ? mes! : hoy.slice(0, 7);
  const ultimo = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
  return { tipo: "mes", desde: `${m}-01`, hasta: `${m}-${String(ultimo).padStart(2, "0")}`, etiqueta: m, mes: m, anio: m.slice(0, 4) };
}

// Costo del tiempo: minutos × costo de la hora, en centavos y redondeado al centavo.
export const costoDe = (minutos: number, costoHora: bigint): bigint => (BigInt(minutos) * costoHora + 30n) / 60n;

// Margen en porcentaje con un decimal (ganancia ÷ cobrado); sin cobrado no hay margen que calcular.
export function margen(cobrado: bigint, ganancia: bigint): string | null {
  if (cobrado <= 0n) return null;
  const d = (ganancia * 1000n) / cobrado; // décimas de punto, truncado hacia cero
  const s = d < 0n ? -d : d;
  return `${d < 0n ? "-" : ""}${s / 10n}.${s % 10n}`;
}

// Lo cobrado por hora trabajada (centavos), con el tiempo en minutos; sin tiempo no se puede.
export const cobradoPorHora = (cobrado: bigint, minutos: number): bigint | null => (minutos > 0 ? (cobrado * 60n) / BigInt(minutos) : null);

export type FilaRentabilidad = {
  empresaId: string; nombre: string; cobrado: bigint; minutos: number; gestiones: number; sinTiempo: number;
  costo: bigint | null; ganancia: bigint | null;
};

// Lo cobrado en el período por cada cliente enlazado: cobros aplicados a sus facturas y anticipos recibidos (no se cuentan dos veces los cobros
// que solo aplican un anticipo). Se lee de la empresa propia que factura. Como en el presupuesto, los montos se toman tal como están.
async function cobradoPorCliente(propiaId: string, p: Periodo): Promise<Map<string, bigint>> {
  const f = await conEmpresa(propiaId, (tx) => tx<{ empresa_id: string; cobrado: string }[]>`
    SELECT cl.empresa_vinculada_id AS empresa_id, sum(x.monto)::text AS cobrado
      FROM (
        SELECT f.cliente_id, a.monto
          FROM cobros c JOIN aplicaciones_cobro a ON a.cobro_id = c.id JOIN facturas f ON f.id = a.factura_id
         WHERE NOT c.anulado AND c.anticipo_id IS NULL AND c.fecha BETWEEN ${p.desde} AND ${p.hasta}
        UNION ALL
        SELECT cliente_id, monto FROM anticipos WHERE NOT anulado AND fecha BETWEEN ${p.desde} AND ${p.hasta}) x
      JOIN clientes cl ON cl.id = x.cliente_id
     WHERE cl.empresa_vinculada_id IS NOT NULL GROUP BY 1`);
  return new Map(f.map((r) => [r.empresa_id, aCentavos(r.cobrado)]));
}

// El tiempo anotado en la bitácora de cada cliente (cada una vive en su empresa, con su propia RLS). Las gestiones que anota el sistema solo
// cuentan si tienen tiempo; la advertencia de «sin tiempo» es por las que anota una persona.
async function tiempoPorCliente(empresaIds: string[], p: Periodo): Promise<Map<string, { minutos: number; gestiones: number; sinTiempo: number }>> {
  const t = new Map<string, { minutos: number; gestiones: number; sinTiempo: number }>();
  if (!empresaIds.length) return t;
  await conEmpresas(async (tx, en) => {
    for (const id of empresaIds) {
      await en(id);
      const [r] = await tx<{ minutos: number; gestiones: number; sin_tiempo: number }[]>`
        SELECT coalesce(sum(minutos), 0)::int AS minutos, count(*) FILTER (WHERE origen = 'manual')::int AS gestiones,
               count(*) FILTER (WHERE origen = 'manual' AND minutos IS NULL)::int AS sin_tiempo
          FROM gestiones WHERE fecha BETWEEN ${p.desde} AND ${p.hasta}`;
      t.set(id, { minutos: r.minutos, gestiones: r.gestiones, sinTiempo: r.sin_tiempo });
    }
  });
  return t;
}

// Una fila por cliente que tuvo cobros o tiempo anotado en el período. Sin costo de la hora, solo se muestran cobrado y tiempo.
export async function rentabilidadPorCliente(propiaId: string | null, clientes: { id: string; nombre: string }[], p: Periodo, costoHora: bigint | null): Promise<FilaRentabilidad[]> {
  const [cobros, tiempo] = await Promise.all([propiaId ? cobradoPorCliente(propiaId, p) : new Map<string, bigint>(), tiempoPorCliente(clientes.map((c) => c.id), p)]);
  const filas: FilaRentabilidad[] = [];
  for (const c of clientes) {
    const cobrado = cobros.get(c.id) ?? 0n;
    const t = tiempo.get(c.id) ?? { minutos: 0, gestiones: 0, sinTiempo: 0 };
    if (cobrado === 0n && t.minutos === 0) continue;
    const costo = costoHora === null ? null : costoDe(t.minutos, costoHora);
    filas.push({ empresaId: c.id, nombre: c.nombre, cobrado, minutos: t.minutos, gestiones: t.gestiones, sinTiempo: t.sinTiempo, costo, ganancia: costo === null ? null : cobrado - costo });
  }
  return filas.sort((a, b) => (a.cobrado === b.cobrado ? a.nombre.localeCompare(b.nombre) : a.cobrado > b.cobrado ? -1 : 1));
}
