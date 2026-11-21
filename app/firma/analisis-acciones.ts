"use server";

import { revalidatePath } from "next/cache";
import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { guardarObservaciones, leerTextos } from "@/lib/analisis-financiero";
import { conEmpresa, mensajeError } from "@/lib/db";
import { fechaValida } from "@/lib/reportes";
import type { Estado } from "../acciones-cuenta";

// Prioridad 3 · P3f: las observaciones y sugerencias que escribe la firma para el análisis financiero de un cliente en un período.
// Quien tiene «registrar» en el cliente y ve su pestaña de Estados financieros las puede escribir.
export async function guardarObservacionesAnalisis(firmaId: string, empresaId: string, desde: string, hasta: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId, false);
  if (await soloCliente(firmaId, usuario.id)) return { error: "El análisis financiero es del equipo de la firma." };
  if (!esUuid(empresaId) || !fechaValida(desde) || !fechaValida(hasta) || desde > hasta) return { error: "Ese análisis no existe." };
  const { empresa, usuario: u } = await exigirPermiso(empresaId, "registrar", "/estados");
  if (empresa.firma_id !== firmaId) return { error: "Ese cliente no es de esta firma." };
  const textos = leerTextos(fd);
  if (typeof textos === "string") return { error: textos };
  try {
    await conEmpresa(empresaId, (tx) => guardarObservaciones(tx, { empresaId, usuarioId: u.id, desde, hasta, textos }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/firma/${firmaId}/analisis`);
  return { ok: "Observaciones guardadas." };
}
