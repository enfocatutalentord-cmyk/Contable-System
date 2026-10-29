"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PESTANAS_CLIENTE, puedeVer } from "@/lib/pestanas";

// pestanas: las que ve el rol de la persona en el cliente elegido (null = todas). soloCliente: usuario de una empresa cliente,
// que no ve las pantallas de la firma.
export function Menu({ firmaId, empresaId, admin, auditoria, pestanas, soloCliente }: {
  firmaId: string; empresaId: string | null; admin: boolean; auditoria: boolean; pestanas: string[] | null; soloCliente: boolean;
}) {
  const ruta = usePathname();
  const firma = `/firma/${firmaId}`;
  const base = empresaId ? `/e/${empresaId}` : null;
  const general: [string, string][] = [[firma, "Inicio de la firma"], [`${firma}/actividad`, "Actividad"]];
  if (admin) general.push([`${firma}/clientes`, "Clientes de la firma"], [`${firma}/equipo`, "Personas y accesos"], [`${firma}/perfiles`, "Roles y permisos"]);
  const cliente = PESTANAS_CLIENTE.map((s) => ({
    ...s,
    enlaces: s.enlaces.filter(([r]) => puedeVer(pestanas, r) && (r !== "/historial" || auditoria || !base)),
  }));
  const todas = cliente.flatMap((s) => s.enlaces.map(([r]) => r));
  const activoCliente = (r: string) => {
    if (!base) return false;
    const href = base + r;
    return r === "" ? ruta === base
      : ruta === href || (ruta.startsWith(href + "/") && !todas.some((o) => o.length > r.length && ruta.startsWith(base + o)));
  };
  return (
    <>
      {!soloCliente && <div className="grupo">General</div>}
      {!soloCliente && general.map(([href, nombre]) => (
        <Link key={href} href={href} aria-current={(href === firma ? ruta === firma : ruta.startsWith(href)) ? "page" : undefined}>{nombre}</Link>
      ))}
      {cliente.filter((s) => s.enlaces.length).map((s, i) => (
        <div key={i} style={{ display: "contents" }}>
          {s.grupo && <div className="grupo">{s.grupo}</div>}
          {s.enlaces.map(([r, nombre]) => (
            <Link key={r} href={base ? base + r : `${firma}/elegir?a=${encodeURIComponent(r || "/")}`}
              aria-current={activoCliente(r) ? "page" : undefined}>{nombre}</Link>
          ))}
        </div>
      ))}
    </>
  );
}
