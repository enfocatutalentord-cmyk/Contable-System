import { antiguedad } from "./cxc";
import { antiguedadCxp } from "./cxp";
import { conEmpresa, db } from "./db";
import { hoyISO, verFecha, verMonto } from "./montos";

// Lo que la firma ve en «Inicio de la firma»: sus clientes con lo pendiente y la actividad del equipo y de los clientes.

export type ClienteFirma = {
  id: string; nombre: string; rnc: string | null; activa: boolean; fecha_bloqueo: string | null;
  responsable_id: string | null; responsable: string | null;
};

// El administrador de la firma ve todos los clientes; el resto, los que tiene asignados.
export async function clientesDeFirma(firmaId: string, usuarioId: string, administrador: boolean, conInactivos = false): Promise<ClienteFirma[]> {
  return db()<ClienteFirma[]>`
    SELECT e.id, e.nombre, e.rnc, e.activa, to_char(e.fecha_bloqueo, 'YYYY-MM-DD') AS fecha_bloqueo, e.responsable_id, r.nombre AS responsable
      FROM empresas e
      LEFT JOIN usuarios r ON r.id = e.responsable_id
     WHERE e.firma_id = ${firmaId} AND (${conInactivos} OR e.activa)
       AND (${administrador} OR EXISTS (SELECT 1 FROM miembros m WHERE m.empresa_id = e.id AND m.usuario_id = ${usuarioId}))
     ORDER BY e.activa DESC, e.nombre`;
}

export type Resumen = {
  borradores: number; facturasBorrador: number; comprasBorrador: number; documentosPorProcesar: number; movimientosBanco: number;
  porCobrar: bigint; vencido: bigint; porPagar: bigint; ultimo: string | null;
};

export async function resumenCliente(empresaId: string): Promise<Resumen> {
  const hoy = hoyISO();
  return conEmpresa(empresaId, async (tx) => {
    const [r] = await tx<{ borradores: number; facturas: number; compras: number; documentos: number; banco: number; ultimo: string | null }[]>`
      SELECT (SELECT count(*)::int FROM asientos WHERE estado = 'borrador') AS borradores,
             (SELECT count(*)::int FROM facturas WHERE estado = 'borrador') AS facturas,
             (SELECT count(*)::int FROM compras WHERE estado = 'borrador') AS compras,
             (SELECT count(*)::int FROM recepciones WHERE estado IN ('nuevo', 'en_proceso')) AS documentos,
             (SELECT count(*)::int FROM movimientos_banco WHERE estado = 'pendiente') AS banco,
             (SELECT to_char(max(fecha), 'YYYY-MM-DD') FROM asientos WHERE estado = 'contabilizado') AS ultimo`;
    const cxc = await antiguedad(tx, hoy);
    const cxp = await antiguedadCxp(tx, hoy);
    return {
      borradores: r.borradores, facturasBorrador: r.facturas, comprasBorrador: r.compras, documentosPorProcesar: r.documentos, movimientosBanco: r.banco,
      porCobrar: cxc.total, vencido: cxc.totales.slice(1).reduce((s, t) => s + t, 0n), porPagar: cxp.total, ultimo: r.ultimo,
    };
  });
}

export type Evento = { fecha: Date; quien: string; texto: string; cliente: string; clienteId: string; enlace: string | null };

type Fila = { tabla: string; registro_id: string | null; accion: string; antes: Record<string, string> | null; despues: Record<string, string> | null; fecha: Date; usuario: string | null };

const pesos = (f: Record<string, string>) => (f.total ? ` por ${f.moneda === "USD" ? "US$" : "RD$"} ${verMonto(f.total)}` : "");

// Convierte un cambio del historial en una frase («emitió la factura B0100000003…»). Lo que no es un hecho importante se omite.
function frase(eid: string, f: Fila): { texto: string; enlace: string | null } | null {
  const a = f.antes ?? {}, d = f.despues ?? {};
  const cambio = (k: string) => f.accion === "update" && JSON.stringify(a[k]) !== JSON.stringify(d[k]);
  const base = `/e/${eid}`;
  switch (f.tabla) {
    case "facturas": {
      const nota = d.tipo_ncf === "B04";
      const que = nota ? "la nota de crédito" : "la factura";
      const enlace = `${base}/facturas/${f.registro_id}`;
      if (f.accion === "insert") return { texto: `creó un borrador de ${nota ? "nota de crédito" : "factura"}`, enlace };
      if (cambio("estado") && d.estado === "emitida") return { texto: `emitió ${que} ${d.ncf ?? ""}${pesos(d)}`, enlace };
      if (cambio("anulada") && String(d.anulada) === "true") return { texto: `anuló ${que} ${d.ncf ?? ""}`, enlace };
      return null;
    }
    case "compras": {
      const enlace = `${base}/compras/${f.registro_id}`;
      if (f.accion === "insert") return { texto: "creó un borrador de compra", enlace };
      if (cambio("estado") && d.estado === "registrada") return { texto: `registró la compra ${d.ncf ?? ""}${pesos(d)}`, enlace };
      if (cambio("anulada") && String(d.anulada) === "true") return { texto: `anuló la compra ${d.ncf ?? ""}`, enlace };
      return null;
    }
    case "cobros":
      if (f.accion === "insert") return { texto: `registró el cobro n.º ${d.numero}`, enlace: `${base}/cobros/${d.numero}` };
      if (cambio("anulado") && String(d.anulado) === "true") return { texto: `anuló el cobro n.º ${d.numero}`, enlace: `${base}/cobros/${d.numero}` };
      return null;
    case "pagos":
      if (f.accion === "insert") return { texto: `registró el pago n.º ${d.numero}`, enlace: `${base}/pagos/${d.numero}` };
      if (cambio("anulado") && String(d.anulado) === "true") return { texto: `anuló el pago n.º ${d.numero}`, enlace: `${base}/pagos/${d.numero}` };
      return null;
    case "asientos": {
      if (d.origen && d.origen !== "manual") return null; // los de documentos ya se cuentan arriba
      const enlace = `${base}/asientos/${f.registro_id}`;
      if (f.accion === "insert") return { texto: `creó un asiento en borrador${d.concepto ? `: ${d.concepto}` : ""}`, enlace };
      if (cambio("estado") && d.estado === "contabilizado") return { texto: `contabilizó el asiento n.º ${d.numero}${d.concepto ? `: ${d.concepto}` : ""}`, enlace };
      return null;
    }
    case "documentos":
      return f.accion === "insert" ? { texto: `adjuntó «${d.nombre}»`, enlace: null } : null;
    case "empresas":
      if (cambio("fecha_bloqueo")) {
        return d.fecha_bloqueo
          ? { texto: `cerró el período hasta el ${verFecha(String(d.fecha_bloqueo).slice(0, 10))}`, enlace: `${base}/cierres` }
          : { texto: "reabrió el período", enlace: `${base}/cierres` };
      }
      return null;
    case "recepciones":
      if (f.accion === "insert") return { texto: `subió «${d.nombre}»`, enlace: `${base}/recepcion` };
      if (cambio("estado") && d.estado === "procesado") return { texto: `procesó «${d.nombre}»`, enlace: `${base}/recepcion?estado=procesado` };
      if (cambio("estado") && d.estado === "descartado") return { texto: `descartó «${d.nombre}»`, enlace: `${base}/recepcion?estado=descartado` };
      return null;
    case "clientes":
      return f.accion === "insert" ? { texto: `agregó al cliente ${d.nombre}`, enlace: `${base}/clientes` } : null;
    case "proveedores":
      return f.accion === "insert" ? { texto: `agregó al proveedor ${d.nombre}`, enlace: `${base}/proveedores` } : null;
  }
  return null;
}

// Actividad reciente de varios clientes, la más nueva primero.
export async function actividad(clientes: { id: string; nombre: string }[], limite = 30, desde?: string): Promise<Evento[]> {
  const listas = await Promise.all(clientes.map((c) => conEmpresa(c.id, async (tx) => {
    const filas = await tx<Fila[]>`
      SELECT h.tabla, h.registro_id, h.accion, h.antes, h.despues, h.fecha, u.nombre AS usuario
        FROM auditoria h LEFT JOIN usuarios u ON u.id = h.usuario_id
       WHERE h.tabla IN ('facturas', 'compras', 'cobros', 'pagos', 'asientos', 'documentos', 'empresas', 'clientes', 'proveedores', 'recepciones')
         AND (h.accion = 'insert' OR (h.accion = 'update' AND (
               h.antes->'estado' IS DISTINCT FROM h.despues->'estado' OR h.antes->'anulada' IS DISTINCT FROM h.despues->'anulada'
               OR h.antes->'anulado' IS DISTINCT FROM h.despues->'anulado' OR h.antes->'fecha_bloqueo' IS DISTINCT FROM h.despues->'fecha_bloqueo')))
         AND (${desde ?? null}::date IS NULL OR h.fecha >= ${desde ?? null}::date)
       ORDER BY h.fecha DESC, h.id DESC LIMIT ${limite * 3}`;
    return filas.flatMap((f) => {
      const x = frase(c.id, f);
      return x ? [{ fecha: f.fecha, quien: f.usuario ?? "El sistema", cliente: c.nombre, clienteId: c.id, ...x }] : [];
    });
  })));
  return listas.flat().sort((a, b) => b.fecha.getTime() - a.fecha.getTime()).slice(0, limite);
}

export function hace(fecha: Date): string {
  const min = Math.round((Date.now() - fecha.getTime()) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  if (min < 24 * 60) return `hace ${Math.round(min / 60)} h`;
  return fecha.toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo", day: "numeric", month: "short" });
}
