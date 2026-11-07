"use server";

import { revalidatePath } from "next/cache";
import { accesoFirma, esUuid, soloCliente } from "@/lib/acceso";
import { conEmpresa, conUsuario, db, mensajeError } from "@/lib/db";
import { ErrorMensaje, quitarEnlace } from "@/lib/mensajes-db";
import type { Estado } from "../acciones-cuenta";

// Bloque 3, entrega 3c: los mensajes predeterminados los cambia un administrador de la firma (Patricia); un enlace compartido lo
// puede retirar cualquiera del equipo.

export async function guardarPlantillaMensaje(firmaId: string, plantillaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId); // solo administradores
  const nombre = String(fd.get("nombre") ?? "").trim().replace(/\s+/g, " ");
  const texto = String(fd.get("texto") ?? "").trim();
  if (!esUuid(plantillaId)) return { error: "Ese mensaje no existe." };
  if (!nombre || nombre.length > 80) return { error: "Ponle un nombre (hasta 80 caracteres)." };
  if (!texto || texto.length > 2000) return { error: "El texto va de 1 a 2,000 caracteres." };
  try {
    const r = await conUsuario(usuario.id, (tx) => tx`
      UPDATE plantillas_mensaje SET nombre = ${nombre}, texto = ${texto}, editado_por = ${usuario.id}, editado = now()
       WHERE id = ${plantillaId} AND firma_id = ${firmaId}`);
    if (!r.count) return { error: "Ese mensaje no existe." };
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/firma/${firmaId}`, "layout");
  return { ok: "Mensaje guardado. Los próximos envíos usan este texto." };
}

export async function retirarEnlace(firmaId: string, empresaId: string, enlaceId: string): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId, false);
  if (await soloCliente(firmaId, usuario.id)) return { error: "Solo para el equipo de la firma." };
  if (!esUuid(empresaId) || !esUuid(enlaceId)) return { error: "Ese enlace no existe." };
  const [e] = await db()`SELECT 1 FROM empresas WHERE id = ${empresaId} AND firma_id = ${firmaId}`;
  if (!e) return { error: "Ese enlace no existe." };
  try {
    await conEmpresa(empresaId, (tx) => quitarEnlace(tx, enlaceId, usuario.id));
  } catch (x) {
    return { error: x instanceof ErrorMensaje ? x.message : mensajeError(x) };
  }
  revalidatePath(`/firma/${firmaId}`, "layout");
  return { ok: "Enlace retirado: ya no descarga el documento." };
}
