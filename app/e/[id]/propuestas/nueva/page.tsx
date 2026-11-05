import Link from "next/link";
import { exigirPermiso } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO } from "@/lib/montos";
import { guardarPropuestaAccion } from "../../propuestas-acciones";
import { datosFormulario } from "../../facturas/datos-formulario";
import { FormularioPropuesta } from "../formulario-propuesta";

export default async function NuevaPropuesta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await exigirPermiso(id, "registrar", "/propuestas");
  const hoy = hoyISO();
  const d = await conEmpresa(id, (tx) => datosFormulario(tx, hoy));
  return (
    <>
      <p><Link href={`/e/${id}/propuestas`}>← Propuestas</Link></p>
      <h1>Nueva propuesta</h1>
      <p className="sub">El precio de lista sale de la categoría del cliente; el descuento que pongas se ve aparte en la propuesta.</p>
      <FormularioPropuesta accion={guardarPropuestaAccion.bind(null, id, null)} clientes={d.clientes} servicios={d.servicios}
        impuestos={d.impuestos} impuestoPorDefecto={d.impuestoPorDefecto} unidades={d.unidades} hoy={hoy} />
    </>
  );
}
