"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// «Viendo: Todos los clientes / un cliente». Al cambiar de cliente se queda en la misma pestaña.
export function SelectorCliente({ firmaId, clientes, actual, todos }: { firmaId: string; clientes: { id: string; nombre: string }[]; actual: string | null; todos: boolean }) {
  const router = useRouter();
  const ruta = usePathname();
  const busqueda = useSearchParams();
  const ir = (id: string) => {
    if (!id) return router.push(`/firma/${firmaId}`);
    const m = ruta.match(/^\/e\/[^/]+(\/.*)?$/);
    // Pestaña actual sin lo que es de un documento en particular (/facturas/<id> → /facturas).
    const pestana = m?.[1]?.split("/").filter((p) => p && !/^[0-9a-f-]{36}$|^\d+$/.test(p) && p !== "editar" && p !== "nuevo" && p !== "nueva").join("/")
      ?? busqueda.get("a")?.replace(/^\//, "") ?? "";
    router.push(`/e/${id}${pestana ? `/${pestana}` : ""}`);
  };
  return (
    <label className="selector-cliente">
      <span>Viendo</span>
      <select value={actual ?? ""} onChange={(e) => ir(e.target.value)} aria-label="Cliente">
        {todos && <option value="">Todos los clientes</option>}
        {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select>
    </label>
  );
}
