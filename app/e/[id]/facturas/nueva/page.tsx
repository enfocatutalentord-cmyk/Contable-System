import Link from "next/link";
import { exigirPermiso } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { guardarFactura } from "../../ventas-acciones";
import { datosFormulario } from "../datos-formulario";
import { FormularioFactura } from "./formulario-factura";

export default async function NuevaFactura({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { empresa, permisos } = await exigirPermiso(id, "registrar");
  const hoy = hoyISO();
  const datos = await conEmpresa(id, (tx) => datosFormulario(tx, hoy));
  return (
    <>
      <p><Link href={`/e/${id}/facturas`}>← Facturas</Link></p>
      <h1>Nueva factura</h1>
      <p className="sub">
        Los impuestos salen de la configuración de este cliente, según la fecha de la factura.
        {empresa.requiere_aprobacion && <> En esta empresa las facturas las emite otra persona: guárdala como borrador.</>}
        {datos.clientes.length === 0 && <> Primero <Link href={`/e/${id}/clientes`}>crea un cliente</Link>.</>}
      </p>
      <FormularioFactura accion={guardarFactura.bind(null, id, null)} {...datos} hoy={hoy}
        puedeEmitir={puede(permisos, "contabilizar") && !empresa.requiere_aprobacion} />
    </>
  );
}
