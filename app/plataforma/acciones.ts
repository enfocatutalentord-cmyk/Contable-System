"use server";

import { revalidatePath } from "next/cache";
import { db, mensajeError } from "@/lib/db";
import { esUuid, exigirDuena } from "@/lib/acceso";
import { redirect } from "next/navigation";
import { permisoSupervision, registrar, supervisionVigente } from "@/lib/plataforma";
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

// Entrar a una firma como supervisora: solo con su permiso vigente y un motivo. Dura una hora.
export async function iniciarSupervision(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const usuario = await exigirDuena();
  if (!esUuid(firmaId)) return { error: "Firma no válida." };
  const motivo = String(fd.get("motivo") ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
  if (motivo.length < 5) return { error: "Escribe para qué entras (al menos 5 letras)." };
  try {
    if (!(await permisoSupervision(firmaId))) return { error: "La firma no ha permitido la supervisión, o el permiso venció." };
    const [f] = await db()<{ id: string; nombre: string }[]>`SELECT id, nombre FROM firmas WHERE id = ${firmaId}`;
    if (!f) return { error: "Firma no válida." };
    if (!(await supervisionVigente(usuario.id, firmaId))) {
      await db()`INSERT INTO supervisiones (usuario_id, firma_id, motivo) VALUES (${usuario.id}, ${firmaId}, ${motivo})`;
      await registrar(usuario, f, "supervisar", motivo);
    }
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/plataforma/${firmaId}`);
  return { ok: "Supervisión abierta por una hora. Entra al cliente que necesitas desde la lista." };
}

export async function terminarSupervision(firmaId: string): Promise<void> {
  const usuario = await exigirDuena();
  if (!esUuid(firmaId)) return;
  const s = await supervisionVigente(usuario.id, firmaId);
  if (s) {
    await db()`UPDATE supervisiones SET terminada_en = now() WHERE id = ${s.id}`;
    const [f] = await db()<{ id: string; nombre: string }[]>`SELECT id, nombre FROM firmas WHERE id = ${firmaId}`;
    if (f) await registrar(usuario, f, "terminar_supervision");
  }
  redirect(`/plataforma/${firmaId}`);
}
