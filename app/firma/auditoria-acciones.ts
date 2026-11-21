"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import {
  agregarPasos, cambiarEstadoAuditoria, crearAuditoria, crearHallazgo, ErrorAuditoria, estadoDeHallazgo, guardarAuditoria, guardarHallazgo, leerAuditoria, leerHallazgo,
  leerPasosTexto, marcarPaso, quitarPaso, retirarEvidencia,
} from "@/lib/auditorias";
import { clienteDeFormulario } from "@/lib/cliente-rapido";
import { conEmpresa, db, mensajeError } from "@/lib/db";
import { ErrorExpediente, guardarArchivos, leerArchivos } from "@/lib/expediente";
import type { Permiso } from "@/lib/permisos";
import type { Estado } from "../acciones-cuenta";

// Prioridad 3 · P3j · Auditoría. Se ve y se trabaja desde las pantallas de la firma; cada acción pide su permiso en el cliente (pestaña Expediente y trámites):
// «registrar» para el plan, los pasos y los hallazgos, «adjuntar» para las pruebas, «cerrar» para cerrar la auditoría y «reabrir» para abrirla de nuevo.

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();
const mensaje = (e: unknown) => (e instanceof ErrorAuditoria || e instanceof ErrorExpediente ? e.message : mensajeError(e));
const ruta = (firmaId: string, empresaId: string, auditoriaId: string) => `/firma/${firmaId}/auditoria/${empresaId}/${auditoriaId}`;

// Que el responsable y el equipo sean gente de la firma.
async function delEquipo(firmaId: string, usuarios: string[]) {
  const ids = [...new Set(usuarios.filter(Boolean))];
  if (!ids.length) return;
  const [{ n }] = await db()<{ n: number }[]>`SELECT count(*)::int AS n FROM miembros_firma WHERE firma_id = ${firmaId} AND usuario_id IN ${db()(ids)}`;
  if (n !== ids.length) throw new ErrorAuditoria("Esa persona no es del equipo de la firma.");
}

async function acceso(firmaId: string, empresaId: string, auditoriaId: string | null, permiso: Permiso) {
  if (!esUuid(empresaId) || (auditoriaId !== null && !esUuid(auditoriaId))) throw new ErrorAuditoria("Esa auditoría no existe.");
  const a = await exigirPermiso(empresaId, permiso, "/expediente");
  if (a.empresa.firma_id !== firmaId) throw new ErrorAuditoria("Ese cliente no es de la firma.");
  if (await soloCliente(firmaId, a.usuario.id)) throw new ErrorAuditoria("Solo el equipo de la firma trabaja las auditorías.");
  return a;
}

const listo = (firmaId: string, empresaId: string, auditoriaId: string, ok: string): Estado => {
  revalidatePath(ruta(firmaId, empresaId, auditoriaId));
  revalidatePath(`/firma/${firmaId}/auditoria`);
  return { ok };
};

export async function crearAuditoriaAccion(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  let destino = "";
  try {
    const d = leerAuditoria(fd);
    const pasos = leerPasosTexto(String(fd.get("pasos") ?? ""));
    const empresaId = (await clienteDeFormulario(firmaId, fd)).id;
    const { usuario } = await acceso(firmaId, empresaId, null, "registrar");
    await delEquipo(firmaId, [...(d.responsable ? [d.responsable] : []), ...d.equipo]);
    const id = await conEmpresa(empresaId, (tx) => crearAuditoria(tx, { ...d, empresaId, usuarioId: usuario.id, pasos }));
    destino = `${ruta(firmaId, empresaId, id)}?creada=1`;
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath(`/firma/${firmaId}/auditoria`);
  redirect(destino);
}

export async function guardarAuditoriaAccion(firmaId: string, empresaId: string, auditoriaId: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    await acceso(firmaId, empresaId, auditoriaId, "registrar");
    const d = leerAuditoria(fd);
    await delEquipo(firmaId, [...(d.responsable ? [d.responsable] : []), ...d.equipo]);
    await conEmpresa(empresaId, (tx) => guardarAuditoria(tx, auditoriaId, d));
  } catch (e) {
    return { error: mensaje(e) };
  }
  return listo(firmaId, empresaId, auditoriaId, "Plan guardado.");
}

export async function cambiarEstadoAuditoriaAccion(firmaId: string, empresaId: string, auditoriaId: string, estado: string): Promise<Estado> {
  try {
    // Cerrar y reabrir tienen su propio permiso.
    const permiso: Permiso = estado === "cerrada" ? "cerrar" : "registrar";
    let a = await acceso(firmaId, empresaId, auditoriaId, permiso);
    const actual = await conEmpresa(empresaId, async (tx) => (await tx<{ estado: string }[]>`SELECT estado FROM auditorias WHERE id = ${auditoriaId}`)[0]?.estado);
    if (actual === "cerrada") a = await acceso(firmaId, empresaId, auditoriaId, "reabrir");
    await conEmpresa(empresaId, (tx) => cambiarEstadoAuditoria(tx, auditoriaId, estado, a.usuario.id));
  } catch (e) {
    return { error: mensaje(e) };
  }
  return listo(firmaId, empresaId, auditoriaId, "Estado cambiado.");
}

export async function agregarPasosAccion(firmaId: string, empresaId: string, auditoriaId: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { usuario } = await acceso(firmaId, empresaId, auditoriaId, "registrar");
    const pasos = leerPasosTexto(String(fd.get("pasos") ?? ""));
    const responsable = texto(fd, "responsable") || null;
    if (responsable) await delEquipo(firmaId, [responsable]);
    await conEmpresa(empresaId, (tx) => agregarPasos(tx, { empresaId, auditoriaId, usuarioId: usuario.id, pasos, responsable }));
  } catch (e) {
    return { error: mensaje(e) };
  }
  return listo(firmaId, empresaId, auditoriaId, "Pasos agregados.");
}

export async function marcarPasoAccion(firmaId: string, empresaId: string, auditoriaId: string, pasoId: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { usuario } = await acceso(firmaId, empresaId, auditoriaId, "registrar");
    if (!esUuid(pasoId)) throw new ErrorAuditoria("Ese paso no existe.");
    await conEmpresa(empresaId, (tx) => marcarPaso(tx, { id: pasoId, auditoriaId, estado: texto(fd, "estado"), nota: texto(fd, "nota"), usuarioId: usuario.id }));
  } catch (e) {
    return { error: mensaje(e) };
  }
  return listo(firmaId, empresaId, auditoriaId, "Paso actualizado.");
}

export async function quitarPasoAccion(firmaId: string, empresaId: string, auditoriaId: string, pasoId: string): Promise<Estado> {
  try {
    await acceso(firmaId, empresaId, auditoriaId, "registrar");
    if (!esUuid(pasoId)) throw new ErrorAuditoria("Ese paso no existe.");
    await conEmpresa(empresaId, (tx) => quitarPaso(tx, pasoId, auditoriaId));
  } catch (e) {
    return { error: mensaje(e) };
  }
  return listo(firmaId, empresaId, auditoriaId, "Paso quitado.");
}

// Crear (hallazgoId = null) o corregir un hallazgo, con sus archivos de prueba (hasta 5 por envío: fotos, PDF, Word o Excel).
export async function guardarHallazgoAccion(firmaId: string, empresaId: string, auditoriaId: string, hallazgoId: string | null, _: Estado, fd: FormData): Promise<Estado> {
  let destino = "";
  try {
    const { usuario } = await acceso(firmaId, empresaId, auditoriaId, "registrar");
    if (hallazgoId !== null && !esUuid(hallazgoId)) throw new ErrorAuditoria("Ese hallazgo no existe.");
    const d = leerHallazgo(fd);
    const archivos = await leerArchivos(fd, "archivo", 5);
    if (archivos.length) await acceso(firmaId, empresaId, auditoriaId, "adjuntar");
    await conEmpresa(empresaId, async (tx) => {
      const id = hallazgoId ?? await crearHallazgo(tx, { ...d, empresaId, auditoriaId, usuarioId: usuario.id });
      if (hallazgoId) await guardarHallazgo(tx, { ...d, id, auditoriaId });
      await guardarArchivos(tx, { empresaId, usuarioId: usuario.id, archivos, entidad: "auditoria", entidadId: id, carpeta: null, anio: null, descripcion: d.titulo.slice(0, 120) });
      if (!hallazgoId) destino = `${ruta(firmaId, empresaId, auditoriaId)}?hallazgo=${id}#h-${id}`;
    });
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath(ruta(firmaId, empresaId, auditoriaId));
  revalidatePath(`/firma/${firmaId}/auditoria`);
  if (destino) redirect(destino);
  return { ok: "Hallazgo guardado." };
}

export async function estadoHallazgoAccion(firmaId: string, empresaId: string, auditoriaId: string, hallazgoId: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    await acceso(firmaId, empresaId, auditoriaId, "registrar");
    if (!esUuid(hallazgoId)) throw new ErrorAuditoria("Ese hallazgo no existe.");
    await conEmpresa(empresaId, (tx) => estadoDeHallazgo(tx, { id: hallazgoId, auditoriaId, estado: texto(fd, "estado"), respuesta: texto(fd, "respuesta") }));
  } catch (e) {
    return { error: mensaje(e) };
  }
  return listo(firmaId, empresaId, auditoriaId, "Hallazgo actualizado.");
}

// Pruebas de la auditoría en general (no de un hallazgo en particular).
export async function agregarPruebasAccion(firmaId: string, empresaId: string, auditoriaId: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { usuario } = await acceso(firmaId, empresaId, auditoriaId, "adjuntar");
    const archivos = await leerArchivos(fd, "archivo", 5);
    if (!archivos.length) throw new ErrorAuditoria("Elige al menos un archivo.");
    const descripcion = texto(fd, "descripcion").slice(0, 120) || null;
    await conEmpresa(empresaId, async (tx) => {
      const [a] = await tx<{ estado: string }[]>`SELECT estado FROM auditorias WHERE id = ${auditoriaId}`;
      if (!a) throw new ErrorAuditoria("Esa auditoría no existe.");
      if (a.estado === "cerrada") throw new ErrorAuditoria("La auditoría está cerrada: reábrela para agregar archivos.");
      await guardarArchivos(tx, { empresaId, usuarioId: usuario.id, archivos, entidad: "auditoria", entidadId: auditoriaId, carpeta: null, anio: null, descripcion });
    });
  } catch (e) {
    return { error: mensaje(e) };
  }
  return listo(firmaId, empresaId, auditoriaId, "Archivos guardados.");
}

// Agrega pruebas a un hallazgo que ya existe.
export async function agregarPruebasHallazgoAccion(firmaId: string, empresaId: string, auditoriaId: string, hallazgoId: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { usuario } = await acceso(firmaId, empresaId, auditoriaId, "adjuntar");
    if (!esUuid(hallazgoId)) throw new ErrorAuditoria("Ese hallazgo no existe.");
    const archivos = await leerArchivos(fd, "archivo", 5);
    if (!archivos.length) throw new ErrorAuditoria("Elige al menos un archivo.");
    const descripcion = texto(fd, "descripcion").slice(0, 120) || null;
    await conEmpresa(empresaId, async (tx) => {
      const [h] = await tx<{ estado: string }[]>`
        SELECT a.estado FROM auditoria_hallazgos h JOIN auditorias a ON a.id = h.auditoria_id WHERE h.id = ${hallazgoId} AND h.auditoria_id = ${auditoriaId}`;
      if (!h) throw new ErrorAuditoria("Ese hallazgo no existe.");
      if (h.estado === "cerrada") throw new ErrorAuditoria("La auditoría está cerrada: reábrela para agregar archivos.");
      await guardarArchivos(tx, { empresaId, usuarioId: usuario.id, archivos, entidad: "auditoria", entidadId: hallazgoId, carpeta: null, anio: null, descripcion });
    });
  } catch (e) {
    return { error: mensaje(e) };
  }
  return listo(firmaId, empresaId, auditoriaId, "Archivos guardados.");
}

export async function retirarPruebaAccion(firmaId: string, empresaId: string, auditoriaId: string, documentoId: string): Promise<Estado> {
  try {
    const { usuario } = await acceso(firmaId, empresaId, auditoriaId, "adjuntar");
    if (!esUuid(documentoId)) throw new ErrorAuditoria("Ese archivo no existe.");
    await conEmpresa(empresaId, (tx) => retirarEvidencia(tx, documentoId, usuario.id));
  } catch (e) {
    return { error: mensaje(e) };
  }
  return listo(firmaId, empresaId, auditoriaId, "Archivo retirado.");
}
