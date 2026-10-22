"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Seccion = { grupo?: string; enlaces: [ruta: string, nombre: string][] };

export function Menu({ empresaId, auditoria }: { empresaId: string; auditoria: boolean }) {
  const ruta = usePathname();
  const base = `/e/${empresaId}`;
  const secciones: Seccion[] = [
    { enlaces: [["", "Inicio"]] },
    { grupo: "Ventas", enlaces: [["/facturas", "Facturas"], ["/cobros", "Cobros"], ["/clientes", "Clientes"], ["/servicios", "Productos y servicios"]] },
    { grupo: "Cuentas por cobrar", enlaces: [["/cxc", "Antigüedad de saldos"], ["/cxc/estado", "Estado de cuenta"]] },
    { grupo: "Compras", enlaces: [["/compras", "Compras y gastos"], ["/pagos", "Pagos"], ["/proveedores", "Proveedores"]] },
    { grupo: "Cuentas por pagar", enlaces: [["/cxp", "Antigüedad por pagar"], ["/cxp/estado", "Estado de cuenta"]] },
    { grupo: "Contabilidad", enlaces: [["/asientos", "Asientos"], ["/catalogo", "Catálogo de cuentas"], ["/cierres", "Cierres de período"]] },
    { grupo: "Libros", enlaces: [["/diario", "Libro diario"], ["/mayor", "Libro mayor"], ["/balanza", "Balanza de comprobación"]] },
    {
      grupo: "Impuestos",
      enlaces: [["/fiscal", "Perfil fiscal"], ["/fiscal/impuestos", "Impuestos"], ["/fiscal/retenciones", "Retenciones"],
                ["/comprobantes", "Comprobantes fiscales"], ["/fiscal/probar", "Probar cálculo"]],
    },
    { grupo: "Control", enlaces: auditoria ? [["/historial", "Historial de cambios"]] : [] },
    {
      grupo: "Empresa",
      enlaces: [
        ["/empresa", "Ficha de la empresa"],
        ["/configuracion", "Configuración de cuentas"],
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
