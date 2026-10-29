"use server";

import { revalidatePath } from "next/cache";
import { exigirPermiso } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { ErrorContable } from "@/lib/asientos";
import { armarFormato, esFormato, FORMATOS, periodoDe } from "@/lib/formatos-dgii";
import { calcularIt1, leerManuales } from "@/lib/it1";
import { deCentavos } from "@/lib/montos";
import type { Estado } from "../../acciones-cuenta";

// Deja constancia de que el formato se envió por la Oficina Virtual (o en cero), con la referencia que da la DGII.
// Solo si no tiene errores: la DGII rechaza el archivo completo si un registro está mal.
export async function marcarEnviado(empresaId: string, formato: string, periodo: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "impuestos", "/dgii");
  const p = periodoDe(periodo);
  if (!esFormato(formato) || !p) return { error: "Formato o período no válido." };
  const referencia = String(fd.get("referencia") ?? "").trim().slice(0, 60) || null;
  try {
    await conEmpresa(empresaId, async (tx) => {
      const a = await armarFormato(tx, formato, p);
      if (a.avisos.some((x) => x.nivel === "error")) throw new ErrorContable("Corrige primero los errores del formato");
      const enCero = a.filas.length === 0 && !(a.consumo && a.consumo.cantidad > 0);
      const r = await tx`
        INSERT INTO envios_dgii (empresa_id, formato, periodo, en_cero, referencia, huella, registros, enviado_por)
        VALUES (${empresaId}, ${formato}, ${periodo}, ${enCero}, ${referencia}, ${a.huella}, ${a.filas.length}, ${usuario.id})
        ON CONFLICT (empresa_id, formato, periodo) DO NOTHING`;
      if (r.count === 0) throw new ErrorContable("Ese formato ya está marcado como enviado");
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/dgii`);
  return { ok: `${formato} · ${FORMATOS[formato]} marcado como enviado.` };
}

// Para reenviar (por ejemplo, después de corregir algo): se quita la marca y queda en el historial de cambios.
export async function quitarEnvio(empresaId: string, formato: string, periodo: string): Promise<Estado> {
  await exigirPermiso(empresaId, "impuestos", "/dgii");
  if (!esFormato(formato) || !periodoDe(periodo)) return { error: "Formato o período no válido." };
  try {
    await conEmpresa(empresaId, (tx) => tx`DELETE FROM envios_dgii WHERE formato = ${formato} AND periodo = ${periodo}`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/dgii`);
  return { ok: "Marca de envío quitada." };
}

// ───── IT-1 ─────

// Guarda lo escrito a mano en el borrador del IT-1 (lo que se deja igual a la sugerencia sigue a lo registrado).
export async function guardarIt1(empresaId: string, periodo: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "impuestos", "/dgii");
  if (!periodoDe(periodo)) return { error: "Período no válido." };
  const manuales = leerManuales(fd);
  if (typeof manuales === "string") return { error: manuales };
  try {
    await conEmpresa(empresaId, (tx) => tx`
      INSERT INTO declaraciones_itbis (empresa_id, periodo, manuales, actualizado_por, actualizado_en)
      VALUES (${empresaId}, ${periodo}, ${tx.json(manuales)}, ${usuario.id}, now())
      ON CONFLICT (empresa_id, periodo) DO UPDATE
        SET manuales = EXCLUDED.manuales, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/dgii/it1`);
  return { ok: "Borrador del IT-1 guardado y recalculado." };
}

// Constancia de que el IT-1 se presentó en la Oficina Virtual. Guarda sus casillas: la 34 (nuevo saldo a favor) pasa
// como saldo a favor anterior (casilla 29) al mes siguiente.
export async function presentarIt1(empresaId: string, periodo: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "impuestos", "/dgii");
  const p = periodoDe(periodo);
  if (!p) return { error: "Período no válido." };
  const referencia = String(fd.get("referencia") ?? "").trim().slice(0, 60) || null;
  try {
    await conEmpresa(empresaId, async (tx) => {
      const [d] = await tx<{ manuales: Record<string, string> }[]>`SELECT manuales FROM declaraciones_itbis WHERE periodo = ${periodo}`;
      const r = await calcularIt1(tx, p, d?.manuales ?? {});
      if (r.avisos.some((x) => x.nivel === "error")) throw new ErrorContable("Corrige primero los errores del IT-1");
      const casillas = Object.fromEntries(Object.entries(r.valores).map(([k, v]) => [k, deCentavos(v)]));
      const x = await tx`
        INSERT INTO envios_dgii (empresa_id, formato, periodo, referencia, huella, registros, enviado_por, casillas)
        VALUES (${empresaId}, 'IT-1', ${periodo}, ${referencia}, ${r.huella}, 0, ${usuario.id}, ${tx.json(casillas)})
        ON CONFLICT (empresa_id, formato, periodo) DO NOTHING`;
      if (x.count === 0) throw new ErrorContable("El IT-1 de ese mes ya está marcado como presentado");
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/dgii`, "layout");
  return { ok: "IT-1 marcado como presentado." };
}

export async function quitarIt1(empresaId: string, periodo: string): Promise<Estado> {
  await exigirPermiso(empresaId, "impuestos", "/dgii");
  if (!periodoDe(periodo)) return { error: "Período no válido." };
  try {
    await conEmpresa(empresaId, (tx) => tx`DELETE FROM envios_dgii WHERE formato = 'IT-1' AND periodo = ${periodo}`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/dgii`, "layout");
  return { ok: "Marca de presentado quitada." };
}
