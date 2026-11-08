"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { conEmpresa, db, mensajeError } from "@/lib/db";
import { urlApp } from "@/lib/enlaces";
import {
  aceptarFormulario, cambiarSolicitud, descartarFormulario, ErrorFormulario, ESTADOS_SOLICITUD, nuevoToken, ORIGENES_SOLICITUD, ponerEnlace,
  PRIORIDADES, SECCIONES_FICHA, TIPOS_FORMULARIO,
} from "@/lib/formularios";
import { aCentavos, hoyISO } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { precioPara, preciosVigentes } from "@/lib/precios";
import { guardarPropuesta } from "@/lib/propuestas";
import type { Estado } from "../../acciones-cuenta";

// Bloque 6, entrega 6a: formularios en línea (enviar, aceptar, descartar) y solicitudes del cliente (anotar, mover y cotizar).

const mensaje = (e: unknown) => (e instanceof ErrorFormulario ? e.message : mensajeError(e));
const volver = (id: string) => revalidatePath(`/e/${id}/solicitudes`);

export async function crearFormulario(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/solicitudes");
  const tipo = String(fd.get("tipo") ?? "");
  if (!(tipo in TIPOS_FORMULARIO)) return { error: "Elige el formulario." };
  try {
    await conEmpresa(empresaId, (tx) => tx`INSERT INTO formularios (empresa_id, tipo, creado_por) VALUES (${empresaId}, ${tipo}, ${usuario.id})`);
  } catch (e) {
    return { error: mensaje(e) };
  }
  volver(empresaId);
  return { ok: `${TIPOS_FORMULARIO[tipo].nombre}: ya se puede enviar por WhatsApp o copiar su enlace.` };
}

// Enlace para copiar y mandarlo por otro medio. Reemplaza el anterior (el que se haya mandado antes deja de funcionar).
export async function enlaceParaCopiar(empresaId: string, formularioId: string): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/solicitudes");
  if (!esUuid(formularioId)) return { error: "Ese formulario no existe." };
  const token = nuevoToken();
  try {
    await conEmpresa(empresaId, (tx) => ponerEnlace(tx, formularioId, token));
  } catch (e) {
    return { error: mensaje(e) };
  }
  volver(empresaId);
  return { ok: `Enlace (vale 30 días; el anterior dejó de funcionar): ${await urlApp()}/f/${token}` };
}

export async function aceptarFormularioAccion(empresaId: string, formularioId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, permisos } = await exigirPermiso(empresaId, "registrar", "/solicitudes");
  if (!esUuid(formularioId)) return { error: "Ese formulario no existe." };
  const secciones = Object.keys(SECCIONES_FICHA).filter((s) => fd.get(`sec_${s}`) === "on" && (s !== "empleados" || puede(permisos, "empresa")));
  try {
    await conEmpresa(empresaId, (tx) => aceptarFormulario(tx, { formularioId, empresaId, secciones, usuarioId: usuario.id }));
  } catch (e) {
    return { error: mensaje(e) };
  }
  volver(empresaId);
  revalidatePath(`/e/${empresaId}/empresa`);
  revalidatePath(`/e/${empresaId}/expediente`);
  return { ok: "Datos cargados." };
}

export async function descartarFormularioAccion(empresaId: string, formularioId: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/solicitudes");
  if (!esUuid(formularioId)) return { error: "Ese formulario no existe." };
  try {
    await conEmpresa(empresaId, (tx) => descartarFormulario(tx, formularioId, usuario.id));
  } catch (e) {
    return { error: mensaje(e) };
  }
  volver(empresaId);
  return { ok: "Formulario descartado: su enlace ya no funciona." };
}

// Anotar una solicitud que llegó por WhatsApp, por escrito o en una llamada.
export async function registrarSolicitud(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "registrar", "/solicitudes");
  const v = (k: string) => String(fd.get(k) ?? "").trim();
  const origen = v("origen"), tipo = v("tipo") || "servicio", prioridad = v("prioridad") || "media";
  const descripcion = v("descripcion").slice(0, 2000), paraQue = v("para_que").slice(0, 1000) || null;
  const fecha = v("fecha_requerida") || null, responsable = v("responsable") || null, servicio = v("servicio").slice(0, 200) || null;
  if (!(origen in ORIGENES_SOLICITUD) || !(prioridad in PRIORIDADES) || !["servicio", "requerimiento"].includes(tipo)) return { error: "Revisa las opciones." };
  if (!descripcion) return { error: "Describe lo que pide el cliente." };
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: "La fecha no es válida." };
  if (responsable) {
    const [m] = esUuid(responsable) ? await db()`SELECT 1 FROM miembros_firma WHERE firma_id = ${empresa.firma_id} AND usuario_id = ${responsable}` : [];
    if (!m) return { error: "Elige el responsable de la lista." };
  }
  try {
    await conEmpresa(empresaId, (tx) => tx`
      INSERT INTO solicitudes (empresa_id, origen, tipo, servicio, descripcion, para_que, fecha_requerida, prioridad, responsable_id, creado_por)
      VALUES (${empresaId}, ${origen}, ${tipo}, ${servicio}, ${descripcion}, ${paraQue}, ${fecha}, ${prioridad}, ${responsable}, ${usuario.id})`);
  } catch (e) {
    return { error: mensaje(e) };
  }
  volver(empresaId);
  return { ok: "Solicitud anotada." };
}

export async function cambiarEstadoSolicitud(empresaId: string, solicitudId: string, estado: string): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/solicitudes");
  if (!esUuid(solicitudId) || !(estado in ESTADOS_SOLICITUD)) return { error: "Datos no válidos." };
  try {
    await conEmpresa(empresaId, (tx) => cambiarSolicitud(tx, solicitudId, estado));
  } catch (e) {
    return { error: mensaje(e) };
  }
  volver(empresaId);
  return { ok: `Solicitud ${ESTADOS_SOLICITUD[estado].toLowerCase()}.` };
}

// «Cotizar»: un borrador de propuesta en la empresa propia de la firma, con el servicio pedido y el precio de la categoría del
// cliente (bloque 2). La solicitud queda «cotizada» con el número de la propuesta.
export async function cotizarSolicitud(empresaId: string, solicitudId: string): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "registrar", "/solicitudes");
  if (!esUuid(solicitudId)) return { error: "Esa solicitud no existe." };
  const [f] = await db()<{ propia: string | null }[]>`SELECT empresa_propia_id AS propia FROM firmas WHERE id = ${empresa.firma_id}`;
  if (!f?.propia) return { error: "Primero marca la empresa propia de la firma (Empresas Empire)." };
  const propia = f.propia;
  await exigirPermiso(propia, "registrar", "/propuestas");
  try {
    const [s] = await conEmpresa(empresaId, (tx) => tx<{ estado: string; servicio_id: string | null; servicio: string | null; descripcion: string; fecha_requerida: string | null }[]>`
      SELECT estado, servicio_id, servicio, descripcion, to_char(fecha_requerida, 'YYYY-MM-DD') AS fecha_requerida FROM solicitudes WHERE id = ${solicitudId}`);
    if (!s) return { error: "Esa solicitud no existe." };
    if (s.estado !== "recibida") return { error: "Esa solicitud ya se cotizó o se cerró." };
    const hoy = hoyISO();
    const propuesta = await conEmpresa(propia, async (tx) => {
      const [c] = await tx<{ id: string; categoria: string | null }[]>`SELECT id, categoria FROM clientes WHERE empresa_vinculada_id = ${empresaId}`;
      if (!c) throw new ErrorFormulario("Este cliente todavía no está en la facturación de la empresa propia.");
      const [sv] = s.servicio_id ? await tx<{ id: string; nombre: string; precio: string; impuesto_id: string | null; impuesto_adicional_id: string | null; unidad_id: string | null }[]>`
        SELECT id, nombre, precio::text, impuesto_id, impuesto_adicional_id, unidad_id FROM servicios WHERE id = ${s.servicio_id}` : [];
      const [itbis] = await tx<{ id: string }[]>`SELECT id FROM impuestos WHERE tipo = 'itbis' AND activo ORDER BY tasa DESC LIMIT 1`;
      const impuestoId = sv?.impuesto_id ?? itbis?.id;
      if (!impuestoId) throw new ErrorFormulario("La empresa propia no tiene configurado el ITBIS.");
      const precio = sv ? precioPara(sv.precio, (await preciosVigentes(tx, hoy)).get(sv.id), c.categoria).precio : "0.00";
      const vence = new Date(Date.parse(`${hoy}T00:00:00Z`) + 15 * 86400000).toISOString().slice(0, 10);
      const id = await guardarPropuesta(tx, {
        empresaId: propia, usuarioId: usuario.id, clienteId: c.id, fecha: hoy, validaHasta: vence, requisitos: null, anticipoPct: "0",
        formaPago: null, entrega: s.fecha_requerida, notas: `Según la solicitud del cliente: ${s.descripcion}`.slice(0, 1000),
        lineas: [{ servicioId: sv?.id ?? null, descripcion: sv?.nombre ?? s.servicio ?? s.descripcion.slice(0, 200), cantidad: 10000n,
          precioLista: aCentavos(precio), descuento: 0n, impuestoId, adicionalId: sv?.impuesto_adicional_id ?? null, unidadId: sv?.unidad_id ?? null }],
      });
      const [{ numero }] = await tx<{ numero: number }[]>`SELECT numero FROM propuestas WHERE id = ${id}`;
      return { id, numero };
    });
    await conEmpresa(empresaId, (tx) => tx`
      UPDATE solicitudes SET estado = 'cotizada', propuesta_id = ${propuesta.id}, propuesta_numero = ${propuesta.numero} WHERE id = ${solicitudId}`);
    volver(empresaId);
    return { ok: `Borrador de la propuesta n.º ${propuesta.numero} creado en la empresa propia: revísalo y envíalo.` };
  } catch (e) {
    return { error: mensaje(e) };
  }
}
