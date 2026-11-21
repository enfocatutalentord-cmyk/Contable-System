"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { ErrorVencimiento, leerVencimiento } from "@/lib/vencimientos";
import type { Estado } from "../../acciones-cuenta";

// Documentos que vencen (P2c.4): se agregan, se cambian (renovar = poner la fecha nueva; el historial guarda la anterior) y se quitan de la lista
// sin borrarlos. Piden el mismo permiso que la ficha, «empresa».
export async function guardarVencimiento(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  await exigirPermiso(empresaId, "empresa", "/empresa");
  const id = String(fd.get("id") ?? "");
  try {
    const d = leerVencimiento(fd);
    await conEmpresa(empresaId, async (tx) => {
      if (id) {
        if (!esUuid(id)) throw new ErrorVencimiento("Ese documento no existe.");
        const r = await tx`UPDATE vencimientos_empresa SET nombre = ${d.nombre}, vence = ${d.vence}, avisar_dias = ${d.avisar_dias}, documento_id = ${d.documento_id}, nota = ${d.nota}
                            WHERE id = ${id} AND activo`;
        if (!r.count) throw new ErrorVencimiento("Ese documento no existe.");
      } else {
        await tx`INSERT INTO vencimientos_empresa (empresa_id, nombre, vence, avisar_dias, documento_id, nota) VALUES (${empresaId}, ${d.nombre}, ${d.vence}, ${d.avisar_dias}, ${d.documento_id}, ${d.nota})`;
      }
    });
  } catch (e) {
    return { error: e instanceof ErrorVencimiento ? e.message : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/empresa`);
  return { ok: id ? "Documento al día." : "Documento agregado: el sistema avisa antes de que venza." };
}

export async function quitarVencimiento(empresaId: string, id: string, _: Estado): Promise<Estado> {
  await exigirPermiso(empresaId, "empresa", "/empresa");
  if (!esUuid(id)) return { error: "Ese documento no existe." };
  try {
    await conEmpresa(empresaId, (tx) => tx`UPDATE vencimientos_empresa SET activo = false WHERE id = ${id}`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/empresa`);
  return { ok: "Quitado de la lista." };
}
