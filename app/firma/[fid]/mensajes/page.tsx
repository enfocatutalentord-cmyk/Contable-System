import { VistaMensajes } from "./vista";

export const metadata = { title: "Mensajes predeterminados · Empire Tax’N Legal" };

export default async function Mensajes({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ editar?: string }> }) {
  return <VistaMensajes fid={(await params).fid} sp={await searchParams} cobro={false} />;
}
