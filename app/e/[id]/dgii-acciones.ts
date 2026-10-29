"use server";

import { revalidatePath } from "next/cache";
import { exigirPermiso } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { ErrorContable } from "@/lib/asientos";
import { armarFormato, esFormato, FORMATOS, periodoDe } from "@/lib/formatos-dgii";
import type { Estado } from "../../acciones-cuenta";

// Deja constancia de que el formato se envió por la Oficina Virtual (o en cero), con la referencia que da la DGII.
// Solo si no tiene errores: la DGII rechaza el archivo completo si un registro está mal.
export async function marcarEnviado(empresaId: string, formato: string, periodo: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "impuestos", "/dgii");
  const p = periodoDe(periodo);
  if (!esFormato(formato) || !p) return { error: "Formato o período no válido." };
  const referencia = String(fd.get("referencia") ?? "").trim().slice(0, 60) || null;
  try {
    await conEmpresa(empresaId, async (tx) => {
      const a = await armarFormato(tx, formato, p);
      if (a.avisos.some((x) => x.nivel === "error")) throw new ErrorContable("Corrige primero los errores del formato");
      const enCero = a.filas.length === 0 && !(a.consumo && a.consumo.cantidad > 0);
      const r = await tx`
        INSERT INTO envios_dgii (empresa_id, formato, periodo, en_cero, referencia, huella, registros, enviado_por)
        VALUES (${empresaId}, ${formato}, ${periodo}, ${enCero}, ${referencia}, ${a.huella}, ${a.filas.length}, ${usuario.id})
        ON CONFLICT (empresa_id, formato, periodo) DO NOTHING`;
      if (r.count === 0) throw new ErrorContable("Ese formato ya está marcado como enviado");
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/dgii`);
  return { ok: `${formato} · ${FORMATOS[formato]} marcado como enviado.` };
}

// Para reenviar (por ejemplo, después de corregir algo): se quita la marca y queda en el historial de cambios.
export async function quitarEnvio(empresaId: string, formato: string, periodo: string): Promise<Estado> {
  await exigirPermiso(empresaId, "impuestos", "/dgii");
  if (!esFormato(formato) || !periodoDe(periodo)) return { error: "Formato o período no válido." };
  try {
    await conEmpresa(empresaId, (tx) => tx`DELETE FROM envios_dgii WHERE formato = ${formato} AND periodo = ${periodo}`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/dgii`);
  return { ok: "Marca de envío quitada." };
}
