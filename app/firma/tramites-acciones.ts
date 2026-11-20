"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accesoFirma, esUuid, exigirPermiso } from "@/lib/acceso";
import { conEmpresa, db, mensajeError } from "@/lib/db";
import { crearEmpresa, leerFicha } from "@/lib/empresas";
import { ErrorExpediente, guardarArchivos, leerArchivos } from "@/lib/expediente";
import { hoyISO } from "@/lib/montos";
import {
  cambiarEtapa, crearTramiteNuevo, ErrorTramite, esEtapa, feriadosDe, guardarPlantilla, INSTITUCIONES, leerPasos, plantillasDe,
} from "@/lib/tramites";
import { sumarLaborables } from "@/lib/dias-laborables";
import type { Estado } from "../acciones-cuenta";

// Prioridad 1.5 del prompt de Patricia (20-nov-2026): crear y seguir trámites desde «Trámites abiertos». Piden el permiso «registrar» en el
// expediente del cliente, como los trámites de antes.

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();
const mensaje = (e: unknown) => (e instanceof ErrorTramite || e instanceof ErrorExpediente ? e.message : mensajeError(e));
const entero = (v: string) => (/^\d{1,3}$/.test(v) ? Number(v) : null);
const ruta = (firmaId: string, empresaId: string, tramiteId: string) => `/firma/${firmaId}/tramites/${empresaId}/${tramiteId}`;

async function delEquipo(firmaId: string, usuarioId: string | null) {
  if (!usuarioId) return null;
  if (!esUuid(usuarioId)) throw new ErrorTramite("Elige el responsable de la lista.");
  const [m] = await db()`SELECT 1 FROM miembros_firma WHERE firma_id = ${firmaId} AND usuario_id = ${usuarioId}`;
  if (!m) throw new ErrorTramite("Esa persona no es del equipo de la firma.");
  return usuarioId;
}

// El cliente elegido o, si es nuevo, un alta rápida con su nombre (y el RNC o cédula si lo tiene).
async function clienteDelTramite(firmaId: string, fd: FormData): Promise<string> {
  const { usuario, firma } = await accesoFirma(firmaId, false);
  const elegido = texto(fd, "empresa");
  if (elegido && elegido !== "nuevo") {
    if (!esUuid(elegido)) throw new ErrorTramite("Elige el cliente.");
    return elegido;
  }
  if (!firma.crear_clientes) throw new ErrorTramite("Crear clientes no está entre tus permisos: elige uno de la lista.");
  const datos = new FormData();
  datos.set("nombre", texto(fd, "cliente_nombre"));
  const rnc = texto(fd, "cliente_rnc").replace(/[-\s]/g, "");
  datos.set("tipo_identificacion", rnc.length === 11 ? "cedula" : "rnc");
  datos.set("rnc", rnc);
  const ficha = leerFicha(datos);
  if (typeof ficha === "string") throw new ErrorTramite(ficha === "Escribe la razón social o el nombre de la empresa." ? "Elige el cliente o escribe el nombre del nuevo." : ficha);
  const id = await crearEmpresa({ firmaId, usuarioId: usuario.id, ficha });
  if (!firma.administrador) {
    await db()`UPDATE empresas SET responsable_id = COALESCE(responsable_id, ${usuario.id}) WHERE id = ${id}`;
    await db()`UPDATE miembros_firma SET clientes = array_append(clientes, ${id}::uuid)
                WHERE firma_id = ${firmaId} AND usuario_id = ${usuario.id} AND alcance = 'elegidos' AND NOT (${id}::uuid = ANY (clientes))`;
  }
  return id;
}

export async function crearTramiteAccion(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  let destino = "";
  try {
    const plantillaId = texto(fd, "plantilla");
    const plantilla = plantillaId ? (await plantillasDe(firmaId)).find((p) => p.id === plantillaId) ?? null : null;
    if (plantillaId && !plantilla) throw new ErrorTramite("Esa plantilla no existe.");
    const nombre = (texto(fd, "nombre") || plantilla?.nombre || "").replace(/\s+/g, " ").slice(0, 120);
    if (!nombre) throw new ErrorTramite("Escribe el nombre del trámite o elige uno de la lista.");
    const institucion = texto(fd, "institucion") || plantilla?.institucion || "otra";
    if (!(institucion in INSTITUCIONES)) throw new ErrorTramite("Elige la institución.");
    const dias = entero(texto(fd, "dias")) ?? plantilla?.dias_estimados ?? null;
    if (!dias || dias < 1) throw new ErrorTramite("Escribe el tiempo estimado en días laborables.");
    const etapa = texto(fd, "etapa") || "pendiente";
    if (!esEtapa(etapa)) throw new ErrorTramite("Elige el estado.");
    const pasosEscritos = leerPasos(texto(fd, "pasos"));
    const pasos = pasosEscritos.length ? pasosEscritos : plantilla?.pasos ?? [];
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(texto(fd, "fecha")) ? texto(fd, "fecha") : hoyISO();
    const empresaId = await clienteDelTramite(firmaId, fd);
    const { usuario, empresa } = await exigirPermiso(empresaId, "registrar", "/expediente");
    if (empresa.firma_id !== firmaId) throw new ErrorTramite("Ese cliente no es de la firma.");
    const responsable = await delEquipo(firmaId, texto(fd, "responsable") || null);
    const feriados = await feriadosDe(firmaId);
    // La primera vez que se usa un nombre, el trámite se guarda como plantilla con sus pasos y tiempos.
    const nuevaPlantilla = !plantilla && !(await plantillasDe(firmaId)).some((p) => p.nombre.toLowerCase() === nombre.toLowerCase());
    const idPlantilla = plantilla?.id ?? (nuevaPlantilla ? await guardarPlantilla(firmaId, usuario.id, { nombre, institucion, dias, pasos }) : null);
    const id = await conEmpresa(empresaId, (tx) => crearTramiteNuevo(tx, {
      empresaId, usuarioId: usuario.id, nombre, institucion, fecha, dias, etapa, esperaMotivo: texto(fd, "espera_motivo") || null,
      esperaDias: entero(texto(fd, "espera_dias")), responsable, pasos, plantillaId: idPlantilla, feriados,
    }));
    destino = `${ruta(firmaId, empresaId, id)}?creado=${nuevaPlantilla ? "plantilla" : "1"}`;
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath(`/firma/${firmaId}`, "layout");
  redirect(destino);
}

async function delTramite(firmaId: string, empresaId: string, tramiteId: string) {
  if (!esUuid(empresaId) || !esUuid(tramiteId)) throw new ErrorTramite("Ese trámite no existe.");
  const acceso = await exigirPermiso(empresaId, "registrar", "/expediente");
  if (acceso.empresa.firma_id !== firmaId) throw new ErrorTramite("Ese trámite no es de la firma.");
  return acceso;
}

const listo = (firmaId: string, empresaId: string, tramiteId: string, ok: string): Estado => {
  revalidatePath(ruta(firmaId, empresaId, tramiteId));
  revalidatePath(`/firma/${firmaId}/tramites`);
  return { ok };
};

export async function cambiarEtapaAccion(firmaId: string, empresaId: string, tramiteId: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { usuario } = await delTramite(firmaId, empresaId, tramiteId);
    const etapa = texto(fd, "etapa");
    if (!esEtapa(etapa)) throw new ErrorTramite("Elige el estado.");
    const feriados = await feriadosDe(firmaId);
    await conEmpresa(empresaId, (tx) => cambiarEtapa(tx, {
      id: tramiteId, etapa, esperaMotivo: texto(fd, "espera_motivo") || null, esperaDias: entero(texto(fd, "espera_dias")),
      usuarioId: usuario.id, hoy: hoyISO(), feriados, respuesta: texto(fd, "respuesta").slice(0, 1000) || null,
    }));
  } catch (e) {
    return { error: mensaje(e) };
  }
  return listo(firmaId, empresaId, tramiteId, "Estado cambiado.");
}

export async function agregarNotaAccion(firmaId: string, empresaId: string, tramiteId: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { usuario } = await delTramite(firmaId, empresaId, tramiteId);
    const nota = texto(fd, "texto").slice(0, 1000);
    if (nota.length < 2) throw new ErrorTramite("Escribe la nota.");
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(texto(fd, "fecha")) ? texto(fd, "fecha") : hoyISO();
    await conEmpresa(empresaId, async (tx) => {
      await tx`INSERT INTO notas_tramite (empresa_id, tramite_id, fecha, texto, creado_por) VALUES (${empresaId}, ${tramiteId}, ${fecha}, ${nota}, ${usuario.id})`;
      const archivos = await leerArchivos(fd, "archivo", 3);
      await guardarArchivos(tx, { empresaId, usuarioId: usuario.id, archivos, entidad: "tramite", entidadId: tramiteId, carpeta: null, anio: null,
        descripcion: nota.slice(0, 120) });
    });
  } catch (e) {
    return { error: mensaje(e) };
  }
  return listo(firmaId, empresaId, tramiteId, "Nota guardada.");
}

export async function agregarPendienteAccion(firmaId: string, empresaId: string, tramiteId: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { usuario } = await delTramite(firmaId, empresaId, tramiteId);
    const que = texto(fd, "texto").slice(0, 300);
    if (que.length < 2) throw new ErrorTramite("Escribe el pendiente.");
    const dia = entero(texto(fd, "dia"));
    const feriados = await feriadosDe(firmaId);
    await conEmpresa(empresaId, async (tx) => {
      const [t] = await tx<{ fecha: string }[]>`SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha FROM tramites WHERE id = ${tramiteId}`;
      if (!t) throw new ErrorTramite("Ese trámite no existe.");
      await tx`INSERT INTO pendientes_tramite (empresa_id, tramite_id, orden, texto, dia, vence, creado_por)
               VALUES (${empresaId}, ${tramiteId}, (SELECT COALESCE(max(orden), -1) + 1 FROM pendientes_tramite WHERE tramite_id = ${tramiteId}),
                       ${que}, ${dia}, ${dia === null ? null : sumarLaborables(t.fecha, dia, feriados)}, ${usuario.id})`;
    });
  } catch (e) {
    return { error: mensaje(e) };
  }
  return listo(firmaId, empresaId, tramiteId, "Pendiente agregado.");
}

export async function marcarPendienteAccion(firmaId: string, empresaId: string, tramiteId: string, pendienteId: string, hecho: boolean): Promise<Estado> {
  try {
    const { usuario } = await delTramite(firmaId, empresaId, tramiteId);
    if (!esUuid(pendienteId)) throw new ErrorTramite("Ese pendiente no existe.");
    await conEmpresa(empresaId, (tx) => tx`
      UPDATE pendientes_tramite SET hecho = ${hecho}, hecho_por = ${hecho ? usuario.id : null}, hecho_en = ${hecho ? new Date() : null}
       WHERE id = ${pendienteId} AND tramite_id = ${tramiteId}`);
  } catch (e) {
    return { error: mensaje(e) };
  }
  return listo(firmaId, empresaId, tramiteId, hecho ? "Pendiente tachado." : "Pendiente abierto otra vez.");
}

// Guardar los pasos y el tiempo de este trámite como su plantilla (la próxima vez solo se elige).
export async function guardarComoPlantillaAccion(firmaId: string, empresaId: string, tramiteId: string): Promise<Estado> {
  try {
    const { usuario } = await delTramite(firmaId, empresaId, tramiteId);
    const datos = await conEmpresa(empresaId, async (tx) => {
      const [t] = await tx<{ tipo: string; institucion: string; dias: number | null; fecha: string; plazo: string }[]>`
        SELECT tipo, institucion, dias_estimados AS dias, to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(plazo, 'YYYY-MM-DD') AS plazo FROM tramites WHERE id = ${tramiteId}`;
      const pasos = await tx<{ texto: string; dia: number | null }[]>`SELECT texto, dia FROM pendientes_tramite WHERE tramite_id = ${tramiteId} ORDER BY orden, creado`;
      return { t, pasos };
    });
    if (!datos.t) throw new ErrorTramite("Ese trámite no existe.");
    const dias = datos.t.dias ?? Math.max(1, Math.round((Date.parse(datos.t.plazo) - Date.parse(datos.t.fecha)) / 86400000));
    await guardarPlantilla(firmaId, usuario.id, { nombre: datos.t.tipo, institucion: datos.t.institucion, dias, pasos: datos.pasos });
  } catch (e) {
    return { error: mensaje(e) };
  }
  return listo(firmaId, empresaId, tramiteId, "Plantilla guardada: la próxima vez elige este trámite de la lista y trae estos pasos y tiempos.");
}

// Feriados de la firma (los de 2026 vienen cargados; se agregan los de 2027 y se corrigen los traslados).
export async function agregarFeriadoAccion(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  await accesoFirma(firmaId);
  const fecha = texto(fd, "fecha"), nombre = texto(fd, "nombre").slice(0, 120);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !nombre) return { error: "Escribe la fecha y el nombre del feriado." };
  await db()`INSERT INTO feriados (firma_id, fecha, nombre) VALUES (${firmaId}, ${fecha}, ${nombre})
             ON CONFLICT (firma_id, fecha) DO UPDATE SET nombre = EXCLUDED.nombre`;
  revalidatePath(`/firma/${firmaId}/tramites`);
  return { ok: "Feriado guardado. Los trámites nuevos lo cuentan." };
}

export async function quitarFeriadoAccion(firmaId: string, fecha: string): Promise<Estado> {
  await accesoFirma(firmaId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: "Fecha no válida." };
  await db()`DELETE FROM feriados WHERE firma_id = ${firmaId} AND fecha = ${fecha}`;
  revalidatePath(`/firma/${firmaId}/tramites`);
  return { ok: "Feriado quitado." };
}

