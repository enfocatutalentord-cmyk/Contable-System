"use server";

import { revalidatePath } from "next/cache";
import { accesoFirma, esUuid } from "@/lib/acceso";
import { conUsuario, db, mensajeError } from "@/lib/db";
import { crearEmpresa, leerFicha } from "@/lib/empresas";
import type { Estado } from "../acciones-cuenta";
import { marcarEmpresaPropia } from "./acciones";

// Prioridad 1.1 del prompt de Patricia (20-nov-2026): sus empresas se agregan directo en Contabilidad, sin pasar por la lista de
// clientes. Una nueva se crea con su catálogo y su configuración tributaria; una que ya estaba como cliente solo cambia de lugar
// (conserva todo lo que tiene). Empire es la que factura a los clientes de la firma.

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();

const facturaA = async (firmaId: string, empresaId: string): Promise<Estado> => {
  const fd = new FormData();
  fd.set("empresa", empresaId);
  return marcarEmpresaPropia(firmaId, {}, fd);
};

export async function agregarEmpresaPropia(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, firma } = await accesoFirma(firmaId);
  const modo = texto(fd, "modo");
  let empresaId: string;
  try {
    if (modo === "existente") {
      empresaId = texto(fd, "empresa");
      if (!esUuid(empresaId)) return { error: "Elige la empresa que estaba como cliente." };
      const [e] = await db()<{ id: string; propia: boolean }[]>`
        SELECT id, contabilidad_propia AS propia FROM empresas WHERE id = ${empresaId} AND firma_id = ${firmaId}`;
      if (!e) return { error: "Esa empresa no es de la firma." };
      if (e.propia) return { error: "Esa empresa ya está en Contabilidad." };
    } else {
      fd.set("tipo_identificacion", "rnc");
      const ficha = leerFicha(fd);
      if (typeof ficha === "string") return { error: ficha };
      if (!ficha.rnc) return { error: "Escribe el RNC de la empresa (9 dígitos)." };
      const [ya] = await db()<{ nombre: string }[]>`SELECT nombre FROM empresas WHERE firma_id = ${firmaId} AND rnc = ${ficha.rnc}`;
      if (ya) return { error: `Ya existe una empresa con ese RNC: ${ya.nombre}. Pásala con «Estaba como cliente».` };
      empresaId = await crearEmpresa({ firmaId, usuarioId: usuario.id, ficha });
    }
    await conUsuario(usuario.id, (tx) => tx`
      UPDATE empresas SET contabilidad_propia = true, lleva_contabilidad = true WHERE id = ${empresaId} AND firma_id = ${firmaId}`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  // La primera de las propias, o la que se marque, es la que factura a los clientes.
  if (!firma.empresa_propia_id || fd.get("factura") === "on") {
    const r = await facturaA(firmaId, empresaId);
    if (r.error) return r;
  }
  revalidatePath(`/firma/${firmaId}`, "layout");
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: modo === "existente" ? "La empresa pasó a Contabilidad con todo lo que tenía. Ya no sale en la lista de clientes."
    : "Empresa creada en Contabilidad con su catálogo de cuentas y su configuración tributaria." };
}

// Elegir cuál de las propias factura a los clientes de la firma (igualas, propuestas, cuentas por cobrar y presupuesto).
export async function elegirQueFactura(firmaId: string, empresaId: string): Promise<Estado> {
  if (!esUuid(empresaId)) return { error: "Datos no válidos." };
  const [e] = await db()<{ ok: boolean }[]>`SELECT contabilidad_propia AS ok FROM empresas WHERE id = ${empresaId} AND firma_id = ${firmaId}`;
  if (!e?.ok) return { error: "Primero agrégala a Contabilidad." };
  return facturaA(firmaId, empresaId);
}

// Devolver una empresa a la lista de clientes (por si se agregó por error). La que factura a los clientes no se devuelve.
export async function devolverAClientes(firmaId: string, empresaId: string): Promise<Estado> {
  const { usuario, firma } = await accesoFirma(firmaId);
  if (!esUuid(empresaId)) return { error: "Datos no válidos." };
  if (firma.empresa_propia_id === empresaId) return { error: "Esta es la que factura a los clientes: elige otra para facturar antes de devolverla." };
  try {
    await conUsuario(usuario.id, (tx) => tx`
      UPDATE empresas SET contabilidad_propia = false WHERE id = ${empresaId} AND firma_id = ${firmaId}`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/firma/${firmaId}`, "layout");
  return { ok: "La empresa volvió a la lista de clientes. No se borró nada." };
}
