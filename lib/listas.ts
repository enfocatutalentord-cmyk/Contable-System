import type { Tx } from "./db";
import { hoyISO } from "./montos";

// Consultas de las listas de facturas, cobros, compras y pagos. Las usan la pantalla y la descarga en Excel/PDF,
// para que lo descargado sea exactamente lo que se ve con los mismos filtros.

const mesValido = (mes: string | undefined, porDefecto: string, vacioEsTodos: boolean) =>
  /^\d{4}-\d{2}$/.test(mes ?? "") ? mes! : vacioEsTodos && mes === "" ? "" : porDefecto;

export const ESTADOS_FACTURA: Record<string, string> = { todas: "Todas", borradores: "Borradores", pendientes: "Pendientes", vencidas: "Vencidas", pagadas: "Pagadas", anuladas: "Anuladas", notas: "Notas de crédito" };
export const ESTADOS_COMPRA: Record<string, string> = {
  todas: "Todas", borradores: "Borradores", pendientes: "Por pagar", vencidas: "Vencidas", pagadas: "Pagadas", anuladas: "Anuladas",
  notas: "Notas de crédito",
};

export type FiltrosDocumentos = { mes: string; estado: string; q: string; hoy: string };
export type FiltrosPagos = { mes: string; q: string };

export function leerFiltrosDocumentos(sp: { mes?: string; estado?: string; q?: string }, estados: Record<string, string>): FiltrosDocumentos {
  const hoy = hoyISO();
  return { mes: mesValido(sp.mes, hoy.slice(0, 7), true), estado: estados[sp.estado ?? ""] ? sp.estado! : "todas", q: (sp.q ?? "").trim(), hoy };
}

export function leerFiltrosPagos(sp: { mes?: string; q?: string }): FiltrosPagos {
  return { mes: mesValido(sp.mes, hoyISO().slice(0, 7), false), q: (sp.q ?? "").trim() };
}

export const consultaFiltros = (f: Partial<FiltrosDocumentos>) =>
  new URLSearchParams(Object.entries({ mes: f.mes, estado: f.estado, q: f.q }).filter(([, v]) => v !== undefined) as [string, string][]).toString();

export type FilaFactura = {
  id: string; estado: string; ncf: string | null; tipo_ncf: string; fecha: string; vence: string; cliente: string; rnc: string | null;
  moneda: string; subtotal: string; itbis: string; otros: string; total: string; saldo: string | null; anulada: boolean; origen: string | null;
};

export function estadoFactura(f: FilaFactura, hoy: string) {
  if (f.estado === "borrador") return "Borrador";
  if (f.anulada) return "Anulada";
  if (f.tipo_ncf === "B04") return `Nota a ${f.origen}`;
  return Number(f.saldo ?? 0) <= 0 ? "Pagada" : f.vence < hoy ? "Vencida" : "Pendiente";
}

export function listarFacturas(tx: Tx, { mes, estado, q, hoy }: FiltrosDocumentos) {
  return tx<FilaFactura[]>`
    SELECT f.id, f.estado, f.ncf, f.tipo_ncf, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, to_char(f.vence, 'YYYY-MM-DD') AS vence,
           c.nombre AS cliente, c.rnc, f.moneda, f.subtotal::text, f.itbis::text, f.otros_impuestos::text AS otros, f.total::text,
           s.saldo::text, f.anulada, o.ncf AS origen
      FROM facturas f JOIN clientes c ON c.id = f.cliente_id
      LEFT JOIN saldos_factura s ON s.factura_id = f.id
      LEFT JOIN facturas o ON o.id = f.factura_origen_id
     WHERE (${mes} = '' OR to_char(f.fecha, 'YYYY-MM') = ${mes})
       AND (${q} = '' OR f.ncf ILIKE ${"%" + q + "%"} OR c.nombre ILIKE ${"%" + q + "%"})
       AND (${estado} = 'todas' OR (${estado} = 'borradores') = (f.estado = 'borrador'))
       AND CASE ${estado}
             WHEN 'borradores' THEN true
             WHEN 'pendientes' THEN NOT f.anulada AND f.tipo_ncf <> 'B04' AND s.saldo > 0
             WHEN 'vencidas' THEN NOT f.anulada AND f.tipo_ncf <> 'B04' AND s.saldo > 0 AND f.vence < ${hoy}
             WHEN 'pagadas' THEN NOT f.anulada AND f.tipo_ncf <> 'B04' AND s.saldo <= 0
             WHEN 'anuladas' THEN f.anulada
             WHEN 'notas' THEN f.tipo_ncf = 'B04'
             ELSE true END
     ORDER BY f.estado = 'borrador' DESC, f.fecha DESC, f.ncf DESC NULLS FIRST`;
}

export type FilaCompra = {
  id: string; estado: string; ncf: string | null; tipo_comprobante: string; fecha: string; vence: string; proveedor: string; rnc: string | null;
  moneda: string; subtotal: string; itbis: string; otros: string; total: string; saldo: string | null; anulada: boolean; origen: string | null;
};

export function estadoCompra(f: FilaCompra, hoy: string) {
  if (f.estado === "borrador") return "Borrador";
  if (f.anulada) return "Anulada";
  if (f.origen !== null) return `Nota a ${f.origen}`;
  return Number(f.saldo ?? 0) <= 0 ? "Pagada" : f.vence < hoy ? "Vencida" : "Por pagar";
}

export function listarCompras(tx: Tx, { mes, estado, q, hoy }: FiltrosDocumentos) {
  return tx<FilaCompra[]>`
    SELECT c.id, c.estado, c.ncf, c.tipo_comprobante, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, to_char(c.vence, 'YYYY-MM-DD') AS vence,
           p.nombre AS proveedor, p.rnc, c.moneda, c.subtotal::text, c.itbis::text, c.otros_impuestos::text AS otros, c.total::text,
           s.saldo::text, c.anulada, o.ncf AS origen
      FROM compras c JOIN proveedores p ON p.id = c.proveedor_id
      LEFT JOIN saldos_compra s ON s.compra_id = c.id
      LEFT JOIN compras o ON o.id = c.compra_origen_id
     WHERE (${mes} = '' OR to_char(c.fecha, 'YYYY-MM') = ${mes})
       AND (${q} = '' OR c.ncf ILIKE ${"%" + q + "%"} OR p.nombre ILIKE ${"%" + q + "%"} OR p.rnc = ${q.replace(/-/g, "")})
       AND (${estado} = 'todas' OR (${estado} = 'borradores') = (c.estado = 'borrador'))
       AND CASE ${estado}
             WHEN 'pendientes' THEN NOT c.anulada AND s.saldo > 0
             WHEN 'vencidas' THEN NOT c.anulada AND s.saldo > 0 AND c.vence < ${hoy}
             WHEN 'pagadas' THEN NOT c.anulada AND s.saldo <= 0
             WHEN 'anuladas' THEN c.anulada
             WHEN 'notas' THEN c.tipo_comprobante IN ('B04', 'E34')
             ELSE true END
     ORDER BY c.estado = 'borrador' DESC, c.fecha DESC, c.ncf DESC NULLS FIRST`;
}

export type FilaCobro = {
  numero: number; fecha: string; cliente: string; moneda: string; recibido: string; retenciones: string; forma_pago: string;
  referencia: string | null; anulado: boolean; facturas: string | null;
};

export function listarCobros(tx: Tx, { mes, q }: FiltrosPagos) {
  return tx<FilaCobro[]>`
    SELECT c.numero, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, cl.nombre AS cliente, c.moneda, c.recibido::text,
           (c.retencion_itbis + c.retencion_isr)::text AS retenciones, c.forma_pago, c.referencia, c.anulado,
           (SELECT string_agg(f.ncf, ', ' ORDER BY f.ncf) FROM aplicaciones_cobro a JOIN facturas f ON f.id = a.factura_id WHERE a.cobro_id = c.id) AS facturas
      FROM cobros c JOIN clientes cl ON cl.id = c.cliente_id
     WHERE to_char(c.fecha, 'YYYY-MM') = ${mes}
       AND (${q} = '' OR cl.nombre ILIKE ${"%" + q + "%"} OR c.referencia ILIKE ${"%" + q + "%"} OR c.numero::text = ${q})
     ORDER BY c.fecha DESC, c.numero DESC`;
}

export type FilaPago = {
  numero: number; fecha: string; proveedor: string; moneda: string; pagado: string; retenciones: string; forma_pago: string;
  referencia: string | null; anulado: boolean; compras: string | null;
};

export function listarPagos(tx: Tx, { mes, q }: FiltrosPagos) {
  return tx<FilaPago[]>`
    SELECT c.numero, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, pr.nombre AS proveedor, c.moneda, c.pagado::text,
           (c.retencion_itbis + c.retencion_isr)::text AS retenciones, c.forma_pago, c.referencia, c.anulado,
           (SELECT string_agg(co.ncf, ', ' ORDER BY co.ncf) FROM aplicaciones_pago a JOIN compras co ON co.id = a.compra_id WHERE a.pago_id = c.id) AS compras
      FROM pagos c JOIN proveedores pr ON pr.id = c.proveedor_id
     WHERE to_char(c.fecha, 'YYYY-MM') = ${mes}
       AND (${q} = '' OR pr.nombre ILIKE ${"%" + q + "%"} OR c.referencia ILIKE ${"%" + q + "%"} OR c.numero::text = ${q})
     ORDER BY c.fecha DESC, c.numero DESC`;
}
