import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { listarImpuestos } from "@/lib/fiscal";
import { puede } from "@/lib/permisos";
import { guardarImpuesto } from "../../../fiscal-acciones";
import { HistorialRegistro } from "../../../historial/registro";
import { CamposImpuesto } from "../../campos";

export default async function EditarImpuesto({ params }: { params: Promise<{ id: string; iid: string }> }) {
  const { id, iid } = await params;
  if (!esUuid(iid)) notFound();
  const { permisos } = await exigirPermiso(id, "impuestos");
  const { impuesto, cuentas } = await conEmpresa(id, async (tx) => ({
    impuesto: (await listarImpuestos(tx)).find((i) => i.id === iid),
    cuentas: (await listarCuentas(tx)).filter((c) => c.de_detalle && c.activa),
  }));
  if (!impuesto) notFound();
  return (
    <>
      <p><Link href={`/e/${id}/fiscal/impuestos`}>← Impuestos</Link></p>
      <h1>{impuesto.nombre}</h1>
      <div className="tarjeta">
        <Formulario accion={guardarImpuesto.bind(null, id, iid)} boton="Guardar cambios" className="">
          <CamposImpuesto d={impuesto} cuentas={cuentas} edicion />
        </Formulario>
      </div>
      {puede(permisos, "auditoria") && (
        <>
          <h2>Historial de cambios</h2>
          <HistorialRegistro empresaId={id} registroId={iid} />
        </>
      )}
    </>
  );
}
