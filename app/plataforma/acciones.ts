"use server";

import { revalidatePath } from "next/cache";
import { db, mensajeError } from "@/lib/db";
import { esUuid, exigirDuena } from "@/lib/acceso";
import { registrar } from "@/lib/plataforma";
import type { Estado } from "../acciones-cuenta";

// Suspender o reactivar una firma desde la Consola de la plataforma, siempre con un motivo, que queda en el registro.
async function cambiarSuspension(firmaId: string, suspender: boolean, fd: FormData): Promise<Estado> {
  const usuario = await exigirDuena();
  if (!esUuid(firmaId)) return { error: "Firma no válida." };
  const motivo = String(fd.get("motivo") ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
  if (motivo.length < 5) return { error: "Escribe el motivo (al menos 5 letras)." };
  try {
    const [f] = suspender
      ? await db()<{ id: string; nombre: string }[]>`
          UPDATE firmas SET suspendida_en = now(), suspendida_motivo = ${motivo}, suspendida_por = ${usuario.id}
           WHERE id = ${firmaId} AND suspendida_en IS NULL RETURNING id, nombre`
      : await db()<{ id: string; nombre: string }[]>`
          UPDATE firmas SET suspendida_en = NULL, suspendida_motivo = NULL, suspendida_por = NULL
           WHERE id = ${firmaId} AND suspendida_en IS NOT NULL RETURNING id, nombre`;
    if (!f) return { error: suspender ? "La firma ya estaba suspendida." : "La firma no estaba suspendida." };
    await registrar(usuario, f, suspender ? "suspender" : "reactivar", motivo);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath("/plataforma", "layout");
  return { ok: suspender ? "Firma suspendida: nadie de la firma puede entrar hasta que se reactive." : "Firma reactivada." };
}

export async function suspenderFirma(firmaId: string, _: Estado, fd: FormData) {
  return cambiarSuspension(firmaId, true, fd);
}

export async function reactivarFirma(firmaId: string, _: Estado, fd: FormData) {
  return cambiarSuspension(firmaId, false, fd);
}
