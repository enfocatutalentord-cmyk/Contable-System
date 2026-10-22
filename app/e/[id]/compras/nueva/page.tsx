import Link from "next/link";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { TIPOS_GASTO } from "@/lib/compras";
import { conEmpresa } from "@/lib/db";
import { hoyISO } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { guardarCompra } from "../../compras-acciones";
import { datosFormularioCompra } from "../datos-formulario";
import { FormularioCompra, type OrigenNota } from "./formulario-compra";

export default async function NuevaCompra({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ origen?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa, permisos } = await exigirPermiso(id, "registrar");
  const hoy = hoyISO();
  const { datos, origen } = await conEmpresa(id, async (tx) => {
    let origen: OrigenNota | undefined;
    if (esUuid(sp.origen ?? "")) {
      const [o] = await tx<{ id: string; ncf: string; proveedor_id: string; moneda: string; tasa: string; tipo_gasto: string }[]>`
        SELECT id, ncf, proveedor_id, moneda, tasa::text, tipo_gasto FROM compras
         WHERE id = ${sp.origen!} AND estado = 'registrada' AND NOT anulada AND tipo_comprobante NOT IN ('B04', 'E34')`;
      if (o) origen = { id: o.id, ncf: o.ncf, proveedor: o.proveedor_id, moneda: o.moneda, tasa: String(Number(o.tasa)), tipoGasto: o.tipo_gasto, tipo: o.ncf.startsWith("E") ? "E34" : "B04" };
    }
    return { datos: await datosFormularioCompra(tx, hoy), origen };
  });
  return (
    <>
      <p><Link href={origen ? `/e/${id}/compras/${origen.id}` : `/e/${id}/compras`}>← {origen ? `Compra ${origen.ncf}` : "Compras"}</Link></p>
      <h1>{origen ? `Nota de crédito del proveedor a ${origen.ncf}` : "Nueva compra"}</h1>
      <p className="sub">
        {origen ? "Registra la nota de crédito que te entregó el proveedor: rebaja el saldo de la compra y revierte el gasto y el ITBIS."
          : "Copia los datos de la factura del proveedor. Los impuestos salen de la configuración de este cliente, según la fecha."}
        {empresa.requiere_aprobacion && <> En esta empresa las compras las registra otra persona: guárdala como borrador.</>}
        {datos.proveedores.length === 0 && <> Primero <Link href={`/e/${id}/proveedores`}>crea un proveedor</Link>.</>}
      </p>
      <FormularioCompra accion={guardarCompra.bind(null, id, null)} {...datos} tiposGasto={TIPOS_GASTO} hoy={hoy} origen={origen}
        puedeRegistrar={puede(permisos, "contabilizar") && !empresa.requiere_aprobacion} />
    </>
  );
}
