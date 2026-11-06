"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso, misFirmas, soloCliente } from "@/lib/acceso";
import { enviarConDetalle } from "@/lib/correo";
import { igualasPorCorreo, leerDirecciones, parrafosDe, pdfFactura, plantillaCorreo, prepararCorreo, registrarCorreo } from "@/lib/correo-facturas";
import { conEmpresa, mensajeError } from "@/lib/db";
import { esPeriodo } from "@/lib/igualas";
import type { Estado } from "../../acciones-cuenta";

// Entrega A (6-nov-2026): «Enviar por correo» en las facturas y notas emitidas, y el envío de las igualas del mes.
// Pide el permiso «exportar» (sale un PDF) y no lo usan los usuarios de los clientes. Cada intento queda guardado; si Gmail lo frena
// queda «no salió» para volver a enviarlo.

const texto = (fd: FormData, campo: string) => String(fd.get(campo) ?? "").trim();

async function acceso(empresaId: string, pestana: string) {
  const a = await exigirPermiso(empresaId, "exportar", pestana);
  if (a.paraClientes || (await soloCliente(a.empresa.firma_id, a.usuario.id))) throw new Error("Solo para el equipo de la firma");
  const propia = (await misFirmas(a.usuario.id)).some((f) => f.empresa_propia_id === empresaId);
  return { ...a, propia };
}

// Envía una factura y guarda el intento. Devuelve el error de Gmail (si lo hubo) para mostrarlo o seguir con las demás.
async function enviarUna(d: {
  empresaId: string; facturaId: string; usuarioId: string; propia: boolean; para: string[]; asunto?: string; texto?: string; plantilla: string;
}): Promise<{ error: string | null; limite: boolean }> {
  const armado = await conEmpresa(d.empresaId, async (tx) => {
    const p = await prepararCorreo(tx, d.empresaId, d.facturaId, d.plantilla);
    const pdf = await pdfFactura(tx, d.facturaId, p.emisor, d.propia);
    return { p, pdf };
  });
  if (!armado.pdf) throw new Error("La factura no está emitida.");
  const { p, pdf } = armado;
  const asunto = (d.asunto || p.asunto).slice(0, 200);
  const cuerpo = (d.texto || p.texto).slice(0, 4000);
  const r = await enviarConDetalle({
    para: d.para.join(", "), asunto, titulo: p.titulo, parrafos: parrafosDe(cuerpo),
    pie: `${p.emisor.nombre}${p.emisor.rnc ? ` · RNC ${p.emisor.rnc}` : ""}${p.emisor.correo ? ` · ${p.emisor.correo}` : ""}`,
    adjuntos: [pdf], responderA: p.emisor.correo,
    remitente: d.propia ? "Empire Tax’N Legal" : p.emisor.nombre, encabezado: d.propia ? null : p.emisor.nombre,
  });
  const error = r.ok ? null : r.error;
  await conEmpresa(d.empresaId, (tx) => registrarCorreo(tx, {
    empresaId: d.empresaId, facturaId: d.facturaId, para: d.para.join(", "), responderA: p.emisor.correo, asunto, texto: cuerpo,
    usuarioId: d.usuarioId, error,
  }));
  return { error, limite: !r.ok && r.limite };
}

export async function enviarFacturaPorCorreo(empresaId: string, facturaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, empresa, propia } = await acceso(empresaId, "/facturas");
  if (!esUuid(facturaId)) return { error: "Factura no válida." };
  const para = leerDirecciones(texto(fd, "para"));
  if (!Array.isArray(para)) return para;
  const cuerpo = texto(fd, "texto");
  if (!cuerpo) return { error: "Escribe el texto del correo." };
  if (/\[[^\]\n]{1,40}\]/.test(cuerpo)) return { error: "El texto todavía tiene algo entre corchetes por llenar." };
  try {
    const r = await enviarUna({
      empresaId, facturaId, usuarioId: usuario.id, propia, para, asunto: texto(fd, "asunto"), texto: cuerpo, plantilla: await plantillaCorreo(empresa.firma_id),
    });
    revalidatePath(`/e/${empresaId}/facturas/${facturaId}`);
    return r.error ? { error: `No salió: ${r.error} Quedó anotado para volver a enviarlo.` } : { ok: `Enviada a ${para.join(", ")} con el PDF adjunto. Quedó en la bitácora.` };
  } catch (e) {
    return { error: mensajeError(e) };
  }
}

// «Enviar por correo las emitidas» en Igualas: cada iguala emitida del mes que no ha salido, con el texto predeterminado.
// Si Gmail frena por el límite del día se para ahí y las demás quedan para después.
export async function enviarIgualasPorCorreo(empresaId: string, periodo: string, _: Estado, _fd: FormData): Promise<Estado> {
  const { usuario, empresa, propia } = await acceso(empresaId, "/igualas");
  if (!esPeriodo(periodo)) return { error: "Mes no válido." };
  const pendientes = await conEmpresa(empresaId, (tx) => igualasPorCorreo(tx, periodo));
  if (!pendientes.length) return { ok: "No hay igualas emitidas de este mes por enviar." };
  const plantilla = await plantillaCorreo(empresa.firma_id);
  const enviadas: string[] = [], fallidas: string[] = [], sinCorreo: string[] = [];
  let frenado = false;
  for (const f of pendientes) {
    const para = f.email ? leerDirecciones(f.email) : null;
    if (!para || !Array.isArray(para)) { sinCorreo.push(f.cliente); continue; }
    if (frenado) { fallidas.push(f.cliente); continue; }
    try {
      const r = await enviarUna({ empresaId, facturaId: f.id, usuarioId: usuario.id, propia, para, plantilla });
      if (r.error) { fallidas.push(f.cliente); if (r.limite) frenado = true; } else enviadas.push(f.cliente);
    } catch {
      fallidas.push(f.cliente);
    }
  }
  revalidatePath(`/e/${empresaId}/igualas`);
  const partes = [
    enviadas.length ? `Se enviaron ${enviadas.length}.` : "",
    sinCorreo.length ? `Sin correo en Clientes: ${sinCorreo.join(", ")}.` : "",
    fallidas.length ? `No salieron: ${fallidas.join(", ")}${frenado ? " (Gmail llegó a su límite del día; vuelve a intentarlo mañana)" : ""}.` : "",
  ].filter(Boolean).join(" ");
  return fallidas.length || !enviadas.length ? { error: partes } : { ok: partes };
}
