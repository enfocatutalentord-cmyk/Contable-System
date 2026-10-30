"use server";

import { revalidatePath } from "next/cache";
import { exigirPermiso } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import type { Estado } from "../../acciones-cuenta";

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim().slice(0, 120) || null;

// Línea de firmas de los estados financieros en PDF (permiso «empresa», como la ficha).
export async function guardarFirmasEstados(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  await exigirPermiso(empresaId, "empresa", "/estados");
  try {
    await conEmpresa(empresaId, (tx) => tx`
      UPDATE empresas SET firma_preparado = ${texto(fd, "firma_preparado")}, firma_icpard = ${texto(fd, "firma_icpard")},
             firma_aprobado = ${texto(fd, "firma_aprobado")}, firma_cargo = ${texto(fd, "firma_cargo")}
       WHERE id = ${empresaId}`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/estados`);
  return { ok: "Firmas guardadas." };
}
