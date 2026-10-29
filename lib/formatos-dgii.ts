import { createHash } from "node:crypto";
import { aPesos, tasaDeTexto } from "./calculos.ts";
import type { Tx } from "./db";
import { aCentavos } from "./montos.ts";

// Formatos de envío de datos de la DGII (Norma General 07-2018): 606 compras, 607 ventas y 608 comprobantes anulados.
// Campos, orden, códigos y límites según los instructivos de la DGII: 606 (febrero 2026), 607 (diciembre 2025) y
// 608 (marzo 2026). Todo se arma desde lo registrado; los montos van en pesos (lo de dólares, a la tasa del documento).
// Los códigos van con dos dígitos (01 a 11, 01 a 07…), como se guardan; el tipo de identificación y el de retención de
// ISR, con uno, como los numera el instructivo.

export const LIMITE_REGISTROS = { "606": 10000, "607": 65000, "608": 4999 } as const;
export type Formato = keyof typeof LIMITE_REGISTROS;
export const FORMATOS: Record<Formato, string> = {
  "606": "Compras de bienes y servicios", "607": "Ventas de bienes y servicios", "608": "Comprobantes anulados",
};
// Norma General 10-18: desde julio 2018 las facturas de consumo van una por una en el 607 solo desde RD$250,000.
export const CONSUMO_DETALLADO_DESDE = 25_000_000n;

export type Aviso = { nivel: "error" | "aviso"; texto: string; enlace?: string };

// ───── Período (AAAAMM, como lo pide la DGII) ─────

export type Periodo = { periodo: string; inicio: string; fin: string; vence: string };

export function periodoDe(p: string): Periodo | null {
  const m = /^(\d{4})(0[1-9]|1[0-2])$/.exec(p);
  if (!m) return null;
  const [a, mes] = [Number(m[1]), Number(m[2])];
  const ultimo = new Date(Date.UTC(a, mes, 0)).getUTCDate();
  const siguiente = mes === 12 ? `${a + 1}-01` : `${a}-${String(mes + 1).padStart(2, "0")}`;
  // Se envía a más tardar el día 15 del mes siguiente (Norma General 07-2018, art. 8).
  return { periodo: p, inicio: `${m[1]}-${m[2]}-01`, fin: `${m[1]}-${m[2]}-${ultimo}`, vence: `${siguiente}-15` };
}

// Por defecto, el mes anterior: es el que toca enviar.
export function periodoAnterior(hoy: string): string {
  const [a, m] = hoy.split("-").map(Number);
  return m === 1 ? `${a - 1}12` : `${a}${String(m - 1).padStart(2, "0")}`;
}

// ───── Utilidades ─────

export const fechaDgii = (f: string | null | undefined) => (f ? f.replace(/-/g, "") : "");

// Reparte un monto en proporción a unos pesos, sin perder ni sumar centavos (método del mayor residuo).
export function repartir(total: bigint, pesos: bigint[]): bigint[] {
  const suma = pesos.reduce((s, p) => s + p, 0n);
  if (suma <= 0n) return pesos.map((_, i) => (i === 0 ? total : 0n));
  const base = pesos.map((p) => (total * p) / suma);
  const residuos = pesos.map((p, i) => ({ i, r: (total * p) % suma }));
  let falta = total - base.reduce((s, b) => s + b, 0n);
  residuos.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (const { i } of residuos) {
    if (falta <= 0n) break;
    base[i] += 1n;
    falta -= 1n;
  }
  return base;
}

export const ncfValido = (ncf: string) => /^B\d{10}$/.test(ncf) || /^E\d{12}$/.test(ncf); // 11 o 13 posiciones
export const esElectronico = (ncf: string) => ncf.startsWith("E");

// Tipo de identificación: 1 RNC, 2 cédula, 3 pasaporte o ID tributaria (este último solo en el 607).
export function tipoIdentificacion(tipo: string | null, numero: string | null): "1" | "2" | "3" | null {
  if (!numero) return null;
  if (tipo === "pasaporte") return "3";
  if (/^\d{9}$/.test(numero)) return "1";
  if (/^\d{11}$/.test(numero)) return "2";
  return null;
}

// Forma de pago del 606: sin pagos, compra a crédito (04); si solo se saldó con nota de crédito, 06; varias formas, mixto (07).
export function formaPago606(formas: string[], conNota: boolean): string {
  const distintas = [...new Set(formas)];
  if (distintas.length === 0) return conNota ? "06" : "04";
  if (distintas.length === 1 && !conNota) return distintas[0];
  return "07";
}

// Huella de lo enviado: si después cambia algo del mes, la huella cambia y se avisa.
export const huella = (filas: unknown[]) => createHash("sha256").update(JSON.stringify(filas, (_, v) => (typeof v === "bigint" ? v.toString() : v))).digest("hex");

// ───── Pagos y cobros de cada documento (para fecha de pago, forma de pago y retenciones) ─────

type Movimiento = { documento: string; pago: string; fecha: string; forma: string; aplicado: bigint; itbis: bigint; isr: bigint; codigoIsr: number | null; repartido: boolean };

// Une cada pago (o cobro) con los documentos a los que se aplicó y reparte sus retenciones entre ellos según lo aplicado.
function movimientos(filas: { documento: string; pago: string; fecha: string; forma: string; aplicado: string; ret_itbis: string; ret_isr: string; codigo_isr: number | null }[]): Movimiento[] {
  const porPago = new Map<string, typeof filas>();
  for (const f of filas) porPago.set(f.pago, [...(porPago.get(f.pago) ?? []), f]);
  const salida: Movimiento[] = [];
  for (const grupo of porPago.values()) {
    const pesos = grupo.map((g) => aCentavos(g.aplicado));
    const itbis = repartir(aCentavos(grupo[0].ret_itbis), pesos);
    const isr = repartir(aCentavos(grupo[0].ret_isr), pesos);
    const repartido = grupo.length > 1 && (itbis.some((x) => x > 0n) || isr.some((x) => x > 0n));
    grupo.forEach((g, i) => salida.push({
      documento: g.documento, pago: g.pago, fecha: g.fecha, forma: g.forma, aplicado: pesos[i], itbis: itbis[i], isr: isr[i],
      codigoIsr: g.codigo_isr, repartido,
    }));
  }
  return salida;
}

// ───── 606: compras de bienes y servicios ─────

export type Fila606 = {
  rnc: string; tipoId: string; tipoBienes: string; ncf: string; ncfModificado: string; fechaComprobante: string; fechaPago: string;
  servicios: bigint; bienes: bigint; totalFacturado: bigint; itbisFacturado: bigint; itbisRetenido: bigint; itbisProporcionalidad: bigint;
  itbisCosto: bigint; itbisAdelantar: bigint; itbisPercibido: bigint; tipoRetencionIsr: string; retencionRenta: bigint; isrPercibido: bigint;
  isc: bigint; otros: bigint; propina: bigint; formaPago: string;
};
export type Detalle606 = Fila606 & { id: string; proveedor: string; reenvio: boolean; b17: boolean };

// Columnas del 606 en el orden del instructivo (campos 1 a 23).
export const COLUMNAS_606: [keyof Fila606, string, "texto" | "monto"][] = [
  ["rnc", "RNC o Cédula", "texto"], ["tipoId", "Tipo Id", "texto"], ["tipoBienes", "Tipo de Bienes y Servicios Comprados", "texto"],
  ["ncf", "NCF", "texto"], ["ncfModificado", "NCF o Documento Modificado", "texto"], ["fechaComprobante", "Fecha Comprobante", "texto"],
  ["fechaPago", "Fecha Pago", "texto"], ["servicios", "Monto Facturado en Servicios", "monto"], ["bienes", "Monto Facturado en Bienes", "monto"],
  ["totalFacturado", "Total Monto Facturado", "monto"], ["itbisFacturado", "ITBIS Facturado", "monto"], ["itbisRetenido", "ITBIS Retenido", "monto"],
  ["itbisProporcionalidad", "ITBIS sujeto a Proporcionalidad (Art. 349)", "monto"], ["itbisCosto", "ITBIS llevado al Costo", "monto"],
  ["itbisAdelantar", "ITBIS por Adelantar", "monto"], ["itbisPercibido", "ITBIS percibido en compras", "monto"],
  ["tipoRetencionIsr", "Tipo de Retención en ISR", "texto"], ["retencionRenta", "Monto Retención Renta", "monto"],
  ["isrPercibido", "ISR Percibido en compras", "monto"], ["isc", "Impuesto Selectivo al Consumo", "monto"], ["otros", "Otros Impuestos/Tasas", "monto"],
  ["propina", "Monto Propina Legal", "monto"], ["formaPago", "Forma de Pago", "texto"],
];

type Empresa = { rnc: string | null; contribuye_itbis: boolean };

export async function formato606(tx: Tx, p: Periodo, empresa: Empresa): Promise<{ filas: Detalle606[]; avisos: Aviso[] }> {
  // Compras del mes y, además, las de meses anteriores a las que este mes se les hizo una retención al pagarlas: el
  // instructivo pide reenviar ese NCF con su fecha original para reportar la retención.
  const compras = await tx<{
    id: string; tipo: string; ncf: string; modificado: string | null; fecha: string; tipo_gasto: string; tasa: string; al_costo: boolean;
    proveedor: string; rnc: string | null; tipo_identificacion: string | null; servicios: string; bienes: string; itbis: string;
    isc: string; propina: string; otro: string; reenvio: boolean;
  }[]>`
    SELECT c.id, c.tipo_comprobante AS tipo, c.ncf, o.ncf AS modificado, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.tipo_gasto,
           c.tasa::text, c.itbis_al_costo AS al_costo, pr.nombre AS proveedor, pr.rnc, pr.tipo_identificacion,
           (SELECT COALESCE(sum(l.subtotal) FILTER (WHERE l.clase = 'servicio'), 0) FROM lineas_compra l WHERE l.compra_id = c.id)::text AS servicios,
           (SELECT COALESCE(sum(l.subtotal) FILTER (WHERE l.clase = 'bien'), 0) FROM lineas_compra l WHERE l.compra_id = c.id)::text AS bienes,
           c.itbis::text,
           (SELECT COALESCE(sum(i.monto) FILTER (WHERE i.tipo = 'isc'), 0) FROM impuestos_linea_compra i WHERE i.compra_id = c.id)::text AS isc,
           (SELECT COALESCE(sum(i.monto) FILTER (WHERE i.tipo = 'propina'), 0) FROM impuestos_linea_compra i WHERE i.compra_id = c.id)::text AS propina,
           (SELECT COALESCE(sum(i.monto) FILTER (WHERE i.tipo = 'otro'), 0) FROM impuestos_linea_compra i WHERE i.compra_id = c.id)::text AS otro,
           c.fecha < ${p.inicio}::date AS reenvio
      FROM compras c JOIN proveedores pr ON pr.id = c.proveedor_id LEFT JOIN compras o ON o.id = c.compra_origen_id
     WHERE c.estado = 'registrada' AND NOT c.anulada
       AND (c.fecha BETWEEN ${p.inicio} AND ${p.fin}
            OR (c.fecha < ${p.inicio} AND EXISTS (
                 SELECT 1 FROM aplicaciones_pago a JOIN pagos pg ON pg.id = a.pago_id
                  WHERE a.compra_id = c.id AND NOT pg.anulado AND pg.fecha BETWEEN ${p.inicio} AND ${p.fin}
                    AND pg.retencion_itbis + pg.retencion_isr > 0)))
     ORDER BY c.fecha, c.ncf`;
  const ids = compras.map((c) => c.id);
  const pagos = movimientos(await tx`
    SELECT a.compra_id AS documento, pg.id AS pago, to_char(pg.fecha, 'YYYY-MM-DD') AS fecha, pg.forma_pago AS forma, a.monto::text AS aplicado,
           pg.retencion_itbis::text AS ret_itbis, pg.retencion_isr::text AS ret_isr,
           (SELECT min(r.codigo_606) FROM retenciones_pago r WHERE r.pago_id = pg.id AND r.impuesto = 'isr') AS codigo_isr
      FROM aplicaciones_pago a JOIN pagos pg ON pg.id = a.pago_id
     WHERE NOT pg.anulado AND pg.fecha <= ${p.fin}
       AND pg.id IN (SELECT a2.pago_id FROM aplicaciones_pago a2 WHERE a2.compra_id = ANY(${ids}::uuid[]))`);
  const conNota = new Set((await tx<{ id: string }[]>`
    SELECT DISTINCT compra_origen_id AS id FROM compras
     WHERE compra_origen_id = ANY(${ids}::uuid[]) AND estado = 'registrada' AND NOT anulada AND fecha <= ${p.fin}`).map((r) => r.id));

  const avisos: Aviso[] = [];
  const filas: Detalle606[] = [];
  for (const c of compras) {
    const enlace = `/compras/${c.id}`;
    const tasa = tasaDeTexto(c.tasa);
    const pesos = (m: string) => aPesos(aCentavos(m), tasa);
    const suyos = pagos.filter((m) => m.documento === c.id);
    const delMes = suyos.filter((m) => m.fecha >= p.inicio);
    const b17 = c.tipo === "B17";
    // B17 (pagos al exterior): se usa el RNC o cédula de la propia empresa (instructivo del 606).
    const rnc = b17 ? empresa.rnc ?? "" : c.rnc ?? "";
    const tipoId = tipoIdentificacion(b17 ? null : c.tipo_identificacion, rnc);
    if (!tipoId || tipoId === "3") avisos.push({ nivel: "error", texto: `${c.ncf} (${c.proveedor}): el 606 pide RNC (9 dígitos) o cédula (11 dígitos) ${b17 ? "de la empresa" : "del proveedor"}.`, enlace: b17 ? "/empresa" : enlace });
    if (!ncfValido(c.ncf)) avisos.push({ nivel: "error", texto: `${c.ncf}: el NCF debe tener 11 posiciones (serie B) o 13 (serie E).`, enlace });
    const itbis = pesos(c.itbis);
    const costo = c.al_costo || !empresa.contribuye_itbis ? itbis : 0n;
    const itbisRetenido = delMes.reduce((s, m) => s + aPesos(m.itbis, tasa), 0n);
    const retencionRenta = delMes.reduce((s, m) => s + aPesos(m.isr, tasa), 0n);
    const codigos = [...new Set(delMes.filter((m) => m.isr > 0n).map((m) => m.codigoIsr))];
    if (delMes.some((m) => m.repartido)) {
      avisos.push({ nivel: "aviso", texto: `${c.ncf}: un mismo pago con retenciones cubrió varias compras; la retención se repartió según lo aplicado a cada una. Revísala.`, enlace });
    }
    if (codigos.length > 1) avisos.push({ nivel: "aviso", texto: `${c.ncf}: tiene retenciones de ISR de tipos distintos; el 606 admite uno por NCF (se tomó el primero).`, enlace });
    if (retencionRenta > 0n && codigos[0] == null) avisos.push({ nivel: "error", texto: `${c.ncf}: la retención de ISR no tiene tipo de retención (configúralo en Retenciones).`, enlace: "/fiscal/retenciones" });
    const servicios = pesos(c.servicios), bienes = pesos(c.bienes);
    filas.push({
      id: c.id, proveedor: c.proveedor, reenvio: c.reenvio, b17,
      rnc, tipoId: tipoId ?? "", tipoBienes: c.tipo_gasto, ncf: c.ncf, ncfModificado: c.modificado ?? "",
      fechaComprobante: fechaDgii(c.fecha),
      // Fecha del último pago hasta el cierre del mes; sin pagos, en blanco.
      fechaPago: fechaDgii(suyos.map((m) => m.fecha).sort().at(-1)),
      servicios, bienes, totalFacturado: servicios + bienes, itbisFacturado: itbis, itbisRetenido, itbisProporcionalidad: 0n,
      itbisCosto: costo, itbisAdelantar: itbis - costo, itbisPercibido: 0n,
      tipoRetencionIsr: retencionRenta > 0n && codigos[0] != null ? String(codigos[0]) : "", retencionRenta, isrPercibido: 0n,
      isc: pesos(c.isc), otros: pesos(c.otro), propina: pesos(c.propina),
      formaPago: formaPago606(suyos.map((m) => m.forma), conNota.has(c.id)),
    });
  }
  if (filas.some((f) => f.reenvio)) {
    avisos.push({ nivel: "aviso", texto: "Incluye compras de meses anteriores que se pagaron este mes con retención: se reenvían con su fecha original para reportar la retención, como indica el instructivo." });
  }
  if (filas.length > LIMITE_REGISTROS["606"]) avisos.push({ nivel: "error", texto: `El 606 admite hasta ${LIMITE_REGISTROS["606"]} registros por archivo.` });
  return { filas, avisos };
}

// ───── 607: ventas de bienes y servicios ─────

export type Fila607 = {
  rnc: string; tipoId: string; ncf: string; ncfModificado: string; tipoIngreso: string; fechaComprobante: string; fechaRetencion: string;
  montoFacturado: bigint; itbisFacturado: bigint; itbisRetenido: bigint; itbisPercibido: bigint; retencionRenta: bigint; isrPercibido: bigint;
  isc: bigint; otros: bigint; propina: bigint; efectivo: bigint; cheque: bigint; tarjeta: bigint; credito: bigint; bonos: bigint;
  permuta: bigint; otrasFormas: bigint;
};
export type Detalle607 = Fila607 & { id: string; cliente: string; reenvio: boolean };
export type ResumenConsumo = { cantidad: number; montoFacturado: bigint; itbis: bigint; isc: bigint; otros: bigint; propina: bigint; total: bigint;
  efectivo: bigint; cheque: bigint; tarjeta: bigint; credito: bigint; bonos: bigint; permuta: bigint; otrasFormas: bigint };

export const COLUMNAS_607: [keyof Fila607, string, "texto" | "monto"][] = [
  ["rnc", "RNC / Cédula o Pasaporte", "texto"], ["tipoId", "Tipo Identificación", "texto"], ["ncf", "Número Comprobante Fiscal", "texto"],
  ["ncfModificado", "Número Comprobante Fiscal Modificado", "texto"], ["tipoIngreso", "Tipo de Ingreso", "texto"],
  ["fechaComprobante", "Fecha Comprobante", "texto"], ["fechaRetencion", "Fecha de Retención", "texto"], ["montoFacturado", "Monto Facturado", "monto"],
  ["itbisFacturado", "ITBIS Facturado", "monto"], ["itbisRetenido", "ITBIS Retenido por Terceros", "monto"], ["itbisPercibido", "ITBIS Percibido", "monto"],
  ["retencionRenta", "Retención Renta por Terceros", "monto"], ["isrPercibido", "ISR Percibido", "monto"], ["isc", "Impuesto Selectivo al Consumo", "monto"],
  ["otros", "Otros Impuestos/Tasas", "monto"], ["propina", "Monto Propina Legal", "monto"], ["efectivo", "Efectivo", "monto"],
  ["cheque", "Cheque/Transferencia/Depósito", "monto"], ["tarjeta", "Tarjeta Débito/Crédito", "monto"], ["credito", "Venta a Crédito", "monto"],
  ["bonos", "Bonos o Certificados de Regalo", "monto"], ["permuta", "Permuta", "monto"], ["otrasFormas", "Otras Formas de Ventas", "monto"],
];

// Forma de cobro registrada → columna del 607.
const COLUMNA_COBRO: Record<string, "efectivo" | "cheque" | "tarjeta" | "otrasFormas"> = {
  efectivo: "efectivo", transferencia: "cheque", cheque: "cheque", tarjeta: "tarjeta", otro: "otrasFormas",
};

export async function formato607(tx: Tx, p: Periodo): Promise<{ filas: Detalle607[]; consumo: ResumenConsumo; avisos: Aviso[] }> {
  const facturas = await tx<{
    id: string; tipo: string; ncf: string; modificado: string | null; tipo_ingreso: string; fecha: string; tasa: string; subtotal: string;
    itbis: string; total: string; cliente: string; rnc: string | null; tipo_identificacion: string | null; isc: string; propina: string; otro: string;
    reenvio: boolean;
  }[]>`
    SELECT f.id, f.tipo_ncf AS tipo, f.ncf, o.ncf AS modificado, f.tipo_ingreso, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, f.tasa::text,
           f.subtotal::text, f.itbis::text, f.total::text, cl.nombre AS cliente, cl.rnc, cl.tipo_identificacion,
           (SELECT COALESCE(sum(i.monto) FILTER (WHERE i.tipo = 'isc'), 0) FROM impuestos_linea_factura i WHERE i.factura_id = f.id)::text AS isc,
           (SELECT COALESCE(sum(i.monto) FILTER (WHERE i.tipo = 'propina'), 0) FROM impuestos_linea_factura i WHERE i.factura_id = f.id)::text AS propina,
           (SELECT COALESCE(sum(i.monto) FILTER (WHERE i.tipo = 'otro'), 0) FROM impuestos_linea_factura i WHERE i.factura_id = f.id)::text AS otro,
           f.fecha < ${p.inicio}::date AS reenvio
      FROM facturas f JOIN clientes cl ON cl.id = f.cliente_id LEFT JOIN facturas o ON o.id = f.factura_origen_id
     WHERE f.estado = 'emitida' AND NOT f.anulada AND f.ncf NOT LIKE 'E%'
       AND (f.fecha BETWEEN ${p.inicio} AND ${p.fin}
            OR (f.fecha < ${p.inicio} AND EXISTS (
                 SELECT 1 FROM aplicaciones_cobro a JOIN cobros c ON c.id = a.cobro_id
                  WHERE a.factura_id = f.id AND NOT c.anulado AND c.fecha BETWEEN ${p.inicio} AND ${p.fin}
                    AND c.retencion_itbis + c.retencion_isr > 0)))
     ORDER BY f.fecha, f.ncf`;
  const ids = facturas.map((f) => f.id);
  const cobros = movimientos(await tx`
    SELECT a.factura_id AS documento, c.id AS pago, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.forma_pago AS forma, a.monto::text AS aplicado,
           c.retencion_itbis::text AS ret_itbis, c.retencion_isr::text AS ret_isr, NULL::int AS codigo_isr
      FROM aplicaciones_cobro a JOIN cobros c ON c.id = a.cobro_id
     WHERE NOT c.anulado AND c.fecha <= ${p.fin}
       AND c.id IN (SELECT a2.cobro_id FROM aplicaciones_cobro a2 WHERE a2.factura_id = ANY(${ids}::uuid[]))`);

  const avisos: Aviso[] = [];
  const filas: Detalle607[] = [];
  const consumo: ResumenConsumo = { cantidad: 0, montoFacturado: 0n, itbis: 0n, isc: 0n, otros: 0n, propina: 0n, total: 0n,
    efectivo: 0n, cheque: 0n, tarjeta: 0n, credito: 0n, bonos: 0n, permuta: 0n, otrasFormas: 0n };
  let notas = false;
  for (const f of facturas) {
    const enlace = `/facturas/${f.id}`;
    const tasa = tasaDeTexto(f.tasa);
    const pesos = (m: string) => aPesos(aCentavos(m), tasa);
    const total = pesos(f.total);
    const suyos = cobros.filter((m) => m.documento === f.id);
    const delMes = suyos.filter((m) => m.fecha >= p.inicio);
    // Formas de cobro hasta el cierre del mes (con impuestos); lo que falta por cobrar es venta a crédito. Deben sumar el total.
    const formas = { efectivo: 0n, cheque: 0n, tarjeta: 0n, credito: 0n, bonos: 0n, permuta: 0n, otrasFormas: 0n };
    const nota = f.tipo === "B04";
    if (nota) {
      notas = true;
      formas.credito = total;
    } else {
      for (const m of suyos) formas[COLUMNA_COBRO[m.forma] ?? "otrasFormas"] += aPesos(m.aplicado, tasa);
      const cobrado = formas.efectivo + formas.cheque + formas.tarjeta + formas.otrasFormas;
      formas.credito = total > cobrado ? total - cobrado : 0n;
      if (cobrado > total) formas.otrasFormas -= cobrado - total; // diferencia cambiaria en dólares: se ajusta para cuadrar
    }
    const conRetencion = delMes.filter((m) => m.itbis > 0n || m.isr > 0n);
    if (delMes.some((m) => m.repartido)) {
      avisos.push({ nivel: "aviso", texto: `${f.ncf}: un mismo cobro con retenciones cubrió varias facturas; la retención se repartió según lo aplicado a cada una. Revísala.`, enlace });
    }
    const fila: Detalle607 = {
      id: f.id, cliente: f.cliente, reenvio: f.reenvio,
      rnc: f.rnc ?? "", tipoId: tipoIdentificacion(f.tipo_identificacion, f.rnc) ?? "", ncf: f.ncf, ncfModificado: f.modificado ?? "",
      tipoIngreso: f.tipo_ingreso, fechaComprobante: fechaDgii(f.fecha),
      fechaRetencion: fechaDgii(conRetencion.map((m) => m.fecha).sort().at(-1)),
      montoFacturado: pesos(f.subtotal), itbisFacturado: pesos(f.itbis),
      itbisRetenido: delMes.reduce((s, m) => s + aPesos(m.itbis, tasa), 0n), itbisPercibido: 0n,
      retencionRenta: delMes.reduce((s, m) => s + aPesos(m.isr, tasa), 0n), isrPercibido: 0n,
      isc: pesos(f.isc), otros: pesos(f.otro), propina: pesos(f.propina), ...formas,
    };
    // Facturas de consumo por debajo de RD$250,000: no van una por una; van al «Resumen General de Facturas de Consumo».
    if (f.tipo === "B02" && total < CONSUMO_DETALLADO_DESDE && !f.reenvio) {
      consumo.cantidad += 1;
      consumo.montoFacturado += fila.montoFacturado; consumo.itbis += fila.itbisFacturado; consumo.isc += fila.isc;
      consumo.otros += fila.otros; consumo.propina += fila.propina; consumo.total += total;
      for (const k of ["efectivo", "cheque", "tarjeta", "credito", "bonos", "permuta", "otrasFormas"] as const) consumo[k] += formas[k];
      continue;
    }
    if (!fila.tipoId) {
      avisos.push({ nivel: "error", texto: `${f.ncf} (${f.cliente}): falta el RNC, la cédula o el pasaporte del cliente${f.tipo === "B02" ? " (factura de consumo desde RD$250,000)" : ""}.`, enlace: "/clientes" });
    }
    if (!ncfValido(f.ncf)) avisos.push({ nivel: "error", texto: `${f.ncf}: el NCF debe tener 11 posiciones.`, enlace });
    filas.push(fila);
  }
  if (notas) avisos.push({ nivel: "aviso", texto: "Las notas de crédito (B04) se reportan con su monto en «Venta a Crédito». Confírmalo con la contadora." });
  if (filas.some((f) => f.reenvio)) {
    avisos.push({ nivel: "aviso", texto: "Incluye facturas de meses anteriores con retenciones que te hicieron este mes: se reenvían con su fecha original para reportar la retención." });
  }
  if (filas.length > LIMITE_REGISTROS["607"]) avisos.push({ nivel: "error", texto: `El 607 admite hasta ${LIMITE_REGISTROS["607"]} registros por archivo.` });
  return { filas, consumo, avisos };
}

// ───── 608: comprobantes anulados ─────

export type Fila608 = { ncf: string; fechaComprobante: string; tipoAnulacion: string };
export type Detalle608 = Fila608 & { id: string; origen: "factura" | "compra"; detalle: string };

export const COLUMNAS_608: [keyof Fila608, string, "texto" | "monto"][] = [
  ["ncf", "Número de Comprobante Fiscal", "texto"], ["fechaComprobante", "Fecha de Comprobante", "texto"], ["tipoAnulacion", "Tipo de Anulación", "texto"],
];

// NCF propios anulados en el mes (por la fecha de anulación): facturas y notas de crédito, y compras con comprobante propio.
// Los e-CF no van en el 608: se anulan con nota de crédito o con el servicio de anulación de la DGII.
export async function formato608(tx: Tx, p: Periodo): Promise<{ filas: Detalle608[]; avisos: Aviso[] }> {
  const anulados = await tx<{ id: string; origen: "factura" | "compra"; ncf: string; fecha: string; motivo: string | null; detalle: string }[]>`
    SELECT f.id, 'factura' AS origen, f.ncf, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, f.motivo_anulacion AS motivo, cl.nombre AS detalle
      FROM facturas f JOIN clientes cl ON cl.id = f.cliente_id
     WHERE f.anulada AND f.ncf IS NOT NULL AND f.ncf NOT LIKE 'E%'
       AND to_char(f.anulada_en AT TIME ZONE 'America/Santo_Domingo', 'YYYYMM') = ${p.periodo}
    UNION ALL
    SELECT c.id, 'compra', c.ncf, to_char(c.fecha, 'YYYY-MM-DD'), c.motivo_608, pr.nombre
      FROM compras c JOIN proveedores pr ON pr.id = c.proveedor_id
     WHERE c.anulada AND c.tipo_comprobante IN ('B11', 'B13', 'B17')
       AND to_char(c.anulada_en AT TIME ZONE 'America/Santo_Domingo', 'YYYYMM') = ${p.periodo}
     ORDER BY 3`;
  const avisos: Aviso[] = [];
  const filas = anulados.map((a) => {
    const codigo = /^(0[1-9]|10)$/.test(a.motivo ?? "") ? a.motivo! : "";
    if (!codigo) avisos.push({ nivel: "error", texto: `${a.ncf}: no tiene el tipo de anulación del 608.`, enlace: `/${a.origen === "factura" ? "facturas" : "compras"}/${a.id}` });
    return { id: a.id, origen: a.origen, detalle: a.detalle, ncf: a.ncf, fechaComprobante: fechaDgii(a.fecha), tipoAnulacion: codigo };
  });
  if (filas.length > LIMITE_REGISTROS["608"]) avisos.push({ nivel: "error", texto: `El 608 admite hasta ${LIMITE_REGISTROS["608"]} registros por archivo.` });
  return { filas, avisos };
}

// Solo los campos del formato, en su orden (para la huella y la descarga).
export function soloCampos<T>(filas: T[], columnas: [keyof T, string, string][]): (string | bigint)[][] {
  return filas.map((f) => columnas.map(([k]) => f[k] as unknown as string | bigint));
}

// ───── Armado de un formato con su huella ─────

export type Armado = {
  formato: Formato; columnas: [string, string, "texto" | "monto"][]; filas: (string | bigint)[][]; avisos: Aviso[]; huella: string;
  detalle: (Detalle606 | Detalle607 | Detalle608)[]; consumo?: ResumenConsumo;
};

export async function armarFormato(tx: Tx, formato: Formato, p: Periodo): Promise<Armado> {
  const [empresa] = await tx<Empresa[]>`SELECT rnc, contribuye_itbis FROM empresas WHERE id = empresa_actual()`;
  if (formato === "606") {
    const r = await formato606(tx, p, empresa);
    const filas = soloCampos(r.filas, COLUMNAS_606);
    return { formato, columnas: COLUMNAS_606, filas, avisos: r.avisos, huella: huella(filas), detalle: r.filas };
  }
  if (formato === "607") {
    const r = await formato607(tx, p);
    const filas = soloCampos(r.filas, COLUMNAS_607);
    return { formato, columnas: COLUMNAS_607, filas, avisos: r.avisos, huella: huella([filas, r.consumo]), detalle: r.filas, consumo: r.consumo };
  }
  const r = await formato608(tx, p);
  const filas = soloCampos(r.filas, COLUMNAS_608);
  return { formato, columnas: COLUMNAS_608, filas, avisos: r.avisos, huella: huella(filas), detalle: r.filas };
}

export const esFormato = (f: string): f is Formato => f in LIMITE_REGISTROS;
