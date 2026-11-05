"use server";

import { revalidatePath } from "next/cache";
import { exigirPermiso } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { hoyISO } from "@/lib/montos";
import { proyeccionDe } from "@/lib/proyeccion";
import type { Estado } from "../../acciones-cuenta";

// Bloque 4, entrega 4c: «Preparar para el cliente» guarda la proyección tal como está (con notas), para enviarla por WhatsApp.
// Prepararla otra vez el mismo mes la reemplaza con las cifras de ese momento.
export async function prepararProyeccion(empresaId: string, periodo: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "impuestos", "/dgii");
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(periodo)) return { error: "Período no válido." };
  const notas = String(fd.get("notas") ?? "").trim().slice(0, 3000) || null;
  try {
    await conEmpresa(empresaId, async (tx) => {
      const datos = await proyeccionDe(tx, periodo, hoyISO());
      await tx`
        INSERT INTO proyecciones_fiscales (empresa_id, periodo, datos, notas, preparado_por)
        VALUES (${empresaId}, ${periodo}, ${tx.json(datos)}, ${notas}, ${usuario.id})
        ON CONFLICT (empresa_id, periodo) DO UPDATE
          SET datos = EXCLUDED.datos, notas = EXCLUDED.notas, preparado_por = EXCLUDED.preparado_por, preparado_en = now()`;
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/dgii/proyeccion`);
  return { ok: "Proyección preparada: ya se puede enviar por WhatsApp." };
}
