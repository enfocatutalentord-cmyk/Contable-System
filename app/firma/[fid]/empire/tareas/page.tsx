import { VistaTareas } from "../../tareas/vista";

export const metadata = { title: "Tareas de cobro · Empire Tax’N Legal" };

// Contabilidad Empire (rediseño R2, n.º 6 de la lista): las tareas de igualas y cobros.
export default async function TareasCobro({ params, searchParams }: {
  params: Promise<{ fid: string }>; searchParams: Promise<{ mes?: string; mias?: string; editar?: string }>;
}) {
  return <VistaTareas fid={(await params).fid} sp={await searchParams} seccion="empire" />;
}
