"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { leerTasa } from "@/lib/calculos";
import { anularPago, FORMAS_PAGO, registrarPago, saldoCompra } from "@/lib/compras";
import { conEmpresa, mensajeError } from "@/lib/db";
import { aCentavos, leerMonto } from "@/lib/montos";
import { fechaValida } from "@/lib/reportes";
import { anularCobro, registrarCobro, saldoFactura } from "@/lib/ventas";
import type { Estado } from "../../acciones-cuenta";

// Rediseño, n.º 9: en un cliente sin contabilidad no hay pantallas de cobros ni pagos. El cobro de una factura y el pago de una compra
// se anotan dentro del documento (fecha, forma, retenciones y referencia): es lo que piden el 606, el 607, el IT-1 y el IR-17.
// No hacen asiento ni piden cuenta de banco.

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();
const FORMAS_COBRO = ["efectivo", "transferencia", "cheque", "tarjeta", "permuta", "otro"];

function leerRetenciones(fd: FormData): { retencionId: string; monto: bigint }[] | string {
  const r: { retencionId: string; monto: bigint }[] = [];
  for (const i of [1, 2]) {
    const id = texto(fd, `ret${i}`), m = texto(fd, `ret${i}_monto`);
    if (!id && !m) continue;
    if (!esUuid(id)) return "Elige la retención.";
    const v = leerMonto(m);
    if (v === null || aCentavos(v) <= 0n) return "Escribe el monto retenido.";
    r.push({ retencionId: id, monto: aCentavos(v) });
  }
  return r;
}

export async function cobrarFactura(empresaId: string, facturaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "contabilizar", "/facturas");
  if (!esUuid(facturaId)) return { error: "Factura no válida." };
  const fecha = texto(fd, "fecha"), forma = texto(fd, "forma_pago");
  if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
  if (!FORMAS_COBRO.includes(forma)) return { error: "Elige cómo pagó el cliente." };
  const retenciones = leerRetenciones(fd);
  if (typeof retenciones === "string") return { error: retenciones };
  let numero: number;
  try {
    numero = await conEmpresa(empresaId, async (tx) => {
      const [f] = await tx<{ cliente_id: string; moneda: "DOP" | "USD" }[]>`SELECT cliente_id, moneda FROM facturas WHERE id = ${facturaId}`;
      if (!f) throw new Error("La factura no existe");
      const tasa = f.moneda === "DOP" ? 10000n : leerTasa(texto(fd, "tasa"));
      if (tasa === null) throw new Error("Escribe la tasa del dólar del día del cobro.");
      const saldo = await saldoFactura(tx, facturaId);
      const t = texto(fd, "aplicado"), v = t ? leerMonto(t) : null;
      if (t && v === null) throw new Error("Revisa el monto.");
      const aplicado = v === null ? saldo : aCentavos(v);
      const retenido = retenciones.reduce((s, r) => s + r.monto, 0n);
      return registrarCobro(tx, {
        empresaId, usuarioId: usuario.id, clienteId: f.cliente_id, fecha, moneda: f.moneda, tasa, cuentaDestinoId: null, formaPago: forma,
        referencia: texto(fd, "referencia") || null, notas: null, recibido: aplicado - retenido, retenciones,
        aplicaciones: [{ facturaId, monto: aplicado }],
      });
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/facturas/${facturaId}?cobrado=${numero}`);
}

export async function anularCobroDeFactura(empresaId: string, facturaId: string, numero: number, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "revertir", "/facturas");
  const motivo = texto(fd, "motivo");
  if (motivo.length < 3) return { error: "Escribe el motivo." };
  try {
    await conEmpresa(empresaId, (tx) => anularCobro(tx, { empresaId, usuarioId: usuario.id, numero, motivo }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/facturas/${facturaId}?cobro_anulado=${numero}`);
}

export async function pagarCompra(empresaId: string, compraId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "contabilizar", "/compras");
  if (!esUuid(compraId)) return { error: "Compra no válida." };
  const fecha = texto(fd, "fecha"), forma = texto(fd, "forma_pago");
  if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
  if (!FORMAS_PAGO[forma]) return { error: "Elige la forma de pago del 606." };
  const retenciones = leerRetenciones(fd);
  if (typeof retenciones === "string") return { error: retenciones };
  let numero: number;
  try {
    numero = await conEmpresa(empresaId, async (tx) => {
      const [c] = await tx<{ proveedor_id: string; moneda: "DOP" | "USD" }[]>`SELECT proveedor_id, moneda FROM compras WHERE id = ${compraId}`;
      if (!c) throw new Error("La compra no existe");
      const tasa = c.moneda === "DOP" ? 10000n : leerTasa(texto(fd, "tasa"));
      if (tasa === null) throw new Error("Escribe la tasa del dólar del día del pago.");
      const saldo = await saldoCompra(tx, compraId);
      const t = texto(fd, "aplicado"), v = t ? leerMonto(t) : null;
      if (t && v === null) throw new Error("Revisa el monto.");
      const aplicado = v === null ? saldo : aCentavos(v);
      const retenido = retenciones.reduce((s, r) => s + r.monto, 0n);
      return registrarPago(tx, {
        empresaId, usuarioId: usuario.id, proveedorId: c.proveedor_id, fecha, moneda: c.moneda, tasa, cuentaOrigenId: null, formaPago: forma,
        referencia: texto(fd, "referencia") || null, notas: null, pagado: aplicado - retenido, retenciones,
        aplicaciones: [{ compraId, monto: aplicado }],
      });
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/compras/${compraId}?pagado=${numero}`);
}

export async function anularPagoDeCompra(empresaId: string, compraId: string, numero: number, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "revertir", "/compras");
  const motivo = texto(fd, "motivo");
  if (motivo.length < 3) return { error: "Escribe el motivo." };
  try {
    await conEmpresa(empresaId, (tx) => anularPago(tx, { empresaId, usuarioId: usuario.id, numero, motivo }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/compras/${compraId}?pago_anulado=${numero}`);
}
