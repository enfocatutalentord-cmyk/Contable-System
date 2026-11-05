"use server";

import { conEmpresa, mensajeError } from "@/lib/db";
import { ErrorExpediente, leerArchivos } from "@/lib/expediente";
import { ErrorFormulario, formularioPorToken, leerRespuestas, recibirFormulario, serviciosDeLaFirma } from "@/lib/formularios";
import type { Estado } from "../acciones-cuenta";

// Bloque 6, entrega 6a: lo que envía el cliente desde el enlace (sin sesión). El enlace es el permiso: se busca por su hash, vence a
// los 30 días y sirve una sola vez. Nada entra a la ficha: queda esperando que la firma lo revise.
export async function enviarFormularioPublico(token: string, _: Estado, fd: FormData): Promise<Estado> {
  const f = await formularioPorToken(token);
  if (!f) return { error: "El enlace venció o ya no está disponible. Pida uno nuevo a la firma." };
  if (f.estado !== "pendiente") return { error: "Este formulario ya se envió. Gracias." };
  try {
    const servicios = f.tipo === "solicitud" ? new Map((await serviciosDeLaFirma(f.propia)).map((s) => [s.id, s.nombre])) : undefined;
    const respuestas = leerRespuestas(f.tipo, fd, servicios);
    const archivos = await leerArchivos(fd, "archivos", 10);
    await conEmpresa(f.empresa_id, (tx) => recibirFormulario(tx, f, respuestas, archivos));
  } catch (e) {
    return { error: e instanceof ErrorFormulario || e instanceof ErrorExpediente ? e.message : mensajeError(e) };
  }
  return { ok: "¡Gracias! Recibimos su información. La firma la revisará y le escribirá si hace falta algo más." };
}
