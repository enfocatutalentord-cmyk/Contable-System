"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { ErrorContable } from "@/lib/asientos";
import { ErrorBitacora, TIPOS_NOTIFICACION } from "@/lib/bitacora";
import { cobrarCargo, FORMAS_COBRO_CARGO, leerPagoImpuesto, registrarCargo } from "@/lib/cargos";
import { conEmpresa, conEmpresas, db, mensajeError } from "@/lib/db";
import { huella, nombreSeguro, TAMANO_MAXIMO, tipoPorContenido } from "@/lib/documentos";
import { aCentavos, hoyISO } from "@/lib/montos";
import type { Estado } from "../../acciones-cuenta";

// Prioridad 2.2 (P2e): el pago de cada impuesto con su comprobante. Si lo pagó el cliente, queda pagado; si Empire lo adelantó, además nace un cargo
// en las cuentas por cobrar de Empire (sin comprobante fiscal) que se cobra después con su recibo.

const error = (e: unknown): Estado => ({ error: e instanceof ErrorBitacora || e instanceof ErrorContable ? e.message : mensajeError(e) });
const periodoVisible = (p: string) => `${p.slice(4)}/${p.slice(0, 4)}`;

export async function registrarPagoImpuesto(empresaId: string, notificacionId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "registrar", "/notificaciones");
  if (!esUuid(notificacionId)) return { error: "La notificación no existe." };
  let pago;
  try {
    pago = leerPagoImpuesto(fd, hoyISO());
  } catch (e) {
    return error(e);
  }
  const archivo = fd.get("comprobante");
  if (!(archivo instanceof File) || archivo.size === 0) return { error: "Sube el comprobante del pago (PDF, JPG o PNG)." };
  if (archivo.size > TAMANO_MAXIMO) return { error: "El comprobante pasa de 4 MB." };
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const tipo = tipoPorContenido(bytes);
  if (!tipo) return { error: "El comprobante debe ser PDF, JPG o PNG." };

  let propia: string | null = null;
  if (pago.quien === "empire") {
    [{ propia }] = await db()<{ propia: string | null }[]>`SELECT empresa_propia_id AS propia FROM firmas WHERE id = ${empresa.firma_id}`;
    if (!propia) return { error: "Primero marca la empresa propia de la firma (Empresas Empire)." };
    await exigirPermiso(propia, "contabilizar", "/cxc");
  }
  try {
    await conEmpresas(async (tx, en) => {
      await en(empresaId);
      const [n] = await tx<{ estado: string; tipo: string; periodo: string; concepto: string | null; monto: string }[]>`
        SELECT estado, tipo, periodo, concepto, monto::text FROM notificaciones_pago WHERE id = ${notificacionId} FOR UPDATE`;
      if (!n) throw new ErrorBitacora("La notificación no existe.");
      if (n.estado === "pagada") throw new ErrorBitacora("Esta notificación ya está pagada.");
      await tx`INSERT INTO documentos (empresa_id, entidad, entidad_id, nombre, tipo, tamano, sha256, contenido, descripcion, subido_por)
               VALUES (${empresaId}, 'pago_impuesto', ${notificacionId}, ${nombreSeguro(archivo.name)}, ${tipo}, ${bytes.length}, ${huella(bytes)}, ${Buffer.from(bytes)}, 'Comprobante de pago', ${usuario.id})`;
      let cargoId: string | null = null;
      if (propia) {
        await en(propia);
        const [c] = await tx<{ id: string }[]>`SELECT id FROM clientes WHERE empresa_vinculada_id = ${empresaId}`;
        if (!c) throw new ErrorBitacora("Este cliente todavía no está en la facturación de la empresa propia.");
        const concepto = `${TIPOS_NOTIFICACION[n.tipo]} de ${periodoVisible(n.periodo)}${n.concepto ? `: ${n.concepto}` : ""}`.slice(0, 300);
        cargoId = (await registrarCargo(tx, { empresaId: propia, usuarioId: usuario.id, clienteId: c.id, concepto, fecha: pago.fecha, monto: aCentavos(n.monto), cuentaPagoId: pago.cuentaPagoId!, notificacionId })).id;
        await en(empresaId);
      }
      await tx`UPDATE notificaciones_pago SET estado = 'pagada', pagada_por = ${usuario.id}, pagada_en = now(), pago_quien = ${pago.quien}, pago_fecha = ${pago.fecha},
                      pago_referencia = ${pago.referencia}, cargo_id = ${cargoId} WHERE id = ${notificacionId}`;
    });
  } catch (e) {
    return error(e);
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  if (propia) revalidatePath(`/e/${propia}`, "layout");
  return { ok: pago.quien === "empire" ? "Pago registrado con su comprobante. Quedó un cargo por cobrar al cliente en las cuentas por cobrar de Empire." : "Pago registrado con su comprobante." };
}

// Cobrar un cargo: el cliente le devolvió a Empire lo que adelantó.
export async function cobrarCargoAccion(empresaId: string, cargoId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "contabilizar", "/cxc");
  if (!esUuid(cargoId)) return { error: "Ese cargo no existe." };
  const t = (k: string) => String(fd.get(k) ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t("fecha")) || t("fecha") > hoyISO()) return { error: "Escribe la fecha del cobro (no puede ser futura)." };
  if (!esUuid(t("cuenta_cobro"))) return { error: "Elige el banco o la caja donde entró el dinero." };
  if (!(t("forma") in FORMAS_COBRO_CARGO)) return { error: "Elige la forma de cobro." };
  try {
    await conEmpresa(empresaId, (tx) => cobrarCargo(tx, { empresaId, usuarioId: usuario.id, cargoId, fecha: t("fecha"), cuentaCobroId: t("cuenta_cobro"), forma: t("forma"), referencia: t("referencia").slice(0, 100) || null }));
  } catch (e) {
    return error(e);
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: "Cobro registrado: el cargo quedó saldado." };
}
