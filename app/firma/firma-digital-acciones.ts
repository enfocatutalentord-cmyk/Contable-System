"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { urlApp } from "@/lib/enlaces";
import { aPdf } from "@/lib/exportar";
import { cancelarSolicitud, crearSolicitud, ErrorFirma, MAX_PDF, ponerEnlaceFirma } from "@/lib/firma-digital";
import { nuevoToken } from "@/lib/mensajes-db";
import { tablaPropuesta } from "@/lib/pdf-documentos";
import type { Estado } from "../acciones-cuenta";

// Prioridad 3 · P3e: pedir, copiar el enlace y cancelar la firma de un documento. Pide poder adjuntar en el cliente; el envío por WhatsApp usa «exportar» como los demás.

const FUENTE = /^(exp|prop):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function listo(firmaId: string, empresaId: string) {
  revalidatePath(`/firma/${firmaId}/firmas`);
  revalidatePath(`/e/${empresaId}/expediente`);
}

// Crea la solicitud con el PDF que se eligió: uno del expediente, una propuesta de Empire (se arma su PDF en ese momento) o uno que se sube.
export async function crearSolicitudFirma(firmaId: string, empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, firma } = await accesoFirma(firmaId, false);
  if (await soloCliente(firmaId, usuario.id)) return { error: "La firma digital es del equipo de la firma." };
  if (!esUuid(empresaId)) return { error: "Ese cliente no existe." };
  const { empresa } = await exigirPermiso(empresaId, "adjuntar");
  if (empresa.firma_id !== firmaId) return { error: "Ese cliente no es de esta firma." };
  let id: string;
  try {
    const fuente = String(fd.get("fuente") ?? "");
    const carpeta = /^0[1-6]$/.test(String(fd.get("carpeta") ?? "")) ? String(fd.get("carpeta")) : "06";
    const firmante = String(fd.get("firmante") ?? "").trim() || null;
    let titulo = String(fd.get("titulo") ?? "").trim();
    let origen: "expediente" | "subido" | "propuesta";
    let origenId: string | null = null;
    let bytes: Uint8Array;
    const m = FUENTE.exec(fuente);
    if (m && m[1] === "exp") {
      const [d] = await conEmpresa(empresaId, (tx) => tx<{ nombre: string; descripcion: string | null; tipo: string; contenido: Buffer }[]>`
        SELECT nombre, descripcion, tipo, contenido FROM documentos WHERE id = ${m[2]} AND entidad = 'expediente' AND NOT eliminado`);
      if (!d || d.tipo !== "application/pdf") return { error: "Ese documento no está en el expediente o no es un PDF." };
      bytes = new Uint8Array(d.contenido);
      origen = "expediente";
      origenId = m[2];
      titulo ||= (d.descripcion || d.nombre).replace(/\.pdf$/i, "");
    } else if (m && m[1] === "prop") {
      const propia = firma.empresa_propia_id;
      if (!propia) return { error: "Primero marca la empresa que factura a los clientes en Contabilidad." };
      const armado = await conEmpresa(propia, async (tx) => {
        const [p] = await tx<{ numero: number }[]>`
          SELECT p.numero FROM propuestas p JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ${m[2]} AND c.empresa_vinculada_id = ${empresaId}`;
        if (!p) return null;
        const [{ nombre, rnc }] = await tx<{ nombre: string; rnc: string | null }[]>`SELECT nombre, rnc FROM empresas WHERE id = ${propia}`;
        const t = await tablaPropuesta(tx, m[2], { empresa: nombre + (rnc ? ` · RNC ${rnc}` : ""), generado: `Enviada a firmar el ${new Date().toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo" })}` });
        return t ? { numero: p.numero, bytes: new Uint8Array(await aPdf(t[1])) } : null;
      });
      if (!armado) return { error: "Esa propuesta no es de este cliente." };
      bytes = armado.bytes;
      origen = "propuesta";
      origenId = m[2];
      titulo ||= `Propuesta n.º ${armado.numero}`;
    } else {
      const a = fd.get("archivo");
      if (!(a instanceof File) || a.size === 0) return { error: "Elige un documento del expediente, una propuesta, o sube un PDF." };
      if (a.size > MAX_PDF) return { error: "El PDF pasa de 4 MB." };
      bytes = new Uint8Array(await a.arrayBuffer());
      origen = "subido";
      titulo ||= a.name.replace(/\.pdf$/i, "");
    }
    id = await conEmpresa(empresaId, (tx) => crearSolicitud(tx, { empresaId, usuarioId: usuario.id, titulo, origen, origenId, carpeta, firmante, bytes }));
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    return { error: e instanceof ErrorFirma ? e.message : mensajeError(e) };
  }
  listo(firmaId, empresaId);
  redirect(`/firma/${firmaId}/firmas?nueva=${id}`);
}

// Enlace para copiar y mandarlo por otro medio (reemplaza el anterior; vale 7 días).
export async function enlaceParaCopiarFirma(empresaId: string, solicitudId: string, _: Estado): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "adjuntar");
  if (!esUuid(solicitudId)) return { error: "Esa solicitud no existe." };
  const token = nuevoToken();
  try {
    await conEmpresa(empresaId, (tx) => ponerEnlaceFirma(tx, { empresaId, solicitudId, token, usuarioId: usuario.id }));
  } catch (e) {
    return { error: e instanceof ErrorFirma ? e.message : mensajeError(e) };
  }
  revalidatePath(`/firma/${empresa.firma_id}/firmas`);
  return { ok: `Enlace (vale 7 días; el anterior dejó de funcionar): ${await urlApp()}/firmar/${token}` };
}

export async function cancelarSolicitudFirma(empresaId: string, solicitudId: string, _: Estado): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "adjuntar");
  if (!esUuid(solicitudId)) return { error: "Esa solicitud no existe." };
  try {
    await conEmpresa(empresaId, (tx) => cancelarSolicitud(tx, { empresaId, solicitudId, usuarioId: usuario.id }));
  } catch (e) {
    return { error: e instanceof ErrorFirma ? e.message : mensajeError(e) };
  }
  listo(empresa.firma_id, empresaId);
  return { ok: "Solicitud cancelada: el enlace dejó de funcionar." };
}
