"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { bitacora } from "@/lib/asientos";
import { conEmpresa, mensajeError } from "@/lib/db";
import { esEmpresaPropia } from "@/lib/propia";
import { leerUnidad } from "@/lib/empresa-propia";
import { aCentavos, hoyISO, leerMonto, verMonto } from "@/lib/montos";
import { fechaValida } from "@/lib/reportes";
import { anularSalida, esTipoSalida, registrarSalida, TIPOS_SALIDA } from "@/lib/salidas";
import { deshacerLiquidacion, liquidar } from "@/lib/socia";
import type { Estado } from "../../acciones-cuenta";

const texto = (fd: FormData, campo: string) => String(fd.get(campo) ?? "").trim();

export async function registrarSalidaAccion(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "contabilizar", "/salidas");
  if (!(await esEmpresaPropia(empresaId))) return { error: "Las salidas se registran en la empresa propia de la firma." };
  const tipo = texto(fd, "tipo");
  const fecha = texto(fd, "fecha");
  const monto = leerMonto(texto(fd, "monto"));
  const unidadId = leerUnidad(texto(fd, "unidad"));
  if (!esTipoSalida(tipo)) return { error: "Elige qué tipo de salida es." };
  if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
  if (monto === null || aCentavos(monto) <= 0n) return { error: "Escribe el monto." };
  if (unidadId === undefined) return { error: "La unidad de negocio no es válida." };
  const origenId = texto(fd, "origen"), destinoId = texto(fd, "destino");
  if ((origenId && !esUuid(origenId)) || (destinoId && !esUuid(destinoId))) return { error: "Elige las cuentas de la lista." };
  try {
    const r = await conEmpresa(empresaId, async (tx) => {
      const r = await registrarSalida(tx, empresaId, usuario.id, {
        tipo, fecha, origenId, destinoId, monto: aCentavos(monto), unidadId,
        categoria: texto(fd, "categoria").slice(0, 80) || null, acreedor: texto(fd, "acreedor").slice(0, 120) || null,
        descripcion: texto(fd, "descripcion").slice(0, 300) || null, referencia: texto(fd, "referencia").slice(0, 80) || null,
      });
      await bitacora(tx, empresaId, usuario.id, "salida_registrada", { salida: r.id });
      return r;
    });
    revalidatePath(`/e/${empresaId}`, "layout");
    return { ok: `Salida n.º ${r.numero} registrada (${TIPOS_SALIDA[tipo].nombre}, RD$${verMonto(aCentavos(monto))}): asiento n.º ${r.asiento}.` };
  } catch (e) {
    return { error: mensajeError(e) };
  }
}

export async function anularSalidaAccion(empresaId: string, salidaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "revertir", "/salidas");
  if (!esUuid(salidaId)) return { error: "La salida no existe." };
  try {
    await conEmpresa(empresaId, (tx) => anularSalida(tx, salidaId, usuario.id, texto(fd, "motivo").slice(0, 300)));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: "Salida anulada; su asiento también." };
}

export async function liquidarAccion(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "cerrar", "/socia");
  if (!(await esEmpresaPropia(empresaId))) return { error: "La cuenta de la socia es de la empresa propia de la firma." };
  const cuentaId = texto(fd, "cuenta"), fin = texto(fd, "fin"), fecha = texto(fd, "fecha");
  const modo = texto(fd, "modo") === "cuenta_por_cobrar" ? "cuenta_por_cobrar" : "dividendos";
  if (!esUuid(cuentaId)) return { error: "Elige la cuenta corriente de la socia." };
  if (!fechaValida(fin) || !fechaValida(fecha)) return { error: "La fecha no es válida." };
  const netoTxt = texto(fd, "neto");
  const neto = netoTxt ? leerMonto(netoTxt) : null;
  if (netoTxt && neto === null) return { error: "El monto no es válido." };
  try {
    const r = await conEmpresa(empresaId, (tx) => liquidar(tx, {
      empresaId, usuarioId: usuario.id, cuentaId, fin, hoy: hoyISO(), modo, fecha, neto: neto === null ? null : aCentavos(neto),
      nota: texto(fd, "nota").slice(0, 500) || null,
    }));
    revalidatePath(`/e/${empresaId}`, "layout");
    return { ok: r.asiento ? `Liquidación registrada: asiento n.º ${r.asiento}. La retención va a la casilla 5 del IR-17 del mes.` : "Queda anotado: el saldo sigue como cuenta por cobrar a la socia." };
  } catch (e) {
    return { error: mensajeError(e) };
  }
}

export async function deshacerLiquidacionAccion(empresaId: string, id: string, _: Estado): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "reabrir", "/socia");
  if (!esUuid(id)) return { error: "La liquidación no existe." };
  try {
    await conEmpresa(empresaId, (tx) => deshacerLiquidacion(tx, id, usuario.id));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: "Liquidación deshecha." };
}
