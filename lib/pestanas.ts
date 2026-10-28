export type Seccion = { grupo?: string; enlaces: [ruta: string, nombre: string][] };

// Pestañas de cada cliente. Sin cliente elegido llevan a «Elige un cliente» y de ahí a la pestaña.
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
