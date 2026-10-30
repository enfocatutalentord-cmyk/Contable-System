import Link from "next/link";
import { exigirPermiso } from "@/lib/acceso";
import { pendientesAl } from "@/lib/cxc";
import { listarCuentas } from "@/lib/cuentas";
import { datosParaDocumento } from "@/lib/conciliacion";
import { conEmpresa } from "@/lib/db";
import { esUuid } from "@/lib/acceso";
import { verFecha, verMonto } from "@/lib/montos";
import { listarRetenciones } from "@/lib/fiscal";
import { deCentavos, hoyISO } from "@/lib/montos";
import { crearCobro } from "../../ventas-acciones";
import { FormularioCobro } from "./formulario-cobro";

export default async function NuevoCobro({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cliente?: string; factura?: string; movimiento?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  await exigirPermiso(id, "contabilizar", "/cobros");
  const hoy = hoyISO();
  const { clientes, pendientes, cuentas, bases, retenciones, banco } = await conEmpresa(id, async (tx) => ({
    banco: sp.movimiento && esUuid(sp.movimiento) ? await datosParaDocumento(tx, sp.movimiento) : null,
    clientes: await tx<{ id: string; nombre: string; retenciones: string[] }[]>`SELECT id, nombre, retenciones FROM clientes ORDER BY nombre`,
    pendientes: await pendientesAl(tx, "9999-12-31"),
    cuentas: (await listarCuentas(tx)).filter((c) => c.de_detalle && c.activa && c.codigo.startsWith("1101")),
    // Bases de las retenciones: el ITBIS facturado y el monto sin impuestos de cada factura.
    bases: Object.fromEntries((await tx<{ id: string; itbis: string; subtotal: string }[]>`
      SELECT id, itbis::text, subtotal::text FROM facturas WHERE tipo_ncf <> 'B04' AND estado = 'emitida'`).map((r) => [r.id, r])),
    retenciones: (await listarRetenciones(tx)).filter((r) => r.activo)
      .map(({ id, nombre, impuesto, tasa, vigente_desde, vigente_hasta }) => ({ id, nombre, impuesto, tasa, vigente_desde, vigente_hasta })),
  }));
  const factura = pendientes.find((p) => p.id === sp.factura);
  const clienteInicial = factura?.cliente_id ?? (clientes.some((c) => c.id === sp.cliente) ? sp.cliente! : "");
  const conSaldo = new Set(pendientes.map((p) => p.cliente_id));

  return (
    <>
      <p><Link href={`/e/${id}/cobros`}>← Cobros</Link></p>
      <h1>Registrar cobro</h1>
      <p className="sub">
        Elige el cliente, marca las facturas que paga y las retenciones que te hizo (salen de la configuración tributaria;
        las habituales del cliente vienen marcadas). El monto sugerido se puede ajustar al del comprobante de retención.
      </p>
      {banco && <p className="aviso">Desde el banco: movimiento del {verFecha(banco.fecha)} por {verMonto(banco.monto)}. Si lo que entra al banco coincide, queda conciliado al registrarlo.</p>}
      <FormularioCobro
        accion={crearCobro.bind(null, id)}
        clientes={clientes.filter((c) => conSaldo.has(c.id))}
        pendientes={pendientes.map((p) => ({
          id: p.id, ncf: p.ncf, fecha: p.fecha, vence: p.vence, moneda: p.moneda, total: p.total,
          itbis: bases[p.id]?.itbis ?? "0", subtotal: bases[p.id]?.subtotal ?? p.total,
          saldo: deCentavos(p.saldo), cliente_id: p.cliente_id,
        }))}
        cuentas={cuentas}
        retenciones={retenciones}
        hoy={hoy}
        clienteInicial={clienteInicial}
        facturaInicial={factura?.id ?? ""}
        banco={banco ? { movimientoId: sp.movimiento!, fecha: banco.fecha, referencia: banco.referencia, cuentaId: banco.cuenta_id, monto: banco.monto } : undefined}
      />
    </>
  );
}
