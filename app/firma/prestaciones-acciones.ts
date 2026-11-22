"use server";

import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { ErrorExpediente, guardarArchivos } from "@/lib/expediente";
import { hoyISO } from "@/lib/montos";
import { logoDe } from "@/lib/pdf-analisis";
import { CARPETA_PRESTACIONES, descripcionPrestaciones, pdfPrestaciones } from "@/lib/pdf-prestaciones";
import { calcular, leerEntrada, type Resultado } from "@/lib/prestaciones";
import { puede } from "@/lib/permisos";
import { revalidatePath } from "next/cache";
import type { Estado } from "../acciones-cuenta";

// Prioridad 3 · P3g: el cálculo de prestaciones de un empleado. No guarda nada: lo escrito viaja en el formulario y la respuesta vuelve en pantalla, así los sueldos no
// pasan por la dirección de la página. Pide poder ver el cliente.
export type EstadoPrestaciones = { error?: string; resultado?: Resultado };

export async function calcularPrestaciones(firmaId: string, empresaId: string, _: EstadoPrestaciones, fd: FormData): Promise<EstadoPrestaciones> {
  const { usuario } = await accesoFirma(firmaId, false);
  if (await soloCliente(firmaId, usuario.id)) return { error: "Las prestaciones laborales son del equipo de la firma." };
  if (!esUuid(empresaId)) return { error: "Elige el cliente." };
  const { empresa } = await exigirPermiso(empresaId, "ver");
  if (empresa.firma_id !== firmaId) return { error: "Ese cliente no es de esta firma." };
  const entrada = leerEntrada(fd);
  if (typeof entrada === "string") return { error: entrada };
  return { resultado: calcular(entrada) };
}

// Guarda la hoja de cálculo (PDF, con el logo del cliente) en la carpeta 05 · Reportes de su expediente. Lleva el sueldo del empleado: pide «adjuntar» y también «empresa», el permiso
// que da ver los sueldos de la ficha. El resultado se vuelve a calcular aquí, nunca se toma del navegador. Cada vez que se guarda queda una copia nueva.
export async function guardarPrestacionesEnExpediente(firmaId: string, empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId, false);
  if (await soloCliente(firmaId, usuario.id)) return { error: "Las prestaciones laborales son del equipo de la firma." };
  if (!esUuid(empresaId)) return { error: "Elige el cliente." };
  const { empresa, permisos } = await exigirPermiso(empresaId, "adjuntar");
  if (empresa.firma_id !== firmaId) return { error: "Ese cliente no es de esta firma." };
  if (!puede(permisos, "empresa")) return { error: "Guardar la hoja en el expediente pide el permiso para ver los sueldos del cliente (el de editar su ficha)." };
  const entrada = leerEntrada(fd);
  if (typeof entrada === "string") return { error: entrada };
  try {
    await conEmpresa(empresaId, async (tx) => {
      const pdf = await pdfPrestaciones({ empresa: empresa.nombre, rnc: empresa.rnc, entrada, resultado: calcular(entrada), preparadoPor: usuario.nombre, logo: await logoDe(tx, empresaId) });
      await guardarArchivos(tx, {
        empresaId, usuarioId: usuario.id, archivos: [{ nombre: pdf.nombre, bytes: pdf.datos }], carpeta: CARPETA_PRESTACIONES, anio: Number(hoyISO().slice(0, 4)),
        descripcion: descripcionPrestaciones(entrada.nombre, entrada.terminacion, entrada.termino),
      });
    });
  } catch (e) {
    return { error: e instanceof ErrorExpediente ? e.message : mensajeError(e) };
  }
  revalidatePath(`/firma/${firmaId}/laboral`);
  revalidatePath(`/e/${empresaId}/expediente`);
  return { ok: "Hoja guardada en el expediente del cliente, carpeta 05 · Reportes." };
}
