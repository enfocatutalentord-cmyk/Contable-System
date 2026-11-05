"use server";

import { revalidatePath } from "next/cache";
import { exigirPermiso } from "@/lib/acceso";
import { conEmpresa, mensajeError, type Tx } from "@/lib/db";
import { hoyISO } from "@/lib/montos";
import { armarReporte, huellaReporte } from "@/lib/reporte-mensual";
import type { Estado } from "../../acciones-cuenta";

// Bloque 4, entrega 4b: el paso a paso del reporte mensual. La coordinadora lo prepara («registrar»), la socia o la contadora lo
// revisa («cerrar»), Patricia lo aprueba («empresa»: solo Administrador lo tiene) y sale por WhatsApp.

const PERIODO = /^\d{4}(0[1-9]|1[0-2])$/;
class ErrorReporte extends Error {}

async function fila(tx: Tx, empresaId: string, periodo: string) {
  await tx`INSERT INTO reportes_mensuales (empresa_id, periodo) VALUES (${empresaId}, ${periodo}) ON CONFLICT (empresa_id, periodo) DO NOTHING`;
  const [r] = await tx<{ id: string; estado: string }[]>`SELECT id, estado FROM reportes_mensuales WHERE periodo = ${periodo} FOR UPDATE`;
  return r;
}

async function correr(empresaId: string, periodo: string, fn: (tx: Tx) => Promise<void>, ok: string): Promise<Estado> {
  if (!PERIODO.test(periodo)) return { error: "Período no válido." };
  try {
    await conEmpresa(empresaId, fn);
  } catch (e) {
    return { error: e instanceof ErrorReporte ? e.message : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/bitacora/reporte`);
  return { ok };
}

export async function guardarNotasReporte(empresaId: string, periodo: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/bitacora");
  const notas = String(fd.get("notas") ?? "").trim().slice(0, 3000) || null;
  return correr(empresaId, periodo, async (tx) => {
    const r = await fila(tx, empresaId, periodo);
    if (r.estado === "aprobado" || r.estado === "enviado") throw new ErrorReporte("El reporte ya está aprobado: para cambiar las notas, quita la aprobación.");
    await tx`UPDATE reportes_mensuales SET notas = ${notas}, preparado_por = ${usuario.id}, preparado_en = now() WHERE id = ${r.id}`;
  }, "Notas guardadas.");
}

export async function revisarReporte(empresaId: string, periodo: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "cerrar", "/bitacora");
  return correr(empresaId, periodo, async (tx) => {
    const r = await fila(tx, empresaId, periodo);
    if (r.estado !== "borrador") throw new ErrorReporte("El reporte ya pasó la revisión.");
    await tx`UPDATE reportes_mensuales SET estado = 'revisado', revisado_por = ${usuario.id}, revisado_en = now() WHERE id = ${r.id}`;
  }, "Reporte revisado: falta la aprobación.");
}

// Aprobar guarda las cifras tal como están ahora; desde ahí el PDF y el enlace muestran exactamente lo aprobado.
export async function aprobarReporte(empresaId: string, periodo: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "empresa", "/bitacora");
  return correr(empresaId, periodo, async (tx) => {
    const r = await fila(tx, empresaId, periodo);
    if (r.estado === "aprobado" || r.estado === "enviado") throw new ErrorReporte("El reporte ya está aprobado.");
    const datos = await armarReporte(tx, empresaId, periodo, hoyISO());
    await tx`UPDATE reportes_mensuales SET estado = 'aprobado', datos = ${tx.json(datos)}, huella = ${huellaReporte(datos)},
               aprobado_por = ${usuario.id}, aprobado_en = now(),
               revisado_por = COALESCE(revisado_por, ${usuario.id}), revisado_en = COALESCE(revisado_en, now())
             WHERE id = ${r.id}`;
  }, "Reporte aprobado: ya se puede enviar por WhatsApp.");
}

export async function quitarAprobacion(empresaId: string, periodo: string): Promise<Estado> {
  await exigirPermiso(empresaId, "empresa", "/bitacora");
  return correr(empresaId, periodo, async (tx) => {
    const r = await fila(tx, empresaId, periodo);
    if (r.estado !== "aprobado" && r.estado !== "enviado") throw new ErrorReporte("El reporte no está aprobado.");
    await tx`UPDATE reportes_mensuales SET estado = 'revisado', datos = NULL, huella = NULL, aprobado_por = NULL, aprobado_en = NULL, enviado_en = NULL
             WHERE id = ${r.id}`;
    await tx`UPDATE enlaces_documento SET revocado_en = now() WHERE tipo = 'reporte' AND ref_id = ${r.id} AND revocado_en IS NULL`;
  }, "Aprobación quitada: el reporte se puede volver a revisar y aprobar (el enlace enviado dejó de funcionar).");
}
