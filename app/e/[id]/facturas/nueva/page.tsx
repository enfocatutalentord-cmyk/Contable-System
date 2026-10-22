import { exigirModulo } from "@/lib/modulos";
import Link from "next/link";
import { exigirPermiso } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO } from "@/lib/montos";
import { crearFactura } from "../../ventas-acciones";
import { FormularioFactura } from "./formulario-factura";

export default async function NuevaFactura({ params }: { params: Promise<{ id: string }> }) {
  exigirModulo("ventas");
  const { id } = await params;
  await exigirPermiso(id, "registrar");
  const hoy = hoyISO();
  const { clientes, servicios, disponibles } = await conEmpresa(id, async (tx) => ({
    clientes: await tx<{ id: string; nombre: string; rnc: string | null; dias_credito: number }[]>`
      SELECT id, nombre, rnc, dias_credito FROM clientes WHERE activo ORDER BY nombre`,
    servicios: await tx<{ id: string; nombre: string; precio: string; tasa_itbis: string }[]>`
      SELECT id, nombre, precio::text, tasa_itbis::text FROM servicios WHERE activo ORDER BY nombre`,
    disponibles: Object.fromEntries((await tx<{ tipo: string; n: number }[]>`
      SELECT tipo, sum(hasta - siguiente + 1)::int AS n FROM secuencias_ncf
       WHERE activa AND siguiente <= hasta AND vence >= ${hoy} GROUP BY tipo`).map((r) => [r.tipo, r.n])),
  }));
  return (
    <>
      <p><Link href={`/e/${id}/facturas`}>← Facturas</Link></p>
      <h1>Nueva factura</h1>
      <p className="sub">
        Al emitirla toma el siguiente NCF y registra el asiento: cuentas por cobrar contra ingresos e ITBIS por pagar.
        {clientes.length === 0 && <> Primero <Link href={`/e/${id}/clientes`}>crea un cliente</Link>.</>}
      </p>
      <FormularioFactura accion={crearFactura.bind(null, id)} clientes={clientes} servicios={servicios} hoy={hoy} disponibles={disponibles} />
    </>
  );
}
