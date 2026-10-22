import Link from "next/link";
import { notFound } from "next/navigation";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { TIPOS_GASTO } from "@/lib/compras";
import { conEmpresa } from "@/lib/db";
import { hoyISO } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { guardarCompra } from "../../../compras-acciones";
import { datosFormularioCompra } from "../../datos-formulario";
import { FormularioCompra, type InicialCompra, type OrigenNota } from "../../nueva/formulario-compra";

export default async function EditarCompra({ params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  if (!esUuid(cid)) notFound();
  const { empresa, permisos, usuario } = await exigirPermiso(id, "registrar");
  const hoy = hoyISO();
  const r = await conEmpresa(id, async (tx) => {
    const [c] = await tx<{
      estado: string; tipo_comprobante: string; ncf: string | null; proveedor_id: string; fecha: string; vence: string; moneda: string;
      tasa: string; tipo_gasto: string; itbis_al_costo: boolean; notas: string | null; creado_por: string; compra_origen_id: string | null; origen_ncf: string | null;
    }[]>`
      SELECT c.estado, c.tipo_comprobante, c.ncf, c.proveedor_id, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, to_char(c.vence, 'YYYY-MM-DD') AS vence,
             c.moneda, c.tasa::text, c.tipo_gasto, c.itbis_al_costo, c.notas, c.creado_por, c.compra_origen_id, o.ncf AS origen_ncf
        FROM compras c LEFT JOIN compras o ON o.id = c.compra_origen_id WHERE c.id = ${cid}`;
    if (!c || c.estado !== "borrador") return null;
    const lineas = await tx<{ descripcion: string; clase: string; cuenta_id: string; cantidad: string; precio: string; principal: string | null; adicional: string | null }[]>`
      SELECT l.descripcion, l.clase, l.cuenta_id, l.cantidad::text, l.precio::text,
             (SELECT il.impuesto_id FROM impuestos_linea_compra il WHERE il.linea_id = l.id AND il.tipo IN ('itbis', 'exento') LIMIT 1) AS principal,
             (SELECT il.impuesto_id FROM impuestos_linea_compra il WHERE il.linea_id = l.id AND il.tipo NOT IN ('itbis', 'exento') LIMIT 1) AS adicional
        FROM lineas_compra l WHERE l.compra_id = ${cid} ORDER BY l.orden`;
    return { c, lineas, datos: await datosFormularioCompra(tx, hoy) };
  });
  if (!r) notFound();
  const { c, lineas, datos } = r;
  const inicial: InicialCompra = {
    proveedor: c.proveedor_id, tipo: c.tipo_comprobante, ncf: c.ncf ?? "", fecha: c.fecha, vence: c.vence, moneda: c.moneda,
    tasa: String(Number(c.tasa)), tipoGasto: c.tipo_gasto, itbisAlCosto: c.itbis_al_costo, notas: c.notas ?? "",
    lineas: lineas.map((l) => ({
      descripcion: l.descripcion, clase: l.clase, cuenta: l.cuenta_id, cantidad: String(Number(l.cantidad)), precio: l.precio,
      impuesto: l.principal ?? "", adicional: l.adicional ?? "",
    })),
  };
  const origen: OrigenNota | undefined = c.compra_origen_id
    ? { id: c.compra_origen_id, ncf: c.origen_ncf ?? "", proveedor: c.proveedor_id, moneda: c.moneda, tasa: String(Number(c.tasa)), tipoGasto: c.tipo_gasto, tipo: c.tipo_comprobante }
    : undefined;
  const propio = empresa.requiere_aprobacion && c.creado_por === usuario.id;
  return (
    <>
      <p><Link href={`/e/${id}/compras/${cid}`}>← Borrador de compra</Link></p>
      <h1>Editar borrador de compra</h1>
      <FormularioCompra accion={guardarCompra.bind(null, id, cid)} {...datos} tiposGasto={TIPOS_GASTO} hoy={hoy} inicial={inicial} origen={origen}
        puedeRegistrar={puede(permisos, "contabilizar") && !propio} />
    </>
  );
}
