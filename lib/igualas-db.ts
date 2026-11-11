import { ErrorContable } from "./asientos.ts";
import type { Tx } from "./db";
import { avisosAcuerdo, fechaFacturacion, igualaDelMes, nombrePeriodo, siguienteFecha, type AcuerdoCalculo, type AvisoIguala } from "./igualas.ts";
import { aCentavos } from "./montos.ts";
import { guardarBorradorFactura, type LineaEntrada, type TipoFactura } from "./ventas.ts";

// Bloque 2, entrega 2b: lo que toca la base. Las igualas y las recurrentes se preparan como borradores (decisión de Patricia del
// 4-nov-2026), con el comprobante habitual del cliente; se emiten después, con la emisión de siempre (NCF y asiento).

export type Acuerdo = AcuerdoCalculo & {
  id: string; cliente_id: string; cliente: string; servicio_id: string; servicio: string; deuda: string | null;
  servicios_incluidos: string[]; notas: string | null; activo: boolean; confirmados: string[];
};

export const listarAcuerdos = (tx: Tx, soloActivos = false) => tx<Acuerdo[]>`
  SELECT a.id, a.cliente_id, c.nombre AS cliente, a.tipo, a.servicio_id, s.nombre AS servicio, a.monto::text, a.tarifa_especial::text,
         to_char(a.tarifa_hasta, 'YYYY-MM-DD') AS tarifa_hasta, a.deuda::text, a.cuota::text, to_char(a.deuda_hasta, 'YYYY-MM-DD') AS deuda_hasta,
         to_char(a.inicio, 'YYYY-MM-DD') AS inicio, a.dia_facturacion, a.servicios_incluidos, a.notas, a.activo,
         COALESCE((SELECT array_agg(to_char(x.aniversario, 'YYYY-MM-DD')) FROM aumentos_iguala x WHERE x.acuerdo_id = a.id), '{}') AS confirmados
    FROM acuerdos_cliente a JOIN clientes c ON c.id = a.cliente_id JOIN servicios s ON s.id = a.servicio_id
   WHERE (NOT ${soloActivos} OR a.activo)
   ORDER BY a.activo DESC, c.nombre`;

type ClienteFactura = { activo: boolean; rnc: string | null; ncf_predeterminado: TipoFactura | null; dias_credito: number; tipo_ingreso: string };
const tipoHabitual = (c: ClienteFactura): TipoFactura => c.ncf_predeterminado ?? (c.rnc ? "B01" : "B02");
const vence = (fecha: string, dias: number) => {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

export type Preparacion = { creadas: number; yaEstaban: number; gratis: string[]; errores: string[] };

// Prepara los borradores de iguala del período. Con `soloHastaHoy`, solo los de clientes cuyo día de facturación ya llegó
// (así «se preparan solas» al abrir la pantalla desde ese día). Cada acuerdo va aparte: si uno falla, los demás siguen.
export async function prepararIgualas(tx: Tx, d: { empresaId: string; usuarioId: string; periodo: string; hoy: string; soloHastaHoy: boolean }): Promise<Preparacion> {
  const r: Preparacion = { creadas: 0, yaEstaban: 0, gratis: [], errores: [] };
  for (const a of await listarAcuerdos(tx, true)) {
    if (d.soloHastaHoy && fechaFacturacion(d.periodo, a.dia_facturacion) > d.hoy) continue;
    const mes = igualaDelMes(a, d.periodo);
    if (!mes) continue;
    const [ya] = await tx`SELECT 1 FROM facturas WHERE acuerdo_id = ${a.id} AND periodo = ${d.periodo} AND NOT anulada`;
    if (ya) { r.yaEstaban++; continue; }
    if (mes.total === 0n) { r.gratis.push(a.cliente); continue; }
    try {
      await tx.savepoint(async (sp) => {
        const [c] = await sp<ClienteFactura[]>`SELECT activo, rnc, ncf_predeterminado, dias_credito, tipo_ingreso FROM clientes WHERE id = ${a.cliente_id}`;
        const [s] = await sp<{ impuesto_id: string | null; impuesto_adicional_id: string | null; unidad_id: string | null; activo: boolean }[]>`
          SELECT impuesto_id, impuesto_adicional_id, unidad_id, activo FROM servicios WHERE id = ${a.servicio_id}`;
        if (!c?.activo) throw new ErrorContable("el cliente está inactivo");
        if (!s?.impuesto_id) throw new ErrorContable("el servicio de la iguala no tiene ITBIS (o exento)");
        const lineas: LineaEntrada[] = mes.lineas.map((l) => ({
          servicioId: a.servicio_id, descripcion: l.descripcion, cantidad: 10000n, precio: l.precio,
          impuestoIds: [s.impuesto_id!, ...(s.impuesto_adicional_id ? [s.impuesto_adicional_id] : [])], unidadId: s.unidad_id,
        }));
        const facturaId = await guardarBorradorFactura(sp, {
          empresaId: d.empresaId, usuarioId: d.usuarioId, clienteId: a.cliente_id, tipo: tipoHabitual(c), fecha: mes.fecha,
          vence: vence(mes.fecha, c.dias_credito), moneda: "DOP", tasa: 10000n, notas: mes.nota, lineas, tipoIngreso: c.tipo_ingreso,
        });
        await sp`UPDATE facturas SET acuerdo_id = ${a.id}, periodo = ${d.periodo} WHERE id = ${facturaId}`;
      });
      r.creadas++;
    } catch (e) {
      r.errores.push(`${a.cliente}: ${e instanceof Error ? e.message : "no se pudo preparar"}`);
    }
  }
  return r;
}

export type FilaMes = {
  acuerdo_id: string; cliente: string; tipo: string; factura_id: string | null; estado: string | null; ncf: string | null; total: string | null;
  notas: string | null;
};

// Las igualas de un período: cada acuerdo activo con su borrador o factura, si ya la tiene.
export const igualasDelPeriodo = (tx: Tx, periodo: string) => tx<FilaMes[]>`
  SELECT a.id AS acuerdo_id, c.nombre AS cliente, a.tipo, f.id AS factura_id, f.estado, f.ncf, f.total::text, f.notas
    FROM acuerdos_cliente a JOIN clientes c ON c.id = a.cliente_id
    LEFT JOIN facturas f ON f.acuerdo_id = a.id AND f.periodo = ${periodo} AND NOT f.anulada
   WHERE a.activo OR f.id IS NOT NULL
   ORDER BY c.nombre`;

export function avisosDe(acuerdos: Acuerdo[], hoy: string): (AvisoIguala & { acuerdo: Acuerdo })[] {
  return acuerdos.filter((a) => a.activo).flatMap((a) => avisosAcuerdo(a, hoy, a.confirmados).map((x) => ({ ...x, acuerdo: a })));
}

// Aplica el aumento de 10 % de un aniversario (lo confirma Patricia por cliente). Queda en el historial.
export async function confirmarAumento(tx: Tx, d: { empresaId: string; usuarioId: string; acuerdoId: string; hoy: string }): Promise<string> {
  const [a] = (await listarAcuerdos(tx)).filter((x) => x.id === d.acuerdoId && x.activo);
  if (!a) throw new ErrorContable("El acuerdo no existe o no está activo");
  const aviso = avisosAcuerdo(a, d.hoy, a.confirmados).find((x) => x.clave === "aumento");
  if (!aviso) throw new ErrorContable("Este acuerdo no tiene un aumento pendiente");
  await tx`INSERT INTO aumentos_iguala (empresa_id, acuerdo_id, aniversario, monto_anterior, monto_nuevo, confirmado_por)
           VALUES (${d.empresaId}, ${a.id}, ${aviso.aniversario!}, ${a.monto}, ${aviso.nuevo!}, ${d.usuarioId})`;
  await tx`UPDATE acuerdos_cliente SET monto = ${aviso.nuevo!} WHERE id = ${a.id}`;
  return aviso.nuevo!;
}

// ───── Facturas recurrentes ─────

export type LineaPlantilla = { servicioId: string | null; descripcion: string; cantidad: string; precio: string; impuestoIds: string[]; unidadId: string | null };
export type Recurrente = {
  id: string; cliente_id: string; cliente: string; nombre: string; frecuencia: string; proxima: string | null; hasta: string | null;
  tipo_ncf: TipoFactura | null; lineas: LineaPlantilla[]; notas: string | null; activa: boolean; total: string;
};

export const listarRecurrentes = (tx: Tx) => tx<Recurrente[]>`
  SELECT r.id, r.cliente_id, c.nombre AS cliente, r.nombre, r.frecuencia, to_char(r.proxima, 'YYYY-MM-DD') AS proxima,
         to_char(r.hasta, 'YYYY-MM-DD') AS hasta, r.tipo_ncf, r.lineas, r.notas, r.activa,
         (SELECT COALESCE(sum((l->>'cantidad')::numeric * (l->>'precio')::numeric), 0)::numeric(18,2)::text FROM jsonb_array_elements(r.lineas) l) AS total
    FROM facturas_recurrentes r JOIN clientes c ON c.id = r.cliente_id
   ORDER BY r.activa DESC, r.proxima NULLS LAST, c.nombre`;

// La plantilla toma las líneas de una factura (cualquier estado; no cambia la factura).
export async function crearRecurrenteDesdeFactura(tx: Tx, d: {
  empresaId: string; facturaId: string; nombre: string; frecuencia: string; proxima: string | null; hasta: string | null;
}): Promise<string> {
  const [f] = await tx<{ cliente_id: string; tipo_ncf: string; notas: string | null; moneda: string }[]>`
    SELECT cliente_id, tipo_ncf, notas, moneda FROM facturas WHERE id = ${d.facturaId}`;
  if (!f || f.tipo_ncf === "B04" || f.tipo_ncf === "E34") throw new ErrorContable("La factura no existe");
  if (f.moneda !== "DOP") throw new ErrorContable("Por ahora las facturas recurrentes son en pesos");
  const lineas = await tx<LineaPlantilla[]>`
    SELECT l.servicio_id AS "servicioId", l.descripcion, l.cantidad::text AS cantidad, l.precio::text AS precio, l.unidad_id AS "unidadId",
           ARRAY(SELECT il.impuesto_id::text FROM impuestos_linea_factura il WHERE il.linea_id = l.id ORDER BY il.tipo NOT IN ('itbis', 'exento')) AS "impuestoIds"
      FROM lineas_factura l WHERE l.factura_id = ${d.facturaId} ORDER BY l.orden`;
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO facturas_recurrentes (empresa_id, cliente_id, nombre, frecuencia, proxima, hasta, tipo_ncf, lineas, notas)
    VALUES (${d.empresaId}, ${f.cliente_id}, ${d.nombre}, ${d.frecuencia}, ${d.frecuencia === "a_solicitud" ? null : d.proxima}, ${d.hasta},
            ${f.tipo_ncf}, ${tx.json(lineas as never)}, ${f.notas}) RETURNING id`;
  return id;
}

// Cantidad guardada como texto (numeric con 4 decimales) a diezmilésimas, sin pasar por números de coma flotante.
const cantidadDe = (t: string) => {
  const [e, dec = ""] = t.split(".");
  return BigInt(e) * 10000n + BigInt((dec + "0000").slice(0, 4));
};

async function borradorDePlantilla(tx: Tx, r: Recurrente, d: { empresaId: string; usuarioId: string }, fecha: string, periodo: string) {
  const [c] = await tx<ClienteFactura[]>`SELECT activo, rnc, ncf_predeterminado, dias_credito, tipo_ingreso FROM clientes WHERE id = ${r.cliente_id}`;
  if (!c?.activo) throw new ErrorContable("el cliente está inactivo");
  const facturaId = await guardarBorradorFactura(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, clienteId: r.cliente_id, tipo: r.tipo_ncf ?? tipoHabitual(c), fecha,
    vence: vence(fecha, c.dias_credito), moneda: "DOP", tasa: 10000n, notas: r.notas, tipoIngreso: c.tipo_ingreso,
    lineas: r.lineas.map((l) => ({
      servicioId: l.servicioId, descripcion: l.descripcion, cantidad: cantidadDe(l.cantidad),
      precio: aCentavos(l.precio), impuestoIds: l.impuestoIds, unidadId: l.unidadId,
    })),
  });
  await tx`UPDATE facturas SET recurrente_id = ${r.id}, periodo = ${periodo} WHERE id = ${facturaId}`;
  return facturaId;
}

// Prepara los borradores de las plantillas que ya tocan (hasta 12 atrasadas por plantilla) y mueve su próxima fecha.
export async function prepararRecurrentes(tx: Tx, d: { empresaId: string; usuarioId: string; hoy: string }): Promise<Preparacion> {
  const r: Preparacion = { creadas: 0, yaEstaban: 0, gratis: [], errores: [] };
  for (const p of await listarRecurrentes(tx)) {
    if (!p.activa || p.frecuencia === "a_solicitud" || !p.proxima) continue;
    let proxima = p.proxima;
    const dia = Number(p.proxima.slice(8));
    for (let n = 0; n < 12 && proxima <= d.hoy && (!p.hasta || proxima <= p.hasta); n++) {
      try {
        await tx.savepoint(async (sp) => {
          const [ya] = await sp`SELECT 1 FROM facturas WHERE recurrente_id = ${p.id} AND periodo = ${proxima} AND NOT anulada`;
          if (ya) r.yaEstaban++;
          else { await borradorDePlantilla(sp, p, d, proxima, proxima); r.creadas++; }
        });
      } catch (e) {
        r.errores.push(`${p.nombre}: ${e instanceof Error ? e.message : "no se pudo preparar"}`);
        break;
      }
      proxima = siguienteFecha(proxima, p.frecuencia, dia);
    }
    if (proxima !== p.proxima) await tx`UPDATE facturas_recurrentes SET proxima = ${proxima} WHERE id = ${p.id}`;
  }
  return r;
}

// Una plantilla «a solicitud» (o cualquiera) prepara su borrador al momento, con la fecha de hoy.
export async function prepararRecurrenteAhora(tx: Tx, d: { empresaId: string; usuarioId: string; recurrenteId: string; hoy: string }): Promise<string> {
  const [p] = (await listarRecurrentes(tx)).filter((x) => x.id === d.recurrenteId);
  if (!p?.activa) throw new ErrorContable("La plantilla no existe o está en pausa");
  const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM facturas WHERE recurrente_id = ${p.id} AND periodo LIKE ${d.hoy + "%"}`;
  return borradorDePlantilla(tx, p, d, d.hoy, n ? `${d.hoy}#${n + 1}` : `${d.hoy}#1`);
}

export const tituloPeriodo = nombrePeriodo;
