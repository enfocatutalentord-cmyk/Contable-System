"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clienteDeFormulario } from "@/lib/cliente-rapido";
import { mensajeError } from "@/lib/db";
import { crearFormulario, registrarSolicitud } from "../e/[id]/solicitudes-acciones";
import type { Estado } from "../acciones-cuenta";

// Prioridad 2.2 (P2c.2): trabajos que arrancan desde la pantalla de la firma, eligiendo el cliente o creándolo ahí mismo.

// Nueva solicitud de un cliente (llegó por WhatsApp, llamada, escrito…).
export async function crearSolicitudAccion(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  let id: string;
  try {
    id = (await clienteDeFormulario(firmaId, fd)).id;
  } catch (e) {
    return { error: mensajeError(e) };
  }
  const r = await registrarSolicitud(id, {}, fd);
  revalidatePath(`/firma/${firmaId}/solicitudes`);
  return r;
}

// Un levantamiento contable nuevo: se crea el formulario del cliente y se sigue a su pantalla para mandarle el enlace.
export async function iniciarLevantamientoAccion(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  let id: string;
  try {
    id = (await clienteDeFormulario(firmaId, fd, { prospecto: true })).id;
  } catch (e) {
    return { error: mensajeError(e) };
  }
  const f = new FormData();
  f.set("tipo", "levantamiento");
  f.set("modo", String(fd.get("modo") ?? ""));
  const r = await crearFormulario(id, {}, f);
  if (r.error) return r;
  redirect(`/e/${id}/solicitudes`);
}

// Elegir (o crear) el cliente y seguir a su pantalla de trabajo: cargar facturas, subir documentos…
const DESTINOS = ["facturas-subidas", "recepcion", "expediente", "solicitudes", "bitacora"];
export async function elegirClienteYSeguir(firmaId: string, destino: string, _: Estado, fd: FormData): Promise<Estado> {
  if (!DESTINOS.includes(destino)) return { error: "Esa pantalla no existe." };
  let id: string;
  try {
    id = (await clienteDeFormulario(firmaId, fd)).id;
  } catch (e) {
    return { error: mensajeError(e) };
  }
  redirect(`/e/${id}/${destino}`);
}
