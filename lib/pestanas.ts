export type Seccion = { grupo?: string; enlaces: [ruta: string, nombre: string][] };

// Pestañas de cada cliente, en el orden del menú (aprobado por Joannie el 29-oct-2026): lo de todos los días arriba,
// después reportes e impuestos, y la configuración al final, separada (lo más usado arriba agiliza; la configuración
// abajo, como recomienda Material Design). La ruta es también la clave con la que cada rol guarda qué pestañas ve
// (`perfiles.pestanas`; vacío = todas).
export const PESTANAS_CLIENTE: Seccion[] = [
  { grupo: "Cliente elegido", enlaces: [["", "Resumen del cliente"], ["/recepcion", "Documentos del cliente"]] },
  { grupo: "Ventas", enlaces: [["/facturas", "Facturas"], ["/cobros", "Cobros"], ["/cxc", "Cuentas por cobrar"], ["/cxc/estado", "Estado de cuenta de clientes"],
                               ["/clientes", "Clientes y contactos"], ["/servicios", "Productos y servicios"]] },
  { grupo: "Compras", enlaces: [["/compras", "Compras y gastos"], ["/pagos", "Pagos"], ["/cxp", "Cuentas por pagar"], ["/cxp/estado", "Estado de cuenta de proveedores"],
                                ["/proveedores", "Proveedores"]] },
  { grupo: "Contabilidad", enlaces: [["/asientos", "Asientos"], ["/cierres", "Cierre del mes"]] },
  { grupo: "Reportes", enlaces: [["/diario", "Libro diario"], ["/mayor", "Libro mayor"], ["/balanza", "Balanza de comprobación"]] },
  { grupo: "Impuestos", enlaces: [["/comprobantes", "Comprobantes NCF"], ["/fiscal", "Perfil fiscal"]] },
  {
    grupo: "Configuración del cliente",
    enlaces: [["/empresa", "Ficha de la empresa"], ["/catalogo", "Catálogo de cuentas"], ["/configuracion", "Configuración de cuentas"],
              ["/fiscal/impuestos", "Tasas de impuestos"], ["/fiscal/retenciones", "Retenciones"], ["/fiscal/probar", "Probar cálculo"],
              ["/usuarios", "Usuarios y permisos"], ["/historial", "Historial de cambios"]],
  },
];

// Pestañas que no van en el menú porque se abren desde otra (el estado de cuenta, desde Cuentas por cobrar o por pagar).
export const FUERA_DEL_MENU = ["/cxc/estado", "/cxp/estado"];

export const TODAS_LAS_PESTANAS = PESTANAS_CLIENTE.flatMap((s) => s.enlaces.map(([r]) => r));

export const esPestana = (v: string) => TODAS_LAS_PESTANAS.includes(v);

// Descargas de Excel y PDF: cada reporte pertenece a la pestaña donde se ve.
const REPORTES: Record<string, string> = {
  diario: "/diario", mayor: "/mayor", balanza: "/balanza", asientos: "/asientos", historial: "/historial",
  antiguedad: "/cxc", "estado-cuenta": "/cxc/estado", "antiguedad-cxp": "/cxp", "estado-cuenta-proveedor": "/cxp/estado",
  facturas: "/facturas", cobros: "/cobros", compras: "/compras", pagos: "/pagos", catalogo: "/catalogo",
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
