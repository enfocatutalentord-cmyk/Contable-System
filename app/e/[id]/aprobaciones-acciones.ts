"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { aprobar, devolver } from "@/lib/aprobaciones";
import { bitacora } from "@/lib/asientos";
import { conEmpresa, mensajeError } from "@/lib/db";
import type { Estado } from "../../acciones-cuenta";

// Prioridad 2.1 (P2a): aprobar o devolver lo que otra persona preparó con un permiso «con aprobación». Pide el permiso «aprobar»; quien
// lo preparó nunca aprueba ni devuelve lo suyo (lo revisa la biblioteca).

export async function aprobarAccion(empresaId: string, aprobacionId: string, _: Estado): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "aprobar");
  if (!esUuid(aprobacionId)) return { error: "La solicitud no existe." };
  try {
    await conEmpresa(empresaId, async (tx) => {
      await aprobar(tx, { empresaId, usuarioId: usuario.id, id: aprobacionId });
      await bitacora(tx, empresaId, usuario.id, "aprobacion_aprobada", { id: aprobacionId });
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  revalidatePath(`/firma`, "layout");
  return { ok: "Aprobado: ya quedó hecho." };
}

export async function devolverAccion(empresaId: string, aprobacionId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "aprobar");
  if (!esUuid(aprobacionId)) return { error: "La solicitud no existe." };
  try {
    await conEmpresa(empresaId, async (tx) => {
      await devolver(tx, { empresaId, usuarioId: usuario.id, id: aprobacionId, motivo: String(fd.get("motivo") ?? "") });
      await bitacora(tx, empresaId, usuario.id, "aprobacion_devuelta", { id: aprobacionId });
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  revalidatePath(`/firma`, "layout");
  return { ok: "Devuelto con lo que hay que corregir." };
}
