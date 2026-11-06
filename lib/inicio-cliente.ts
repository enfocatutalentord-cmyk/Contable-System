import type { Tx } from "./db";
import { porVencer } from "./bitacora.ts";
import { cuentaConFirma, type DatosReporte } from "./reporte-mensual.ts";
import { contadorMes } from "./facturas-subidas.ts";

// Pantalla de inicio del cliente en la aplicación (bloque 8a; documento «Sistema Empire · Fase 2», sección 2): lo suyo del mes,
// sin las cifras contables internas. Solo lee; lo que se descarga sale por /e/[id]/mis-documentos.

export type InicioCliente = {
  estado: string;
  documentosMes: number;
  porProcesar: number;
  facturas: { gastos: number; ingresos: number; gastos_ok: number; ingresos_ok: number; revision: number }; // bloque 8b
  impuestos: { id: string; tipo: string; concepto: string | null; periodo: string; monto: string; fecha_limite: string; estado: string; doc: string | null; alerta: "vencida" | "por_vencer" | null }[];
  reporte: { id: string; periodo: string } | null;
  proyeccion: { id: string; periodo: string } | null;
  cuenta: DatosReporte["cuenta"];
  avisos: { texto: string; enlace: string | null }[];
};

const periodoDe = (fecha: string) => fecha.slice(0, 4) + fecha.slice(5, 7);

// Corre en conEmpresa de la empresa del cliente. La cuenta con Empire se lee aparte (facturas de la empresa propia).
export async function inicioCliente(tx: Tx, empresaId: string, hoy: string, base: string): Promise<InicioCliente> {
  const [{ estado_cliente }] = await tx<{ estado_cliente: string }[]>`SELECT estado_cliente FROM empresas WHERE id = ${empresaId}`;
  const [docs] = await tx<{ mes: number; nuevos: number }[]>`
    SELECT count(*) FILTER (WHERE subido_en >= date_trunc('month', ${hoy}::date))::int AS mes,
           count(*) FILTER (WHERE estado IN ('nuevo', 'en_proceso'))::int AS nuevos
      FROM recepciones`;
  const impuestos = (await tx<Omit<InicioCliente["impuestos"][number], "alerta">[]>`
    SELECT n.id, n.tipo, n.concepto, n.periodo, n.monto::text, to_char(n.fecha_limite, 'YYYY-MM-DD') AS fecha_limite, n.estado,
           (SELECT d.id FROM documentos d WHERE d.entidad = 'notificacion' AND d.entidad_id = n.id AND NOT d.eliminado ORDER BY d.subido_en DESC LIMIT 1) AS doc
      FROM notificaciones_pago n WHERE n.estado <> 'pagada' ORDER BY n.fecha_limite`).map((n) => ({ ...n, alerta: porVencer(n, hoy) }));
  const [reporte] = await tx<{ id: string; periodo: string }[]>`
    SELECT id, periodo FROM reportes_mensuales WHERE estado IN ('aprobado', 'enviado') ORDER BY periodo DESC LIMIT 1`;
  const [proyeccion] = await tx<{ id: string; periodo: string }[]>`SELECT id, periodo FROM proyecciones_fiscales ORDER BY periodo DESC LIMIT 1`;

  const facturas = await contadorMes(tx, hoy.slice(0, 7));
  const avisos: InicioCliente["avisos"] = [];
  for (const f of await tx<{ numero: number; estado: string; motivo: string | null; ncf: string | null }[]>`
      SELECT numero, estado, motivo, ncf FROM facturas_subidas WHERE estado IN ('rechazada', 'desestimada') AND revisado_en > now() - interval '30 days'
       ORDER BY revisado_en DESC LIMIT 5`) {
    avisos.push({ texto: `La factura n.º ${f.numero}${f.ncf ? ` (${f.ncf})` : ""} fue ${f.estado}${f.motivo ? `: ${f.motivo}` : ""}.${f.estado === "rechazada" ? " Súbela de nuevo." : ""}`, enlace: `${base}/facturas-subidas` });
  }
  for (const n of impuestos) {
    if (n.alerta) avisos.push({ texto: `${n.tipo.toUpperCase()} de ${n.periodo.slice(4)}/${n.periodo.slice(0, 4)}: ${n.alerta === "vencida" ? "venció" : "vence"} el ${n.fecha_limite.split("-").reverse().join("/")} y no consta el pago`, enlace: null });
  }
  for (const r of await tx<{ nombre: string; respuesta: string | null }[]>`
      SELECT nombre, respuesta FROM recepciones WHERE estado = 'descartado' AND subido_en > now() - interval '30 days' ORDER BY subido_en DESC LIMIT 5`) {
    avisos.push({ texto: `No se pudo usar «${r.nombre}»${r.respuesta ? `: ${r.respuesta}` : ""}. Súbelo de nuevo si hace falta.`, enlace: `${base}/recepcion` });
  }
  for (const s of await tx<{ servicio: string | null; descripcion: string; estado: string }[]>`
      SELECT servicio, descripcion, estado FROM solicitudes WHERE estado IN ('cotizada', 'entregada') AND creado > now() - interval '60 days' ORDER BY creado DESC LIMIT 5`) {
    const que = s.servicio ?? (s.descripcion.length > 60 ? `${s.descripcion.slice(0, 60)}…` : s.descripcion);
    avisos.push({ texto: s.estado === "cotizada" ? `Te cotizamos «${que}»: te enviaremos la propuesta.` : `Entregamos «${que}».`, enlace: `${base}/solicitudes` });
  }
  const [{ formularios }] = await tx<{ formularios: number }[]>`SELECT count(*)::int AS formularios FROM formularios WHERE estado = 'pendiente' AND token_hash IS NOT NULL AND vence > now()`;
  if (formularios) avisos.push({ texto: `Tienes ${formularios === 1 ? "un formulario" : `${formularios} formularios`} por llenar.`, enlace: `${base}/solicitudes` });

  const cuenta = await cuentaConFirma(empresaId, periodoDe(hoy), hoy);
  return { estado: estado_cliente, documentosMes: docs.mes, porProcesar: docs.nuevos, facturas, impuestos, reporte: reporte ?? null, proyeccion: proyeccion ?? null, cuenta, avisos };
}
