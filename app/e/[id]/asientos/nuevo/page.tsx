import Link from "next/link";
import { exigirPermiso } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { guardarAsiento } from "../../acciones";
import { FormularioAsiento } from "./formulario-asiento";

export default async function NuevoAsiento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { empresa, permisos } = await exigirPermiso(id, "registrar");
  const cuentas = (await conEmpresa(id, listarCuentas)).filter((c) => c.de_detalle && c.activa);
  return (
    <>
      <p><Link href={`/e/${id}/asientos`}>← Asientos</Link></p>
      <h1>Nuevo asiento</h1>
      <p className="sub">
        Puedes guardarlo como borrador aunque no esté completo. Para contabilizarlo, el debe y el haber deben cuadrar.
        {empresa.requiere_aprobacion && <> En esta empresa los asientos requieren la aprobación de otra persona.</>}
        {empresa.fecha_bloqueo && <> El período está cerrado hasta el {verFecha(empresa.fecha_bloqueo)}.</>}
      </p>
      <FormularioAsiento accion={guardarAsiento.bind(null, id, null)} cuentas={cuentas} hoy={hoyISO()} bloqueo={empresa.fecha_bloqueo}
        puedeContabilizar={puede(permisos, "contabilizar") && !empresa.requiere_aprobacion} />
    </>
  );
}
