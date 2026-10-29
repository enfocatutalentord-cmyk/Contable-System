import Link from "next/link";
import { notFound } from "next/navigation";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { guardarFactura } from "../../../ventas-acciones";
import { datosFormulario } from "../../datos-formulario";
import { FormularioFactura, type InicialFactura } from "../../nueva/formulario-factura";

export default async function EditarFactura({ params }: { params: Promise<{ id: string; fid: string }> }) {
  const { id, fid } = await params;
  if (!esUuid(fid)) notFound();
  const { empresa, permisos, usuario } = await exigirPermiso(id, "registrar");
  const hoy = hoyISO();
  const r = await conEmpresa(id, async (tx) => {
    const [f] = await tx<{ estado: string; tipo_ncf: string; cliente_id: string; fecha: string; vence: string; moneda: string; tasa: string; notas: string | null; creado_por: string; tipo_ingreso: string }[]>`
      SELECT estado, tipo_ncf, cliente_id, to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(vence, 'YYYY-MM-DD') AS vence, moneda,
             tasa::text, notas, creado_por, tipo_ingreso FROM facturas WHERE id = ${fid}`;
    if (!f || f.estado !== "borrador" || f.tipo_ncf === "B04") return null;
    const lineas = await tx<{ servicio_id: string | null; descripcion: string; cantidad: string; precio: string; principal: string | null; adicional: string | null }[]>`
      SELECT l.servicio_id, l.descripcion, l.cantidad::text, l.precio::text,
             (SELECT il.impuesto_id FROM impuestos_linea_factura il WHERE il.linea_id = l.id AND il.tipo IN ('itbis', 'exento') LIMIT 1) AS principal,
             (SELECT il.impuesto_id FROM impuestos_linea_factura il WHERE il.linea_id = l.id AND il.tipo NOT IN ('itbis', 'exento') LIMIT 1) AS adicional
        FROM lineas_factura l WHERE l.factura_id = ${fid} ORDER BY l.orden`;
    return { f, lineas, datos: await datosFormulario(tx, hoy) };
  });
  if (!r) notFound();
  const { f, lineas, datos } = r;
  const inicial: InicialFactura = {
    cliente: f.cliente_id, tipo: f.tipo_ncf, fecha: f.fecha, vence: f.vence, moneda: f.moneda, tasa: String(Number(f.tasa)), notas: f.notas ?? "", tipoIngreso: f.tipo_ingreso,
    lineas: lineas.map((l) => ({
      servicioId: l.servicio_id ?? "", descripcion: l.descripcion, cantidad: String(Number(l.cantidad)), precio: l.precio,
      impuesto: l.principal ?? "", adicional: l.adicional ?? "",
    })),
  };
  const propio = empresa.requiere_aprobacion && f.creado_por === usuario.id;
  return (
    <>
      <p><Link href={`/e/${id}/facturas/${fid}`}>← Borrador de factura</Link></p>
      <h1>Editar borrador de factura</h1>
      <p className="sub">Mientras sea borrador no tiene NCF ni asiento.</p>
      <FormularioFactura accion={guardarFactura.bind(null, id, fid)} {...datos} hoy={hoy} inicial={inicial}
        puedeEmitir={puede(permisos, "contabilizar") && !propio} />
    </>
  );
}
