"use client";

export function BotonImprimir({ texto = "Imprimir o guardar PDF" }: { texto?: string }) {
  return <button type="button" onClick={() => window.print()}>{texto}</button>;
}
