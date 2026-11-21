import type { Tx } from "./db";
import { aCentavos } from "./montos.ts";

// Prioridad 3 · P3b: cargo por la aplicación. A los clientes que usan la aplicación se les suma un porcentaje (el de la firma, 10 % al empezar) al
// precio de sus servicios y de su iguala. No se separa en la factura: el precio ya lo incluye. Cada factura guarda el porcentaje con el que se hizo
// (`facturas.cargo_app_pct`) y de ahí sale cuánto de su precio es el cargo (la función `cargo_de_factura` de la base).

export class ErrorCargo extends Error {}

export const CARGO_DEFECTO = "10.00";

// El porcentaje escrito en pantalla: de 0 a 100 con hasta dos decimales. Devuelve el texto con dos decimales.
export function leerPorcentajeCargo(bruto: string): string {
  const t = bruto.trim().replace(",", ".").replace(/\s*%$/, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) throw new ErrorCargo("El porcentaje es un número de 0 a 100, con hasta dos decimales.");
  const centesimas = Math.round(Number(t) * 100);
  if (centesimas > 10000) throw new ErrorCargo("El porcentaje no puede pasar de 100.");
  return `${Math.floor(centesimas / 100)}.${String(centesimas % 100).padStart(2, "0")}`;
}

const centesimas = (pct: string) => BigInt(Math.round(Number(pct) * 100)); // 10.00 → 1000

// El precio con el cargo incluido (centavos, redondeado al centavo).
export function conCargo(precio: bigint, pct: string): bigint {
  const p = centesimas(pct);
  return (precio * (10000n + p) + 5000n) / 10000n;
}

// Cuánto de un subtotal que ya lleva el cargo es el cargo: subtotal × p / (100 + p).
export function cargoIncluido(subtotal: bigint, pct: string): bigint {
  const p = centesimas(pct);
  const d = 10000n + p;
  return (subtotal * p + d / 2n) / d;
}

// El porcentaje que le toca a un cliente de la empresa en curso (corre en conEmpresa de la empresa propia): el de la firma si el cliente usa la
// aplicación; si no, null.
export async function cargoDelCliente(tx: Tx, clienteId: string): Promise<string | null> {
  const [r] = await tx<{ pct: string | null }[]>`SELECT cargo_aplicacion_de(${clienteId})::text AS pct`;
  return r?.pct ?? null;
}

export type FilaCargo = { clienteId: string; cliente: string; facturado: bigint; cobrado: bigint; porCobrar: bigint };
export type ReporteCargo = { filas: FilaCargo[]; facturado: bigint; cobrado: bigint; porCobrar: bigint; cobradoAnio: bigint };

const finDeMes = (mes: string) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);

// El reporte del mes (AAAA-MM) de la empresa propia, por cliente: lo facturado ese mes con cargo, lo cobrado ese mes del cargo (a cada cobro le toca
// la parte del cargo que tiene la factura que paga) y lo que falta por cobrar a fin de mes. Solo facturas emitidas, vigentes y sin nota de crédito;
// los cobros hechos con un anticipo ya recibido no se cuentan (como en el presupuesto, el dinero entró cuando llegó el anticipo).
export async function reporteDelMes(tx: Tx, mes: string): Promise<ReporteCargo> {
  return calcular(tx, `${mes}-01`, finDeMes(mes), mes.slice(0, 4));
}

// Se arma por partes (facturas y cobros aparte) para no repetir el cargo de una factura por cada cobro que tiene.
async function calcular(tx: Tx, desde: string, hasta: string, anio: string): Promise<ReporteCargo> {
  const facturadas = await tx<{ cliente_id: string; cliente: string; cargo: string; en_mes: boolean }[]>`
    SELECT cl.id AS cliente_id, cl.nombre AS cliente, cargo_de_factura(f.id)::text AS cargo, (f.fecha >= ${desde}) AS en_mes
      FROM facturas f JOIN clientes cl ON cl.id = f.cliente_id
     WHERE f.estado = 'emitida' AND NOT f.anulada AND f.cargo_app_pct IS NOT NULL AND f.fecha <= ${hasta}`;
  const cobros = await tx<{ cliente_id: string; cliente: string; parte: string; en_mes: boolean; en_anio: boolean }[]>`
    SELECT cl.id AS cliente_id, cl.nombre AS cliente, round(a.monto * cargo_de_factura(f.id) / NULLIF(f.total, 0), 2)::text AS parte,
           (co.fecha >= ${desde}) AS en_mes, (co.fecha >= make_date(${Number(anio)}, 1, 1)) AS en_anio
      FROM cobros co JOIN aplicaciones_cobro a ON a.cobro_id = co.id JOIN facturas f ON f.id = a.factura_id JOIN clientes cl ON cl.id = f.cliente_id
     WHERE NOT co.anulado AND co.anticipo_id IS NULL AND co.fecha <= ${hasta}
       AND f.estado = 'emitida' AND NOT f.anulada AND f.cargo_app_pct IS NOT NULL`;
  const por = new Map<string, FilaCargo & { cobradoTotal: bigint; facturadoTotal: bigint }>();
  const fila = (id: string, nombre: string) => {
    if (!por.has(id)) por.set(id, { clienteId: id, cliente: nombre, facturado: 0n, cobrado: 0n, porCobrar: 0n, cobradoTotal: 0n, facturadoTotal: 0n });
    return por.get(id)!;
  };
  // Cada parte ya viene redondeada al centavo desde la base; el reporte suma esos centavos (igual que el presupuesto).
  const centavos = (t: string) => aCentavos(t);
  for (const f of facturadas) {
    const r = fila(f.cliente_id, f.cliente);
    const c = centavos(f.cargo);
    r.facturadoTotal += c;
    if (f.en_mes) r.facturado += c;
  }
  let cobradoAnio = 0n;
  for (const c of cobros) {
    const r = fila(c.cliente_id, c.cliente);
    const v = centavos(c.parte);
    r.cobradoTotal += v;
    if (c.en_mes) r.cobrado += v;
    if (c.en_anio) cobradoAnio += v;
  }
  const lista = [...por.values()].map((r) => ({ ...r, porCobrar: r.facturadoTotal - r.cobradoTotal })).sort((a, b) => a.cliente.localeCompare(b.cliente));
  const suma = (k: "facturado" | "cobrado" | "porCobrar") => lista.reduce((s, r) => s + r[k], 0n);
  return {
    filas: lista.filter((r) => r.facturado !== 0n || r.cobrado !== 0n || r.porCobrar !== 0n).map(({ clienteId, cliente, facturado, cobrado, porCobrar }) => ({ clienteId, cliente, facturado, cobrado, porCobrar })),
    facturado: suma("facturado"), cobrado: suma("cobrado"), porCobrar: suma("porCobrar"), cobradoAnio,
  };
}
