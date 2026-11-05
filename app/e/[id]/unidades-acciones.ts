"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { ErrorContable } from "@/lib/asientos";
import { conEmpresa, mensajeError, type Tx } from "@/lib/db";
import type { Estado } from "../../acciones-cuenta";

// Unidades de negocio de un cliente (bloque 1b). Se crean, se renombran o se desactivan; no se borran, porque las líneas
// que ya las usan las conservan. Permiso «catálogo», como el resto de la configuración contable.

async function cuentaIngreso(tx: Tx, valor: FormDataEntryValue | null): Promise<string | null> {
  const id = String(valor ?? "");
  if (!id) return null;
  if (!esUuid(id)) throw new ErrorContable("Elige una cuenta de ingreso válida");
  const [c] = await tx<{ tipo: string; de_detalle: boolean; activa: boolean }[]>`SELECT tipo, de_detalle, activa FROM cuentas WHERE id = ${id}`;
  if (!c || c.tipo !== "ingreso" || !c.de_detalle || !c.activa) throw new ErrorContable("La cuenta debe ser una cuenta de detalle de ingresos, activa");
  return id;
}

const nombreDe = (fd: FormData) => String(fd.get("nombre") ?? "").trim().replace(/\s+/g, " ");

async function correr(empresaId: string, ok: string, fn: (tx: Tx) => Promise<unknown>): Promise<Estado> {
  await exigirPermiso(empresaId, "catalogo", "/configuracion");
  try {
    await conEmpresa(empresaId, fn);
  } catch (e) {
    return { error: (e as { code?: string }).code === "23505" ? "Ya hay una unidad con ese nombre." : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok };
}

export async function crearUnidad(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const nombre = nombreDe(fd);
  if (!nombre || nombre.length > 80) return { error: "Escribe el nombre de la unidad (hasta 80 caracteres)." };
  return correr(empresaId, `Unidad «${nombre}» creada.`, async (tx) => {
    const cuenta = await cuentaIngreso(tx, fd.get("cuenta"));
    const [{ orden }] = await tx<{ orden: number }[]>`SELECT COALESCE(max(orden), 0) + 1 AS orden FROM unidades_negocio`;
    await tx`INSERT INTO unidades_negocio (empresa_id, nombre, cuenta_ingreso_id, orden) VALUES (${empresaId}, ${nombre}, ${cuenta}, ${orden})`;
  });
}

export async function guardarUnidad(empresaId: string, unidadId: string, _: Estado, fd: FormData): Promise<Estado> {
  const nombre = nombreDe(fd);
  if (!esUuid(unidadId)) return { error: "La unidad no existe." };
  if (!nombre || nombre.length > 80) return { error: "Escribe el nombre de la unidad (hasta 80 caracteres)." };
  return correr(empresaId, "Unidad guardada.", async (tx) => {
    const cuenta = await cuentaIngreso(tx, fd.get("cuenta"));
    const r = await tx`UPDATE unidades_negocio SET nombre = ${nombre}, cuenta_ingreso_id = ${cuenta}, activa = ${fd.get("activa") === "on"}
                        WHERE id = ${unidadId}`;
    if (r.count === 0) throw new ErrorContable("La unidad no existe");
  });
}
