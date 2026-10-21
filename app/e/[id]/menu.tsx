"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECCIONES: { grupo?: string; enlaces: [ruta: string, nombre: string][] }[] = [
  { enlaces: [["", "Inicio"]] },
  { grupo: "Contabilidad", enlaces: [["/asientos", "Asientos"], ["/catalogo", "Catálogo de cuentas"], ["/cierres", "Cierres de período"]] },
  { grupo: "Libros", enlaces: [["/diario", "Libro diario"], ["/mayor", "Libro mayor"], ["/balanza", "Balanza de comprobación"]] },
  { grupo: "Empresa", enlaces: [["/usuarios", "Usuarios y roles"]] },
];

export function Menu({ empresaId }: { empresaId: string }) {
  const ruta = usePathname();
  const base = `/e/${empresaId}`;
  return (
    <>
      {SECCIONES.map((s, i) => (
        <div key={i} style={{ display: "contents" }}>
          {s.grupo && <div className="grupo">{s.grupo}</div>}
          {s.enlaces.map(([r, nombre]) => {
            const href = base + r;
            const activo = r === "" ? ruta === base : ruta.startsWith(href);
            return (
              <Link key={r} href={href} aria-current={activo ? "page" : undefined}>{nombre}</Link>
            );
          })}
        </div>
      ))}
    </>
  );
}
