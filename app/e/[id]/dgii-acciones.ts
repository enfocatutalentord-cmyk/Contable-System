"use server";

import { revalidatePath } from "next/cache";
import { exigirPermiso } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { ErrorContable } from "@/lib/asientos";
import { armarFormato, esFormato, FORMATOS, periodoDe } from "@/lib/formatos-dgii";
import { calcularDeclaracion, esFormulario, FORMULARIOS, leerManuales } from "@/lib/declaraciones";
import { leerSociedad } from "@/lib/ir2-sociedad";
import { deCentavos, leerMonto } from "@/lib/montos";
import { fechaValida } from "@/lib/reportes";
import { ErrorImpuestos, guardarPresentacion, leerConstancia, quitarPresentacion } from "@/lib/impuestos-mes";
import type { Estado } from "../../acciones-cuenta";

// Deja constancia de que el formato se envió por la Oficina Virtual (o en cero), con la referencia que da la DGII.
// Solo si no tiene errores: la DGII rechaza el archivo completo si un registro está mal.
export async function marcarEnviado(empresaId: string, formato: string, periodo: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "impuestos", "/dgii");
  const p = periodoDe(periodo);
  if (!esFormato(formato) || !p) return { error: "Formato o período no válido." };
  const referencia = String(fd.get("referencia") ?? "").trim().slice(0, 60) || null;
  try {
    const constancia = await leerConstancia(fd.get("constancia"));
    await conEmpresa(empresaId, async (tx) => {
      const a = await armarFormato(tx, formato, p);
      if (a.avisos.some((x) => x.nivel === "error")) throw new ErrorContable("Corrige primero los errores del formato");
      const enCero = a.filas.length === 0 && !(a.consumo && a.consumo.cantidad > 0);
      if (fd.get("en_cero") === "1" && !enCero) throw new ErrorContable(`El ${formato} tiene registros este mes: no va en cero`);
      await guardarPresentacion(tx, {
        empresaId, usuarioId: usuario.id, formato, periodo, nombre: `${formato} · ${FORMATOS[formato]}`, enCero, referencia, huella: a.huella,
        registros: a.filas.length, casillas: null, monto: null, fechaLimite: null, constancia,
      });
    });
  } catch (e) {
    return { error: e instanceof ErrorImpuestos ? e.message : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/dgii`);
  return { ok: `${formato} · ${FORMATOS[formato]} marcado como enviado.` };
}

// Para reenviar (por ejemplo, después de corregir algo): se quita la marca y queda en el historial de cambios.
export async function quitarEnvio(empresaId: string, formato: string, periodo: string): Promise<Estado> {
  await exigirPermiso(empresaId, "impuestos", "/dgii");
  if (!esFormato(formato) || !periodoDe(periodo)) return { error: "Formato o período no válido." };
  try {
    await conEmpresa(empresaId, (tx) => quitarPresentacion(tx, formato, periodo));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/dgii`);
  return { ok: "Marca de envío quitada." };
}

// ───── Declaraciones juradas (IT-1, IR-17, IR-2) ─────

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
  // Constancia, monto a pagar y fecha límite (bloque 4a). Con monto, nace la notificación de pago de la DGII.
  const montoTexto = String(fd.get("monto_pagar") ?? "").trim();
  const monto = montoTexto ? leerMonto(montoTexto) : null;
  const fechaLimite = String(fd.get("fecha_limite") ?? "").trim() || null;
  if (montoTexto && monto === null) return { error: "El monto a pagar no es válido." };
  if (fechaLimite && !fechaValida(fechaLimite)) return { error: "La fecha límite no es válida." };
  try {
    const constancia = await leerConstancia(fd.get("constancia"));
    await conEmpresa(empresaId, async (tx) => {
      const r = await calcularDeclaracion(tx, formulario, p);
      if (r.avisos.some((x) => x.nivel === "error")) throw new ErrorContable(`Corrige primero los errores del ${formulario}`);
      const casillas = Object.fromEntries(Object.entries(r.valores).map(([k, v]) => [k, deCentavos(v)]));
      const enCero = Object.values(r.valores).every((v) => v === 0n);
      await guardarPresentacion(tx, {
        empresaId, usuarioId: usuario.id, formato: formulario, periodo, nombre: FORMULARIOS[formulario].nombre.split(" · ")[0], enCero, referencia,
        huella: r.huella, registros: 0, casillas, monto, fechaLimite, constancia,
      });
    });
  } catch (e) {
    return { error: e instanceof ErrorImpuestos ? e.message : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/dgii`, "layout");
  return { ok: `${formulario} marcado como presentado.` };
}

export async function quitarDeclaracion(empresaId: string, formulario: string, periodo: string): Promise<Estado> {
  await exigirPermiso(empresaId, "impuestos", "/dgii");
  if (!esFormulario(formulario) || !periodoDe(periodo)) return { error: "Formulario o período no válido." };
  try {
    await conEmpresa(empresaId, (tx) => quitarPresentacion(tx, formulario, periodo));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/dgii`, "layout");
  return { ok: "Marca de presentado quitada." };
}

// IR-2, anexos H-1 y H-2: datos de la sociedad, uno por empresa (se reusan cada año).
export async function guardarSociedad(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "impuestos", "/dgii");
  const datos = leerSociedad(fd);
  if (typeof datos === "string") return { error: datos };
  try {
    await conEmpresa(empresaId, (tx) => tx`
      INSERT INTO sociedad_ir2 (empresa_id, datos, actualizado_por, actualizado_en)
      VALUES (${empresaId}, ${tx.json(datos)}, ${usuario.id}, now())
      ON CONFLICT (empresa_id) DO UPDATE SET datos = EXCLUDED.datos, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/dgii/ir2`);
  return { ok: "Datos de los anexos H-1 y H-2 guardados." };
}
