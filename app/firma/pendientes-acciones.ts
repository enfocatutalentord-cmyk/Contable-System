"use server";

import { revalidatePath } from "next/cache";
import { accesoFirma, esUuid } from "@/lib/acceso";
import { bitacora } from "@/lib/asientos";
import { conEmpresa, mensajeError } from "@/lib/db";
import { aCentavos, leerMonto, verMonto } from "@/lib/montos";
import { ErrorPresupuesto } from "@/lib/presupuesto-metas";
import { agregarPendiente, descartarPendiente, marcarPagado } from "@/lib/presupuesto-pendientes";
import { fechaValida } from "@/lib/reportes";
import type { Estado } from "../acciones-cuenta";

// Prioridad 1.6 del prompt de Patricia (cierre): gastos pendientes de pago y la casilla «Pagado». Solo administradores, como el presupuesto.

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();
const msg = (e: unknown) => (e instanceof ErrorPresupuesto ? e.message : e instanceof Error && !("code" in e) ? e.message : mensajeError(e));

async function propia(firmaId: string) {
  const { usuario, firma } = await accesoFirma(firmaId);
  if (!firma.empresa_propia_id) throw new ErrorPresupuesto("Primero elige la empresa que factura en Contabilidad.");
  return { usuario, empresaId: firma.empresa_propia_id };
}

export async function agregarPendienteAccion(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { usuario, empresaId } = await propia(firmaId);
    const monto = leerMonto(texto(fd, "monto"));
    if (monto === null || aCentavos(monto) <= 0n) return { error: "Escribe el monto." };
    const fecha = texto(fd, "fecha");
    if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
    const cuenta = texto(fd, "cuenta");
    if (!esUuid(cuenta)) return { error: "Elige la cuenta de la lista." };
    await conEmpresa(empresaId, (tx) => agregarPendiente(tx, empresaId, usuario.id, {
      tipo: texto(fd, "tipo"), fecha, categoria: texto(fd, "categoria").slice(0, 80) || null, descripcion: texto(fd, "descripcion").slice(0, 300) || null,
      monto: aCentavos(monto), cuentaId: cuenta,
    }));
    revalidatePath(`/firma/${firmaId}/empire/presupuesto`);
    return { ok: "Gasto pendiente anotado. No resta del presupuesto ni del banco hasta que lo marques como pagado." };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function marcarPagadoAccion(firmaId: string, id: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { usuario, empresaId } = await propia(firmaId);
    if (!esUuid(id)) return { error: "El gasto no existe." };
    const origen = texto(fd, "origen"), fecha = texto(fd, "fecha");
    if (!esUuid(origen)) return { error: "Elige de dónde salió el dinero." };
    if (!fechaValida(fecha)) return { error: "La fecha del pago no es válida." };
    const s = await conEmpresa(empresaId, async (tx) => {
      const s = await marcarPagado(tx, empresaId, usuario.id, id, { origenId: origen, fecha, referencia: texto(fd, "referencia").slice(0, 80) || null });
      await bitacora(tx, empresaId, usuario.id, "salida_registrada", { salida: s.id, gastoPendiente: id });
      return s;
    });
    revalidatePath(`/firma/${firmaId}/empire/presupuesto`);
    revalidatePath(`/e/${empresaId}`, "layout");
    return { ok: `Pagado: salida n.º ${s.numero}, asiento n.º ${s.asiento}.` };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function descartarPendienteAccion(firmaId: string, id: string, _: Estado): Promise<Estado> {
  try {
    const { empresaId } = await propia(firmaId);
    if (!esUuid(id)) return { error: "El gasto no existe." };
    await conEmpresa(empresaId, (tx) => descartarPendiente(tx, id));
    revalidatePath(`/firma/${firmaId}/empire/presupuesto`);
    return { ok: "Gasto pendiente descartado." };
  } catch (e) {
    return { error: msg(e) };
  }
}
