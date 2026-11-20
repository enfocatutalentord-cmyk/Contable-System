"use server";

import { revalidatePath } from "next/cache";
import { accesoFirma, esUuid } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { aCentavos, leerMonto } from "@/lib/montos";
import {
  agregarCategoria, copiarAnio, guardarMonto, quitarCategoria, renombrarCategoria, type ListaPresupuesto,
} from "@/lib/presupuesto";
import { ErrorPresupuesto, guardarDeuda, guardarMeta, quitarDeuda, quitarMeta } from "@/lib/presupuesto-metas";
import { fechaValida } from "@/lib/reportes";
import type { Estado } from "../acciones-cuenta";

// Prioridad 1.6 del prompt de Patricia (20-nov-2026): el presupuesto de Empire. Solo administradores (lo personal es privado).

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();

async function propia(firmaId: string) {
  const { usuario, firma } = await accesoFirma(firmaId);
  if (!firma.empresa_propia_id) throw new Error("Primero elige la empresa que factura en Contabilidad.");
  return { usuario, empresaId: firma.empresa_propia_id };
}

const entero = (v: string, min: number, max: number) => (/^\d{1,4}$/.test(v) && Number(v) >= min && Number(v) <= max ? Number(v) : null);

// Guarda lo presupuestado de un mes: campos «m|<lista>|<categoría>» con el monto; con «todos» lo repite en los 12 meses del año.
export async function guardarPresupuestoAccion(firmaId: string, anio: number, mes: number, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { empresaId } = await propia(firmaId);
    const meses = fd.get("todos") ? Array.from({ length: 12 }, (_, i) => i + 1) : [mes];
    const campos: { lista: string; categoria: string; monto: bigint }[] = [];
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("m|")) continue;
      const [, lista, ...resto] = k.split("|");
      const categoria = resto.join("|");
      const bruto = String(v).trim();
      const monto = bruto === "" ? 0n : (() => { const m = leerMonto(bruto); return m === null ? null : aCentavos(m); })();
      if (monto === null) return { error: `El monto de «${categoria}» no es válido.` };
      campos.push({ lista, categoria, monto });
    }
    await conEmpresa(empresaId, async (tx) => {
      for (const m of meses) for (const c of campos) await guardarMonto(tx, empresaId, anio, m, c.lista, c.categoria, c.monto);
    });
    revalidatePath(`/firma/${firmaId}/empire/presupuesto`);
    return { ok: fd.get("todos") ? "Presupuesto guardado en los 12 meses." : "Presupuesto del mes guardado." };
  } catch (e) {
    return { error: e instanceof Error && !("code" in e) ? e.message : mensajeError(e) };
  }
}

export async function copiarAnioAccion(firmaId: string, anio: number, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { empresaId } = await propia(firmaId);
    const desde = entero(texto(fd, "desde"), 2000, 2100);
    if (!desde || desde === anio) return { error: "Elige otro año del que copiar." };
    const n = await conEmpresa(empresaId, (tx) => copiarAnio(tx, empresaId, desde, anio));
    revalidatePath(`/firma/${firmaId}/empire/presupuesto`);
    return { ok: n ? `Se copiaron ${n} montos de ${desde}. Lo que ya tenías escrito en ${anio} no se tocó.` : `No había montos nuevos que copiar de ${desde}.` };
  } catch (e) {
    return { error: e instanceof Error && !("code" in e) ? e.message : mensajeError(e) };
  }
}

const listaValida = (v: string): v is ListaPresupuesto => v === "oficina" || v === "personal";

export async function agregarCategoriaAccion(firmaId: string, lista: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { empresaId } = await propia(firmaId);
    if (!listaValida(lista)) return { error: "La lista no es válida." };
    await conEmpresa(empresaId, (tx) => agregarCategoria(tx, empresaId, lista, texto(fd, "nombre")));
    revalidatePath(`/firma/${firmaId}/empire/presupuesto`);
    return { ok: "Categoría agregada." };
  } catch (e) {
    return { error: e instanceof Error && !("code" in e) ? e.message : mensajeError(e) };
  }
}

export async function renombrarCategoriaAccion(firmaId: string, id: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { empresaId } = await propia(firmaId);
    if (!esUuid(id)) return { error: "La categoría no existe." };
    await conEmpresa(empresaId, (tx) => renombrarCategoria(tx, id, texto(fd, "nombre")));
    revalidatePath(`/firma/${firmaId}/empire/presupuesto`);
    return { ok: "Nombre cambiado. Lo ya gastado y presupuestado con el nombre anterior no se mueve." };
  } catch (e) {
    return { error: e instanceof Error && !("code" in e) ? e.message : mensajeError(e) };
  }
}

export async function quitarCategoriaAccion(firmaId: string, id: string, _: Estado): Promise<Estado> {
  try {
    const { empresaId } = await propia(firmaId);
    if (!esUuid(id)) return { error: "La categoría no existe." };
    await conEmpresa(empresaId, (tx) => quitarCategoria(tx, id));
    revalidatePath(`/firma/${firmaId}/empire/presupuesto`);
    return { ok: "Categoría quitada de las listas. Los años anteriores la conservan." };
  } catch (e) {
    return { error: e instanceof Error && !("code" in e) ? e.message : mensajeError(e) };
  }
}

const msg = (e: unknown) => (e instanceof ErrorPresupuesto ? e.message : e instanceof Error && !("code" in e) ? e.message : mensajeError(e));
const opcional = (v: string) => (v && esUuid(v) ? v : null);
const montoDe = (v: string) => { const m = leerMonto(v); return m === null ? null : aCentavos(m); };

export async function guardarMetaAccion(firmaId: string, id: string | null, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { empresaId } = await propia(firmaId);
    const meta = montoDe(texto(fd, "meta"));
    if (meta === null) return { error: "El monto de la meta no es válido." };
    const objetivo = texto(fd, "objetivo") || null;
    if (objetivo && !fechaValida(objetivo)) return { error: "La fecha objetivo no es válida." };
    await conEmpresa(empresaId, (tx) => guardarMeta(tx, empresaId, {
      id: id ?? undefined, nombre: texto(fd, "nombre"), tipo: texto(fd, "tipo"), meta, objetivo, cuentaId: opcional(texto(fd, "cuenta")),
    }));
    revalidatePath(`/firma/${firmaId}/empire/presupuesto`);
    return { ok: id ? "Meta cambiada." : "Meta agregada." };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function quitarMetaAccion(firmaId: string, id: string, _: Estado): Promise<Estado> {
  try {
    const { empresaId } = await propia(firmaId);
    if (!esUuid(id)) return { error: "La meta no existe." };
    await conEmpresa(empresaId, (tx) => quitarMeta(tx, id));
    revalidatePath(`/firma/${firmaId}/empire/presupuesto`);
    return { ok: "Meta quitada. Lo ahorrado queda en la contabilidad." };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function guardarDeudaAccion(firmaId: string, id: string | null, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { empresaId } = await propia(firmaId);
    const inicial = montoDe(texto(fd, "inicial") || "0"), pagoMensual = montoDe(texto(fd, "pago") || "0");
    if (inicial === null || pagoMensual === null) return { error: "Los montos no son válidos." };
    await conEmpresa(empresaId, (tx) => guardarDeuda(tx, empresaId, {
      id: id ?? undefined, acreedor: texto(fd, "acreedor"), tipo: texto(fd, "tipo"), inicial, pagoMensual,
      cuentaPrestamoId: opcional(texto(fd, "prestamo")), cuentaInteresId: opcional(texto(fd, "interes")),
    }));
    revalidatePath(`/firma/${firmaId}/empire/presupuesto`);
    return { ok: id ? "Deuda cambiada." : "Deuda agregada." };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function quitarDeudaAccion(firmaId: string, id: string, _: Estado): Promise<Estado> {
  try {
    const { empresaId } = await propia(firmaId);
    if (!esUuid(id)) return { error: "La deuda no existe." };
    await conEmpresa(empresaId, (tx) => quitarDeuda(tx, id));
    revalidatePath(`/firma/${firmaId}/empire/presupuesto`);
    return { ok: "Deuda quitada de la lista. Lo pagado queda en la contabilidad." };
  } catch (e) {
    return { error: msg(e) };
  }
}
