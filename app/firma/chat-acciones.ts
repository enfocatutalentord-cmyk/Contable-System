"use server";

import { revalidatePath } from "next/cache";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { enviarMensaje, ErrorChat, existeTrabajo, leerHilo, marcarLeido, type Hilo } from "@/lib/chat";
import { clientesDeFirma } from "@/lib/firma";
import type { Estado } from "../acciones-cuenta";

// Prioridad 2.2 (P2b): chat interno del equipo. Lo usa el equipo de la firma (no los usuarios de los clientes) y cada quien solo conversa
// sobre los clientes que ve.

// Revisa que la persona pueda estar en esa conversación: del equipo y, si es de un cliente o de un trabajo, que vea ese cliente.
async function permitido(firmaId: string, clave: string): Promise<{ usuarioId: string; hilo: Hilo }> {
  const { usuario, firma } = await accesoFirma(firmaId, false);
  if (await soloCliente(firmaId, usuario.id)) throw new ErrorChat("El chat es del equipo de la firma.");
  const hilo = leerHilo(clave);
  if (!hilo) throw new ErrorChat("Esa conversación no existe.");
  if (hilo.empresaId) {
    const clientes = await clientesDeFirma(firmaId, usuario.id, firma.administrador, true);
    if (!clientes.some((c) => c.id === hilo.empresaId)) throw new ErrorChat("No tienes acceso a ese cliente.");
    if (hilo.solicitudId && !(await existeTrabajo(hilo.empresaId, hilo.solicitudId))) throw new ErrorChat("Ese trabajo no existe.");
  }
  return { usuarioId: usuario.id, hilo };
}

export async function enviarMensajeChat(firmaId: string, clave: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { usuarioId, hilo } = await permitido(firmaId, clave);
    await enviarMensaje(firmaId, usuarioId, hilo, String(fd.get("texto") ?? ""));
  } catch (e) {
    if (e instanceof ErrorChat) return { error: e.message };
    throw e;
  }
  revalidatePath(`/firma/${firmaId}/chat`);
  return { ok: "" };
}

// Lo llama la pantalla al abrir una conversación con mensajes nuevos.
export async function marcarLeidoChat(firmaId: string, clave: string): Promise<void> {
  try {
    const { usuarioId, hilo } = await permitido(firmaId, clave);
    await marcarLeido(firmaId, usuarioId, hilo.clave);
  } catch (e) {
    if (!(e instanceof ErrorChat)) throw e;
  }
}
