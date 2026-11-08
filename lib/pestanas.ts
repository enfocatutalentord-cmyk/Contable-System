export type Seccion = { grupo?: string; enlaces: [ruta: string, nombre: string][] };

// Pestañas de cada cliente, en el orden del menú (aprobado por Joannie el 29-oct-2026): lo de todos los días arriba,
// después reportes e impuestos, y la configuración al final, separada (lo más usado arriba agiliza; la configuración
// abajo, como recomienda Material Design). La ruta es también la clave con la que cada rol guarda qué pestañas ve
// (`perfiles.pestanas`; vacío = todas).
export const PESTANAS_CLIENTE: Seccion[] = [
  { grupo: "Cliente elegido", enlaces: [["", "Resumen del cliente"], ["/recepcion", "Documentos del cliente"], ["/facturas-subidas", "Facturas subidas"], ["/expediente", "Expediente"], ["/solicitudes", "Solicitudes y formularios"], ["/bitacora", "Bitácora"], ["/notificaciones", "Notificaciones de pago"]] },
  { grupo: "Ventas", enlaces: [["/facturas", "Facturas"], ["/igualas", "Igualas"], ["/recurrentes", "Facturas recurrentes"], ["/propuestas", "Propuestas"], ["/cobros", "Cobros"], ["/anticipos", "Anticipos de clientes"], ["/cxc", "Cuentas por cobrar"], ["/cxc/estado", "Estado de cuenta de clientes"],
                               ["/clientes", "Clientes y contactos"], ["/servicios", "Productos y servicios"]] },
  { grupo: "Compras", enlaces: [["/compras", "Compras y gastos"], ["/pagos", "Pagos"], ["/cxp", "Cuentas por pagar"], ["/cxp/estado", "Estado de cuenta de proveedores"],
                                ["/proveedores", "Proveedores"]] },
  { grupo: "Contabilidad", enlaces: [["/asientos", "Asientos"], ["/plantillas", "Asientos frecuentes"], ["/bancos", "Bancos"], ["/cierres", "Cierre del mes"]] },
  // Solo en la empresa propia y solo para el rol Administrador (bloque 7a): lo personal de la socia.
  { grupo: "Cuenta de la socia", enlaces: [["/salidas", "Registrar salidas"], ["/socia", "Cuenta de la socia"]] },
  { grupo: "Reportes", enlaces: [["/reportes", "Centro de reportes"], ["/diario", "Libro diario"], ["/mayor", "Libro mayor"], ["/balanza", "Balanza de comprobación"], ["/estados", "Estados financieros"]] },
  { grupo: "Impuestos", enlaces: [["/dgii", "Reportes DGII"], ["/comprobantes", "Comprobantes NCF"], ["/fiscal", "Perfil fiscal"]] },
  {
    grupo: "Configuración del cliente",
    enlaces: [["/empresa", "Ficha de la empresa"], ["/catalogo", "Catálogo de cuentas"], ["/configuracion", "Configuración de cuentas"],
              ["/fiscal/impuestos", "Tasas de impuestos"], ["/fiscal/retenciones", "Retenciones"], ["/fiscal/probar", "Probar cálculo"],
              ["/usuarios", "Usuarios y permisos"], ["/historial", "Historial de cambios"]],
  },
];

// Pestañas de cada empresa que en el menú van en la sección Administración (rediseño R1, n.º 21 de la lista).
// R4: también la ficha («Administración › Empresas Empire» en la lista de rediseños).
export const PESTANAS_ADMINISTRACION = ["/empresa", "/usuarios", "/historial"];

// Pestañas que no van en el menú porque se abren desde otra (el estado de cuenta, desde Cuentas por cobrar o por pagar).
export const FUERA_DEL_MENU = ["/cxc/estado", "/cxp/estado"];

export const TODAS_LAS_PESTANAS = PESTANAS_CLIENTE.flatMap((s) => s.enlaces.map(([r]) => r));

export const esPestana = (v: string) => TODAS_LAS_PESTANAS.includes(v);

// Pestañas privadas (montos personales de la socia, Documento maestro, sección 3): solo las ve el rol Administrador o un rol que
// las tenga marcadas a propósito. Un rol con «todas» (vacío) no las incluye; así Solo lectura y la Coordinadora no las ven.
export const PESTANAS_PRIVADAS = ["/salidas", "/socia"];
export const GRUPO_PRIVADO = "Cuenta de la socia";

// Pestañas que solo existen en la empresa propia, Contabilidad Empire (rediseño R2, n.º 4): lo que Empire le cobra a sus clientes
// y lo personal de la socia. En un cliente no se ven ni se abren.
export const PESTANAS_SOLO_PROPIA = ["/igualas", "/recurrentes", "/propuestas", ...PESTANAS_PRIVADAS];

// La contabilidad (rediseño R3, n.º 8): a los clientes no se les hacen asientos. Solo la ven la empresa propia y el cliente que tenga
// marcada «lleva contabilidad» en su ficha. Lo que ya tenga guardado se conserva.
export const PESTANAS_CONTABLES = ["/asientos", "/plantillas", "/cierres", "/diario", "/mayor", "/balanza", "/catalogo", "/configuracion", "/bancos",
  // n.º 9: cobros, pagos, cuentas por cobrar y por pagar son del sistema del cliente. El cobro y el pago se anotan en la factura y la compra.
  "/cobros", "/anticipos", "/cxc", "/cxc/estado", "/pagos", "/cxp", "/cxp/estado"];

// Lo que ve un rol en una empresa según sea la propia o un cliente (y si ese cliente lleva contabilidad en el sistema).
export const pestanasEn = (pestanas: string[] | null, propia: boolean, contabilidad = false): string[] | null =>
  propia ? pestanas : (pestanas ?? TODAS_LAS_PESTANAS).filter((r) => !PESTANAS_SOLO_PROPIA.includes(r) && (contabilidad || !PESTANAS_CONTABLES.includes(r)));

// Lo que ve un rol en un cliente: null = todo (administrador). Un rol sin lista ve todo menos lo privado.
export function pestanasDelRol(pestanas: string[] | null, administrador: boolean): string[] | null {
  if (administrador) return null;
  if (!pestanas) return TODAS_LAS_PESTANAS.filter((r) => !PESTANAS_PRIVADAS.includes(r));
  return pestanas.filter((p) => TODAS_LAS_PESTANAS.includes(p));
}

// Lo que se guarda al editar un rol: «todas» (NULL) si marcó todas las comunes y ninguna privada; si no, la lista.
export function pestanasAGuardar(marcadas: string[]): string[] | null {
  const comunes = TODAS_LAS_PESTANAS.filter((r) => !PESTANAS_PRIVADAS.includes(r));
  if (comunes.every((r) => marcadas.includes(r)) && !marcadas.some((r) => PESTANAS_PRIVADAS.includes(r))) return null;
  return TODAS_LAS_PESTANAS.filter((r) => marcadas.includes(r));
}

// Descargas de Excel y PDF: cada reporte pertenece a la pestaña donde se ve.
const REPORTES: Record<string, string> = {
  diario: "/diario", mayor: "/mayor", balanza: "/balanza", asientos: "/asientos", historial: "/historial",
  "estado-inicial": "/solicitudes", antiguedad: "/cxc", "estado-cuenta": "/cxc/estado", "antiguedad-cxp": "/cxp", "estado-cuenta-proveedor": "/cxp/estado",
  "dgii-606": "/dgii", "dgii-607": "/dgii", "dgii-608": "/dgii", it1: "/dgii", ir17: "/dgii", ir6: "/dgii",
  facturas: "/facturas", factura: "/facturas", "reporte-mensual": "/bitacora", proyeccion: "/dgii", cobros: "/cobros", bitacora: "/bitacora", "lista-precios": "/servicios", socia: "/socia", salidas: "/salidas", propuesta: "/propuestas", "recibo-anticipo": "/anticipos", compras: "/compras", pagos: "/pagos", catalogo: "/catalogo", "conciliacion-banco": "/bancos", "estado-financiero": "/estados", ir2: "/dgii", "ir2-a1": "/dgii", "ir2-b1": "/dgii", "ir2-j": "/dgii", "ir2-h": "/dgii",
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
