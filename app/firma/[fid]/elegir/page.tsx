import Link from "next/link";
import { accesoFirma } from "@/lib/acceso";
import { clientesDeFirma } from "@/lib/firma";
import { PESTANAS } from "@/lib/pestanas";

export const metadata = { title: "Elige un cliente · Empire Tax’N Legal" };

// Se llega aquí al tocar una pestaña de cliente con «Todos los clientes» elegido arriba.
export default async function Elegir({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ a?: string }> }) {
  const { fid } = await params;
  const { a } = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  const clientes = await clientesDeFirma(fid, usuario.id, firma.administrador);
  const extra: [string, string][] = [["/", "Resumen del cliente"], ["/historial", "Historial de cambios"], ["/empresa", "Ficha de la empresa"],
    ["/configuracion", "Configuración de cuentas"], ["/usuarios", "Usuarios y permisos"]];
  const pestanas = [...PESTANAS.flatMap((s) => s.enlaces), ...extra];
  const pestana = pestanas.find(([r]) => r === a);
  const ruta = pestana && pestana[0] !== "/" ? pestana[0] : "";
  return (
    <>
      <h1>{pestana ? pestana[1] : "Elige un cliente"}</h1>
      <p className="sub">¿De qué cliente? Elígelo aquí o arriba en «Viendo».</p>
      <div className="elegir-cliente">
        {clientes.map((c) => (
          <Link key={c.id} className="tarjeta" href={`/e/${c.id}${ruta}`}>
            <strong>{c.nombre}</strong>
            <span className="sub">{c.rnc ?? "Sin RNC"}{c.responsable && ` · ${c.responsable}`}</span>
          </Link>
        ))}
        {clientes.length === 0 && <p>No tienes clientes todavía.</p>}
      </div>
    </>
  );
}
