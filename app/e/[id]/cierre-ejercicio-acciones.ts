"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { cerrarEjercicio, deshacerCierre, traspasarResultado } from "@/lib/cierre-ejercicio";
import { conEmpresa, mensajeError } from "@/lib/db";
import type { Estado } from "../../acciones-cuenta";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();

async function hacer(empresaId: string, fin: string, aviso: string, fn: () => Promise<unknown>): Promise<Estado> {
  if (!FECHA.test(fin)) return { error: "Fecha no válida." };
  try {
    await fn();
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/cierres?ejercicio=${fin}&aviso=${aviso}`);
}

// Cerrar el ejercicio (permiso «cerrar», como el cierre del mes).
export async function cerrarElEjercicio(empresaId: string, fin: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "cerrar", "/cierres");
  const cuenta = texto(fd, "cuenta_resultado");
  if (!esUuid(cuenta)) return { error: "Elige la cuenta del resultado del ejercicio." };
  return hacer(empresaId, fin, "cerrado", () => conEmpresa(empresaId, async (tx) => {
    const [{ mes_cierre }] = await tx<{ mes_cierre: number }[]>`SELECT mes_cierre FROM empresas WHERE id = ${empresaId}`;
    return cerrarEjercicio(tx, { empresaId, fin, mesCierre: mes_cierre, cuentaResultadoId: cuenta, usuarioId: usuario.id });
  }));
}

export async function traspasarElResultado(empresaId: string, fin: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "cerrar", "/cierres");
  const cuenta = texto(fd, "cuenta_acumulados");
  if (!esUuid(cuenta)) return { error: "Elige la cuenta de resultados acumulados." };
  return hacer(empresaId, fin, "traspasado", () => conEmpresa(empresaId, (tx) => traspasarResultado(tx, { empresaId, fin, cuentaAcumuladosId: cuenta, usuarioId: usuario.id })));
}

// Deshacer el cierre reabre el ejercicio: solo quien puede reabrir períodos.
export async function deshacerElCierre(empresaId: string, fin: string, _: Estado, _fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "reabrir", "/cierres");
  return hacer(empresaId, fin, "deshecho", () => conEmpresa(empresaId, (tx) => deshacerCierre(tx, { empresaId, fin, usuarioId: usuario.id })));
}
