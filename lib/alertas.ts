import { porVencer } from "./bitacora.ts";
import type { Tx } from "./db";
import { avisosDe, listarAcuerdos } from "./igualas-db.ts";
import { verFecha, verMonto } from "./montos.ts";

// Bloque 3, entrega 3b: las alertas por cliente de la sección 9 del Documento maestro, calculadas con lo que ya registra el
// sistema. No se guardan: desaparecen solas cuando se resuelve lo que avisan (se carga el rango, se marca presentada, etc.).

// mensaje: el mensaje de WhatsApp que corresponde a la alerta (bloque 3c), con lo que hace falta para llenarlo.
export type Mensaje = { clave: string; extra?: Record<string, string>; ref?: { tipo: "notificacion"; id: string } };
export type Alerta = { tipo: string; nivel: "urgente" | "aviso"; texto: string; enlace: string; orden: string; mensaje?: Mensaje };

export const TIPOS_ALERTA: Record<string, string> = {
  comprobantes: "Comprobantes", declaracion: "Declaraciones", notificacion: "Notificaciones de pago", documentos: "Documentos del cliente",
  formalizacion: "Formalización", registro: "Registro mercantil y ONAPI", contrato: "Contrato e iguala", fidelidad: "Fidelidad",
  tramite: "Trámites", solicitud: "Solicitudes y formularios",
};

// Declaraciones mensuales que el sistema puede ver presentadas («Marcar como presentado» en Reportes DGII) y su día de vencimiento.
const MENSUALES: Record<string, { formato: string; dia: number }> = {
  ir17: { formato: "IR-17", dia: 10 }, f606: { formato: "606", dia: 15 }, f607: { formato: "607", dia: 15 }, f608: { formato: "608", dia: 15 },
  it1: { formato: "IT-1", dia: 20 },
};
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);
const mas = (f: string, n: number) => { const d = new Date(`${f}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const faltan = (hoy: string, f: string) => { const n = dias(hoy, f); return n < 0 ? `venció el ${verFecha(f)}` : n === 0 ? "vence hoy" : `vence el ${verFecha(f)} (faltan ${n} día${n === 1 ? "" : "s"})`; };
// El próximo aniversario (mes y día de una fecha) desde hoy.
function proximo(fecha: string, hoy: string): string {
  const a = Number(hoy.slice(0, 4));
  const en = (anio: number) => `${anio}${fecha.slice(4)}`;
  return en(a) >= hoy ? en(a) : en(a + 1);
}

export async function alertasDeEmpresa(tx: Tx, d: { empresaId: string; hoy: string; propia: boolean }): Promise<Alerta[]> {
  const { empresaId: id, hoy } = d;
  const base = `/e/${id}`;
  const alertas: Alerta[] = [];
  const poner = (tipo: string, nivel: Alerta["nivel"], texto: string, enlace: string, orden = hoy, mensaje?: Mensaje) => alertas.push({ tipo, nivel, texto, enlace, orden, mensaje });

  // Comprobantes: quedan 10 o menos, o el rango vence en 30 días.
  for (const s of await tx<{ tipo: string; quedan: number; vence: string }[]>`
      SELECT tipo, (hasta - siguiente + 1)::int AS quedan, to_char(vence, 'YYYY-MM-DD') AS vence FROM secuencias_ncf WHERE activa`) {
    if (s.vence < hoy) continue; // vencidos: no se usan
    if (s.quedan <= 10) poner("comprobantes", s.quedan <= 0 ? "urgente" : "aviso", s.quedan <= 0 ? `Se agotaron los comprobantes ${s.tipo}` : `Quedan ${s.quedan} comprobantes ${s.tipo}`, `${base}/comprobantes`, hoy,
      { clave: "comprobantes", extra: { cantidad: String(Math.max(0, s.quedan)), tipo: s.tipo } });
    else if (dias(hoy, s.vence) <= 30) poner("comprobantes", "aviso", `El rango de comprobantes ${s.tipo} ${faltan(hoy, s.vence)}`, `${base}/comprobantes`, s.vence);
  }

  // Declaraciones del mes anterior confirmadas en el perfil fiscal: avisa 7 días antes y hasta que se marcan presentadas.
  const [a, m] = [Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7))];
  const anterior = m === 1 ? `${a - 1}12` : `${a}${String(m - 1).padStart(2, "0")}`;
  const obligaciones = (await tx<{ clave: string }[]>`SELECT clave FROM obligaciones_empresa WHERE activa`).map((o) => o.clave);
  const presentadas = new Set((await tx<{ formato: string; periodo: string }[]>`SELECT formato, periodo FROM envios_dgii`).map((e) => `${e.formato}:${e.periodo}`));
  for (const clave of obligaciones) {
    const x = MENSUALES[clave];
    if (!x || presentadas.has(`${x.formato}:${anterior}`)) continue;
    const vence = `${hoy.slice(0, 7)}-${String(x.dia).padStart(2, "0")}`;
    if (dias(hoy, vence) > 7) continue;
    poner("declaracion", dias(hoy, vence) < 0 ? "urgente" : "aviso", `${x.formato} de ${MESES[Number(anterior.slice(4)) - 1]} sin presentar: ${faltan(hoy, vence)}`, `${base}/dgii`, vence);
  }
  // IR-2: 120 días después del cierre del ejercicio; avisa 30 días antes.
  const [e] = await tx<{ mes_cierre: number; estado_cliente: string; formalizado: boolean; vence_registro_mercantil: string | null;
    vence_nombre_comercial: string | null; fecha_asamblea: string | null; fecha_inicio_contrato: string | null; nombre: string }[]>`
    SELECT mes_cierre, estado_cliente, (ficha_firmada IS NOT NULL AND hoja_firmada IS NOT NULL AND contrato_firmado IS NOT NULL) AS formalizado,
           to_char(vence_registro_mercantil, 'YYYY-MM-DD') AS vence_registro_mercantil, to_char(vence_nombre_comercial, 'YYYY-MM-DD') AS vence_nombre_comercial,
           to_char(fecha_asamblea, 'YYYY-MM-DD') AS fecha_asamblea, to_char(fecha_inicio_contrato, 'YYYY-MM-DD') AS fecha_inicio_contrato, nombre
      FROM empresas WHERE id = ${id}`;
  if (obligaciones.includes("ir2") && e) {
    const mc = e.mes_cierre;
    const anioFin = Number(hoy.slice(5, 7)) > mc ? a : a - 1;
    const fin = new Date(Date.UTC(anioFin, mc, 0)).toISOString().slice(0, 10);
    const vence = mas(fin, 120);
    const periodo = fin.slice(0, 4) + fin.slice(5, 7);
    if (!presentadas.has(`IR-2:${periodo}`) && dias(hoy, vence) <= 30) {
      poner("declaracion", dias(hoy, vence) < 0 ? "urgente" : "aviso", `IR-2 del ejercicio ${fin.slice(0, 4)} sin presentar: ${faltan(hoy, vence)}`, `${base}/dgii/ir2`, vence);
    }
  }

  // Trámites abiertos (bloque 5a): 5 días antes del plazo y cuando vence sin respuesta.
  for (const t of await tx<{ institucion: string; tipo: string; plazo: string }[]>`
      SELECT institucion, tipo, to_char(plazo, 'YYYY-MM-DD') AS plazo FROM tramites WHERE estado = 'abierto' AND plazo <= ${hoy}::date + 5`) {
    const inst = ({ dgii: "DGII", tss: "TSS", camara: "Cámara de Comercio", onapi: "ONAPI" } as Record<string, string>)[t.institucion] ?? "institución";
    poner("tramite", t.plazo < hoy ? "urgente" : "aviso",
      `Trámite ante ${inst} (${t.tipo}) ${t.plazo < hoy ? `venció sin respuesta el ${verFecha(t.plazo)}` : faltan(hoy, t.plazo).replace("vence", "vence el plazo")}`,
      `${base}/expediente?ver=tramites`, t.plazo);
  }

  // Solicitudes del cliente con su fecha pasada y formularios en línea recibidos sin revisar (bloque 6a).
  for (const s of await tx<{ descripcion: string; servicio: string | null; fecha: string }[]>`
      SELECT descripcion, servicio, to_char(fecha_requerida, 'YYYY-MM-DD') AS fecha FROM solicitudes
       WHERE estado NOT IN ('entregada', 'descartada') AND fecha_requerida < ${hoy}::date`) {
    poner("solicitud", "urgente", `Solicitud atrasada (era para el ${verFecha(s.fecha)}): ${s.servicio ?? s.descripcion.slice(0, 80)}`, `${base}/solicitudes`, s.fecha);
  }
  const [{ recibidos }] = await tx<{ recibidos: number }[]>`SELECT count(*)::int AS recibidos FROM formularios WHERE estado = 'recibido'`;
  if (recibidos) poner("solicitud", "aviso", `${recibidos === 1 ? "Un formulario en línea recibido" : `${recibidos} formularios en línea recibidos`} por revisar`, `${base}/solicitudes`);

  // Notificaciones de pago sin pagar cerca de la fecha límite.
  for (const n of await tx<{ id: string; tipo: string; periodo: string; monto: string; fecha_limite: string; estado: string }[]>`
      SELECT id, tipo, periodo, monto::text, to_char(fecha_limite, 'YYYY-MM-DD') AS fecha_limite, estado FROM notificaciones_pago WHERE estado <> 'pagada'`) {
    const p = porVencer(n, hoy);
    if (p) poner("notificacion", p === "vencida" ? "urgente" : "aviso", `Notificación ${n.tipo.toUpperCase()} de ${n.periodo.slice(4)}/${n.periodo.slice(0, 4)} por RD$${verMonto(n.monto)} sin pagar: ${faltan(hoy, n.fecha_limite)}`, `${base}/notificaciones`, n.fecha_limite,
      { clave: n.tipo === "tss" ? "notificacion_tss" : "constancia", ref: { tipo: "notificacion", id: n.id } });
  }

  if (!d.propia && e && e.estado_cliente !== "retirado") {
    // Documentos del cliente no recibidos: desde el día 10, nada subido en el mes.
    if (Number(hoy.slice(8)) >= 10) {
      const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM recepciones WHERE subido_en >= date_trunc('month', ${hoy}::date)`;
      if (n === 0) poner("documentos", "aviso", "No ha enviado documentos este mes (facturas de compras para el 606)", `${base}/recepcion`, hoy,
        { clave: "facturas_606", extra: { mes: `${MESES[Number(anterior.slice(4)) - 1]} ${anterior.slice(0, 4)}` } });
    }
    if (!e.formalizado) poner("formalizacion", "aviso", "Sin formalizar: falta la fecha de la ficha, la hoja de acuerdo o el contrato firmados", `${base}/empresa?seccion=relacion`);
    // Registro mercantil y nombre comercial: 60 días antes. Asamblea ordinaria: 30 días antes.
    for (const [f, que, antes] of [[e.vence_registro_mercantil, "El registro mercantil", 60], [e.vence_nombre_comercial, "El nombre comercial (ONAPI)", 60], [e.fecha_asamblea, "La asamblea ordinaria anual", 30]] as const) {
      if (f && dias(hoy, f) <= antes) poner("registro", dias(hoy, f) < 0 ? "urgente" : "aviso", `${que} ${que.startsWith("La asamblea") ? (dias(hoy, f) < 0 ? `era el ${verFecha(f)}` : `es el ${verFecha(f)}`) : faltan(hoy, f)}`, `${base}/empresa?seccion=sociedad`, f);
    }
    // Fidelidad: cumpleaños de los contactos (hoy o mañana) y aniversario con Empire (en los próximos 7 días).
    for (const c of await tx<{ nombre: string; nacimiento: string }[]>`
        SELECT nombre, to_char(nacimiento, 'YYYY-MM-DD') AS nacimiento FROM contactos_empresa WHERE nacimiento IS NOT NULL`) {
      const cumple = proximo(c.nacimiento, hoy);
      if (dias(hoy, cumple) <= 1) poner("fidelidad", "aviso", `${dias(hoy, cumple) === 0 ? "Hoy" : "Mañana"} cumple años ${c.nombre}`, `${base}/empresa?seccion=contactos`, cumple,
        { clave: "cumpleanos", extra: { nombre: c.nombre } });
    }
    if (e.fecha_inicio_contrato) {
      const aniv = proximo(e.fecha_inicio_contrato, hoy);
      const anios = Number(aniv.slice(0, 4)) - Number(e.fecha_inicio_contrato.slice(0, 4));
      if (anios > 0 && dias(hoy, aniv) <= 7) poner("fidelidad", "aviso", `${dias(hoy, aniv) === 0 ? "Hoy" : `El ${verFecha(aniv)}`} cumple ${anios} año${anios > 1 ? "s" : ""} con la firma`, `${base}/empresa?seccion=relacion`, aniv,
        { clave: "aniversario", extra: { años: String(anios) } });
    }
  }

  if (d.propia) {
    // En la empresa propia: igualas vencidas sin cobrar y los avisos de los acuerdos (aniversario, aumento, fin de tarifa).
    for (const f of await tx<{ cliente: string; saldo: string; vence: string }[]>`
        SELECT c.nombre AS cliente, s.saldo::text, to_char(f.vence, 'YYYY-MM-DD') AS vence
          FROM facturas f JOIN saldos_factura s ON s.factura_id = f.id JOIN clientes c ON c.id = f.cliente_id
         WHERE f.acuerdo_id IS NOT NULL AND f.estado = 'emitida' AND NOT f.anulada AND s.saldo > 0 AND f.vence < ${hoy}::date`) {
      poner("contrato", "urgente", `Iguala atrasada de ${f.cliente}: RD$${verMonto(f.saldo)} (venció el ${verFecha(f.vence)})`, `${base}/cxc`, f.vence);
    }
    for (const x of avisosDe(await listarAcuerdos(tx), hoy)) poner("contrato", x.clave === "aumento" ? "urgente" : "aviso", `${x.acuerdo.cliente}: ${x.texto}`, `${base}/igualas`);
  }
  return alertas.sort((x, y) => (x.nivel === y.nivel ? x.orden.localeCompare(y.orden) : x.nivel === "urgente" ? -1 : 1));
}
