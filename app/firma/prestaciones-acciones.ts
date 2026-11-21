"use server";

import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { calcular, leerEntrada, type Resultado } from "@/lib/prestaciones";

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
