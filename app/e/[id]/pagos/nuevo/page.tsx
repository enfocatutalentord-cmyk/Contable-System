import Link from "next/link";
import { exigirPermiso } from "@/lib/acceso";
import { FORMAS_PAGO } from "@/lib/compras";
import { listarCuentas } from "@/lib/cuentas";
import { comprasPendientesAl } from "@/lib/cxp";
import { datosParaDocumento } from "@/lib/conciliacion";
import { conEmpresa } from "@/lib/db";
import { esUuid } from "@/lib/acceso";
import { verFecha, verMonto } from "@/lib/montos";
import { listarRetenciones } from "@/lib/fiscal";
import { deCentavos, hoyISO } from "@/lib/montos";
import { crearPago } from "../../compras-acciones";
import { FormularioPago } from "./formulario-pago";

export default async function NuevoPago({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ proveedor?: string; compra?: string; movimiento?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  await exigirPermiso(id, "contabilizar");
  const hoy = hoyISO();
  const { proveedores, pendientes, cuentas, retenciones, banco } = await conEmpresa(id, async (tx) => ({
    banco: sp.movimiento && esUuid(sp.movimiento) ? await datosParaDocumento(tx, sp.movimiento) : null,
    proveedores: await tx<{ id: string; nombre: string; retenciones: string[] }[]>`SELECT id, nombre, retenciones FROM proveedores ORDER BY nombre`,
    pendientes: await comprasPendientesAl(tx, "9999-12-31"),
    cuentas: (await listarCuentas(tx)).filter((c) => c.de_detalle && c.activa && c.codigo.startsWith("1101")),
    retenciones: (await listarRetenciones(tx)).filter((r) => r.activo)
      .map(({ id, nombre, impuesto, tasa, vigente_desde, vigente_hasta }) => ({ id, nombre, impuesto, tasa, vigente_desde, vigente_hasta })),
  }));
  const compra = pendientes.find((p) => p.id === sp.compra);
  const proveedorInicial = compra?.proveedor_id ?? (proveedores.some((p) => p.id === sp.proveedor) ? sp.proveedor! : "");
  const conSaldo = new Set(pendientes.map((p) => p.proveedor_id));

  return (
    <>
      <p><Link href={`/e/${id}/pagos`}>← Pagos</Link></p>
      <h1>Registrar pago a proveedor</h1>
      <p className="sub">
        Elige el proveedor, marca las compras que pagas y las retenciones que le haces (las habituales del proveedor vienen
        marcadas; el monto sugerido se puede ajustar). Lo retenido queda por pagar a la DGII.
      </p>
      {banco && <p className="aviso">Desde el banco: movimiento del {verFecha(banco.fecha)} por {verMonto(banco.monto.replace("-", ""))}. Si lo que sale del banco coincide, queda conciliado al registrarlo.</p>}
      <FormularioPago
        accion={crearPago.bind(null, id)}
        proveedores={proveedores.filter((p) => conSaldo.has(p.id))}
        pendientes={pendientes.map((p) => ({
          id: p.id, ncf: p.ncf, fecha: p.fecha, vence: p.vence, moneda: p.moneda, total: p.total, itbis: p.itbis, subtotal: p.subtotal,
          saldo: deCentavos(p.saldo), proveedor_id: p.proveedor_id,
        }))}
        cuentas={cuentas}
        retenciones={retenciones}
        formasPago={FORMAS_PAGO}
        hoy={hoy}
        proveedorInicial={proveedorInicial}
        compraInicial={compra?.id ?? ""}
        banco={banco ? { movimientoId: sp.movimiento!, fecha: banco.fecha, referencia: banco.referencia, cuentaId: banco.cuenta_id, monto: banco.monto } : undefined}
      />
    </>
  );
}
