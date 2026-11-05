"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { anularAnticipo, aplicarAnticipo, FORMAS_ANTICIPO, registrarAnticipo } from "@/lib/anticipos";
import { bitacora, ErrorContable } from "@/lib/asientos";
import { leerCantidad } from "@/lib/calculos";
import { conEmpresa, mensajeError } from "@/lib/db";
import { leerUnidad } from "@/lib/empresa-propia";
import { aCentavos, hoyISO, leerMonto } from "@/lib/montos";
import { cambiarEstado, convertirEnFactura, convertirEnIguala, ESTADOS_PROPUESTA, guardarPropuesta, type LineaPropuesta } from "@/lib/propuestas";
import { fechaValida } from "@/lib/reportes";
import type { Estado } from "../../acciones-cuenta";

// Bloque 2, entrega 2c: propuestas (/propuestas) y anticipos (/anticipos).

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();
const error = (e: unknown): Estado => ({ error: e instanceof ErrorContable ? e.message : mensajeError(e) });

type LineaForm = { servicioId: string; descripcion: string; cantidad: string; precio: string; descuento: string; impuesto: string; adicional: string; unidad: string };

function leerLineas(fd: FormData): LineaPropuesta[] {
  let crudas: LineaForm[];
  try {
    crudas = JSON.parse(texto(fd, "lineas") || "[]");
  } catch {
    throw new ErrorContable("No se pudieron leer las líneas");
  }
  const lineas: LineaPropuesta[] = [];
  for (const [i, l] of crudas.entries()) {
    if (!l.descripcion.trim() && !l.precio) continue;
    const cantidad = leerCantidad(l.cantidad || "1");
    const precio = leerMonto(l.precio);
    const descuento = leerMonto(l.descuento || "0");
    const unidad = leerUnidad(l.unidad);
    if (cantidad === null) throw new ErrorContable(`Línea ${i + 1}: la cantidad no es válida`);
    if (precio === null || descuento === null) throw new ErrorContable(`Línea ${i + 1}: el precio o el descuento no son válidos`);
    if (!esUuid(l.impuesto) || (l.adicional && !esUuid(l.adicional)) || (l.servicioId && !esUuid(l.servicioId)) || unidad === undefined) {
      throw new ErrorContable(`Línea ${i + 1}: revisa el servicio y el impuesto`);
    }
    lineas.push({
      servicioId: l.servicioId || null, descripcion: l.descripcion.trim(), cantidad, precioLista: aCentavos(precio), descuento: aCentavos(descuento),
      impuestoId: l.impuesto, adicionalId: l.adicional || null, unidadId: unidad,
    });
  }
  return lineas;
}

export async function guardarPropuestaAccion(empresaId: string, propuestaId: string | null, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/propuestas");
  let id: string;
  try {
    const cliente = texto(fd, "cliente");
    const fecha = texto(fd, "fecha");
    const validaHasta = texto(fd, "valida_hasta");
    const entrega = texto(fd, "entrega") || null;
    const pct = leerMonto(texto(fd, "anticipo") || "0");
    if (!esUuid(cliente)) throw new ErrorContable("Elige el cliente");
    if (!fechaValida(fecha) || !fechaValida(validaHasta) || (entrega && !fechaValida(entrega))) throw new ErrorContable("Revisa las fechas");
    if (pct === null || aCentavos(pct) > 10000n) throw new ErrorContable("El anticipo es un porcentaje de 0 a 100");
    const lineas = leerLineas(fd);
    id = await conEmpresa(empresaId, async (tx) => {
      const r = await guardarPropuesta(tx, {
        empresaId, usuarioId: usuario.id, clienteId: cliente, fecha, validaHasta, entrega, anticipoPct: pct, lineas, propuestaId,
        requisitos: texto(fd, "requisitos") || null, formaPago: texto(fd, "forma_pago") || null, notas: texto(fd, "notas") || null,
      });
      await bitacora(tx, empresaId, usuario.id, propuestaId ? "propuesta_editada" : "propuesta_creada", { id: r });
      return r;
    });
  } catch (e) {
    return error(e);
  }
  revalidatePath(`/e/${empresaId}/propuestas`);
  redirect(`/e/${empresaId}/propuestas/${id}`);
}

export async function cambiarEstadoPropuesta(empresaId: string, propuestaId: string, estado: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/propuestas");
  if (!esUuid(propuestaId) || !(estado in ESTADOS_PROPUESTA)) return { error: "Datos no válidos." };
  try {
    await conEmpresa(empresaId, async (tx) => {
      await cambiarEstado(tx, propuestaId, estado);
      await bitacora(tx, empresaId, usuario.id, "propuesta_estado", { id: propuestaId, estado });
    });
  } catch (e) {
    return error(e);
  }
  revalidatePath(`/e/${empresaId}/propuestas`, "layout");
  return { ok: `Propuesta marcada como ${ESTADOS_PROPUESTA[estado].toLowerCase()}.` };
}

export async function propuestaAFactura(empresaId: string, propuestaId: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/propuestas");
  if (!esUuid(propuestaId)) return { error: "La propuesta no existe." };
  let facturaId: string;
  try {
    facturaId = await conEmpresa(empresaId, (tx) => convertirEnFactura(tx, { empresaId, usuarioId: usuario.id, propuestaId, fecha: hoyISO() }));
  } catch (e) {
    return error(e);
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/facturas/${facturaId}`);
}

export async function propuestaAIguala(empresaId: string, propuestaId: string, _: Estado, fd: FormData): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/igualas");
  const inicio = texto(fd, "inicio");
  if (!esUuid(propuestaId) || !fechaValida(inicio)) return { error: "Escribe la fecha de inicio del contrato." };
  try {
    await conEmpresa(empresaId, (tx) => convertirEnIguala(tx, { empresaId, propuestaId, inicio }));
  } catch (e) {
    return error(e);
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/igualas`);
}

// ───── Anticipos ─────

export async function registrarAnticipoAccion(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "contabilizar", "/anticipos");
  const cliente = texto(fd, "cliente");
  const cuenta = texto(fd, "cuenta_destino");
  const propuesta = texto(fd, "propuesta") || null;
  const fecha = texto(fd, "fecha");
  const monto = leerMonto(texto(fd, "monto"));
  const forma = texto(fd, "forma_pago");
  if (!esUuid(cliente) || !esUuid(cuenta) || (propuesta && !esUuid(propuesta))) return { error: "Elige el cliente y la cuenta." };
  if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
  if (monto === null || aCentavos(monto) <= 0n) return { error: "El monto no es válido." };
  if (!(forma in FORMAS_ANTICIPO)) return { error: "Elige la forma de pago." };
  try {
    const r = await conEmpresa(empresaId, (tx) => registrarAnticipo(tx, {
      empresaId, usuarioId: usuario.id, clienteId: cliente, fecha, monto: aCentavos(monto), cuentaDestinoId: cuenta, formaPago: forma,
      referencia: texto(fd, "referencia") || null, notas: texto(fd, "notas") || null, propuestaId: propuesta,
    }));
    revalidatePath(`/e/${empresaId}`, "layout");
    return { ok: `Anticipo n.º ${r.numero} registrado. Se aplica a la factura desde la factura misma («Aplicar anticipo»).` };
  } catch (e) {
    return error(e);
  }
}

export async function aplicarAnticipoAccion(empresaId: string, facturaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "contabilizar", "/cobros");
  const anticipo = texto(fd, "anticipo");
  const monto = leerMonto(texto(fd, "monto"));
  const fecha = texto(fd, "fecha");
  if (!esUuid(anticipo) || !esUuid(facturaId)) return { error: "Elige el anticipo." };
  if (monto === null || aCentavos(monto) <= 0n) return { error: "El monto no es válido." };
  if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
  try {
    const n = await conEmpresa(empresaId, (tx) => aplicarAnticipo(tx, { empresaId, usuarioId: usuario.id, anticipoId: anticipo, facturaId, monto: aCentavos(monto), fecha }));
    revalidatePath(`/e/${empresaId}`, "layout");
    return { ok: `Anticipo aplicado (recibo n.º ${n}).` };
  } catch (e) {
    return error(e);
  }
}

export async function anularAnticipoAccion(empresaId: string, anticipoId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "revertir", "/anticipos");
  const motivo = texto(fd, "motivo");
  if (!esUuid(anticipoId)) return { error: "El anticipo no existe." };
  if (motivo.length < 3) return { error: "Escribe el motivo." };
  try {
    await conEmpresa(empresaId, (tx) => anularAnticipo(tx, { empresaId, usuarioId: usuario.id, anticipoId, motivo }));
  } catch (e) {
    return error(e);
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: "Anticipo anulado: su asiento también." };
}
