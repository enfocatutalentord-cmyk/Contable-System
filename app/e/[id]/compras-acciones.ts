"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { bitacora, ErrorContable } from "@/lib/asientos";
import {
  anularCompra, anularPago, descartarBorradorCompra, esNotaProveedor, esTipoCompra, FORMAS_PAGO, guardarBorradorCompra, registrarCompra,
  registrarPago, TIPOS_GASTO, type LineaCompraEntrada,
} from "@/lib/compras";
import { conEmpresa, mensajeError } from "@/lib/db";
import { limpiarRnc } from "@/lib/empresas";
import { aCentavos, leerMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { fechaValida } from "@/lib/reportes";
import { leerCantidad, leerTasa } from "@/lib/ventas";
import type { Estado } from "../../acciones-cuenta";

function texto(fd: FormData, campo: string): string {
  return String(fd.get(campo) ?? "").trim();
}

// ───── Proveedores ─────

export async function guardarProveedor(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar");
  const id = texto(fd, "id");
  const nombre = texto(fd, "nombre");
  const tipoId = texto(fd, "tipo_identificacion");
  const ident = tipoId === "pasaporte" ? texto(fd, "rnc").toUpperCase() : limpiarRnc(texto(fd, "rnc"));
  const dias = Number(texto(fd, "dias_credito") || "0");
  const tipoGasto = texto(fd, "tipo_gasto");
  const cuenta = texto(fd, "cuenta_gasto");
  const retenciones = fd.getAll("retenciones").map(String).filter(esUuid);
  if (!nombre) return { error: "Escribe el nombre o razón social." };
  if (ident && tipoId === "rnc" && !/^\d{9}$/.test(ident)) return { error: "El RNC debe tener 9 dígitos." };
  if (ident && tipoId === "cedula" && !/^\d{11}$/.test(ident)) return { error: "La cédula debe tener 11 dígitos." };
  if (ident && tipoId === "pasaporte" && !/^[A-Z0-9]{5,20}$/.test(ident)) return { error: "El pasaporte o identificación no es válido." };
  if (tipoGasto && !TIPOS_GASTO[tipoGasto]) return { error: "El tipo de gasto no es válido." };
  if (cuenta && !esUuid(cuenta)) return { error: "La cuenta no es válida." };
  if (!Number.isInteger(dias) || dias < 0 || dias > 365) return { error: "Los días de crédito van de 0 a 365." };
  const datos = {
    nombre, rnc: ident || null, tipo_identificacion: ident ? tipoId : null, email: texto(fd, "email") || null,
    telefono: texto(fd, "telefono") || null, direccion: texto(fd, "direccion") || null, dias_credito: dias,
    tipo_gasto: tipoGasto || null, cuenta_gasto_id: cuenta || null, retenciones, del_exterior: fd.get("del_exterior") === "on",
    activo: id ? fd.get("activo") === "on" : true,
  };
  try {
    await conEmpresa(empresaId, async (tx) => {
      if (retenciones.length) {
        const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM retenciones WHERE id = ANY(${retenciones}::uuid[])`;
        if (n !== retenciones.length) throw new ErrorContable("Una de las retenciones no existe");
      }
      if (id) {
        if (!esUuid(id)) throw new ErrorContable("Proveedor no válido");
        const r = await tx`UPDATE proveedores SET ${tx(datos)} WHERE id = ${id}`;
        if (r.count === 0) throw new ErrorContable("El proveedor no existe");
      } else {
        await tx`INSERT INTO proveedores ${tx({ ...datos, empresa_id: empresaId })}`;
      }
      await bitacora(tx, empresaId, usuario.id, id ? "proveedor_editado" : "proveedor_creado", { nombre });
    });
  } catch (e) {
    const err = e as { code?: string };
    return { error: err.code === "23505" ? "Ya hay un proveedor con esa identificación." : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/proveedores`);
  if (id) redirect(`/e/${empresaId}/proveedores`);
  return { ok: `Proveedor ${nombre} guardado.` };
}

// ───── Compras ─────

type LineaForm = { descripcion: string; clase: string; cantidad: string; precio: string; cuenta: string; impuesto: string; adicional: string };

function leerLineas(fd: FormData): LineaCompraEntrada[] | string {
  let crudas: LineaForm[];
  try {
    crudas = JSON.parse(String(fd.get("lineas") ?? "[]"));
  } catch {
    return "No se pudieron leer las líneas.";
  }
  const lineas: LineaCompraEntrada[] = [];
  for (const [i, l] of crudas.entries()) {
    if (!l.descripcion.trim() && !l.precio) continue;
    const cantidad = leerCantidad(l.cantidad || "1");
    const precio = leerMonto(l.precio);
    if (!l.descripcion.trim()) return `Línea ${i + 1}: escribe la descripción.`;
    if (cantidad === null) return `Línea ${i + 1}: la cantidad no es válida.`;
    if (precio === null) return `Línea ${i + 1}: el precio no es válido.`;
    if (!esUuid(l.impuesto) || (l.adicional && !esUuid(l.adicional)) || (l.cuenta && !esUuid(l.cuenta))) return `Línea ${i + 1}: revisa la cuenta y el impuesto.`;
    lineas.push({
      descripcion: l.descripcion.trim(), clase: l.clase === "bien" ? "bien" : "servicio", cantidad, precio: aCentavos(precio),
      cuentaId: l.cuenta || null, impuestoIds: [l.impuesto, ...(l.adicional ? [l.adicional] : [])],
    });
  }
  return lineas;
}

// Guarda la compra como borrador o, con accion=registrar, la guarda y la registra (asiento y, si es propio, NCF).
export async function guardarCompra(empresaId: string, compraId: string | null, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, permisos } = await exigirPermiso(empresaId, "registrar");
  const registrarAhora = texto(fd, "accion") === "registrar";
  if (registrarAhora && !puede(permisos, "contabilizar")) return { error: "Tu perfil no permite registrar compras; guárdala como borrador." };
  const proveedorId = texto(fd, "proveedor");
  const tipo = texto(fd, "tipo");
  const fecha = texto(fd, "fecha");
  let vence = texto(fd, "vence");
  const moneda = texto(fd, "moneda") === "USD" ? "USD" : "DOP";
  const tasa = moneda === "DOP" ? 10000n : leerTasa(texto(fd, "tasa"));
  const origen = texto(fd, "origen") || null;
  if (!esUuid(proveedorId)) return { error: "Elige el proveedor." };
  if (!esTipoCompra(tipo)) return { error: "Elige el tipo de comprobante." };
  if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
  if (!fechaValida(vence)) vence = fecha;
  if (tasa === null) return { error: "Escribe la tasa del dólar." };
  if (origen && !esUuid(origen)) return { error: "Compra de origen no válida." };
  if (esNotaProveedor(tipo) && !origen) return { error: "La nota de crédito se registra desde la compra que modifica." };
  const lineas = leerLineas(fd);
  if (typeof lineas === "string") return { error: lineas };
  let id: string;
  let registrada = false;
  try {
    id = await conEmpresa(empresaId, async (tx) => {
      const id = await guardarBorradorCompra(tx, {
        compraId, empresaId, usuarioId: usuario.id, proveedorId, tipo, ncf: texto(fd, "ncf") || null, fecha, vence, moneda, tasa,
        tipoGasto: texto(fd, "tipo_gasto"), itbisAlCosto: fd.get("itbis_al_costo") === "on", notas: texto(fd, "notas") || null,
        compraOrigenId: esNotaProveedor(tipo) ? origen : null, lineas,
      });
      if (registrarAhora) {
        await registrarCompra(tx, { empresaId, usuarioId: usuario.id, compraId: id });
        registrada = true;
      }
      return id;
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/compras/${id}?${registrada ? "registrada" : "guardada"}=1`);
}

export async function registrarBorradorCompra(empresaId: string, compraId: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "contabilizar");
  try {
    await conEmpresa(empresaId, (tx) => registrarCompra(tx, { empresaId, usuarioId: usuario.id, compraId }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/compras/${compraId}?registrada=1`);
}

export async function descartarCompra(empresaId: string, compraId: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar");
  try {
    await conEmpresa(empresaId, async (tx) => {
      await descartarBorradorCompra(tx, compraId);
      await bitacora(tx, empresaId, usuario.id, "compra_borrador_descartada", { id: compraId });
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/compras?descartada=1`);
}

export async function anularLaCompra(empresaId: string, compraId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "revertir");
  const motivo = texto(fd, "motivo");
  if (!motivo) return { error: "Escribe el motivo." };
  try {
    await conEmpresa(empresaId, (tx) => anularCompra(tx, { empresaId, usuarioId: usuario.id, compraId, motivo }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/compras/${compraId}?anulada=1`);
}

// ───── Pagos ─────

export async function crearPago(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "contabilizar");
  const proveedorId = texto(fd, "proveedor");
  const fecha = texto(fd, "fecha");
  const moneda = texto(fd, "moneda") === "USD" ? "USD" : "DOP";
  const tasa = moneda === "DOP" ? 10000n : leerTasa(texto(fd, "tasa"));
  const pagadoTexto = leerMonto(texto(fd, "pagado"));
  const formaPago = texto(fd, "forma_pago");
  if (!esUuid(proveedorId)) return { error: "Elige el proveedor." };
  if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
  if (tasa === null) return { error: "Escribe la tasa del dólar del día del pago." };
  if (pagadoTexto === null) return { error: "Revisa los montos." };
  if (!FORMAS_PAGO[formaPago]) return { error: "Elige la forma de pago." };
  let aplicaciones: { compraId: string; monto: bigint }[];
  let retenciones: { retencionId: string; monto: bigint }[];
  try {
    const leer = (campo: string, clave: string) => (JSON.parse(String(fd.get(campo) ?? "[]")) as Record<string, string>[]).map((a) => {
      const m = leerMonto(a.monto);
      if (m === null || !esUuid(a[clave])) throw new Error("monto");
      return { id: a[clave], monto: aCentavos(m) };
    });
    aplicaciones = leer("aplicaciones", "compraId").map((a) => ({ compraId: a.id, monto: a.monto }));
    retenciones = leer("retenciones", "retencionId").map((r) => ({ retencionId: r.id, monto: r.monto }));
  } catch {
    return { error: "Uno de los montos no es válido." };
  }
  let numero: number;
  try {
    numero = await conEmpresa(empresaId, (tx) => registrarPago(tx, {
      empresaId, usuarioId: usuario.id, proveedorId, fecha, moneda, tasa, cuentaOrigenId: texto(fd, "cuenta_origen"), formaPago,
      referencia: texto(fd, "referencia") || null, notas: texto(fd, "notas") || null, pagado: aCentavos(pagadoTexto), retenciones, aplicaciones,
    }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/pagos/${numero}?nuevo=1`);
}

export async function anularElPago(empresaId: string, numero: number, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "revertir");
  const motivo = texto(fd, "motivo");
  if (!motivo) return { error: "Escribe el motivo." };
  try {
    await conEmpresa(empresaId, (tx) => anularPago(tx, { empresaId, usuarioId: usuario.id, numero, motivo }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/pagos/${numero}?anulado=1`);
}
