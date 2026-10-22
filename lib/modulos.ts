import { notFound } from "next/navigation";

// Módulos que existen en el código pero aún no están aprobados para usarse.
// Ventas y CxC se construyó antes del documento rector y se adapta y aprueba en la fase 3; mientras, queda apagado.
export const MODULOS = {
  ventas: process.env.MODULO_VENTAS === "1",
};

export function exigirModulo(m: keyof typeof MODULOS) {
  if (!MODULOS[m]) notFound();
}
