import { createHash } from "node:crypto";
import { TIPOS_GESTION } from "./bitacora.ts";
import { db, type Tx } from "./db.ts";
import { manualesDe } from "./declaraciones.ts";
import { periodoDe } from "./formatos-dgii.ts";
import { nombrePeriodo } from "./igualas.ts";
import { calcularIr17 } from "./ir17.ts";
import { calcularIt1 } from "./it1.ts";
import { estadoDelMes, finDeMes, vencimientos } from "./impuestos-mes.ts";
import { deCentavos, verFecha, verMonto } from "./montos.ts";
import type { Tabla } from "./exportar.ts";

// Bloque 4, entrega 4b: el reporte mensual al cliente (Documento maestro, sección 8), armado con lo que ya está registrado.
// Al aprobarlo se guarda tal cual (`datos`); si después cambia algo del mes, la huella avisa.

export type Monto = { cantidad: number; subtotal: string; itbis: string; total: string };
export type DatosReporte = {
  periodo: string; mes: string; empresa: string;
  servicios: { fecha: string; tipo: string; descripcion: string; estado: string }[];
  ventas: Monto; notas: Monto; compras: Monto;
  itbis: { fuente: "presentado" | "calculado"; cobrado: string; deducible: string; aPagar: string; saldoFavor: string; vence: string } | null;
  retenciones: { itbis: string; isr: string; venceItbis: string; venceIsr: string } | null;
  declaraciones: { nombre: string; estado: string; monto: string | null; vence: string }[];
  notificaciones: { tipo: string; concepto: string; monto: string; fechaLimite: string; estado: string }[];
  pendientes: string[];
  cuenta: { saldo: string; facturas: { ncf: string; fecha: string; total: string; saldo: string; detalle: string }[] } | null;
};

export const ESTADOS_REPORTE: Record<string, string> = { borrador: "En preparación", revisado: "Revisado", aprobado: "Aprobado", enviado: "Enviado" };
const ESTADO_DECLARACION: Record<string, string> = { presentada: "Presentada", en_cero: "Presentada en cero", pendiente: "Pendiente", vencida: "Vencida sin presentar" };
const ESTADO_NOTIFICACION: Record<string, string> = { pendiente: "Por enviar", enviada: "Enviada, sin pagar", pagada: "Pagada" };

export const huellaReporte = (d: DatosReporte) => createHash("sha256").update(JSON.stringify(d)).digest("hex");

async function montos(tx: Tx, sql: "ventas" | "notas" | "compras", desde: string, hasta: string): Promise<Monto> {
  const [m] = sql === "compras"
    ? await tx<{ cantidad: number; subtotal: string; itbis: string; total: string }[]>`
        SELECT count(*)::int AS cantidad, COALESCE(sum(subtotal * tasa), 0)::numeric(18,2)::text AS subtotal,
               COALESCE(sum(itbis * tasa), 0)::numeric(18,2)::text AS itbis, COALESCE(sum(total * tasa), 0)::numeric(18,2)::text AS total
          FROM compras WHERE estado = 'registrada' AND NOT anulada AND tipo_comprobante NOT IN ('B04', 'E34') AND fecha BETWEEN ${desde} AND ${hasta}`
    : await tx<{ cantidad: number; subtotal: string; itbis: string; total: string }[]>`
        SELECT count(*)::int AS cantidad, COALESCE(sum(subtotal * tasa), 0)::numeric(18,2)::text AS subtotal,
               COALESCE(sum(itbis * tasa), 0)::numeric(18,2)::text AS itbis, COALESCE(sum(total * tasa), 0)::numeric(18,2)::text AS total
          FROM facturas WHERE estado = 'emitida' AND NOT anulada AND (tipo_ncf IN ('B04', 'E34')) = ${sql === "notas"} AND fecha BETWEEN ${desde} AND ${hasta}`;
  return m;
}

// Facturas de la empresa propia a este cliente (su cuenta con la firma): se leen con la conexión dueña fijando la propia.
export async function cuentaConFirma(empresaId: string, periodo: string, hasta: string): Promise<DatosReporte["cuenta"]> {
  const [f] = await db()<{ propia: string | null }[]>`
    SELECT fi.empresa_propia_id AS propia FROM empresas e JOIN firmas fi ON fi.id = e.firma_id WHERE e.id = ${empresaId}`;
  if (!f?.propia || f.propia === empresaId) return null;
  return db().begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${f.propia}, true)`;
    const [c] = await tx<{ id: string }[]>`SELECT id FROM clientes WHERE empresa_id = ${f.propia} AND empresa_vinculada_id = ${empresaId}`;
    if (!c) return null;
    const facturas = await tx<{ ncf: string; fecha: string; total: string; saldo: string; detalle: string; delMes: boolean }[]>`
      SELECT f.ncf, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, f.total::text, COALESCE(s.saldo, 0)::text AS saldo,
             COALESCE((SELECT string_agg(l.descripcion, ' · ' ORDER BY l.orden) FROM lineas_factura l WHERE l.factura_id = f.id), '') AS detalle,
             (f.periodo = ${periodo} OR (f.periodo IS NULL AND to_char(f.fecha, 'YYYYMM') = ${periodo})) AS "delMes"
        FROM facturas f LEFT JOIN saldos_factura s ON s.factura_id = f.id
       WHERE f.empresa_id = ${f.propia} AND f.cliente_id = ${c.id} AND f.estado = 'emitida' AND NOT f.anulada AND f.tipo_ncf NOT IN ('B04', 'E34')
         AND f.fecha <= (${hasta}::date + 31)
       ORDER BY f.fecha`;
    const saldo = facturas.reduce((s, x) => s + BigInt(Math.round(Number(x.saldo) * 100)), 0n);
    return {
      saldo: deCentavos(saldo),
      facturas: facturas.filter((x) => x.delMes || Number(x.saldo) > 0).map(({ ncf, fecha, total, saldo, detalle }) => ({ ncf, fecha, total, saldo, detalle })),
    };
  }) as Promise<DatosReporte["cuenta"]>;
}

// Corre en conEmpresa (la del cliente).
export async function armarReporte(tx: Tx, empresaId: string, periodo: string, hoy: string): Promise<DatosReporte> {
  const p = periodoDe(periodo);
  if (!p) throw new Error("Período no válido");
  const desde = p.inicio, hasta = finDeMes(periodo);
  const [{ nombre }] = await tx<{ nombre: string }[]>`SELECT nombre FROM empresas WHERE id = empresa_actual()`;
  const servicios = (await tx<{ fecha: string; tipo: string; descripcion: string; estado: string }[]>`
    SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, tipo, descripcion, estado FROM gestiones
     WHERE fecha BETWEEN ${desde} AND ${hasta} ORDER BY fecha, creado`)
    .map((g) => ({ ...g, tipo: TIPOS_GESTION[g.tipo] ?? g.tipo }));
  const mes = await estadoDelMes(tx, periodo, hoy);
  const declara = new Set(mes.declaraciones.map((d) => d.formato));
  const presentadas = new Map((await tx<{ formato: string; casillas: Record<string, string> | null }[]>`
    SELECT formato, casillas FROM envios_dgii WHERE periodo = ${periodo} AND formato IN ('IT-1', 'IR-17')`).map((e) => [e.formato, e.casillas]));
  // Una declaración presentada manda (sus casillas guardadas); si no, se calcula con lo registrado.
  const casillas = async (f: "IT-1" | "IR-17"): Promise<[Record<string, string>, "presentado" | "calculado"]> => {
    const guardadas = presentadas.get(f);
    if (guardadas) return [guardadas, "presentado"];
    const r = f === "IT-1" ? await calcularIt1(tx, p, await manualesDe(tx, f, periodo)) : await calcularIr17(tx, p, await manualesDe(tx, f, periodo));
    return [Object.fromEntries(Object.entries(r.valores).map(([k, v]) => [k, deCentavos(v)])), "calculado"];
  };
  let itbis: DatosReporte["itbis"] = null, retenciones: DatosReporte["retenciones"] = null;
  const cero = (x?: string) => x ?? "0.00";
  const fechas = await vencimientos(tx, periodo, ["IT-1", "IR-17"]); // calendario fiscal de la firma (entrega B)
  if (declara.has("IT-1")) {
    const [c, fuente] = await casillas("IT-1");
    itbis = { fuente, cobrado: cero(c.I21), deducible: cero(c.I25), aPagar: cero(c.I38 ?? c.I33), saldoFavor: cero(c.I34), vence: fechas["IT-1"] };
    retenciones = { itbis: cero(c.I67), isr: "0.00", venceItbis: fechas["IT-1"], venceIsr: fechas["IR-17"] };
  }
  if (declara.has("IR-17")) {
    const [c] = await casillas("IR-17");
    retenciones = { ...(retenciones ?? { itbis: "0.00", venceItbis: fechas["IT-1"] }), isr: cero(c.R37), venceIsr: fechas["IR-17"] };
  }
  const notificaciones = (await tx<{ tipo: string; concepto: string | null; monto: string; fecha_limite: string; estado: string }[]>`
    SELECT tipo, concepto, monto::text, to_char(fecha_limite, 'YYYY-MM-DD') AS fecha_limite, estado FROM notificaciones_pago
     WHERE periodo = ${periodo} OR (estado <> 'pagada' AND fecha_limite <= ${hasta}::date + 31) ORDER BY fecha_limite`)
    .map((n) => ({ tipo: n.tipo.toUpperCase(), concepto: n.concepto ?? "", monto: n.monto, fechaLimite: n.fecha_limite, estado: ESTADO_NOTIFICACION[n.estado] ?? n.estado }));
  const cuenta = await cuentaConFirma(empresaId, periodo, hasta);

  const pendientes: string[] = [];
  const [{ recibidos }] = await tx<{ recibidos: number }[]>`
    SELECT count(*)::int AS recibidos FROM recepciones WHERE subido_en >= ${desde}::date AND subido_en < ${hasta}::date + 1`;
  if (recibidos === 0) pendientes.push(`No recibimos documentos de compras y gastos de ${nombrePeriodo(periodo)}.`);
  if (mes.corregir) pendientes.push(`${mes.corregir} factura${mes.corregir > 1 ? "s" : ""} de compra con datos por corregir.`);
  for (const n of notificaciones.filter((x) => x.estado !== "Pagada" && x.fechaLimite < hoy)) {
    pendientes.push(`Notificación ${n.tipo}${n.concepto ? ` (${n.concepto})` : ""} por RD$${verMonto(n.monto)}: venció el ${verFecha(n.fechaLimite)} y no consta el pago.`);
  }
  if (cuenta && Number(cuenta.saldo) > 0) pendientes.push(`Saldo pendiente con la firma: RD$${verMonto(cuenta.saldo)}.`);

  return {
    periodo, mes: nombrePeriodo(periodo), empresa: nombre, servicios,
    ventas: await montos(tx, "ventas", desde, hasta), notas: await montos(tx, "notas", desde, hasta), compras: await montos(tx, "compras", desde, hasta),
    itbis, retenciones,
    declaraciones: mes.declaraciones.map((d) => ({ nombre: d.nombre, estado: ESTADO_DECLARACION[d.estado], monto: d.monto, vence: d.vence })),
    notificaciones, pendientes, cuenta,
  };
}

// El PDF (con la marca de la firma: es un documento de Empire, no del cliente) en una sola tabla por secciones.
export function tablaReporte(d: DatosReporte, notas: string | null, base: { empresa: string; generado: string }): Tabla {
  const filas: (string | number)[][] = [];
  const negritas: number[] = [];
  const seccion = (t: string) => { negritas.push(filas.length); filas.push([t, "", ""]); };
  seccion("1. Servicios realizados en el mes");
  if (d.servicios.length === 0) filas.push(["Sin gestiones anotadas", "", ""]);
  for (const s of d.servicios) filas.push([`${verFecha(s.fecha)} · ${s.tipo}`, s.descripcion, ""]);
  seccion("2. Facturas del mes");
  filas.push(["Facturas de ventas emitidas", `${d.ventas.cantidad} · ITBIS RD$${verMonto(d.ventas.itbis)}`, d.ventas.total]);
  if (d.notas.cantidad) filas.push(["Notas de crédito", String(d.notas.cantidad), `-${d.notas.total}`]);
  filas.push(["Facturas de compras recibidas", `${d.compras.cantidad} · ITBIS RD$${verMonto(d.compras.itbis)}`, d.compras.total]);
  seccion("3. ITBIS");
  if (d.itbis) {
    filas.push(["ITBIS facturado (cobrado)", "", d.itbis.cobrado], ["ITBIS adelantado (deducible)", "", d.itbis.deducible]);
    filas.push([Number(d.itbis.aPagar) > 0 ? "ITBIS a pagar" : "Saldo a favor", `${d.itbis.fuente === "presentado" ? "según el IT-1 presentado" : "calculado con lo registrado"} · vence ${verFecha(d.itbis.vence)}`,
      Number(d.itbis.aPagar) > 0 ? d.itbis.aPagar : d.itbis.saldoFavor]);
  } else filas.push(["No declara ITBIS (IT-1) según su perfil fiscal", "", ""]);
  seccion("4. Retenciones e ISR");
  if (d.retenciones) {
    filas.push(["Retenciones de ITBIS a pagar", `vence ${verFecha(d.retenciones.venceItbis)}`, d.retenciones.itbis]);
    filas.push(["Retenciones de ISR (IR-17) a pagar", `vence ${verFecha(d.retenciones.venceIsr)}`, d.retenciones.isr]);
  } else filas.push(["Sin retenciones que declarar", "", ""]);
  seccion("5. Declaraciones y notificaciones");
  for (const x of d.declaraciones) filas.push([x.nombre, x.estado + (x.estado.startsWith("Presentada") ? "" : ` · vence ${verFecha(x.vence)}`), x.monto ?? ""]);
  for (const n of d.notificaciones) filas.push([`Notificación ${n.tipo}${n.concepto ? ` · ${n.concepto}` : ""}`, `${n.estado} · fecha límite ${verFecha(n.fechaLimite)}`, n.monto]);
  seccion("6. Pendientes del cliente");
  if (d.pendientes.length === 0) filas.push(["Nada pendiente", "", ""]);
  for (const t of d.pendientes) filas.push([t, "", ""]);
  if (d.cuenta) {
    seccion("7. Su cuenta con la firma");
    for (const f of d.cuenta.facturas) filas.push([`Factura ${f.ncf} del ${verFecha(f.fecha)}`, `${f.detalle} · pendiente RD$${verMonto(f.saldo)}`, f.total]);
    filas.push(["Saldo pendiente", "", d.cuenta.saldo]);
    negritas.push(filas.length - 1);
  }
  if (notas?.trim()) { seccion("Notas"); filas.push([notas.trim().split(/\s+/).join(" "), "", ""]); }
  return {
    ...base, titulo: `Reporte mensual · ${d.mes}`, detalle: `${d.empresa} · lo que hicimos por usted en ${d.mes}`, negritas,
    columnas: [{ titulo: "Concepto", ancho: 42 }, { titulo: "Detalle", ancho: 60 }, { titulo: "RD$", num: true }],
    filas,
  };
}
