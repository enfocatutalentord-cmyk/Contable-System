export type Seccion = { grupo?: string; enlaces: [ruta: string, nombre: string][] };

// Pestañas de cada cliente, en el orden del menú. La ruta es también la clave con la que cada rol guarda qué pestañas ve
// (`perfiles.pestanas`; vacío = todas). Sin cliente elegido, el menú lleva a «Elige un cliente» y de ahí a la pestaña.
export const PESTANAS: Seccion[] = [
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
];

// Todas las pestañas de un cliente, incluido su resumen, el control y los datos de la empresa.
export const PESTANAS_CLIENTE: Seccion[] = [
  { grupo: "Cliente elegido", enlaces: [["", "Resumen del cliente"]] },
  ...PESTANAS,
  { grupo: "Control", enlaces: [["/historial", "Historial de cambios"]] },
  { grupo: "Empresa", enlaces: [["/empresa", "Ficha de la empresa"], ["/configuracion", "Configuración de cuentas"], ["/usuarios", "Usuarios y permisos"]] },
];

export const TODAS_LAS_PESTANAS = PESTANAS_CLIENTE.flatMap((s) => s.enlaces.map(([r]) => r));

export const esPestana = (v: string) => TODAS_LAS_PESTANAS.includes(v);

// Descargas de Excel y PDF: cada reporte pertenece a la pestaña donde se ve.
const REPORTES: Record<string, string> = {
  diario: "/diario", mayor: "/mayor", balanza: "/balanza", asientos: "/asientos", historial: "/historial",
  antiguedad: "/cxc", "estado-cuenta": "/cxc/estado", "antiguedad-cxp": "/cxp", "estado-cuenta-proveedor": "/cxp/estado",
};

// Pestaña a la que pertenece una dirección dentro del cliente (/facturas/nueva → /facturas; /cxc/estado → /cxc/estado;
// /exportar/diario → /diario). Devuelve null para lo que no es una pestaña (documentos adjuntos): eso lo cuidan los permisos.
export function pestanaDeRuta(resto: string): string | null {
  if (resto === "" || resto === "/") return "";
  const reporte = resto.match(/^\/exportar\/([^/?]+)/)?.[1];
  if (reporte) return REPORTES[reporte] ?? "/historial";
  const candidatas = TODAS_LAS_PESTANAS.filter((r) => r && (resto === r || resto.startsWith(r + "/")));
  return candidatas.sort((a, b) => b.length - a.length)[0] ?? null;
}

export const puedeVer = (pestanas: string[] | null, ruta: string) => pestanas === null || pestanas.includes(ruta);
