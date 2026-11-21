"use server";

import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { deCentavos } from "@/lib/montos";
import { calcularNomina, leerNomina } from "@/lib/nomina";

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
