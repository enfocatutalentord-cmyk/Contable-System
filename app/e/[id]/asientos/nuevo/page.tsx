import Link from "next/link";
import { exigirPermiso } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha } from "@/lib/montos";
import { registrarAsiento } from "../../acciones";
import { FormularioAsiento } from "./formulario-asiento";

export default async function NuevoAsiento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { empresa } = await exigirPermiso(id, "registrar");
  const cuentas = (await conEmpresa(id, listarCuentas)).filter((c) => c.de_detalle && c.activa);
  return (
    <>
      <p><Link href={`/e/${id}/asientos`}>← Asientos</Link></p>
      <h1>Nuevo asiento</h1>
      <p className="sub">
        El asiento se registra solo si el debe y el haber cuadran.
        {empresa.fecha_bloqueo && <> El período está cerrado hasta el {verFecha(empresa.fecha_bloqueo)}.</>}
      </p>
      <FormularioAsiento accion={registrarAsiento.bind(null, id)} cuentas={cuentas} hoy={hoyISO()} bloqueo={empresa.fecha_bloqueo} />
    </>
  );
}
