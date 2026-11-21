"use server";

import { headers } from "next/headers";
import { ErrorFirma, firmarPorToken, leerFirma, rechazarPorToken } from "@/lib/firma-digital";
import { mensajeError } from "@/lib/db";
import type { Estado } from "../acciones-cuenta";

// Prioridad 3 · P3e: las dos cosas que hace el cliente desde el enlace, sin cuenta: firmar o decir por qué no firma. Se guarda la dirección de internet y el
// dispositivo desde los que se hizo.

async function origen() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null, agente: h.get("user-agent") };
}

export async function firmarDocumento(token: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const datos = leerFirma(fd);
    const { ip, agente } = await origen();
    await firmarPorToken(token, datos, ip, agente);
  } catch (e) {
    return { error: e instanceof ErrorFirma ? e.message : mensajeError(e) };
  }
  return { ok: "Listo: el documento quedó firmado. Puede bajar su copia aquí abajo." };
}

export async function rechazarDocumento(token: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { ip } = await origen();
    await rechazarPorToken(token, String(fd.get("motivo") ?? ""), ip);
  } catch (e) {
    return { error: e instanceof ErrorFirma ? e.message : mensajeError(e) };
  }
  return { ok: "Gracias. Le avisamos a la firma que no firmó y por qué." };
}
