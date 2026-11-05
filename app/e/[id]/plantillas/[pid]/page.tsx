import { notFound } from "next/navigation";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO } from "@/lib/montos";
import type { Plantilla } from "@/lib/plantillas";
import { PaginaPlantilla } from "../formulario";

export default async function EditarPlantilla({ params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  if (!esUuid(pid)) notFound();
  await exigirPermiso(id, "registrar", "/plantillas");
  const [p] = await conEmpresa(id, (tx) => tx<Plantilla[]>`
    SELECT id, nombre, concepto, referencia, lineas, frecuencia, dia, to_char(proxima, 'YYYY-MM-DD') AS proxima, to_char(hasta, 'YYYY-MM-DD') AS hasta, activa
      FROM plantillas_asiento WHERE id = ${pid}`);
  if (!p) notFound();
  return (
    <PaginaPlantilla id={id} plantillaId={pid} inicial={{
      nombre: p.nombre, concepto: p.concepto, referencia: p.referencia ?? "", lineas: p.lineas, frecuencia: p.frecuencia, dia: p.dia,
      desde: (p.proxima ?? hoyISO()).slice(0, 7), hasta: p.hasta,
    }} />
  );
}
