"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { ErrorContable } from "@/lib/asientos";
import { enviarCorreo } from "@/lib/correo";
import { conEmpresa, db, mensajeError } from "@/lib/db";
import { huella, nombreSeguro, TAMANO_MAXIMO, tipoPorContenido } from "@/lib/documentos";
import { urlApp } from "@/lib/enlaces";
import { CATEGORIAS } from "@/lib/recepciones";
import { MENSAJE_XLS, MIME, tipoEstadoCuenta } from "@/lib/archivos-banco";
import type { Estado } from "../../acciones-cuenta";

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();

// El cliente (o alguien del equipo) sube uno o varios documentos a la bandeja de la empresa.
export async function subirDocumentos(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "adjuntar", "/recepcion");
  const categoria = texto(fd, "categoria");
  if (!CATEGORIAS[categoria]) return { error: "Elige qué tipo de documento es." };
  const archivos = fd.getAll("archivos").filter((a): a is File => a instanceof File && a.size > 0);
  if (archivos.length === 0) return { error: "Elige al menos un archivo." };
  if (archivos.length > 10) return { error: "Sube hasta 10 archivos a la vez." };
  const nota = texto(fd, "nota").slice(0, 500) || null;
  const leidos: { nombre: string; tipo: string; bytes: Uint8Array }[] = [];
  for (const a of archivos) {
    if (a.size > TAMANO_MAXIMO) return { error: `«${a.name}» pasa de 4 MB. Tómale la foto con menos resolución o divide el PDF.` };
    const bytes = new Uint8Array(await a.arrayBuffer());
    let tipo = tipoPorContenido(bytes);
    // Los estados bancarios también pueden venir en Excel, CSV u OFX, para importarlos en Bancos.
    if (!tipo && categoria === "estado_bancario") {
      const t = tipoEstadoCuenta(bytes);
      if (t === "xls") return { error: `«${a.name}»: ${MENSAJE_XLS}` };
      if (t) tipo = MIME[t];
    }
    if (!tipo) return { error: `«${a.name}» no es PDF, JPG ni PNG${categoria === "estado_bancario" ? " (ni Excel, CSV u OFX)" : ""}.` };
    leidos.push({ nombre: nombreSeguro(a.name), tipo, bytes });
  }
  try {
    await conEmpresa(empresaId, async (tx) => {
      for (const l of leidos) {
        await tx`INSERT INTO recepciones (empresa_id, categoria, nombre, tipo, tamano, sha256, contenido, nota, subido_por)
                 VALUES (${empresaId}, ${categoria}, ${l.nombre}, ${l.tipo}, ${l.bytes.length}, ${huella(l.bytes)}, ${Buffer.from(l.bytes)}, ${nota}, ${usuario.id})`;
      }
    });
  } catch (e) {
    const err = e as { code?: string };
    return { error: err.code === "23505" ? "Uno de esos archivos ya se había subido." : mensajeError(e) };
  }
  // Aviso por correo a la persona responsable del cliente (si no es quien lo subió).
  const [r] = await db()<{ email: string; nombre: string; id: string }[]>`
    SELECT u.id, u.email, u.nombre FROM empresas e JOIN usuarios u ON u.id = e.responsable_id WHERE e.id = ${empresaId}`;
  if (r && r.id !== usuario.id) {
    await enviarCorreo({
      para: r.email, asunto: `${empresa.nombre} subió ${leidos.length} documento${leidos.length > 1 ? "s" : ""}`,
      titulo: `Hola, ${r.nombre}`,
      parrafos: [`${usuario.nombre} subió ${leidos.length} documento${leidos.length > 1 ? "s" : ""} (${CATEGORIAS[categoria].toLowerCase()}) en ${empresa.nombre}.`,
                 ...(nota ? [`Nota: ${nota}`] : [])],
      boton: { texto: "Ver los documentos", url: `${await urlApp()}/e/${empresaId}/recepcion` },
    });
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  const esCliente = await soloCliente(empresa.firma_id, usuario.id);
  return { ok: `${leidos.length === 1 ? "Documento recibido" : `${leidos.length} documentos recibidos`}.${esCliente ? " Tu firma ya puede verlos." : ""}` };
}

// El equipo marca el documento como en proceso, procesado o descartado, con una respuesta opcional para el cliente.
export async function cambiarEstadoRecepcion(empresaId: string, recepcionId: string, estado: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/recepcion");
  if (!esUuid(recepcionId) || !["en_proceso", "procesado", "descartado", "nuevo"].includes(estado)) return { error: "Datos no válidos." };
  const respuesta = texto(fd, "respuesta").slice(0, 500) || null;
  try {
    await conEmpresa(empresaId, async (tx) => {
      const final = estado === "procesado" || estado === "descartado";
      const r = await tx`UPDATE recepciones SET estado = ${estado}, respuesta = COALESCE(${respuesta}, respuesta),
                                procesado_por = ${final ? usuario.id : null}, procesado_en = ${final ? new Date() : null}
                          WHERE id = ${recepcionId}`;
      if (r.count === 0) throw new ErrorContable("Documento no encontrado");
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: "Listo." };
}
