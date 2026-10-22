import { exigirModulo } from "@/lib/modulos";
import Link from "next/link";
import { exigirPermiso } from "@/lib/acceso";
import { pendientesAl } from "@/lib/cxc";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { deCentavos, hoyISO } from "@/lib/montos";
import { crearCobro } from "../../ventas-acciones";
import { FormularioCobro } from "./formulario-cobro";

export default async function NuevoCobro({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cliente?: string; factura?: string }>;
}) {
  exigirModulo("ventas");
  const { id } = await params;
  const sp = await searchParams;
  await exigirPermiso(id, "registrar");
  const hoy = hoyISO();
  const { clientes, pendientes, cuentas, itbis } = await conEmpresa(id, async (tx) => ({
    clientes: await tx<{ id: string; nombre: string }[]>`SELECT id, nombre FROM clientes ORDER BY nombre`,
    pendientes: await pendientesAl(tx, "9999-12-31"),
    cuentas: (await listarCuentas(tx)).filter((c) => c.de_detalle && c.activa && c.codigo.startsWith("1101")),
    itbis: Object.fromEntries((await tx<{ id: string; itbis: string }[]>`SELECT id, itbis::text FROM facturas WHERE tipo_ncf <> 'B04'`).map((r) => [r.id, r.itbis])),
  }));
  const factura = pendientes.find((p) => p.id === sp.factura);
  const clienteInicial = factura?.cliente_id ?? (clientes.some((c) => c.id === sp.cliente) ? sp.cliente! : "");
  const conSaldo = new Set(pendientes.map((p) => p.cliente_id));

  return (
    <>
      <p><Link href={`/e/${id}/cobros`}>← Cobros</Link></p>
      <h1>Registrar cobro</h1>
      <p className="sub">Elige el cliente, marca las facturas que paga y anota las retenciones si te las hizo.</p>
      <FormularioCobro
        accion={crearCobro.bind(null, id)}
        clientes={clientes.filter((c) => conSaldo.has(c.id))}
        pendientes={pendientes.map((p) => ({
          id: p.id, ncf: p.ncf, fecha: p.fecha, vence: p.vence, moneda: p.moneda, total: p.total, itbis: itbis[p.id] ?? "0",
          saldo: deCentavos(p.saldo), cliente_id: p.cliente_id,
        }))}
        cuentas={cuentas}
        hoy={hoy}
        clienteInicial={clienteInicial}
        facturaInicial={factura?.id ?? ""}
      />
    </>
  );
}
