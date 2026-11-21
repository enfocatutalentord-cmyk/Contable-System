"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { agregarCartasDeEjemplo } from "@/lib/cartas-trabajo";
import { hoyISO } from "@/lib/montos";
import { generarDocumento, guardarPlantilla, leerPlantilla, plantillaDe, quitarPlantilla } from "@/lib/plantillas-documento";
import { ErrorPlantilla } from "@/lib/plantillas-word";
import type { Estado } from "../acciones-cuenta";

// Prioridad 3 · P3d: plantillas de Word de la firma y documentos generados para los clientes. Las plantillas las maneja una administradora; generar un
// documento pide poder adjuntar en el cliente (queda en su expediente).

export async function subirPlantilla(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  try {
    const d = await leerPlantilla(fd);
    if (!d.archivo) return { error: "Elige el documento de Word (.docx) con los espacios {{así}}." };
    const r = await guardarPlantilla(firmaId, usuario.id, { ...d, archivo: d.archivo });
    revalidatePath(`/firma/${firmaId}/plantillas`);
    return { ok: `Plantilla guardada. Reconocí ${r.campos.length} ${r.campos.length === 1 ? "espacio" : "espacios"}.` };
  } catch (e) {
    return { error: e instanceof ErrorPlantilla ? e.message : mensajeError(e) };
  }
}

export async function quitarPlantillaAccion(firmaId: string, id: string, _: Estado): Promise<Estado> {
  await accesoFirma(firmaId);
  if (!esUuid(id)) return { error: "Esa plantilla no existe." };
  await quitarPlantilla(firmaId, id);
  revalidatePath(`/firma/${firmaId}/plantillas`);
  return { ok: "Plantilla quitada. Los documentos que ya se generaron siguen en el expediente." };
}

// Genera el Word con lo que la persona revisó en pantalla (viene prellenado con los datos del cliente) y vuelve a la lista con el enlace para bajarlo.
export async function generarDocumentoAccion(firmaId: string, empresaId: string, plantillaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, firma } = await accesoFirma(firmaId, false);
  if (await soloCliente(firmaId, usuario.id)) return { error: "Los documentos los genera el equipo de la firma." };
  if (!esUuid(empresaId) || !esUuid(plantillaId)) return { error: "El cliente o la plantilla no existen." };
  const { empresa } = await exigirPermiso(empresaId, "adjuntar");
  if (empresa.firma_id !== firmaId) return { error: "Ese cliente no es de esta firma." };
  let resultado: { documentoId: string; referencia: string };
  try {
    const plantilla = await plantillaDe(firmaId, plantillaId);
    if (!plantilla) return { error: "Esa plantilla ya no está." };
    const valores: Record<string, string> = {};
    for (const campo of plantilla.campos) valores[campo] = String(fd.get(`v_${campo}`) ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 4000);
    const hoy = hoyISO();
    resultado = await conEmpresa(empresaId, async (tx) => {
      return generarDocumento(tx, { empresaId, usuarioId: usuario.id, hoy, nombreCliente: empresa.nombre, plantilla, valores });
    });
  } catch (e) {
    return { error: e instanceof ErrorPlantilla ? e.message : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/expediente`);
  redirect(`/firma/${firmaId}/plantillas?hecho=${resultado.documentoId}&e=${empresaId}&ref=${encodeURIComponent(resultado.referencia)}`);
}

// P3i: agrega las cartas de trabajo de ejemplo (constancia, desahucio y vacaciones) que la firma todavía no tenga. Solo administradoras, como cualquier plantilla.
export async function agregarCartasAccion(firmaId: string, _: Estado): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  try {
    const agregadas = await agregarCartasDeEjemplo(firmaId, usuario.id);
    revalidatePath(`/firma/${firmaId}/cartas`);
    revalidatePath(`/firma/${firmaId}/plantillas`);
    return { ok: agregadas.length ? `Agregué: ${agregadas.join(", ")}. Revisa el texto de cada una antes de usarla.` : "Ya tienes las tres cartas de ejemplo." };
  } catch (e) {
    return { error: e instanceof ErrorPlantilla ? e.message : mensajeError(e) };
  }
}
