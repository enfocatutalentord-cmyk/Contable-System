"use server";

import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { aPdf } from "@/lib/exportar";
import { ErrorExpediente, guardarArchivos } from "@/lib/expediente";
import { deCentavos } from "@/lib/montos";
import { calcularNomina, CARPETA_NOMINA, descripcionNomina, leerNomina, tablaNomina } from "@/lib/nomina";
import { puede } from "@/lib/permisos";
import { revalidatePath } from "next/cache";
import type { Estado } from "../acciones-cuenta";

// Prioridad 3 · P3h: el cálculo de la nómina del mes. No guarda nada: lo escrito viaja en el formulario y la respuesta vuelve en pantalla (los sueldos no pasan por la
// dirección de la página). Pide poder ver el cliente.
export type FilaVista = {
  nombre: string; salarioSS: string; gravable: string; afpTrabajador: string; sfsTrabajador: string; isr: string; isrEstimado: string; manual: boolean;
  pension: string; neto: string; afpEmpleador: string; sfsEmpleador: string; srl: string; infotep: string;
};
export type ResultadoVista = {
  filas: FilaVista[]; totales: Record<string, string>; topes: { srl: string; sfs: string; afp: string }; advertencias: string[];
};
export type EstadoNomina = { error?: string; resultado?: ResultadoVista };

export async function calcularNominaAccion(firmaId: string, empresaId: string, _: EstadoNomina, fd: FormData): Promise<EstadoNomina> {
  const { usuario } = await accesoFirma(firmaId, false);
  if (await soloCliente(firmaId, usuario.id)) return { error: "La nómina es del equipo de la firma." };
  if (!esUuid(empresaId)) return { error: "Elige el cliente." };
  const { empresa } = await exigirPermiso(empresaId, "ver");
  if (empresa.firma_id !== firmaId) return { error: "Ese cliente no es de esta firma." };
  const entrada = leerNomina(fd, empresa.rnc ?? "");
  if (typeof entrada === "string") return { error: entrada };
  const r = calcularNomina(entrada);
  const m = deCentavos;
  return {
    resultado: {
      filas: r.filas.map((f) => ({
        nombre: f.nombre, salarioSS: m(f.salarioSS), gravable: m(f.salarioISR + f.otrasISR), afpTrabajador: m(f.afpTrabajador), sfsTrabajador: m(f.sfsTrabajador), isr: m(f.isr),
        isrEstimado: m(f.isrEstimado), manual: f.isrManual !== null, pension: m(f.pension), neto: m(f.neto), afpEmpleador: m(f.afpEmpleador), sfsEmpleador: m(f.sfsEmpleador), srl: m(f.srl), infotep: m(f.infotep),
      })),
      totales: Object.fromEntries(Object.entries(r.totales).map(([k, v]) => [k, m(v)])),
      topes: { srl: m(r.topes.srl), sfs: m(r.topes.sfs), afp: m(r.topes.afp) },
      advertencias: r.advertencias,
    },
  };
}

// Guarda la hoja de la nómina (PDF) en la carpeta 04 · Declaraciones del expediente del cliente. Lleva sueldos y cédulas: pide «adjuntar» y también «empresa», el permiso que da ver los
// sueldos de la ficha. La nómina se vuelve a calcular aquí, nunca se toma del navegador. Cada vez que se guarda queda una copia nueva. El archivo de la TSS (.txt) no se guarda.
export async function guardarNominaEnExpediente(firmaId: string, empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId, false);
  if (await soloCliente(firmaId, usuario.id)) return { error: "La nómina es del equipo de la firma." };
  if (!esUuid(empresaId)) return { error: "Elige el cliente." };
  const { empresa, permisos } = await exigirPermiso(empresaId, "adjuntar");
  if (empresa.firma_id !== firmaId) return { error: "Ese cliente no es de esta firma." };
  if (!puede(permisos, "empresa")) return { error: "Guardar la nómina en el expediente pide el permiso para ver los sueldos del cliente (el de editar su ficha)." };
  const entrada = leerNomina(fd, empresa.rnc ?? "");
  if (typeof entrada === "string") return { error: entrada };
  const resultado = calcularNomina(entrada);
  try {
    const ahora = new Date().toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" });
    const tabla = tablaNomina(entrada, resultado, empresa.nombre + (empresa.rnc ? ` · RNC ${empresa.rnc}` : ""), `Generado por ${usuario.nombre} el ${ahora}`);
    const bytes = new Uint8Array(await aPdf(tabla));
    await conEmpresa(empresaId, (tx) => guardarArchivos(tx, {
      empresaId, usuarioId: usuario.id, archivos: [{ nombre: `Nomina_${entrada.periodo.replace("-", "")}_${empresa.rnc ?? "cliente"}.pdf`, bytes }], carpeta: CARPETA_NOMINA,
      anio: Number(entrada.periodo.slice(0, 4)), descripcion: descripcionNomina(entrada.periodo, resultado.filas.length),
    }));
  } catch (e) {
    return { error: e instanceof ErrorExpediente ? e.message : mensajeError(e) };
  }
  revalidatePath(`/firma/${firmaId}/nomina`);
  revalidatePath(`/e/${empresaId}/expediente`);
  return { ok: "Hoja de la nómina guardada en el expediente del cliente, carpeta 04 · Declaraciones." };
}
