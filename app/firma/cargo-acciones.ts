"use server";

import { revalidatePath } from "next/cache";
import { accesoFirma } from "@/lib/acceso";
import { ErrorCargo, leerPorcentajeCargo } from "@/lib/cargo-aplicacion";
import { conUsuario } from "@/lib/db";
import type { Estado } from "../acciones-cuenta";

// Prioridad 3 · P3b: el porcentaje del cargo por la aplicación (uno para toda la firma). Solo administradoras. Lo ya facturado no cambia: cada factura
// guarda el porcentaje con el que se hizo.
export async function guardarPorcentajeCargo(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  let pct: string;
  try {
    pct = leerPorcentajeCargo(String(fd.get("porcentaje") ?? ""));
  } catch (e) {
    if (e instanceof ErrorCargo) return { error: e.message };
    throw e;
  }
  await conUsuario(usuario.id, (tx) => tx`UPDATE firmas SET cargo_aplicacion = ${pct} WHERE id = ${firmaId}`);
  revalidatePath(`/firma/${firmaId}/empire/cargo-aplicacion`);
  return { ok: Number(pct) === 0 ? "Quedó en 0 %: no se suma cargo a las facturas nuevas." : `Cargo guardado: ${Number(pct)} % para las facturas nuevas.` };
}
