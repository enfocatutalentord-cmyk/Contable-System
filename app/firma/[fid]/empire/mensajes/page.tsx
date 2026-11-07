import { VistaMensajes } from "../../mensajes/vista";

export const metadata = { title: "Mensajes de cobro · Empire Tax’N Legal" };

// Contabilidad Empire (rediseño R2, n.º 6 de la lista): los mensajes de cobro.
export default async function MensajesCobro({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ editar?: string }> }) {
  return <VistaMensajes fid={(await params).fid} sp={await searchParams} cobro />;
}
