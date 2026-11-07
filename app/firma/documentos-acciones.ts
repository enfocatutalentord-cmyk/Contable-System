"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { ErrorContable } from "@/lib/asientos";
import { conEmpresa, mensajeError } from "@/lib/db";
import { aprobarSubida, subirFactura } from "@/lib/facturas-subidas";
import { aCentavos, leerMonto } from "@/lib/montos";
import { fechaValida } from "@/lib/reportes";
import { leerNcf } from "@/lib/validar-fiscal";
import type { Estado } from "../acciones-cuenta";

// Rediseño R4 (n.º 12): un documento recibido se procesa en la misma pantalla de la Firma. Se completa la factura y se aprueba: queda
// como factura del cliente (con su revisión de RNC, NCF y repetidas) y como borrador de compra (606) o de venta (607), con el archivo.

const texto = (fd: FormData, campo: string) => String(fd.get(campo) ?? "").trim();
const identificacion = (v: string) => { const x = v.replace(/[-\s]/g, ""); return /^\d{9}$|^\d{11}$/.test(x) ? x : null; };
const monto = (v: string) => { if (!v) return null; const m = leerMonto(v); return m === null ? undefined : aCentavos(m); };

export async function procesarDocumento(firmaId: string, empresaId: string, recepcionId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "registrar", "/recepcion");
  if (empresa.firma_id !== firmaId || !esUuid(recepcionId)) return { error: "Documento no válido." };
  const tipo = texto(fd, "tipo") === "ingreso" ? "ingreso" : "gasto";
  const rncTxt = texto(fd, "rnc");
  const rnc = rncTxt ? identificacion(rncTxt) : null;
  if (rncTxt && !rnc) return { error: "El RNC tiene 9 dígitos y la cédula 11." };
  const n = leerNcf(texto(fd, "ncf"));
  if (!n) return { error: "Escribe el NCF: B y 10 dígitos (B0100000001) o E y 12 (E310000000001)." };
  const fecha = texto(fd, "fecha");
  if (!fechaValida(fecha)) return { error: "Escribe la fecha de la factura." };
  const subtotal = monto(texto(fd, "subtotal")), itbis = monto(texto(fd, "itbis")) ?? 0n;
  if (subtotal === null || subtotal === undefined || itbis === undefined) return { error: "Escribe el subtotal y el ITBIS." };
  const nombre = texto(fd, "nombre").slice(0, 200) || null;
  let destino = "";
  try {
    destino = await conEmpresa(empresaId, async (tx) => {
      const [r] = await tx<{ nombre: string; tipo: string; contenido: Buffer; estado: string }[]>`
        SELECT nombre, tipo, contenido, estado FROM recepciones WHERE id = ${recepcionId} FOR UPDATE`;
      if (!r) throw new ErrorContable("Documento no encontrado");
      if (r.estado === "procesado" || r.estado === "descartado") throw new ErrorContable("Ese documento ya se procesó.");
      if (!["application/pdf", "image/jpeg", "image/png"].includes(r.tipo)) throw new ErrorContable("Solo una foto o un PDF se registra como factura. Ábrelo en el cliente.");
      const s = await subirFactura(tx, {
        empresaId, usuarioId: usuario.id, archivo: { nombre: r.nombre, tipo: r.tipo, bytes: new Uint8Array(r.contenido) }, tipo,
        rncContraparte: rnc, nombreContraparte: nombre, ncf: n.ncf, fecha, subtotal, itbis, total: subtotal + itbis, qr: null,
      });
      const a = await aprobarSubida(tx, {
        empresaId, usuarioId: usuario.id, id: s.id, rnc, nombre, ncf: n.ncf, fecha, subtotal, itbis,
        tipoGasto: texto(fd, "tipo_gasto"), clase: texto(fd, "clase") === "bien" ? "bien" : "servicio",
      });
      await tx`UPDATE recepciones SET estado = 'procesado', compra_id = ${a.compraId}, procesado_por = ${usuario.id}, procesado_en = now(),
                      respuesta = COALESCE(respuesta, ${tipo === "gasto" ? "Registrado para el 606." : "Registrado para el 607."})
                WHERE id = ${recepcionId}`;
      return a.compraId ? `/e/${empresaId}/compras/${a.compraId}` : `/e/${empresaId}/facturas/${a.facturaId}`;
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/firma/${firmaId}`, "layout");
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/firma/${firmaId}/documentos?${new URLSearchParams({ hecho: tipo, borrador: destino })}`);
}

export async function descartarDocumento(firmaId: string, empresaId: string, recepcionId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "registrar", "/recepcion");
  if (empresa.firma_id !== firmaId || !esUuid(recepcionId)) return { error: "Documento no válido." };
  const motivo = texto(fd, "respuesta").slice(0, 500);
  if (motivo.length < 3) return { error: "Escribe el motivo (lo ve el cliente)." };
  try {
    await conEmpresa(empresaId, async (tx) => {
      const r = await tx`UPDATE recepciones SET estado = 'descartado', respuesta = ${motivo}, procesado_por = ${usuario.id}, procesado_en = now()
                          WHERE id = ${recepcionId} AND estado IN ('nuevo', 'en_proceso')`;
      if (r.count === 0) throw new ErrorContable("Ese documento ya se procesó.");
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/firma/${firmaId}`, "layout");
  redirect(`/firma/${firmaId}/documentos?hecho=descartado`);
}
