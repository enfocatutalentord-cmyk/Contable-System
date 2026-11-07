"use server";

import { revalidatePath } from "next/cache";
import { accesoFirma, esUuid, soloCliente } from "@/lib/acceso";
import { conUsuario, mensajeError } from "@/lib/db";
import { ALCANCES, marcarTarea, SECCIONES_TAREA } from "@/lib/tareas";
import type { Estado } from "../acciones-cuenta";

// Bloque 3, entrega 3b: tareas del mes (cualquiera del equipo) y cronograma (lo ajusta un administrador de la firma).

async function equipo(firmaId: string) {
  const { usuario } = await accesoFirma(firmaId, false);
  if (await soloCliente(firmaId, usuario.id)) throw new Error("Solo para el equipo de la firma");
  return usuario;
}

export async function marcarTareaAccion(firmaId: string, tareaId: string, hecha: boolean): Promise<Estado> {
  const usuario = await equipo(firmaId);
  if (!esUuid(tareaId)) return { error: "La tarea no existe." };
  try {
    await conUsuario(usuario.id, (tx) => marcarTarea(tx, { firmaId, tareaId, hecha, usuarioId: usuario.id }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/firma/${firmaId}`, "layout");
  return { ok: hecha ? "Tarea hecha." : "Tarea reabierta." };
}

export async function asignarTarea(firmaId: string, tareaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const usuario = await equipo(firmaId);
  const responsable = String(fd.get("responsable") ?? "");
  if (!esUuid(tareaId) || (responsable && !esUuid(responsable))) return { error: "Datos no válidos." };
  await conUsuario(usuario.id, async (tx) => {
    if (responsable) {
      const [m] = await tx`SELECT 1 FROM miembros_firma WHERE firma_id = ${firmaId} AND usuario_id = ${responsable}`;
      if (!m) throw new Error("Esa persona no es del equipo");
    }
    await tx`UPDATE tareas SET responsable_id = ${responsable || null} WHERE id = ${tareaId} AND firma_id = ${firmaId}`;
  });
  revalidatePath(`/firma/${firmaId}`, "layout");
  return { ok: "Responsable guardado." };
}

const entero = (fd: FormData, c: string, max: number) => {
  const v = String(fd.get(c) ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : NaN;
};

export async function guardarPlantilla(firmaId: string, plantillaId: string | null, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId); // solo administradores
  const titulo = String(fd.get("titulo") ?? "").trim().replace(/\s+/g, " ");
  const alcance = String(fd.get("alcance") ?? "firma");
  const seccion = String(fd.get("seccion") ?? "firma");
  const semana = entero(fd, "dia_semana", 7);
  const desde = semana ? null : entero(fd, "dia_desde", 31);
  const hasta = semana ? null : entero(fd, "dia_hasta", 31) ?? desde;
  if (!titulo || titulo.length > 200) return { error: "Escribe la tarea (hasta 200 caracteres)." };
  if (!(alcance in ALCANCES)) return { error: "Elige para quién es." };
  if (!(seccion in SECCIONES_TAREA)) return { error: "Elige dónde se ve." };
  if ([semana, desde, hasta].some((x) => Number.isNaN(x))) return { error: "Revisa los días." };
  if (!semana && (!desde || !hasta || desde > hasta)) return { error: "Pon el día de inicio y el de fin (o un día de la semana)." };
  if (plantillaId && !esUuid(plantillaId)) return { error: "La tarea no existe." };
  const datos = { titulo, alcance, seccion, dia_semana: semana, dia_desde: desde, dia_hasta: hasta };
  try {
    await conUsuario(usuario.id, async (tx) => {
      if (plantillaId) {
        await tx`UPDATE plantillas_tarea SET ${tx({ ...datos, activa: fd.get("activa") === "on" })} WHERE id = ${plantillaId} AND firma_id = ${firmaId}`;
      } else {
        const [{ orden }] = await tx<{ orden: number }[]>`SELECT COALESCE(max(orden), 0) + 1 AS orden FROM plantillas_tarea WHERE firma_id = ${firmaId}`;
        await tx`INSERT INTO plantillas_tarea ${tx({ ...datos, firma_id: firmaId, orden })}`;
      }
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/firma/${firmaId}`, "layout");
  return { ok: "Cronograma guardado. Los cambios valen para las tareas que se generen desde ahora." };
}
