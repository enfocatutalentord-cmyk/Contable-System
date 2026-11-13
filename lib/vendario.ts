// Integración con Vendario, parte 1 (acuerdo docs/vendario/acuerdo.md): guarda lo que llega, lleva el ciclo del cliente (alta, cambios,
// baja, aceptar, pedir información, estados) y manda los estados a Vendario con reintentos. Todo con la conexión dueña: estas tablas son
// de la plataforma, no de una empresa.
import { randomUUID } from "node:crypto";
import { enviarCorreo } from "./correo.ts";
import { db, type Tx } from "./db.ts";
import { crearEmpresa, limpiarRnc } from "./empresas.ts";
import { clavesDe, firmar } from "./vendario-firma.ts";
import { ESTADOS, PERIODO, SERVICIOS_CONTABLES, sobreEstado, trasRespuesta, type EstadoServicio, type Sobre } from "./vendario-sobre.ts";

// Dirección de la app para los enlaces de los correos (aquí no hay petición de donde sacarla).
const baseApp = () => process.env.URL_APP?.replace(/\/$/, "")
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://contable-system.vercel.app");

export const URL_VENDARIO = () => (process.env.VENDARIO_URL || "https://semwrlqhurdgphahrvkv.supabase.co/functions/v1").replace(/\/+$/, "");

export class ErrorVendario extends Error {}

// ───── Recepción ─────

// Guarda el mensaje tal como llegó. false si ese id ya estaba (duplicado: no se registra de nuevo).
export async function guardarMensaje(sobre: Sobre, cuerpo: string): Promise<boolean> {
  const r = await db()`
    INSERT INTO vendario_mensajes (id, tipo, org_id, org_rnc, seq, creado_en_vendario, cuerpo, sobre)
    VALUES (${sobre.id}, ${sobre.type}, ${sobre.org.vendario_id}, ${sobre.org.rnc}, ${sobre.seq},
            ${sobre.created_at && !Number.isNaN(Date.parse(sobre.created_at)) ? new Date(sobre.created_at) : null}, ${cuerpo}, ${db().json(JSON.parse(cuerpo))})
    ON CONFLICT (id) DO NOTHING`;
  return r.count > 0;
}

export async function registrarRechazo(d: { codigo: number; motivo: string; ip: string | null; largo: number }) {
  await db()`INSERT INTO vendario_rechazos (codigo, motivo, ip, largo) VALUES (${d.codigo}, ${d.motivo}, ${d.ip}, ${d.largo})`;
}

type Cliente = {
  id: string; firma_id: string; org_id: string; rnc: string | null; empresa_id: string | null; estado: string; servicios: string[];
  vista_en: Date | null; aceptada_en: Date | null; baja_en: Date | null; empresa_datos: Record<string, string | null>; contacto: Record<string, string | null>;
  responsable_id: string | null; fecha_inicio: string | null;
};
const clienteDe = async (tx: Tx | ReturnType<typeof db>, orgId: string) =>
  (await tx<Cliente[]>`SELECT *, to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio FROM vendario_clientes WHERE org_id = ${orgId}`)[0] ?? null;

const fechaO = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const objeto = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// Procesa un mensaje guardado. Lo que no se puede todavía queda «pendiente» con el motivo y se reintenta solo.
export async function procesarMensaje(id: string): Promise<{ estado: string; motivo?: string; avisar?: string }> {
  const [m] = await db()<{ sobre: Sobre; estado: string }[]>`SELECT sobre, estado FROM vendario_mensajes WHERE id = ${id}`;
  if (!m || m.estado === "procesado") return { estado: "procesado" };
  let r: { estado: "procesado" | "pendiente"; motivo?: string; avisar?: string };
  try {
    r = await db().begin((tx) => aplicar(tx, m.sobre)) as typeof r;
  } catch (e) {
    r = { estado: "pendiente", motivo: `Error al procesar: ${(e as Error).message}`.slice(0, 500) };
  }
  await db()`UPDATE vendario_mensajes SET estado = ${r.estado}, motivo = ${r.motivo ?? null}, intentos = intentos + 1,
                procesado_en = CASE WHEN ${r.estado} = 'procesado' THEN now() ELSE procesado_en END WHERE id = ${id}`;
  if (r.avisar) await avisarAlta(r.avisar).catch(() => {});
  return r;
}

async function aplicar(tx: Tx, s: Sobre): Promise<{ estado: "procesado" | "pendiente"; motivo?: string; avisar?: string }> {
  const d = s.data;
  const c = await clienteDe(tx, s.org.vendario_id);
  switch (s.type) {
    case "client.enroll": {
      const [firma] = await tx<{ id: string }[]>`SELECT id FROM firmas WHERE recibe_vendario`;
      if (!firma) return { estado: "pendiente", motivo: "Ninguna firma recibe clientes de Vendario: márcala en Firma › Vendario" };
      const empresa = objeto(d.company);
      const historia = objeto(d.history);
      const servicios = (d.services as unknown[]).filter((x): x is string => typeof x === "string");
      const campos = {
        rnc: s.org.rnc ?? texto(empresa.rnc), servicios, fecha_inicio: fechaO(d.start_date), historico_desde: fechaO(historia.from),
        historico_hasta: fechaO(historia.to), empresa_datos: tx.json(empresa as never), contacto: tx.json(objeto(d.contact) as never),
        autorizacion: tx.json(objeto(d.authorization) as never),
      };
      if (!c) {
        const [n] = await tx<{ id: string }[]>`
          INSERT INTO vendario_clientes (firma_id, org_id, rnc, servicios, fecha_inicio, historico_desde, historico_hasta, empresa_datos, contacto,
                                         autorizacion, alta_mensaje_id)
          VALUES (${firma.id}, ${s.org.vendario_id}, ${campos.rnc}, ${campos.servicios}, ${campos.fecha_inicio}, ${campos.historico_desde},
                  ${campos.historico_hasta}, ${campos.empresa_datos}, ${campos.contacto}, ${campos.autorizacion}, ${s.id}) RETURNING id`;
        await encolar(tx, n.id, "recibida", {});
        return { estado: "procesado", avisar: n.id };
      }
      // Ya existía: si se había dado de baja, es un alta nueva (vuelve a solicitud); si no, se toma como cambio de datos.
      const nueva = c.estado === "finalizada";
      await tx`
        UPDATE vendario_clientes SET rnc = ${campos.rnc}, servicios = ${campos.servicios}, fecha_inicio = ${campos.fecha_inicio},
               historico_desde = ${campos.historico_desde}, historico_hasta = ${campos.historico_hasta}, empresa_datos = ${campos.empresa_datos},
               contacto = ${campos.contacto}, autorizacion = ${campos.autorizacion}, alta_mensaje_id = ${s.id}, actualizado_en = now(),
               estado = CASE WHEN ${nueva} THEN 'solicitud' ELSE estado END,
               vista_en = CASE WHEN ${nueva} THEN NULL ELSE vista_en END, vista_por = CASE WHEN ${nueva} THEN NULL ELSE vista_por END,
               aceptada_en = CASE WHEN ${nueva} THEN NULL ELSE aceptada_en END, baja_en = CASE WHEN ${nueva} THEN NULL ELSE baja_en END,
               baja_motivo = CASE WHEN ${nueva} THEN NULL ELSE baja_motivo END
         WHERE id = ${c.id}`;
      if (nueva) {
        await encolar(tx, c.id, "recibida", {});
        return { estado: "procesado", avisar: c.id };
      }
      return { estado: "procesado" };
    }
    case "client.update": {
      if (!c) return { estado: "pendiente", motivo: "Cliente desconocido: todavía no llegó su alta" };
      const servicios = Array.isArray(d.services) ? (d.services as unknown[]).filter((x): x is string => typeof x === "string") : null;
      const empresa = d.company === undefined ? null : objeto(d.company);
      const contacto = d.contact === undefined ? null : objeto(d.contact);
      await tx`
        UPDATE vendario_clientes SET servicios = coalesce(${servicios}::text[], servicios),
               empresa_datos = CASE WHEN ${empresa !== null} THEN empresa_datos || ${tx.json((empresa ?? {}) as never)} ELSE empresa_datos END,
               contacto = CASE WHEN ${contacto !== null} THEN ${tx.json((contacto ?? {}) as never)} ELSE contacto END,
               fecha_inicio = coalesce(${fechaO(d.start_date)}::date, fecha_inicio),
               rnc = coalesce(${s.org.rnc}, rnc), actualizado_en = now()
         WHERE id = ${c.id}`;
      // Los servicios contables deciden si Empire lleva la contabilidad completa de la empresa ya creada.
      if (c.empresa_id && servicios) {
        await tx`UPDATE empresas SET lleva_contabilidad = ${servicios.some((x) => SERVICIOS_CONTABLES.includes(x))} WHERE id = ${c.empresa_id}`;
      }
      return { estado: "procesado" };
    }
    case "client.unenroll": {
      if (!c) return { estado: "pendiente", motivo: "Cliente desconocido: todavía no llegó su alta" };
      if (c.estado !== "finalizada") {
        const at = texto(d.at);
        await tx`UPDATE vendario_clientes SET estado = 'finalizada', baja_en = ${at && !Number.isNaN(Date.parse(at)) ? new Date(at) : new Date()},
                   baja_motivo = ${texto(d.reason)}, actualizado_en = now() WHERE id = ${c.id}`;
        await encolar(tx, c.id, "finalizada", {});
      }
      return { estado: "procesado" };
    }
    case "accounting.event": {
      if (!c) return { estado: "pendiente", motivo: "Cliente desconocido: todavía no llegó su alta" };
      const amounts = objeto(d.amounts);
      const total = typeof amounts.total === "string" && /^-?\d+(\.\d{1,2})?$/.test(amounts.total) ? amounts.total : null;
      const ocurrio = texto(d.occurred_at) ?? s.created_at;
      const despues = c.estado === "finalizada" && c.baja_en && ocurrio && Date.parse(ocurrio) > c.baja_en.getTime();
      await tx`
        INSERT INTO vendario_eventos (id, vendario_cliente_id, seq, tipo, fecha, historico, revierte, total, datos, estado, motivo)
        VALUES (${s.id}, ${c.id}, ${s.seq}, ${String(d.event_type)}, ${fechaO(d.date)}, ${d.historical === true},
                ${typeof d.reverses === "string" && /^[0-9a-f-]{36}$/i.test(d.reverses) ? d.reverses.toLowerCase() : null}, ${total},
                ${tx.json(d as never)}, ${despues ? "despues_de_baja" : "esperando"}, ${despues ? "Llegó después de la baja: no se contabiliza" : null})
        ON CONFLICT (id) DO NOTHING`;
      return { estado: "procesado" };
    }
    case "sync.history_complete": {
      if (!c) return { estado: "pendiente", motivo: "Cliente desconocido: todavía no llegó su alta" };
      await tx`UPDATE vendario_clientes SET historico_totales = ${tx.json(d as never)}, historico_completo_en = now(), actualizado_en = now()
                WHERE id = ${c.id}`;
      return { estado: "procesado" };
    }
  }
}

// Lo que quedó sin procesar (por ejemplo, llegó antes de marcar la firma): se reintenta en orden de llegada y de seq.
export async function procesarPendientes(limite = 200): Promise<number> {
  const filas = await db()<{ id: string }[]>`
    SELECT id FROM vendario_mensajes WHERE estado IN ('recibido', 'pendiente') ORDER BY recibido_en, seq NULLS FIRST LIMIT ${limite}`;
  for (const f of filas) await procesarMensaje(f.id);
  return filas.length;
}

// Aviso al equipo de una solicitud nueva: correo a los administradores de la firma (la notificación en Empire es la lista de
// solicitudes del Inicio de la firma).
async function avisarAlta(clienteId: string) {
  const [c] = await db()<{ firma_id: string; nombre: string | null; servicios: string[] }[]>`
    SELECT firma_id, coalesce(empresa_datos->>'legal_name', empresa_datos->>'trade_name') AS nombre, servicios FROM vendario_clientes WHERE id = ${clienteId}`;
  if (!c) return;
  const admins = await db()<{ email: string }[]>`
    SELECT u.email FROM miembros_firma mf JOIN usuarios u ON u.id = mf.usuario_id WHERE mf.firma_id = ${c.firma_id} AND mf.administrador`;
  const url = `${baseApp()}/firma/${c.firma_id}/vendario/${clienteId}`;
  for (const a of admins) {
    await enviarCorreo({
      para: a.email, asunto: `Solicitud nueva desde Vendario: ${c.nombre ?? "empresa sin nombre"}`, titulo: "Solicitud nueva desde Vendario",
      parrafos: [`${c.nombre ?? "Una empresa"} pidió el servicio contable desde Vendario (${c.servicios.join(", ")}).`,
        "Ábrela para ver su autorización, aceptarla con su responsable o pedirle información. Vendario le muestra al cliente cada paso."],
      boton: { texto: "Ver la solicitud", url },
    });
  }
}

// ───── Estados que Empire manda a Vendario ─────

async function encolar(tx: Tx, clienteId: string, estado: EstadoServicio,
  o: { usuarioId?: string | null; contable?: string | null; periodo?: string | null; nota?: string | null; pedidos?: string[] }): Promise<string> {
  const [c] = await tx<{ org_id: string; rnc: string | null }[]>`SELECT org_id, rnc FROM vendario_clientes WHERE id = ${clienteId}`;
  const id = randomUUID();
  const sobre = sobreEstado({ id, ahora: new Date(), org: { vendario_id: c.org_id, rnc: c.rnc }, estado, contable: o.contable, periodo: o.periodo,
    nota: o.nota, pedidos: o.pedidos });
  await tx`INSERT INTO vendario_envios (id, vendario_cliente_id, estado_servicio, sobre, creado_por)
           VALUES (${id}, ${clienteId}, ${estado}, ${tx.json(sobre as never)}, ${o.usuarioId ?? null})`;
  return id;
}

export type Pedir = (url: string, init: RequestInit) => Promise<Response>;

// Manda los estados que tocan. Cada envío se «toma» antes (próximo intento en 10 min) para que dos llamadas no lo manden doble.
export async function enviarPendientes(o: { pedir?: Pedir; limite?: number } = {}): Promise<{ enviados: number; fallidos: number }> {
  const [clave] = clavesDe(process.env.E2V_SECRET);
  if (!clave) return { enviados: 0, fallidos: 0 };
  const tomadas = await db()<{ id: string; sobre: unknown; intentos: number; creado_en: Date }[]>`
    UPDATE vendario_envios SET proximo_intento = now() + interval '10 minutes'
     WHERE id IN (SELECT id FROM vendario_envios WHERE estado = 'pendiente' AND proximo_intento <= now()
                  ORDER BY creado_en LIMIT ${o.limite ?? 20} FOR UPDATE SKIP LOCKED)
    RETURNING id, sobre, intentos, creado_en`;
  const filas = tomadas.sort((a, b) => a.creado_en.getTime() - b.creado_en.getTime()); // en el orden en que se crearon
  let enviados = 0, fallidos = 0;
  for (const f of filas) {
    const cuerpo = JSON.stringify(f.sobre);
    let codigo: number | null = null, respuesta: string | null = null;
    try {
      const r = await (o.pedir ?? fetch)(`${URL_VENDARIO()}/empire-inbox`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Signature": firmar(clave, cuerpo) }, body: cuerpo,
        signal: AbortSignal.timeout(15_000),
      });
      codigo = r.status;
      respuesta = (await r.text()).slice(0, 500);
    } catch (e) {
      respuesta = String((e as Error)?.message ?? e).slice(0, 500);
    }
    const intentos = f.intentos + 1;
    const t = trasRespuesta(codigo, intentos);
    await db()`
      UPDATE vendario_envios SET intentos = ${intentos}, codigo = ${codigo}, respuesta = ${respuesta}, estado = ${t.estado},
             enviado_en = CASE WHEN ${t.estado} = 'enviado' THEN now() ELSE enviado_en END,
             proximo_intento = now() + make_interval(mins => ${t.esperaMin ?? 0})
       WHERE id = ${f.id}`;
    if (t.estado === "enviado") enviados++; else fallidos++;
  }
  return { enviados, fallidos };
}

export async function reenviar(firmaId: string, envioId: string) {
  const r = await db()`UPDATE vendario_envios s SET estado = 'pendiente', intentos = 0, proximo_intento = now() FROM vendario_clientes v
                        WHERE s.id = ${envioId} AND v.id = s.vendario_cliente_id AND v.firma_id = ${firmaId} AND s.estado IN ('fallido', 'rechazado')`;
  if (!r.count) throw new ErrorVendario("Ese envío no está fallido");
}

// ───── Lo que hace el equipo ─────

const nombreDe = async (tx: Tx, usuarioId: string) => (await tx<{ nombre: string }[]>`SELECT nombre FROM usuarios WHERE id = ${usuarioId}`)[0]?.nombre ?? null;

async function exigirCliente(tx: Tx, firmaId: string, clienteId: string): Promise<Cliente> {
  const [c] = await tx<Cliente[]>`SELECT *, to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio FROM vendario_clientes WHERE id = ${clienteId} AND firma_id = ${firmaId} FOR UPDATE`;
  if (!c) throw new ErrorVendario("Esa solicitud no existe");
  return c;
}

// Primera vez que alguien del equipo abre la solicitud: «vista» con su nombre.
export async function registrarVista(firmaId: string, clienteId: string, usuarioId: string): Promise<boolean> {
  return db().begin(async (tx) => {
    const c = await exigirCliente(tx, firmaId, clienteId);
    if (c.vista_en || c.estado === "finalizada") return false;
    await tx`UPDATE vendario_clientes SET vista_en = now(), vista_por = ${usuarioId} WHERE id = ${c.id}`;
    await encolar(tx, c.id, "vista", { usuarioId, contable: await nombreDe(tx, usuarioId) });
    return true;
  }) as Promise<boolean>;
}

// Empresas de la firma con el mismo RNC (para enlazar en vez de crear otra).
export async function empresasConRnc(firmaId: string, rnc: string | null) {
  const r = limpiarRnc(rnc);
  if (!r) return [];
  return db()<{ id: string; nombre: string }[]>`SELECT id, nombre FROM empresas WHERE firma_id = ${firmaId} AND rnc = ${r} ORDER BY nombre`;
}

// Aceptar: se enlaza la empresa que ya está en Empire con ese RNC o se crea con los datos del alta, con su responsable.
export async function aceptar(d: { firmaId: string; clienteId: string; usuarioId: string; responsableId: string; empresaId: string | null }) {
  return db().begin(async (tx) => {
    const c = await exigirCliente(tx, d.firmaId, d.clienteId);
    if (!["solicitud", "necesita_info"].includes(c.estado) || c.aceptada_en) throw new ErrorVendario("Esta solicitud ya no se puede aceptar");
    const [resp] = await tx<{ nombre: string }[]>`
      SELECT u.nombre FROM miembros_firma mf JOIN usuarios u ON u.id = mf.usuario_id WHERE mf.firma_id = ${d.firmaId} AND mf.usuario_id = ${d.responsableId}`;
    if (!resp) throw new ErrorVendario("Elige el responsable entre el equipo de la firma");
    const contable = SERVICIOS_CONTABLES.some((s) => c.servicios.includes(s));
    let empresaId = d.empresaId;
    if (empresaId) {
      const [e] = await tx<{ id: string }[]>`SELECT id FROM empresas WHERE id = ${empresaId} AND firma_id = ${d.firmaId}`;
      if (!e) throw new ErrorVendario("Esa empresa no es de la firma");
      const [otro] = await tx`SELECT 1 FROM vendario_clientes WHERE empresa_id = ${empresaId} AND id <> ${c.id} AND estado <> 'finalizada'`;
      if (otro) throw new ErrorVendario("Esa empresa ya está enlazada con otra cuenta de Vendario");
    } else {
      const e = c.empresa_datos;
      const rnc = limpiarRnc(c.rnc ?? e.rnc ?? null) || null;
      empresaId = await crearEmpresa({
        firmaId: d.firmaId, usuarioId: d.usuarioId,
        ficha: {
          nombre: e.legal_name || e.trade_name || "Empresa de Vendario", nombre_comercial: e.trade_name ?? null,
          tipo_identificacion: rnc && rnc.length === 11 ? "cedula" : "rnc", rnc, actividad_economica: null, regimen: "ordinario",
          direccion: e.address ?? null, telefono: e.phone ?? null, correo: c.contacto.email ?? null, mes_cierre: 12, inicio_operaciones: null,
          requiere_aprobacion: false, activa: true,
        },
      }, tx);
      if (c.contacto.name) {
        await tx`INSERT INTO contactos_empresa (empresa_id, rol, nombre, telefono, whatsapp, correo)
                 VALUES (${empresaId}, 'principal', ${c.contacto.name}, ${c.contacto.phone ?? null}, ${c.contacto.phone ?? null}, ${c.contacto.email ?? null})`;
      }
    }
    await tx`UPDATE empresas SET estado_cliente = 'activo', responsable_id = ${d.responsableId}, lleva_contabilidad = lleva_contabilidad OR ${contable},
                    fecha_inicio_contrato = coalesce(fecha_inicio_contrato, ${c.fecha_inicio}::date) WHERE id = ${empresaId}`;
    await tx`UPDATE vendario_clientes SET estado = 'aceptada', empresa_id = ${empresaId}, responsable_id = ${d.responsableId}, aceptada_por = ${d.usuarioId},
                    aceptada_en = now(), nota = NULL, actualizado_en = now() WHERE id = ${c.id}`;
    await encolar(tx, c.id, "aceptada", { usuarioId: d.usuarioId, contable: resp.nombre });
    return empresaId;
  }) as Promise<string>;
}

// Pedir información, suspender, trabajar un período o marcarlo al día.
export async function cambiarEstado(d: { firmaId: string; clienteId: string; usuarioId: string; estado: EstadoServicio; periodo?: string | null;
  nota?: string | null; pedidos?: string[] }) {
  const e = ESTADOS[d.estado];
  if (!e || !["necesita_info", "suspendida", "en_proceso", "al_dia"].includes(d.estado)) throw new ErrorVendario("Ese estado no se cambia a mano");
  if (e.nota && !d.nota?.trim()) throw new ErrorVendario("Escribe la nota que verá el cliente");
  if (e.periodo && !PERIODO.test(d.periodo ?? "")) throw new ErrorVendario("Elige el período (mes)");
  return db().begin(async (tx) => {
    const c = await exigirCliente(tx, d.firmaId, d.clienteId);
    if (c.estado === "finalizada") throw new ErrorVendario("El servicio terminó: Vendario dio de baja a este cliente");
    if (d.estado !== "necesita_info" && !c.empresa_id) throw new ErrorVendario("Primero acepta la solicitud");
    const nuevo = d.estado === "necesita_info" ? "necesita_info" : d.estado === "suspendida" ? "suspendida" : "aceptada";
    await tx`UPDATE vendario_clientes SET estado = ${nuevo}, nota = ${e.nota ? d.nota!.trim() : null},
                    al_dia_hasta = CASE WHEN ${d.estado === "al_dia"} THEN ${d.periodo ?? null} ELSE al_dia_hasta END, actualizado_en = now()
              WHERE id = ${c.id}`;
    await encolar(tx, c.id, d.estado, {
      usuarioId: d.usuarioId, contable: await nombreDe(tx, c.responsable_id ?? d.usuarioId), periodo: e.periodo ? d.periodo : null,
      nota: e.nota ? d.nota!.trim() : null, pedidos: d.estado === "necesita_info" ? d.pedidos : undefined,
    });
  });
}

export async function marcarFirmaReceptora(firmaId: string, recibe: boolean) {
  await db().begin(async (tx) => {
    if (recibe) await tx`UPDATE firmas SET recibe_vendario = false WHERE recibe_vendario AND id <> ${firmaId}`;
    await tx`UPDATE firmas SET recibe_vendario = ${recibe} WHERE id = ${firmaId}`;
  });
  if (recibe) await procesarPendientes(); // las altas que esperaban una firma
}
