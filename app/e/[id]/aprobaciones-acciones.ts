"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { aprobar, cancelarAccion, devolver, formularioDe, liberarAccion, reclamarAccion, registrarAprobada } from "@/lib/aprobaciones";
import { bitacora } from "@/lib/asientos";
import { conEmpresa, mensajeError } from "@/lib/db";
import type { Estado } from "../../acciones-cuenta";
import { ACCIONES_DIFERIDAS } from "./acciones-diferidas";

// Prioridad 2.1 (P2a): aprobar o devolver lo que otra persona preparó con un permiso «con aprobación». Pide el permiso «aprobar»; quien
// lo preparó nunca aprueba ni devuelve lo suyo (lo revisa la biblioteca).

export async function aprobarAccion(empresaId: string, aprobacionId: string, _: Estado): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "aprobar");
  if (!esUuid(aprobacionId)) return { error: "La solicitud no existe." };
  const [tipo] = await conEmpresa(empresaId, (tx) => tx<{ tipo: string }[]>`SELECT tipo FROM aprobaciones WHERE id = ${aprobacionId}`);
  if (tipo?.tipo === "accion") return aprobarDiferida(empresaId, usuario.id, aprobacionId);
  try {
    await conEmpresa(empresaId, async (tx) => {
      await aprobar(tx, { empresaId, usuarioId: usuario.id, id: aprobacionId });
      await bitacora(tx, empresaId, usuario.id, "aprobacion_aprobada", { id: aprobacionId });
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  revalidatePath(`/firma`, "layout");
  return { ok: "Aprobado: ya quedó hecho." };
}

export async function devolverAccion(empresaId: string, aprobacionId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "aprobar");
  if (!esUuid(aprobacionId)) return { error: "La solicitud no existe." };
  try {
    await conEmpresa(empresaId, async (tx) => {
      await devolver(tx, { empresaId, usuarioId: usuario.id, id: aprobacionId, motivo: String(fd.get("motivo") ?? "") });
      await bitacora(tx, empresaId, usuario.id, "aprobacion_devuelta", { id: aprobacionId });
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  revalidatePath(`/firma`, "layout");
  return { ok: "Devuelto con lo que hay que corregir." };
}

// Un redirect de Next dentro de la acción es la forma de terminar bien; el que lleva a «sin permiso» es que quien aprueba no puede hacerlo.
function resultadoDeRedirect(e: unknown): "ok" | "sin_permiso" | null {
  const digest = e && typeof e === "object" && "digest" in e ? String((e as { digest: unknown }).digest) : "";
  if (!digest.startsWith("NEXT_REDIRECT")) return null;
  return /sin_permiso|sin_pestana|sin_contabilidad|solo_empire/.test(digest) ? "sin_permiso" : "ok";
}

// Aprobar una acción guardada: se reclama (nadie más la ejecuta), se ejecuta con los mismos datos y, si falla, vuelve a quedar pendiente.
async function aprobarDiferida(empresaId: string, usuarioId: string, aprobacionId: string): Promise<Estado> {
  let payload;
  try {
    payload = (await conEmpresa(empresaId, (tx) => reclamarAccion(tx, { empresaId, usuarioId, id: aprobacionId }))).payload;
  } catch (e) {
    return { error: mensajeError(e) };
  }
  const liberar = (mensaje: string): Promise<Estado> =>
    conEmpresa(empresaId, (tx) => liberarAccion(tx, aprobacionId)).then(() => ({ error: mensaje }));
  const accion = ACCIONES_DIFERIDAS[payload.accion];
  if (!accion) return liberar("Esa acción ya no existe en el sistema.");
  try {
    const r = await accion(empresaId, payload.args, formularioDe(payload.campos));
    if (r && "error" in r && r.error) return liberar(r.error);
  } catch (e) {
    const rd = resultadoDeRedirect(e);
    if (rd === "sin_permiso") return liberar("No tienes el permiso completo para hacer esto: pídele a una administradora que lo apruebe.");
    if (rd === null) return liberar(mensajeError(e));
  }
  await conEmpresa(empresaId, async (tx) => {
    await registrarAprobada(tx, { empresaId, usuarioId, id: aprobacionId });
    await bitacora(tx, empresaId, usuarioId, "aprobacion_aprobada", { id: aprobacionId, accion: payload.accion });
  });
  revalidatePath(`/e/${empresaId}`, "layout");
  revalidatePath(`/firma`, "layout");
  return { ok: "Aprobado: ya quedó hecho." };
}

// Quien pidió una acción puede descartarla (por ejemplo, si se la devolvieron).
export async function descartarSolicitudAccion(empresaId: string, aprobacionId: string, _: Estado): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "ver");
  if (!esUuid(aprobacionId)) return { error: "La solicitud no existe." };
  try {
    await conEmpresa(empresaId, (tx) => cancelarAccion(tx, { empresaId, usuarioId: usuario.id, id: aprobacionId }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/firma`, "layout");
  return { ok: "Solicitud descartada." };
}
