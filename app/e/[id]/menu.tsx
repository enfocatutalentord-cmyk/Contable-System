"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PESTANAS, type Seccion } from "@/lib/pestanas";

export function Menu({ firmaId, empresaId, admin, auditoria }: { firmaId: string; empresaId: string | null; admin: boolean; auditoria: boolean }) {
  const ruta = usePathname();
  const firma = `/firma/${firmaId}`;
  const base = empresaId ? `/e/${empresaId}` : null;
  const general: [string, string][] = [[firma, "Inicio de la firma"], [`${firma}/actividad`, "Actividad"]];
  if (admin) general.push([`${firma}/clientes`, "Clientes de la firma"], [`${firma}/equipo`, "Personas y accesos"], [`${firma}/perfiles`, "Roles y permisos"]);
  const cliente: Seccion[] = [
    { grupo: "Cliente elegido", enlaces: [["", "Resumen del cliente"]] },
    ...PESTANAS,
    { grupo: "Control", enlaces: auditoria || !base ? [["/historial", "Historial de cambios"]] : [] },
    { grupo: "Empresa", enlaces: [["/empresa", "Ficha de la empresa"], ["/configuracion", "Configuración de cuentas"], ["/usuarios", "Usuarios y permisos"]] },
  ];
  const todas = cliente.flatMap((s) => s.enlaces.map(([r]) => r));
  const activoCliente = (r: string) => {
    if (!base) return false;
    const href = base + r;
    return r === "" ? ruta === base
      : ruta === href || (ruta.startsWith(href + "/") && !todas.some((o) => o.length > r.length && ruta.startsWith(base + o)));
  };
  return (
    <>
      <div className="grupo">General</div>
      {general.map(([href, nombre]) => (
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
