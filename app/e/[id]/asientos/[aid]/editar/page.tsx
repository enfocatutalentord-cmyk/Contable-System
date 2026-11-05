import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { listarUnidades } from "@/lib/empresa-propia";
import { conEmpresa } from "@/lib/db";
import { hoyISO } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { guardarAsiento } from "../../../acciones";
import { FormularioAsiento } from "../../nuevo/formulario-asiento";

export default async function EditarBorrador({ params }: { params: Promise<{ id: string; aid: string }> }) {
  const { id, aid } = await params;
  if (!esUuid(aid)) notFound();
  const { empresa, permisos } = await exigirPermiso(id, "registrar");
  const datos = await conEmpresa(id, async (tx) => {
    const [a] = await tx<{ fecha: string; concepto: string; referencia: string | null; estado: string }[]>`
      SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, concepto, referencia, estado FROM asientos WHERE id = ${aid}`;
    if (!a) return null;
    const lineas = await tx<{ cuenta_id: string; descripcion: string | null; debe: string; haber: string; unidad_id: string | null; categoria_personal: string | null }[]>`
      SELECT cuenta_id, descripcion, debe::text, haber::text, unidad_id, categoria_personal FROM lineas_asiento WHERE asiento_id = ${aid} ORDER BY orden`;
    return { a, lineas, cuentas: (await listarCuentas(tx)).filter((c) => c.de_detalle && c.activa), unidades: await listarUnidades(tx) };
  });
  if (!datos) notFound();
  if (datos.a.estado !== "borrador") redirect(`/e/${id}/asientos/${aid}`);
  const monto = (v: string) => (Number(v) ? v : "");
  return (
    <>
      <p><Link href={`/e/${id}/asientos/${aid}`}>← Volver al borrador</Link></p>
      <h1>Editar borrador</h1>
      <FormularioAsiento
        accion={guardarAsiento.bind(null, id, aid)} cuentas={datos.cuentas} hoy={hoyISO()} bloqueo={empresa.fecha_bloqueo} unidades={datos.unidades}
        puedeContabilizar={puede(permisos, "contabilizar") && !empresa.requiere_aprobacion}
        inicial={{
          fecha: datos.a.fecha, concepto: datos.a.concepto, referencia: datos.a.referencia ?? "",
          lineas: datos.lineas.map((l) => ({ cuentaId: l.cuenta_id, descripcion: l.descripcion ?? "", debe: monto(l.debe), haber: monto(l.haber), unidad: l.unidad_id ?? "", categoria: l.categoria_personal ?? "" })),
        }}
      />
    </>
  );
}
