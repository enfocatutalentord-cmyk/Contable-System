"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Seccion = { grupo?: string; enlaces: [ruta: string, nombre: string][] };

export function Menu({ empresaId, ventas, auditoria }: { empresaId: string; ventas: boolean; auditoria: boolean }) {
  const ruta = usePathname();
  const base = `/e/${empresaId}`;
  const secciones: Seccion[] = [
    { enlaces: [["", "Inicio"]] },
    ...(ventas
      ? [
          { grupo: "Ventas", enlaces: [["/facturas", "Facturas"], ["/cobros", "Cobros"], ["/clientes", "Clientes"], ["/servicios", "Servicios"]] },
          { grupo: "Cuentas por cobrar", enlaces: [["/cxc", "Antigüedad de saldos"], ["/cxc/estado", "Estado de cuenta"]] },
        ] as Seccion[]
      : []),
    { grupo: "Contabilidad", enlaces: [["/asientos", "Asientos"], ["/catalogo", "Catálogo de cuentas"], ["/cierres", "Cierres de período"]] },
    { grupo: "Libros", enlaces: [["/diario", "Libro diario"], ["/mayor", "Libro mayor"], ["/balanza", "Balanza de comprobación"]] },
    { grupo: "Control", enlaces: auditoria ? [["/historial", "Historial de cambios"]] : [] },
    {
      grupo: "Empresa",
      enlaces: [
        ["/empresa", "Ficha de la empresa"],
        ...(ventas ? ([["/comprobantes", "Comprobantes NCF"], ["/configuracion", "Configuración"]] as [string, string][]) : []),
        ["/usuarios", "Usuarios y permisos"],
      ],
    },
  ];
  const todas = secciones.flatMap((s) => s.enlaces.map(([r]) => r));
  return (
    <>
      {secciones.filter((s) => s.enlaces.length).map((s, i) => (
        <div key={i} style={{ display: "contents" }}>
          {s.grupo && <div className="grupo">{s.grupo}</div>}
          {s.enlaces.map(([r, nombre]) => {
            const href = base + r;
            const activo = r === "" ? ruta === base
              : ruta === href || (ruta.startsWith(href + "/") && !todas.some((o) => o.length > r.length && ruta.startsWith(base + o)));
            return <Link key={r} href={href} aria-current={activo ? "page" : undefined}>{nombre}</Link>;
          })}
        </div>
      ))}
    </>
  );
}
