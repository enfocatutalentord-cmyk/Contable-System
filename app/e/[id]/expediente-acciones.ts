"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { conEmpresa, db, mensajeError } from "@/lib/db";
import { ErrorExpediente, esCarpeta, guardarArchivos, leerArchivos, retirarDelExpediente } from "@/lib/expediente";
import { abrirConstitucion, cerrarTramite, ErrorTramite, ESTADOS_PASO, leerTramite, PASOS } from "@/lib/tramites";
import type { Estado } from "../../acciones-cuenta";

// Bloque 5, entrega 5a: subir y retirar documentos del expediente, trámites y pasos de la empresa nueva.

const mensaje = (e: unknown) => (e instanceof ErrorExpediente || e instanceof ErrorTramite ? e.message : mensajeError(e));
const ruta = (id: string) => revalidatePath(`/e/${id}/expediente`);

async function delEquipo(firmaId: string, usuarioId: string | null) {
  if (!usuarioId) return null;
  if (!esUuid(usuarioId)) throw new ErrorTramite("Elige el responsable de la lista.");
  const [m] = await db()`SELECT 1 FROM miembros_firma WHERE firma_id = ${firmaId} AND usuario_id = ${usuarioId}`;
  if (!m) throw new ErrorTramite("Esa persona no es del equipo de la firma.");
  return usuarioId;
}

export async function subirExpediente(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "adjuntar", "/expediente");
  const carpeta = String(fd.get("carpeta") ?? "");
  const anioTexto = String(fd.get("anio") ?? "").trim();
  const anio = anioTexto ? Number(anioTexto) : null;
  const descripcion = String(fd.get("descripcion") ?? "").trim().slice(0, 300) || null;
  if (!esCarpeta(carpeta)) return { error: "Elige la carpeta." };
  if (anio !== null && !(Number.isInteger(anio) && anio >= 1990 && anio <= 2100)) return { error: "El año no es válido." };
  try {
    const archivos = await leerArchivos(fd);
    if (archivos.length === 0) return { error: "Elige al menos un archivo." };
    await conEmpresa(empresaId, (tx) => guardarArchivos(tx, { empresaId, usuarioId: usuario.id, archivos, carpeta, anio, descripcion }));
    ruta(empresaId);
    return { ok: archivos.length === 1 ? "Documento guardado en el expediente." : `${archivos.length} documentos guardados en el expediente.` };
  } catch (e) {
    return { error: mensaje(e) };
  }
}

export async function retirarDocumento(empresaId: string, documentoId: string, volver: boolean): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/expediente");
  if (!esUuid(documentoId)) return { error: "Ese documento no existe." };
  try {
    await conEmpresa(empresaId, (tx) => retirarDelExpediente(tx, documentoId, usuario.id, volver));
  } catch (e) {
    return { error: mensaje(e) };
  }
  ruta(empresaId);
  return { ok: volver ? "Documento devuelto al expediente." : "Documento retirado (se puede devolver desde «Ver retirados»)." };
}

export async function registrarTramite(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "registrar", "/expediente");
  try {
    const t = leerTramite(fd);
    const responsable = await delEquipo(empresa.firma_id, t.responsable);
    const archivos = await leerArchivos(fd, "volante", 3);
    await conEmpresa(empresaId, async (tx) => {
      const [{ id }] = await tx<{ id: string }[]>`
        INSERT INTO tramites (empresa_id, institucion, tipo, numero, descripcion, fecha, plazo, responsable_id, creado_por)
        VALUES (${empresaId}, ${t.institucion}, ${t.tipo}, ${t.numero}, ${t.descripcion}, ${t.fecha}, ${t.plazo}, ${responsable}, ${usuario.id}) RETURNING id`;
      await guardarArchivos(tx, { empresaId, usuarioId: usuario.id, archivos, entidad: "tramite", entidadId: id, carpeta: null, anio: null, descripcion: "Volante de recepción" });
    });
  } catch (e) {
    return { error: mensaje(e) };
  }
  ruta(empresaId);
  revalidatePath(`/firma/${empresa.firma_id}/tramites`);
  return { ok: "Trámite registrado: avisará antes de que venza el plazo." };
}

export async function cerrarTramiteAccion(empresaId: string, tramiteId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "registrar", "/expediente");
  if (!esUuid(tramiteId)) return { error: "Ese trámite no existe." };
  const respuesta = String(fd.get("respuesta") ?? "").trim().slice(0, 1000) || null;
  try {
    const archivos = await leerArchivos(fd, "documento", 3);
    await conEmpresa(empresaId, async (tx) => {
      await cerrarTramite(tx, tramiteId, respuesta, usuario.id);
      await guardarArchivos(tx, { empresaId, usuarioId: usuario.id, archivos, entidad: "tramite", entidadId: tramiteId, carpeta: null, anio: null, descripcion: "Respuesta" });
    });
  } catch (e) {
    return { error: mensaje(e) };
  }
  ruta(empresaId);
  revalidatePath(`/firma/${empresa.firma_id}/tramites`);
  return { ok: "Trámite cerrado." };
}

export async function abrirConstitucionAccion(empresaId: string): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/expediente");
  try {
    await conEmpresa(empresaId, (tx) => abrirConstitucion(tx, empresaId));
  } catch (e) {
    return { error: mensaje(e) };
  }
  ruta(empresaId);
  return { ok: "Lista de pasos de la empresa nueva abierta." };
}

export async function guardarPaso(empresaId: string, paso: number, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "registrar", "/expediente");
  const estado = String(fd.get("estado") ?? "");
  const fecha = String(fd.get("fecha") ?? "").trim() || null;
  const nota = String(fd.get("nota") ?? "").trim().slice(0, 500) || null;
  if (!Number.isInteger(paso) || paso < 1 || paso > PASOS.length) return { error: "Paso no válido." };
  if (!(estado in ESTADOS_PASO)) return { error: "Elige el estado." };
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: "La fecha no es válida." };
  try {
    const responsable = await delEquipo(empresa.firma_id, String(fd.get("responsable") ?? "") || null);
    const archivos = await leerArchivos(fd, "documento", 1);
    await conEmpresa(empresaId, async (tx) => {
      const [doc] = await guardarArchivos(tx, { empresaId, usuarioId: usuario.id, archivos, carpeta: "01", anio: null, descripcion: `Paso ${paso}: ${PASOS[paso - 1]}` });
      const r = await tx`UPDATE pasos_constitucion SET estado = ${estado}, fecha = ${fecha ?? (estado === "hecho" ? new Date().toISOString().slice(0, 10) : null)},
                           responsable_id = ${responsable}, nota = ${nota}, documento_id = COALESCE(${doc ?? null}::uuid, documento_id)
                         WHERE empresa_id = ${empresaId} AND paso = ${paso}`;
      if (!r.count) throw new ErrorTramite("Abre primero la lista de pasos.");
    });
  } catch (e) {
    return { error: mensaje(e) };
  }
  ruta(empresaId);
  return { ok: `Paso ${paso} guardado.` };
}
