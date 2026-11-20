"use server";

import { exigirUsuario } from "@/lib/auth";
import type { RespuestaRnc } from "@/lib/padron";
import { buscarRnc } from "@/lib/padron-db";

// Busca un RNC o una cédula en el padrón de la DGII que cargó la dueña de la plataforma (P2c.3). Pide sesión; no guarda nada.
export async function consultarRnc(valor: string): Promise<RespuestaRnc> {
  await exigirUsuario();
  const r = await buscarRnc(String(valor ?? "").slice(0, 30));
  return r.tipo === "encontrado" || r.tipo === "no_esta" ? { ...r, al: r.al.toISOString().slice(0, 10) } : r;
}
