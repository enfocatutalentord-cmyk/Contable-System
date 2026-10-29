"use server";

import { revalidatePath } from "next/cache";
import { exigirPermiso } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { ErrorContable } from "@/lib/asientos";
import { armarFormato, esFormato, FORMATOS, periodoDe } from "@/lib/formatos-dgii";
import { calcularDeclaracion, esFormulario, FORMULARIOS, leerManuales } from "@/lib/declaraciones";
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

// ───── Declaraciones juradas (IT-1, IR-17) ─────

// Guarda lo escrito a mano en el borrador (lo que se deja igual a la sugerencia sigue a lo registrado).
export async function guardarDeclaracion(empresaId: string, formulario: string, periodo: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "impuestos", "/dgii");
  if (!esFormulario(formulario) || !periodoDe(periodo)) return { error: "Formulario o período no válido." };
  const manuales = leerManuales(fd, FORMULARIOS[formulario].editables);
  if (typeof manuales === "string") return { error: manuales };
  try {
    await conEmpresa(empresaId, (tx) => tx`
      INSERT INTO declaraciones (empresa_id, formulario, periodo, manuales, actualizado_por, actualizado_en)
      VALUES (${empresaId}, ${formulario}, ${periodo}, ${tx.json(manuales)}, ${usuario.id}, now())
      ON CONFLICT (empresa_id, formulario, periodo) DO UPDATE
        SET manuales = EXCLUDED.manuales, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/dgii/${FORMULARIOS[formulario].ruta}`);
  return { ok: `Borrador del ${formulario} guardado y recalculado.` };
}

// Constancia de que la declaración se presentó en la Oficina Virtual. Guarda sus casillas: el nuevo saldo a favor pasa
// como saldo a favor anterior al mes siguiente.
export async function presentarDeclaracion(empresaId: string, formulario: string, periodo: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "impuestos", "/dgii");
  const p = periodoDe(periodo);
  if (!esFormulario(formulario) || !p) return { error: "Formulario o período no válido." };
  const referencia = String(fd.get("referencia") ?? "").trim().slice(0, 60) || null;
  try {
    await conEmpresa(empresaId, async (tx) => {
      const r = await calcularDeclaracion(tx, formulario, p);
      if (r.avisos.some((x) => x.nivel === "error")) throw new ErrorContable(`Corrige primero los errores del ${formulario}`);
      const casillas = Object.fromEntries(Object.entries(r.valores).map(([k, v]) => [k, deCentavos(v)]));
      const x = await tx`
        INSERT INTO envios_dgii (empresa_id, formato, periodo, referencia, huella, registros, enviado_por, casillas)
        VALUES (${empresaId}, ${formulario}, ${periodo}, ${referencia}, ${r.huella}, 0, ${usuario.id}, ${tx.json(casillas)})
        ON CONFLICT (empresa_id, formato, periodo) DO NOTHING`;
      if (x.count === 0) throw new ErrorContable(`El ${formulario} de ese mes ya está marcado como presentado`);
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/dgii`, "layout");
  return { ok: `${formulario} marcado como presentado.` };
}

export async function quitarDeclaracion(empresaId: string, formulario: string, periodo: string): Promise<Estado> {
  await exigirPermiso(empresaId, "impuestos", "/dgii");
  if (!esFormulario(formulario) || !periodoDe(periodo)) return { error: "Formulario o período no válido." };
  try {
    await conEmpresa(empresaId, (tx) => tx`DELETE FROM envios_dgii WHERE formato = ${formulario} AND periodo = ${periodo}`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/dgii`, "layout");
  return { ok: "Marca de presentado quitada." };
}
