import Link from "next/link";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { listarUnidades } from "@/lib/empresa-propia";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { guardarAsiento } from "../../acciones";
import { FormularioAsiento, type Linea } from "./formulario-asiento";

export default async function NuevoAsiento({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ plantilla?: string }> }) {
  const { id } = await params;
  const { plantilla: pid } = await searchParams;
  const { empresa, permisos } = await exigirPermiso(id, "registrar");
  // «Usar» una plantilla de Asientos frecuentes: el formulario viene lleno con sus líneas.
  const [cuentas, unidades, plantilla] = await conEmpresa(id, async (tx) => [
    (await listarCuentas(tx)).filter((c) => c.de_detalle && c.activa), await listarUnidades(tx),
    pid && esUuid(pid) ? (await tx<{ nombre: string; concepto: string; referencia: string | null; lineas: Linea[] }[]>`
      SELECT nombre, concepto, referencia, lineas FROM plantillas_asiento WHERE id = ${pid}`)[0] ?? null : null,
  ] as const);
  return (
    <>
      <p><Link href={`/e/${id}/asientos`}>← Asientos</Link></p>
      <h1>Nuevo asiento{plantilla ? `: ${plantilla.nombre}` : ""}</h1>
      <p className="sub">
        Puedes guardarlo como borrador aunque no esté completo. Para contabilizarlo, el debe y el haber deben cuadrar.
        {empresa.requiere_aprobacion && <> En esta empresa los asientos requieren la aprobación de otra persona.</>}
        {empresa.fecha_bloqueo && <> El período está cerrado hasta el {verFecha(empresa.fecha_bloqueo)}.</>}
      </p>
      <FormularioAsiento accion={guardarAsiento.bind(null, id, null)} cuentas={cuentas} hoy={hoyISO()} bloqueo={empresa.fecha_bloqueo} unidades={unidades}
        inicial={plantilla ? { fecha: hoyISO(), concepto: plantilla.concepto, referencia: plantilla.referencia ?? "", lineas: plantilla.lineas } : undefined}
        puedeContabilizar={puede(permisos, "contabilizar") && !empresa.requiere_aprobacion} />
    </>
  );
}
