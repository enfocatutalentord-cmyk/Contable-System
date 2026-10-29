import type { Tx } from "./db";
import type { Periodo } from "./formatos-dgii.ts";
import { calcularIt1, EDITABLES, SECCIONES, type Resultado, type Seccion } from "./it1.ts";
import { calcularIr17, EDITABLES_IR17, SECCIONES_IR17 } from "./ir17.ts";
import { leerMonto } from "./montos.ts";

// Declaraciones juradas que el sistema prepara como borrador: IT-1 (ITBIS) e IR-17 (otras retenciones). Cada una con
// las casillas de su formulario oficial; lo escrito a mano se guarda en la tabla «declaraciones».

export type Formulario = "IT-1" | "IR-17";
export type Definicion = {
  nombre: string; ruta: string; diaVence: number; secciones: Seccion[]; editables: Set<string>;
  hojas: [Seccion["hoja"], string][]; cifras: [string, string][];
  calcular: (tx: Tx, p: Periodo, manuales: Record<string, string>) => Promise<Resultado>;
};

export const FORMULARIOS: Record<Formulario, Definicion> = {
  "IT-1": {
    nombre: "IT-1 · Declaración del ITBIS", ruta: "it1", diaVence: 20, secciones: SECCIONES, editables: EDITABLES,
    hojas: [["A", "Anexo A"], ["I", "Formulario IT-1"]],
    cifras: [["I21", "ITBIS cobrado (21)"], ["I25", "ITBIS deducible (25)"], ["I33", "Diferencia a pagar (33)"], ["I34", "Nuevo saldo a favor (34)"],
      ["I67", "Retenciones a pagar (67)"], ["I68", "Total general (68)"]],
    calcular: calcularIt1,
  },
  "IR-17": {
    nombre: "IR-17 · Otras retenciones y retribuciones complementarias", ruta: "ir17", diaVence: 10, secciones: SECCIONES_IR17,
    editables: EDITABLES_IR17, hojas: [["I", "Formulario IR-17"]],
    cifras: [["R25", "Otras retenciones (25)"], ["R28i", "Retribuciones complementarias (28)"], ["R29", "Impuesto a pagar (29)"],
      ["R33", "Diferencia a pagar (33)"], ["R34", "Nuevo saldo a favor (34)"], ["R37", "Total a pagar (37)"]],
    calcular: calcularIr17,
  },
};
export const esFormulario = (f: string): f is Formulario => f in FORMULARIOS;

export async function manualesDe(tx: Tx, formulario: Formulario, periodo: string): Promise<Record<string, string>> {
  const [d] = await tx<{ manuales: Record<string, string> }[]>`
    SELECT manuales FROM declaraciones WHERE formulario = ${formulario} AND periodo = ${periodo}`;
  return d?.manuales ?? {};
}

export async function calcularDeclaracion(tx: Tx, formulario: Formulario, p: Periodo): Promise<Resultado> {
  return FORMULARIOS[formulario].calcular(tx, p, await manualesDe(tx, formulario, p.periodo));
}

// Lo escrito a mano, validado: solo casillas que se pueden escribir y montos válidos. Lo que se deja igual a la
// sugerencia no se guarda, para que siga a lo registrado.
export function leerManuales(fd: FormData, editables: Set<string>): Record<string, string> | string {
  const salida: Record<string, string> = {};
  for (const k of editables) {
    const txt = String(fd.get(k) ?? "").trim();
    if (txt === "" || fd.get(`${k}_auto`) === txt) continue;
    const n = leerMonto(txt.replace(/%$/, ""));
    if (n === null) return `La casilla ${k.replace(/^[A-Z]/, "")} no tiene un monto válido.`;
    salida[k] = n;
  }
  return salida;
}
