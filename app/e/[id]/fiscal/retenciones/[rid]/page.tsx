import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { listarRetenciones } from "@/lib/fiscal";
import { puede } from "@/lib/permisos";
import { guardarRetencion } from "../../../fiscal-acciones";
import { HistorialRegistro } from "../../../historial/registro";
import { CamposRetencion } from "../../campos";

export default async function EditarRetencion({ params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  if (!esUuid(rid)) notFound();
  const { permisos } = await exigirPermiso(id, "impuestos");
  const { retencion, cuentas } = await conEmpresa(id, async (tx) => ({
    retencion: (await listarRetenciones(tx)).find((r) => r.id === rid),
    cuentas: (await listarCuentas(tx)).filter((c) => c.de_detalle && c.activa),
  }));
  if (!retencion) notFound();
  return (
    <>
      <p><Link href={`/e/${id}/fiscal/retenciones`}>← Retenciones</Link></p>
      <h1>{retencion.nombre}</h1>
      <div className="tarjeta">
        <Formulario accion={guardarRetencion.bind(null, id, rid)} boton="Guardar cambios" className="">
          <CamposRetencion d={retencion} cuentas={cuentas} edicion />
        </Formulario>
      </div>
      {puede(permisos, "auditoria") && (
        <>
          <h2>Historial de cambios</h2>
          <HistorialRegistro empresaId={id} registroId={rid} />
        </>
      )}
    </>
  );
}
