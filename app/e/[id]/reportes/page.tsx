import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";
import { puedeVer } from "@/lib/pestanas";

export const metadata = { title: "Centro de reportes · Empire Tax’N Legal" };

type Reporte = { nombre: string; ayuda: string; ruta: string; pestana: string };
const GRUPOS: [titulo: string, reportes: Reporte[]][] = [
  ["Estados financieros", [
    { nombre: "Estado de resultados", ayuda: "Ingresos, costos, gastos y utilidad; comparativo y mes por mes.", ruta: "/estados?tipo=resultados", pestana: "/estados" },
    { nombre: "Estado de situación financiera", ayuda: "Activos, pasivos y patrimonio a una fecha.", ruta: "/estados?tipo=balance", pestana: "/estados" },
    { nombre: "Estado de flujos de efectivo", ayuda: "Método indirecto: operación, inversión y financiamiento.", ruta: "/estados?tipo=flujo", pestana: "/estados" },
    { nombre: "Estado de cambios en el patrimonio", ayuda: "Capital, reservas y resultados del período.", ruta: "/estados?tipo=patrimonio", pestana: "/estados" },
  ]],
  ["Libros contables", [
    { nombre: "Libro diario", ayuda: "Todos los asientos contabilizados del período.", ruta: "/diario", pestana: "/diario" },
    { nombre: "Libro mayor", ayuda: "Movimientos y saldo de una cuenta.", ruta: "/mayor", pestana: "/mayor" },
    { nombre: "Balanza de comprobación", ayuda: "Saldos iniciales, movimientos y saldos finales.", ruta: "/balanza", pestana: "/balanza" },
    { nombre: "Asientos", ayuda: "Búsqueda avanzada de asientos.", ruta: "/asientos", pestana: "/asientos" },
  ]],
  ["Ventas y cuentas por cobrar", [
    { nombre: "Facturas", ayuda: "Facturas y notas de crédito con impuestos.", ruta: "/facturas", pestana: "/facturas" },
    { nombre: "Cobros", ayuda: "Cobros recibidos y retenciones.", ruta: "/cobros", pestana: "/cobros" },
    { nombre: "Antigüedad de cuentas por cobrar", ayuda: "Lo que deben los clientes por tramos de vencimiento.", ruta: "/cxc", pestana: "/cxc" },
    { nombre: "Estado de cuenta de clientes", ayuda: "Movimientos y saldo de un cliente.", ruta: "/cxc/estado", pestana: "/cxc/estado" },
  ]],
  ["Compras y cuentas por pagar", [
    { nombre: "Compras y gastos", ayuda: "Compras registradas con ITBIS y otros impuestos.", ruta: "/compras", pestana: "/compras" },
    { nombre: "Pagos", ayuda: "Pagos a proveedores y retenciones hechas.", ruta: "/pagos", pestana: "/pagos" },
    { nombre: "Antigüedad de cuentas por pagar", ayuda: "Lo que se debe a proveedores por tramos.", ruta: "/cxp", pestana: "/cxp" },
    { nombre: "Estado de cuenta de proveedores", ayuda: "Movimientos y saldo de un proveedor.", ruta: "/cxp/estado", pestana: "/cxp/estado" },
  ]],
  ["Bancos", [
    { nombre: "Conciliación bancaria", ayuda: "Por cuenta: reporte del mes, partidas en tránsito y cierre.", ruta: "/bancos", pestana: "/bancos" },
  ]],
  ["Impuestos (DGII)", [
    { nombre: "Formatos 606, 607 y 608", ayuda: "Compras, ventas y anulaciones del mes, en Excel, PDF y TXT.", ruta: "/dgii", pestana: "/dgii" },
    { nombre: "IT-1 (ITBIS)", ayuda: "Borrador de la declaración del ITBIS con su Anexo A.", ruta: "/dgii/it1", pestana: "/dgii" },
    { nombre: "IR-17 y anexo IR-6", ayuda: "Otras retenciones y retribuciones complementarias.", ruta: "/dgii/ir17", pestana: "/dgii" },
  ]],
];

// Centro de reportes, como el de QuickBooks Online: todos los reportes en una pantalla, cada rol ve solo los suyos.
export default async function Reportes({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { empresa, pestanas } = await accesoEmpresa(id);
  const visibles = GRUPOS.map(([t, rs]) => [t, rs.filter((r) => puedeVer(pestanas, r.pestana))] as const).filter(([, rs]) => rs.length);

  return (
    <>
      <h1>Centro de reportes</h1>
      <p className="sub">{empresa.nombre} · cada reporte se abre en pantalla y se descarga en Excel o PDF.</p>
      <div className="centro-reportes">
        {visibles.map(([titulo, rs]) => (
          <section key={titulo} className="tarjeta">
            <h2 style={{ marginTop: 0 }}>{titulo}</h2>
            <ul>
              {rs.map((r) => (
                <li key={r.ruta}><Link href={`/e/${id}${r.ruta}`}><strong>{r.nombre}</strong></Link><div className="sub" style={{ margin: 0 }}>{r.ayuda}</div></li>
              ))}
            </ul>
          </section>
        ))}
        {visibles.length === 0 && <p>Tu rol no tiene reportes.</p>}
      </div>
    </>
  );
}
