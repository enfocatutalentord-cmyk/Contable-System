"use server";

import { revalidatePath } from "next/cache";
import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { guardarObservaciones, leerFiltrosAnalisis, leerTextos } from "@/lib/analisis-financiero";
import { conEmpresa, mensajeError } from "@/lib/db";
import { ErrorExpediente, guardarArchivos } from "@/lib/expediente";
import { hoyISO } from "@/lib/montos";
import { CARPETA_ANALISIS, descripcionAnalisis, pdfAnalisis } from "@/lib/pdf-analisis";
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

// Guarda el informe del análisis (PDF, con el logo del cliente, del período y la comparación que se estaban viendo) en la carpeta 05 · Reportes del expediente del cliente.
// Cada vez que se guarda queda una copia nueva. Pide «adjuntar» en el cliente y ver su pestaña de Estados financieros.
export async function guardarInformeAnalisis(firmaId: string, empresaId: string, desde: string, hasta: string, comparar: string): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId, false);
  if (await soloCliente(firmaId, usuario.id)) return { error: "El análisis financiero es del equipo de la firma." };
  if (!esUuid(empresaId) || !fechaValida(desde) || !fechaValida(hasta) || desde > hasta) return { error: "Ese análisis no existe." };
  const { empresa, usuario: u } = await exigirPermiso(empresaId, "adjuntar", "/estados");
  if (empresa.firma_id !== firmaId) return { error: "Ese cliente no es de esta firma." };
  const f = leerFiltrosAnalisis({ desde, hasta, comparar });
  try {
    await conEmpresa(empresaId, async (tx) => {
      const pdf = await pdfAnalisis(tx, { empresaId, empresa: empresa.nombre, rnc: empresa.rnc, ...f, preparadoPor: u.nombre });
      await guardarArchivos(tx, {
        empresaId, usuarioId: u.id, archivos: [{ nombre: pdf.nombre, bytes: pdf.datos }], carpeta: CARPETA_ANALISIS, anio: Number(hoyISO().slice(0, 4)), descripcion: descripcionAnalisis(f.desde, f.hasta, f.comparar),
      });
    });
  } catch (e) {
    return { error: e instanceof ErrorExpediente ? e.message : mensajeError(e) };
  }
  revalidatePath(`/firma/${firmaId}/analisis`);
  revalidatePath(`/e/${empresaId}/expediente`);
  return { ok: "Informe guardado en el expediente del cliente, carpeta 05 · Reportes." };
}
