"use server";

import { revalidatePath } from "next/cache";
import { exigirPermiso } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { fechaValida } from "@/lib/reportes";
import { leerSaldos } from "@/lib/saldos-registro";
import type { Estado } from "../../acciones-cuenta";

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim().slice(0, 120) || null;

// Línea de firmas de los estados financieros en PDF (permiso «empresa», como la ficha).
export async function guardarFirmasEstados(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  await exigirPermiso(empresaId, "empresa", "/estados");
  try {
    await conEmpresa(empresaId, (tx) => tx`
      UPDATE empresas SET firma_preparado = ${texto(fd, "firma_preparado")}, firma_icpard = ${texto(fd, "firma_icpard")},
             firma_aprobado = ${texto(fd, "firma_aprobado")}, firma_cargo = ${texto(fd, "firma_cargo")}
       WHERE id = ${empresaId}`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/estados`);
  return { ok: "Firmas guardadas." };
}

// Saldos del balance de un cliente sin contabilidad (rediseño R5): lo que las facturas no traen, a una fecha de corte.
export async function guardarSaldosRegistro(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/estados");
  const fecha = String(fd.get("fecha") ?? "");
  if (!fechaValida(fecha)) return { error: "Elige la fecha de corte." };
  const montos = leerSaldos(fd);
  if (typeof montos === "string") return { error: montos };
  const notas = String(fd.get("notas") ?? "").trim().slice(0, 500) || null;
  try {
    await conEmpresa(empresaId, (tx) => tx`
      INSERT INTO saldos_registro (empresa_id, fecha, montos, notas, actualizado_por) VALUES (${empresaId}, ${fecha}, ${tx.json(montos)}, ${notas}, ${usuario.id})
      ON CONFLICT (empresa_id, fecha) DO UPDATE SET montos = EXCLUDED.montos, notas = EXCLUDED.notas, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/estados`);
  return { ok: "Saldos guardados. El estado de situación financiera ya los toma." };
}

export async function borrarCorte(empresaId: string, fecha: string): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/estados");
  if (!fechaValida(fecha)) return { error: "Fecha no válida." };
  await conEmpresa(empresaId, (tx) => tx`DELETE FROM saldos_registro WHERE fecha = ${fecha}`);
  revalidatePath(`/e/${empresaId}/estados`);
  return { ok: "Corte borrado." };
}
