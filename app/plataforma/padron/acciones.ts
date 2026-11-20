"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirDuena } from "@/lib/acceso";
import { mensajeError } from "@/lib/db";
import { leerBloquePadron, type FilaPadron } from "@/lib/padron";
import { cargarTanda, fallarCarga, iniciarCarga, terminarCarga } from "@/lib/padron-db";

// Carga del padrón de la DGII (P2c.3): solo la dueña de la plataforma. El navegador corta el archivo en tandas y las manda una por una.

type Resp<T> = ({ ok: true } & T) | { ok: false; error: string };

export async function vistaPreviaPadron(texto: string): Promise<Resp<{ filas: FilaPadron[]; rechazadas: number; separador: string }>> {
  await exigirDuena();
  const r = leerBloquePadron(String(texto).slice(0, 200_000));
  return { ok: true, filas: r.filas.slice(0, 6), rechazadas: r.rechazadas, separador: r.separador };
}

export async function empezarCargaPadron(archivo: string): Promise<Resp<{ id: string }>> {
  const usuario = await exigirDuena();
  try {
    return { ok: true, id: await iniciarCarga(usuario, String(archivo || "padron")) };
  } catch (e) {
    return { ok: false, error: mensajeError(e) };
  }
}

export async function subirTandaPadron(cargaId: string, texto: string): Promise<Resp<{ filas: number; rechazadas: number }>> {
  await exigirDuena();
  if (!esUuid(cargaId)) return { ok: false, error: "Carga no válida." };
  try {
    return { ok: true, ...(await cargarTanda(cargaId, String(texto))) };
  } catch (e) {
    return { ok: false, error: mensajeError(e) };
  }
}

export async function terminarCargaPadron(cargaId: string): Promise<Resp<{ filas: number; rechazadas: number }>> {
  await exigirDuena();
  if (!esUuid(cargaId)) return { ok: false, error: "Carga no válida." };
  try {
    const c = await terminarCarga(cargaId);
    revalidatePath("/plataforma/padron");
    if (c.estado !== "completa") return { ok: false, error: c.nota ?? "No se cargó ninguna fila." };
    return { ok: true, filas: c.filas, rechazadas: c.rechazadas };
  } catch (e) {
    return { ok: false, error: mensajeError(e) };
  }
}

export async function cancelarCargaPadron(cargaId: string, motivo: string): Promise<void> {
  await exigirDuena();
  if (!esUuid(cargaId)) return;
  await fallarCarga(cargaId, String(motivo || "Se cortó la carga."));
  revalidatePath("/plataforma/padron");
}
