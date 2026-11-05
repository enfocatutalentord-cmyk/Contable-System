"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { bitacora } from "@/lib/asientos";
import { conEmpresa, mensajeError } from "@/lib/db";
import { contabilizarDePlantilla, primeraFecha, revisarPlantilla, type LineaPlantilla } from "@/lib/plantillas";
import { fechaValida } from "@/lib/reportes";
import type { Estado } from "../../acciones-cuenta";

const texto = (fd: FormData, campo: string) => String(fd.get(campo) ?? "").trim();

function leerLineas(fd: FormData): LineaPlantilla[] | null {
  try {
    const crudas = JSON.parse(String(fd.get("lineas") ?? "[]")) as LineaPlantilla[];
    if (!Array.isArray(crudas) || crudas.length > 60) return null;
    return crudas
      .filter((l) => l && (l.cuentaId || l.debe || l.haber))
      .map((l) => ({
        cuentaId: esUuid(String(l.cuentaId ?? "")) ? String(l.cuentaId) : "", descripcion: String(l.descripcion ?? "").slice(0, 200),
        debe: String(l.debe ?? ""), haber: String(l.haber ?? ""), unidad: esUuid(String(l.unidad ?? "")) ? String(l.unidad) : "",
        categoria: String(l.categoria ?? "").slice(0, 80),
      }));
  } catch {
    return null;
  }
}

export async function guardarPlantilla(empresaId: string, plantillaId: string | null, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/plantillas");
  const lineas = leerLineas(fd);
  if (!lineas) return { error: "No se pudieron leer las líneas." };
  const nombre = texto(fd, "nombre").slice(0, 100);
  const concepto = texto(fd, "concepto").slice(0, 300);
  const frecuencia = texto(fd, "frecuencia") === "mensual" ? "mensual" : "ninguna";
  const dia = frecuencia === "mensual" ? Number(texto(fd, "dia")) || null : null;
  const desde = texto(fd, "desde");                    // AAAA-MM
  const hasta = texto(fd, "hasta") || null;            // AAAA-MM-DD
  if (frecuencia === "mensual" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(desde)) return { error: "Elige desde qué mes empieza." };
  if (hasta && !fechaValida(hasta)) return { error: "La fecha final no es válida." };
  const proxima = frecuencia === "mensual" && dia ? primeraFecha(desde, dia) : null;
  const error = revisarPlantilla({ nombre, concepto, lineas, frecuencia, dia, proxima });
  if (error) return { error };
  if (hasta && proxima && hasta < proxima) return { error: "La fecha final es anterior al primer mes." };
  let id = plantillaId;
  try {
    id = await conEmpresa(empresaId, async (tx) => {
      const datos = { nombre, concepto, referencia: texto(fd, "referencia").slice(0, 80) || null, frecuencia, dia, proxima, hasta };
      let pid = plantillaId;
      if (pid) {
        const r = await tx`UPDATE plantillas_asiento SET nombre = ${datos.nombre}, concepto = ${datos.concepto}, referencia = ${datos.referencia},
                             lineas = ${tx.json(lineas as never)}, frecuencia = ${frecuencia}, dia = ${dia}, proxima = ${proxima}, hasta = ${hasta}, activa = true
                            WHERE id = ${pid}`;
        if (r.count === 0) throw new Error("La plantilla no existe");
      } else {
        [{ id: pid }] = await tx<{ id: string }[]>`
          INSERT INTO plantillas_asiento (empresa_id, nombre, concepto, referencia, lineas, frecuencia, dia, proxima, hasta, creado_por)
          VALUES (${empresaId}, ${datos.nombre}, ${datos.concepto}, ${datos.referencia}, ${tx.json(lineas as never)}, ${frecuencia}, ${dia},
                  ${proxima}, ${hasta}, ${usuario.id}) RETURNING id`;
      }
      await bitacora(tx, empresaId, usuario.id, "plantilla_guardada", { plantilla: pid });
      return pid!;
    });
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "23505") return { error: "Ya hay una plantilla con ese nombre." };
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/plantillas?guardada=${id}`);
}

export async function pausarPlantilla(empresaId: string, plantillaId: string, activa: boolean, _: Estado): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/plantillas");
  if (!esUuid(plantillaId)) return { error: "La plantilla no existe." };
  try {
    await conEmpresa(empresaId, (tx) => tx`UPDATE plantillas_asiento SET activa = ${activa} WHERE id = ${plantillaId}`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/plantillas`);
  return { ok: activa ? "Plantilla activa." : "Plantilla en pausa." };
}

export async function eliminarPlantilla(empresaId: string, plantillaId: string, _: Estado): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/plantillas");
  if (!esUuid(plantillaId)) return { error: "La plantilla no existe." };
  try {
    await conEmpresa(empresaId, (tx) => tx`DELETE FROM plantillas_asiento WHERE id = ${plantillaId}`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/plantillas`);
  return { ok: "Plantilla eliminada. Los asientos que ya preparó se quedan." };
}

// Contabiliza los borradores marcados que prepararon las plantillas, cada uno en su transacción: los errores se listan sin parar los demás.
export async function contabilizarBorradoresPlantilla(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "contabilizar", "/plantillas");
  const ids = fd.getAll("asiento").map(String).filter(esUuid);
  if (!ids.length) return { error: "Marca los borradores que quieres contabilizar." };
  let hechos = 0;
  const errores: string[] = [];
  for (const id of ids) {
    try {
      await conEmpresa(empresaId, (tx) => contabilizarDePlantilla(tx, empresaId, id, usuario.id, empresa.requiere_aprobacion));
      hechos++;
    } catch (e) {
      errores.push(mensajeError(e));
    }
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  if (errores.length) return { error: `${hechos} contabilizados. No se pudieron: ${errores.join(" · ")}` };
  return { ok: `${hechos} ${hechos === 1 ? "asiento contabilizado" : "asientos contabilizados"}.` };
}
