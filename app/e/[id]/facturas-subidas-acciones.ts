"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { TAMANO_MAXIMO, tipoPorContenido } from "@/lib/documentos";
import { aprobarSubida, rechazarSubida, subirFactura } from "@/lib/facturas-subidas";
import { aCentavos, leerMonto } from "@/lib/montos";
import { fechaValida } from "@/lib/reportes";
import { leerNcf, leerQr } from "@/lib/validar-fiscal";
import type { Estado } from "../../acciones-cuenta";

const texto = (fd: FormData, campo: string) => String(fd.get(campo) ?? "").trim();
const identificacion = (v: string) => { const x = v.replace(/[-\s]/g, ""); return /^\d{9}$|^\d{11}$/.test(x) ? x : null; };
const monto = (v: string) => { if (!v) return null; const m = leerMonto(v); return m === null ? undefined : aCentavos(m); };
const volver = (id: string) => { revalidatePath(`/e/${id}/facturas-subidas`); revalidatePath(`/e/${id}`); };

// El cliente (o el equipo) sube una factura: foto o PDF, el QR de la factura electrónica o los datos escritos (bloque 8b).
export async function subirFacturaAccion(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "adjuntar", "/facturas-subidas");
  const tipo = texto(fd, "tipo") === "ingreso" ? "ingreso" : "gasto";
  const qr = texto(fd, "qr") ? leerQr(texto(fd, "qr")) : null;
  if (texto(fd, "qr") && !qr) return { error: "El código QR no es de una factura electrónica de la DGII." };
  const rncTxt = texto(fd, "rnc");
  const rnc = rncTxt ? identificacion(rncTxt) : (tipo === "gasto" ? qr?.rncEmisor : qr?.rncComprador) ?? null;
  if (rncTxt && !rnc) return { error: "El RNC tiene 9 dígitos y la cédula 11." };
  const ncfTxt = texto(fd, "ncf") || qr?.ncf || "";
  const n = ncfTxt ? leerNcf(ncfTxt) : null;
  if (ncfTxt && !n) return { error: "El NCF no es válido: B y 10 dígitos (B0100000001) o E y 12 (E310000000001)." };
  const fecha = texto(fd, "fecha") || qr?.fecha || null;
  if (fecha && !fechaValida(fecha)) return { error: "La fecha no es válida." };
  const subtotal = monto(texto(fd, "subtotal")), itbis = monto(texto(fd, "itbis"));
  const total = monto(texto(fd, "total") || qr?.total || "");
  if (subtotal === undefined || itbis === undefined || total === undefined) return { error: "Revisa los montos." };
  const archivo = fd.get("archivo");
  let doc: { nombre: string; tipo: string; bytes: Uint8Array } | null = null;
  if (archivo instanceof File && archivo.size > 0) {
    if (archivo.size > TAMANO_MAXIMO) return { error: "El archivo pasa de 4 MB. Toma la foto de nuevo o comprime el PDF." };
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const t = tipoPorContenido(bytes);
    if (!t) return { error: "Solo se aceptan fotos (JPG o PNG) y PDF." };
    doc = { nombre: archivo.name || "factura", tipo: t, bytes };
  }
  try {
    const r = await conEmpresa(empresaId, (tx) => subirFactura(tx, {
      empresaId, usuarioId: usuario.id, archivo: doc, tipo, rncContraparte: rnc, nombreContraparte: texto(fd, "nombre").slice(0, 200) || null,
      ncf: n?.ncf ?? null, fecha, subtotal, itbis, total: total ?? (subtotal !== null && itbis !== null ? subtotal + itbis : null), qr,
    }));
    volver(empresaId);
    const errores = r.marcas.filter((m) => m.nivel === "error");
    return errores.length
      ? { error: `Factura n.º ${r.numero} recibida, pero ${errores.map((m) => m.texto.charAt(0).toLowerCase() + m.texto.slice(1)).join(" ")} Empire la revisará.` }
      : { ok: `Factura n.º ${r.numero} recibida. Empire la revisa y aquí verás si se aprobó.` };
  } catch (e) {
    return { error: mensajeError(e) };
  }
}

export async function aprobarSubidaAccion(empresaId: string, id: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, paraClientes } = await exigirPermiso(empresaId, "registrar", "/facturas-subidas");
  if (paraClientes || !esUuid(id)) return { error: "Esto lo hace el equipo de la firma." };
  const fecha = texto(fd, "fecha");
  const subtotal = monto(texto(fd, "subtotal")), itbis = monto(texto(fd, "itbis")) ?? 0n;
  const rncTxt = texto(fd, "rnc");
  const rnc = rncTxt ? identificacion(rncTxt) : null;
  if (rncTxt && !rnc) return { error: "El RNC tiene 9 dígitos y la cédula 11." };
  if (!fechaValida(fecha)) return { error: "Escribe la fecha de la factura." };
  if (subtotal === null || subtotal === undefined || itbis === undefined) return { error: "Escribe el subtotal y el ITBIS." };
  const clase = texto(fd, "clase") === "bien" ? "bien" : "servicio";
  try {
    const r = await conEmpresa(empresaId, (tx) => aprobarSubida(tx, {
      empresaId, usuarioId: usuario.id, id, rnc, nombre: texto(fd, "nombre").slice(0, 200) || null, ncf: texto(fd, "ncf"), fecha, subtotal, itbis,
      tipoGasto: texto(fd, "tipo_gasto"), clase,
    }));
    volver(empresaId);
    redirect(`/e/${empresaId}/facturas-subidas?hecho=aprobada&${r.compraId ? `compra=${r.compraId}` : `venta=${r.facturaId}`}`);
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    return { error: mensajeError(e) };
  }
}

export async function rechazarSubidaAccion(empresaId: string, id: string, estado: "rechazada" | "desestimada", _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, paraClientes } = await exigirPermiso(empresaId, "registrar", "/facturas-subidas");
  if (paraClientes || !esUuid(id) || !["rechazada", "desestimada"].includes(estado)) return { error: "Esto lo hace el equipo de la firma." };
  try {
    await conEmpresa(empresaId, (tx) => rechazarSubida(tx, id, usuario.id, estado, texto(fd, "motivo")));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  volver(empresaId);
  redirect(`/e/${empresaId}/facturas-subidas?hecho=${estado}`);
}
