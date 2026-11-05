"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { cambiarNotificacion, ErrorBitacora, ESTADOS_GESTION, leerGestion, leerNotificacion } from "@/lib/bitacora";
import { conEmpresa, mensajeError, type Tx } from "@/lib/db";
import { huella, nombreSeguro, TAMANO_MAXIMO, tipoPorContenido } from "@/lib/documentos";
import { hoyISO } from "@/lib/montos";
import type { Estado } from "../../acciones-cuenta";

// Bloque 3, entrega 3a: bitácora (/bitacora) y notificaciones de pago (/notificaciones).

const error = (e: unknown): Estado => ({ error: e instanceof ErrorBitacora ? e.message : mensajeError(e) });

// Adjunta un PDF, JPG o PNG (opcional) a una gestión o notificación.
async function adjuntar(tx: Tx, empresaId: string, entidad: "gestion" | "notificacion", entidadId: string, archivo: FormDataEntryValue | null, usuarioId: string) {
  if (!(archivo instanceof File) || archivo.size === 0) return;
  if (archivo.size > TAMANO_MAXIMO) throw new ErrorBitacora("El archivo pasa de 4 MB.");
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const tipo = tipoPorContenido(bytes);
  if (!tipo) throw new ErrorBitacora("Solo se aceptan PDF, JPG y PNG.");
  await tx`INSERT INTO documentos (empresa_id, entidad, entidad_id, nombre, tipo, tamano, sha256, contenido, subido_por)
           VALUES (${empresaId}, ${entidad}, ${entidadId}, ${nombreSeguro(archivo.name)}, ${tipo}, ${bytes.length}, ${huella(bytes)}, ${Buffer.from(bytes)}, ${usuarioId})`;
}

export async function anotarGestion(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/bitacora");
  try {
    const g = leerGestion(fd, hoyISO());
    await conEmpresa(empresaId, async (tx) => {
      const [{ id }] = await tx<{ id: string }[]>`
        INSERT INTO gestiones (empresa_id, fecha, tipo, descripcion, responsable_id, entrega, estado, creado_por)
        VALUES (${empresaId}, ${g.fecha}, ${g.tipo}, ${g.descripcion}, ${g.responsableId ?? usuario.id}, ${g.entrega}, ${g.estado}, ${usuario.id})
        RETURNING id`;
      await adjuntar(tx, empresaId, "gestion", id, fd.get("archivo"), usuario.id);
    });
  } catch (e) {
    return error(e);
  }
  revalidatePath(`/e/${empresaId}/bitacora`);
  return { ok: "Gestión anotada." };
}

export async function cambiarEstadoGestion(empresaId: string, gestionId: string, estado: string): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/bitacora");
  if (!esUuid(gestionId) || !(estado in ESTADOS_GESTION)) return { error: "Datos no válidos." };
  await conEmpresa(empresaId, (tx) => tx`UPDATE gestiones SET estado = ${estado} WHERE id = ${gestionId}`);
  revalidatePath(`/e/${empresaId}/bitacora`);
  return { ok: `Marcada como ${ESTADOS_GESTION[estado].toLowerCase()}.` };
}

// Solo se borran las gestiones anotadas a mano; las del sistema reflejan algo que pasó (queda el historial de cambios).
export async function borrarGestion(empresaId: string, gestionId: string): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/bitacora");
  if (!esUuid(gestionId)) return { error: "La gestión no existe." };
  const r = await conEmpresa(empresaId, (tx) => tx`DELETE FROM gestiones WHERE id = ${gestionId} AND origen = 'manual'`);
  if (r.count === 0) return { error: "Las gestiones que anota el sistema no se borran." };
  revalidatePath(`/e/${empresaId}/bitacora`);
  return { ok: "Gestión borrada." };
}

export async function registrarNotificacion(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/notificaciones");
  try {
    const n = leerNotificacion(fd);
    await conEmpresa(empresaId, async (tx) => {
      const [{ id }] = await tx<{ id: string }[]>`
        INSERT INTO notificaciones_pago (empresa_id, tipo, periodo, concepto, monto, fecha_limite, creado_por)
        VALUES (${empresaId}, ${n.tipo}, ${n.periodo}, ${n.concepto}, ${n.monto}, ${n.fechaLimite}, ${usuario.id}) RETURNING id`;
      await adjuntar(tx, empresaId, "notificacion", id, fd.get("archivo"), usuario.id);
    });
  } catch (e) {
    return error(e);
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: "Notificación registrada: queda pendiente de enviar al cliente." };
}

export async function cambiarEstadoNotificacion(empresaId: string, notificacionId: string, estado: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/notificaciones");
  if (!esUuid(notificacionId)) return { error: "La notificación no existe." };
  try {
    await conEmpresa(empresaId, (tx) => cambiarNotificacion(tx, notificacionId, estado, usuario.id));
  } catch (e) {
    return error(e);
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: estado === "enviada" ? "Marcada como enviada; quedó en la bitácora." : estado === "pagada" ? "Marcada como pagada." : "Vuelve a pendiente." };
}
