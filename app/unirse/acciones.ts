"use server";

import { headers } from "next/headers";
import { esUuid } from "@/lib/acceso";
import { leerAlta } from "@/lib/prospectos";
import { registrarProspecto } from "@/lib/prospectos-alta";
import type { Estado } from "../acciones-cuenta";

// Página pública de la firma: cualquiera crea su cuenta y queda como prospecto (bloque 8a). La respuesta es la misma exista o no
// la cuenta, para no revelar quién está registrado.
export async function crearCuentaProspecto(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  if (!esUuid(firmaId)) return { error: "Esta página de registro no está disponible." };
  const d = leerAlta(fd);
  if (typeof d === "string") return { error: d };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null;
  try {
    const r = await registrarProspecto(firmaId, d, ip);
    if (!r.ok) return { error: r.error };
  } catch (e) {
    console.error("[prospecto]", e);
    return { error: "No pudimos crear la cuenta en este momento. Inténtalo de nuevo o escríbenos por WhatsApp." };
  }
  return { ok: `Listo. Te enviamos un correo a ${d.email} para verificarlo y crear tu contraseña. Si no lo ves, revisa la carpeta de correo no deseado.` };
}
