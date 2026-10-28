import { notFound, redirect } from "next/navigation";
import { esUuid } from "@/lib/acceso";

// Dirección anterior: el nuevo cliente ahora está dentro de la firma.
export default async function NuevaEmpresa({ searchParams }: { searchParams: Promise<{ firma?: string }> }) {
  const { firma } = await searchParams;
  if (!firma || !esUuid(firma)) notFound();
  redirect(`/firma/${firma}/clientes/nuevo`);
}
