"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECCIONES: { grupo?: string; enlaces: [ruta: string, nombre: string][] }[] = [
  { enlaces: [["", "Inicio"]] },
  { grupo: "Ventas", enlaces: [["/facturas", "Facturas"], ["/cobros", "Cobros"], ["/clientes", "Clientes"], ["/servicios", "Servicios"]] },
  { grupo: "Cuentas por cobrar", enlaces: [["/cxc", "Antigüedad de saldos"], ["/cxc/estado", "Estado de cuenta"]] },
  { grupo: "Contabilidad", enlaces: [["/asientos", "Asientos"], ["/catalogo", "Catálogo de cuentas"], ["/cierres", "Cierres de período"]] },
  { grupo: "Libros", enlaces: [["/diario", "Libro diario"], ["/mayor", "Libro mayor"], ["/balanza", "Balanza de comprobación"]] },
  { grupo: "Empresa", enlaces: [["/comprobantes", "Comprobantes NCF"], ["/configuracion", "Configuración"], ["/usuarios", "Usuarios y roles"]] },
];

const TODAS = SECCIONES.flatMap((s) => s.enlaces.map(([r]) => r));

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
            const activo = r === "" ? ruta === base : ruta === href || (ruta.startsWith(href + "/") && !TODAS.some((o) => o.length > r.length && ruta.startsWith(base + o)));
            return (
              <Link key={r} href={href} aria-current={activo ? "page" : undefined}>{nombre}</Link>
            );
          })}
        </div>
      ))}
    </>
  );
}
