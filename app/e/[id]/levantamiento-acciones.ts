"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { bitacora } from "@/lib/asientos";
import { conEmpresa, mensajeError, type Tx } from "@/lib/db";
import { ErrorLevantamiento, estadoInicial, leerPatrimonio } from "@/lib/levantamiento";
import { deCentavos } from "@/lib/montos";
import { fechaValida } from "@/lib/reportes";
import type { Estado } from "../../acciones-cuenta";

// Entrega 6b.2: la revisión del levantamiento. La coordinadora completa el patrimonio y Patricia (permiso «empresa») aprueba el estado inicial.

const volver = (id: string, fid: string) => { revalidatePath(`/e/${id}/solicitudes/levantamiento/${fid}`); revalidatePath(`/e/${id}/expediente`); };
const error = (e: unknown): Estado => ({ error: e instanceof ErrorLevantamiento ? e.message : mensajeError(e) });
type Fila = { estado: string; respuestas: Record<string, string> | null; aprobado_en: Date | null };
const leer = async (tx: Tx, fid: string) => {
  const [f] = await tx<Fila[]>`SELECT estado, respuestas, aprobado_en FROM formularios WHERE id = ${fid} AND tipo = 'levantamiento' FOR UPDATE`;
  if (!f?.respuestas) throw new ErrorLevantamiento("Ese levantamiento no existe o no se ha recibido.");
  return f as Fila & { respuestas: Record<string, string> };
};

export async function guardarPatrimonio(empresaId: string, fid: string, _: Estado, fd: FormData): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/solicitudes");
  if (!esUuid(fid)) return { error: "Ese levantamiento no existe." };
  try {
    const pat = leerPatrimonio(fd);
    const proxima = { proxima_accion: String(fd.get("proxima_accion") ?? "").trim().slice(0, 300), proxima_fecha: String(fd.get("proxima_fecha") ?? "").trim() };
    if (proxima.proxima_fecha && !fechaValida(proxima.proxima_fecha)) return { error: "La fecha acordada no es válida." };
    await conEmpresa(empresaId, async (tx) => {
      const f = await leer(tx, fid);
      if (f.aprobado_en) throw new ErrorLevantamiento("Ya está aprobado: quita la aprobación para cambiarlo.");
      await tx`UPDATE formularios SET respuestas = ${tx.json({ ...f.respuestas, ...pat, ...proxima })} WHERE id = ${fid}`;
    });
  } catch (e) {
    return error(e);
  }
  volver(empresaId, fid);
  return { ok: "Guardado." };
}

export async function aprobarEstadoInicial(empresaId: string, fid: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "empresa", "/solicitudes");
  if (!esUuid(fid)) return { error: "Ese levantamiento no existe." };
  try {
    await conEmpresa(empresaId, async (tx) => {
      const f = await leer(tx, fid);
      if (f.estado !== "aceptado") throw new ErrorLevantamiento("Primero acepta el levantamiento.");
      const e = estadoInicial(f.respuestas);
      if (e.diferencia !== 0n) throw new ErrorLevantamiento(`No cuadra: hay una diferencia de RD$${deCentavos(e.diferencia)}.`);
      await tx`UPDATE formularios SET aprobado_por = ${usuario.id}, aprobado_en = now() WHERE id = ${fid}`;
      await bitacora(tx, empresaId, usuario.id, "estado_inicial_aprobado", { formulario: fid });
    });
  } catch (e) {
    return error(e);
  }
  volver(empresaId, fid);
  return { ok: "Estado inicial aprobado." };
}

export async function quitarAprobacionEstado(empresaId: string, fid: string): Promise<Estado> {
  await exigirPermiso(empresaId, "empresa", "/solicitudes");
  if (!esUuid(fid)) return { error: "Ese levantamiento no existe." };
  try {
    await conEmpresa(empresaId, (tx) => tx`UPDATE formularios SET aprobado_por = NULL, aprobado_en = NULL WHERE id = ${fid} AND tipo = 'levantamiento'`);
  } catch (e) {
    return error(e);
  }
  volver(empresaId, fid);
  return { ok: "Aprobación quitada." };
}

// Pasa lo aprobado a los «Saldos del balance» (rediseño R5), para que los estados financieros del cliente arranquen con esas cifras.
export async function pasarASaldos(empresaId: string, fid: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/solicitudes");
  const fecha = String(fd.get("fecha") ?? "").trim();
  if (!esUuid(fid)) return { error: "Ese levantamiento no existe." };
  if (!fechaValida(fecha)) return { error: "Escribe la fecha de corte." };
  try {
    await conEmpresa(empresaId, async (tx) => {
      const f = await leer(tx, fid);
      if (!f.aprobado_en) throw new ErrorLevantamiento("Patricia debe aprobar el estado inicial primero.");
      const [ya] = await tx`SELECT 1 FROM saldos_registro WHERE fecha = ${fecha}`;
      if (ya) throw new ErrorLevantamiento("Ya hay saldos guardados en esa fecha: revísalos en Estados financieros o elige otra fecha.");
      await tx`INSERT INTO saldos_registro (empresa_id, fecha, montos, notas, actualizado_por)
               VALUES (${empresaId}, ${fecha}, ${tx.json(estadoInicial(f.respuestas).saldos)}, 'Del levantamiento contable', ${usuario.id})`;
    });
  } catch (e) {
    return error(e);
  }
  revalidatePath(`/e/${empresaId}/estados`);
  return { ok: "Listo: los saldos del balance ya tienen estas cifras." };
}
