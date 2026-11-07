import { VistaTareas } from "./vista";

export const metadata = { title: "Tareas del mes · Empire Tax’N Legal" };

export default async function Tareas({ params, searchParams }: {
  params: Promise<{ fid: string }>; searchParams: Promise<{ mes?: string; mias?: string; editar?: string }>;
}) {
  return <VistaTareas fid={(await params).fid} sp={await searchParams} seccion="firma" />;
}
