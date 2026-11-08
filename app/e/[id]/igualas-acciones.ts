"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { bitacora, ErrorContable } from "@/lib/asientos";
import { conEmpresa, mensajeError, type Tx } from "@/lib/db";
import { esPeriodo, FRECUENCIAS, igualaBajoMinimo, nombrePeriodo, SERVICIOS_INCLUIDOS, TIPOS_ACUERDO } from "@/lib/igualas";
import {
  confirmarAumento, crearRecurrenteDesdeFactura, prepararIgualas, prepararRecurrenteAhora, prepararRecurrentes, type Preparacion,
} from "@/lib/igualas-db";
import { aCentavos, deCentavos, hoyISO, leerMonto } from "@/lib/montos";
import { fechaValida } from "@/lib/reportes";
import { emitir } from "@/lib/ventas";
import type { Estado } from "../../acciones-cuenta";

// Bloque 2, entrega 2b: igualas (pestaña /igualas) y facturas recurrentes (/recurrentes).

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();
const sinPunto = (t: string) => t.replace(/\.+$/, "");
const montoOpcional = (fd: FormData, c: string, nombre: string): string | null => {
  const v = texto(fd, c);
  if (!v) return null;
  const m = leerMonto(v);
  if (m === null) throw new ErrorContable(`${nombre}: el monto no es válido`);
  return deCentavos(aCentavos(m));
};
const fechaOpcional = (fd: FormData, c: string, nombre: string): string | null => {
  const v = texto(fd, c);
  if (!v) return null;
  if (!fechaValida(v)) throw new ErrorContable(`${nombre}: la fecha no es válida`);
  return v;
};

function resumen(r: Preparacion, que: string): Estado {
  const partes = [
    r.creadas ? `${r.creadas} ${r.creadas === 1 ? "borrador preparado" : "borradores preparados"}` : `Ningún ${que} nuevo`,
    r.yaEstaban ? `${r.yaEstaban} ya estaban` : "",
    r.gratis.length ? `sin factura por mes gratis: ${r.gratis.join(", ")}` : "",
  ].filter(Boolean).join(" · ");
  return r.errores.length ? { error: `${partes}. No se pudieron preparar: ${r.errores.map(sinPunto).join("; ")}.` } : { ok: `${partes}.` };
}

// ───── Acuerdos ─────

export async function guardarAcuerdo(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/igualas");
  const id = texto(fd, "id");
  let bajoMinimo = false;
  try {
    const cliente = texto(fd, "cliente");
    const servicio = texto(fd, "servicio");
    const tipo = texto(fd, "tipo");
    if (!esUuid(cliente)) throw new ErrorContable("Elige el cliente");
    if (!esUuid(servicio)) throw new ErrorContable("Elige el servicio de la iguala (de la lista de precios)");
    if (!(tipo in TIPOS_ACUERDO)) throw new ErrorContable("Elige el tipo de acuerdo");
    const monto = montoOpcional(fd, "monto", "Iguala");
    if (monto === null) throw new ErrorContable("Escribe el monto de la iguala");
    if (tipo === "cero" && (aCentavos(monto) < 60000n || aCentavos(monto) > 250000n)) throw new ErrorContable("La declaración en cero va de RD$600 a RD$2,500");
    const tarifa = montoOpcional(fd, "tarifa_especial", "Tarifa especial");
    const tarifaHasta = fechaOpcional(fd, "tarifa_hasta", "Tarifa especial");
    if ((tarifa === null) !== (tarifaHasta === null)) throw new ErrorContable("La tarifa especial necesita su monto y la fecha hasta la que rige");
    const cuota = montoOpcional(fd, "cuota", "Cuota");
    const deudaHasta = fechaOpcional(fd, "deuda_hasta", "Acuerdo especial");
    if ((cuota === null) !== (deudaHasta === null)) throw new ErrorContable("El acuerdo especial necesita la cuota y la fecha de término");
    const inicio = fechaOpcional(fd, "inicio", "Inicio del contrato");
    if (!inicio) throw new ErrorContable("Escribe la fecha de inicio del contrato");
    const dia = Number(texto(fd, "dia_facturacion") || "30");
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) throw new ErrorContable("El día de facturación va del 1 al 31");
    const incluidos = fd.getAll("incluidos").map(String).filter((k) => SERVICIOS_INCLUIDOS.some(([c]) => c === k));
    const datos = {
      cliente_id: cliente, servicio_id: servicio, tipo, monto, tarifa_especial: tarifa, tarifa_hasta: tarifaHasta,
      deuda: montoOpcional(fd, "deuda", "Deuda"), cuota, deuda_hasta: deudaHasta, inicio, dia_facturacion: dia,
      servicios_incluidos: incluidos, notas: texto(fd, "notas") || null,
    };
    bajoMinimo = await conEmpresa(empresaId, async (tx) => {
      const [c] = await tx<{ categoria: string | null }[]>`SELECT categoria FROM clientes WHERE id = ${cliente}`;
      if (id) {
        if (!esUuid(id)) throw new ErrorContable("El acuerdo no existe");
        const r = await tx`UPDATE acuerdos_cliente SET ${tx({ ...datos, activo: fd.get("activo") === "on" })} WHERE id = ${id}`;
        if (r.count === 0) throw new ErrorContable("El acuerdo no existe");
      } else {
        await tx`INSERT INTO acuerdos_cliente ${tx({ ...datos, empresa_id: empresaId })}`;
      }
      await bitacora(tx, empresaId, usuario.id, id ? "acuerdo_editado" : "acuerdo_creado", { tipo, monto });
      return igualaBajoMinimo(aCentavos(monto), tipo, c?.categoria ?? null);
    });
  } catch (e) {
    const err = e as { code?: string };
    return { error: err.code === "23505" ? "Ese cliente ya tiene un acuerdo activo: edítalo." : e instanceof ErrorContable ? e.message : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/igualas`);
  const aviso = bajoMinimo ? " Ojo: esta iguala está por debajo del mínimo de RD$4,000 de la lista de precios." : "";
  return { ok: (id ? "Acuerdo guardado." : "Acuerdo creado.") + aviso };
}

// ───── El mes ─────

export async function prepararMes(empresaId: string, periodo: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/igualas");
  if (!esPeriodo(periodo)) return { error: "Período no válido." };
  try {
    const r = await conEmpresa(empresaId, (tx) => prepararIgualas(tx, { empresaId, usuarioId: usuario.id, periodo, hoy: hoyISO(), soloHastaHoy: false }));
    revalidatePath(`/e/${empresaId}`, "layout");
    return resumen(r, "borrador");
  } catch (e) {
    return { error: mensajeError(e) };
  }
}

// Emite los borradores de iguala del período, uno por uno: si uno falla (sin NCF disponibles, por ejemplo), los demás siguen.
export async function emitirMes(empresaId: string, periodo: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "contabilizar", "/igualas");
  if (!esPeriodo(periodo)) return { error: "Período no válido." };
  const borradores = await conEmpresa(empresaId, (tx) => tx<{ id: string; cliente: string }[]>`
    SELECT f.id, c.nombre AS cliente FROM facturas f JOIN clientes c ON c.id = f.cliente_id
     WHERE f.acuerdo_id IS NOT NULL AND f.periodo = ${periodo} AND f.estado = 'borrador' ORDER BY c.nombre`);
  if (!borradores.length) return { error: `No hay borradores de iguala de ${nombrePeriodo(periodo)} por emitir.` };
  let emitidas = 0;
  const errores: string[] = [];
  for (const b of borradores) {
    try {
      await conEmpresa(empresaId, (tx) => emitir(tx, { empresaId, usuarioId: usuario.id, facturaId: b.id }));
      emitidas++;
    } catch (e) {
      errores.push(`${b.cliente}: ${sinPunto(mensajeError(e))}`);
    }
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  const ok = `${emitidas} ${emitidas === 1 ? "iguala emitida" : "igualas emitidas"} con su NCF y asiento`;
  return errores.length ? { error: `${ok}. No se emitieron: ${errores.join("; ")}.` } : { ok: `${ok}.` };
}

// El aumento de 10 % del aniversario se aplica solo cuando lo confirma quien edita la ficha de la empresa (Patricia).
export async function confirmarAumentoIguala(empresaId: string, acuerdoId: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "empresa", "/igualas");
  if (!esUuid(acuerdoId)) return { error: "El acuerdo no existe." };
  try {
    const nuevo = await conEmpresa(empresaId, async (tx) => {
      const n = await confirmarAumento(tx, { empresaId, usuarioId: usuario.id, acuerdoId, hoy: hoyISO() });
      await bitacora(tx, empresaId, usuario.id, "aumento_iguala_confirmado", { acuerdoId, monto: n });
      return n;
    });
    revalidatePath(`/e/${empresaId}/igualas`);
    return { ok: `Aumento confirmado: la iguala pasa a RD$${Number(nuevo).toLocaleString("es-DO", { minimumFractionDigits: 2 })} desde la próxima factura.` };
  } catch (e) {
    return { error: e instanceof ErrorContable ? e.message : mensajeError(e) };
  }
}

// ───── Facturas recurrentes ─────

const leerPlantilla = (fd: FormData) => {
  const nombre = texto(fd, "nombre");
  const frecuencia = texto(fd, "frecuencia");
  if (!nombre || nombre.length > 120) throw new ErrorContable("Escribe el nombre de la plantilla (hasta 120 caracteres)");
  if (!(frecuencia in FRECUENCIAS)) throw new ErrorContable("Elige la frecuencia");
  const proxima = fechaOpcional(fd, "proxima", "Próxima factura");
  if (frecuencia !== "a_solicitud" && !proxima) throw new ErrorContable("Escribe la fecha de la próxima factura");
  return { nombre, frecuencia, proxima: frecuencia === "a_solicitud" ? null : proxima, hasta: fechaOpcional(fd, "hasta", "Hasta") };
};

export async function crearRecurrente(empresaId: string, facturaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/recurrentes");
  if (!esUuid(facturaId)) return { error: "La factura no existe." };
  try {
    const p = leerPlantilla(fd);
    await conEmpresa(empresaId, async (tx) => {
      await crearRecurrenteDesdeFactura(tx, { empresaId, facturaId, ...p });
      await bitacora(tx, empresaId, usuario.id, "recurrente_creada", { nombre: p.nombre, frecuencia: p.frecuencia });
    });
  } catch (e) {
    return { error: e instanceof ErrorContable ? e.message : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/recurrentes`);
  return { ok: "Plantilla creada: la verás en Facturas recurrentes." };
}

export async function guardarRecurrente(empresaId: string, recurrenteId: string, _: Estado, fd: FormData): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/recurrentes");
  if (!esUuid(recurrenteId)) return { error: "La plantilla no existe." };
  try {
    const p = leerPlantilla(fd);
    const r = await conEmpresa(empresaId, (tx: Tx) => tx`
      UPDATE facturas_recurrentes SET ${tx({ ...p, activa: fd.get("activa") === "on" })} WHERE id = ${recurrenteId}`);
    if (r.count === 0) return { error: "La plantilla no existe." };
  } catch (e) {
    return { error: e instanceof ErrorContable ? e.message : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/recurrentes`);
  return { ok: "Plantilla guardada." };
}

export async function eliminarRecurrente(empresaId: string, recurrenteId: string): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/recurrentes");
  if (!esUuid(recurrenteId)) return { error: "La plantilla no existe." };
  // Las facturas que ya salieron de ella se quedan (pierden el enlace a la plantilla).
  await conEmpresa(empresaId, (tx) => tx`DELETE FROM facturas_recurrentes WHERE id = ${recurrenteId}`);
  revalidatePath(`/e/${empresaId}/recurrentes`);
  return { ok: "Plantilla eliminada. Las facturas que ya salieron de ella no cambian." };
}

export async function prepararAhora(empresaId: string, recurrenteId: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/recurrentes");
  if (!esUuid(recurrenteId)) return { error: "La plantilla no existe." };
  try {
    await conEmpresa(empresaId, (tx) => prepararRecurrenteAhora(tx, { empresaId, usuarioId: usuario.id, recurrenteId, hoy: hoyISO() }));
  } catch (e) {
    return { error: e instanceof ErrorContable ? e.message : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: "Borrador preparado: revísalo en Facturas antes de emitirlo." };
}

export async function prepararPendientes(empresaId: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/recurrentes");
  const r = await conEmpresa(empresaId, (tx) => prepararRecurrentes(tx, { empresaId, usuarioId: usuario.id, hoy: hoyISO() }));
  revalidatePath(`/e/${empresaId}`, "layout");
  return resumen(r, "borrador");
}
