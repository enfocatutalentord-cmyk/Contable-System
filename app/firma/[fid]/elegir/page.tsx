import Link from "next/link";
import { accesoFirma } from "@/lib/acceso";
import { clientesDeFirma } from "@/lib/firma";
import { PESTANAS_CLIENTE } from "@/lib/pestanas";

export const metadata = { title: "Elige un cliente · Empire Tax’N Legal" };

// Se llega aquí al tocar una pestaña de cliente con «Todos los clientes» elegido arriba.
export default async function Elegir({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ a?: string }> }) {
  const { fid } = await params;
  const { a } = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  const clientes = await clientesDeFirma(fid, usuario.id, firma.administrador);
  // El resumen («») llega como «/» en la dirección.
  const pestanas = PESTANAS_CLIENTE.flatMap((s) => s.enlaces).map(([r, n]) => [r || "/", n] as const);
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
