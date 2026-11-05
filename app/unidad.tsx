"use client";

// Unidad de negocio de una línea (asiento, factura o compra). Solo se muestra si la empresa tiene unidades.
export type UnidadOpcion = { id: string; nombre: string };

export function SelectorUnidad({ unidades, valor, cambiar, etiqueta }: {
  unidades: UnidadOpcion[]; valor: string; cambiar: (v: string) => void; etiqueta: string;
}) {
  const conocida = !valor || unidades.some((u) => u.id === valor);
  return (
    <select aria-label={etiqueta} value={valor} onChange={(e) => cambiar(e.target.value)}>
      <option value="">Sin unidad</option>
      {!conocida && <option value={valor}>(unidad inactiva)</option>}
      {unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
    </select>
  );
}
