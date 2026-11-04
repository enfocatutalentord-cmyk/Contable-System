import type { Tx } from "./db";
import { periodoDe, type Periodo } from "./formatos-dgii.ts";
import { anexoB1, b1ConCostoD, type Anexo1 } from "./ir2.ts";
import { calcularIt1, EDITABLES, SECCIONES, type Resultado, type Seccion } from "./it1.ts";
import { calcularIr17, EDITABLES_IR17, SECCIONES_IR17 } from "./ir17.ts";
import { calcularIr2, EDITABLES_IR2, SECCIONES_IR2, venceIr2 } from "./ir2-liquidacion.ts";
import { deCentavos, leerMonto } from "./montos.ts";

// Declaraciones juradas que el sistema prepara como borrador: IT-1 (ITBIS), IR-17 (otras retenciones) e IR-2 (ISR anual;
// su período es el mes en que termina el ejercicio). Cada una con
// las casillas de su formulario oficial; lo escrito a mano se guarda en la tabla «declaraciones».

export type Formulario = "IT-1" | "IR-17" | "IR-2";
export type Definicion = {
  nombre: string; ruta: string; diaVence: number; secciones: Seccion[]; editables: Set<string>;
  hojas: [Seccion["hoja"], string][]; cifras: [string, string][];
  calcular: (tx: Tx, p: Periodo, manuales: Record<string, string>) => Promise<Resultado>;
  // Para las anuales: fecha límite propia, a qué pasa el saldo a favor y cómo se nombra cada clave.
  anual?: { vence: (p: Periodo) => string; etiqueta: (clave: string) => string };
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
  "IR-2": {
    nombre: "IR-2 · Liquidación del ISR anual de sociedades", ruta: "ir2", diaVence: 0, secciones: SECCIONES_IR2, editables: EDITABLES_IR2,
    hojas: [["D", "Anexo D · Depreciación y costo de venta"], ["D1", "Anexo D-1 · Depreciación de la categoría 1"],
      ["D2", "Anexo D-2 · Ajuste fiscal por inflación"], ["G", "Anexo G · Ajustes fiscales"], ["E", "Anexo E · Datos complementarios"],
      ["I", "Formulario IR-2"], ["X", "Impuesto a los activos"]],
    cifras: [["I7", "Renta neta imponible antes de pérdidas (7)"], ["I11", "Renta neta imponible (11)"], ["I12", "Impuesto liquidado (12)"],
      ["I23", "Diferencia a pagar (23)"], ["I31", "Total a pagar (31)"], ["I33", "Nuevo saldo a favor (33)"],
      ["DCV", "Costo de venta del anexo D"], ["X45", "Impuesto a los activos a pagar (45)"]],
    calcular: calcularIr2,
    anual: {
      vence: venceIr2,
      etiqueta: (k) => ({ G: "Anexo G", E: "Anexo E", D: "Anexo D", U: "Anexo D-1", T: "Anexo D-2", X: "Activos, casilla" } as Record<string, string>)[k[0]]
        ?.concat(` ${k.slice(1)}`) ?? `Casilla ${k.slice(1)}`,
    },
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

// Anexo B-1 con el costo de venta del anexo D en la casilla 5, como lo lleva el IR-2 (pantalla y descarga del B-1).
export async function anexoB1ConCostoD(tx: Tx, inicio: string, fin: string): Promise<Anexo1> {
  const b1 = await anexoB1(tx, inicio, fin);
  const { valores } = await calcularDeclaracion(tx, "IR-2", periodoDe(fin.slice(0, 7).replace("-", ""))!);
  const costo = valores.DCV ?? 0n;
  const nota = `Costo de venta del anexo D (las cuentas de costo de la contabilidad suman ${deCentavos(b1.valores["5"] ?? 0n)})`;
  return { ...b1, valores: b1ConCostoD(b1.valores, costo), detalle: { ...b1.detalle, "5": [{ cuentaId: "", codigo: "", nombre: nota, monto: costo }] } };
}
