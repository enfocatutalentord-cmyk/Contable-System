import { esUuid, exigirPermiso } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO } from "@/lib/montos";
import { lineasDeAsiento } from "@/lib/plantillas";
import { PaginaPlantilla } from "../formulario";

// Nueva plantilla, vacía o copiada de un asiento («Guardar como plantilla» en el detalle del asiento).
export default async function NuevaPlantilla({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ desde?: string }> }) {
  const { id } = await params;
  const { desde } = await searchParams;
  await exigirPermiso(id, "registrar", "/plantillas");
  const copia = desde && esUuid(desde) ? await conEmpresa(id, (tx) => lineasDeAsiento(tx, desde)) : null;
  return (
    <PaginaPlantilla id={id} plantillaId={null} inicial={{
      nombre: "", concepto: copia?.concepto ?? "", referencia: copia?.referencia ?? "", lineas: copia?.lineas ?? [], frecuencia: "ninguna", dia: null,
      desde: hoyISO().slice(0, 7), hasta: null,
    }} />
  );
}
