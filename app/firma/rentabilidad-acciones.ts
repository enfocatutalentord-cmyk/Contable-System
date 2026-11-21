"use server";

import { revalidatePath } from "next/cache";
import { accesoFirma } from "@/lib/acceso";
import { conUsuario } from "@/lib/db";
import { aCentavos, deCentavos, leerMonto } from "@/lib/montos";
import type { Estado } from "../acciones-cuenta";

// Prioridad 2.2 (P2b): el costo de la hora de trabajo con el que se mide la rentabilidad por cliente. Solo administradoras.
export async function guardarCostoHora(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  const bruto = String(fd.get("costo_hora") ?? "").trim();
  let valor: string | null = null;
  if (bruto !== "") {
    const m = leerMonto(bruto);
    if (m === null) return { error: "El costo de la hora no es válido." };
    const c = aCentavos(m);
    if (c > 10_000_000n) return { error: "El costo de la hora va hasta RD$100,000." };
    valor = deCentavos(c);
  }
  await conUsuario(usuario.id, (tx) => tx`UPDATE firmas SET costo_hora = ${valor} WHERE id = ${firmaId}`);
  revalidatePath(`/firma/${firmaId}/rentabilidad`);
  return { ok: valor === null ? "Quitaste el costo de la hora." : "Costo de la hora guardado." };
}
