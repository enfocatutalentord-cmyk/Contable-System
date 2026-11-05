import { createHash, randomBytes } from "node:crypto";
import { aCentavos, deCentavos, leerMonto } from "./montos.ts";
import { db, type Tx } from "./db.ts";
import { type Archivo, guardarArchivos } from "./expediente.ts";
import { categoriaSugerida, ErrorFicha, guardarSocios, leerContactos, leerOperaciones, leerSociedad, leerSocios, ROLES_CONTACTO } from "./ficha.ts";
import { abrirConstitucion } from "./tramites.ts";

// Bloque 6, entrega 6a: formularios en línea (Documento maestro, sección 6). El cliente los llena desde un enlace seguro sin
// cuenta; lo que envía queda en `formularios.respuestas` (los mismos nombres de campo que la ficha) y espera revisión. Al aceptar
// una sección se carga con los mismos lectores de la ficha, así las reglas (cédulas, 100 %, fechas) son las mismas.

export const TIPOS_FORMULARIO: Record<string, { nombre: string; codigo: string; mensaje: string; carpeta: string }> = {
  ficha: { nombre: "Ficha de Registro", codigo: "EMP-F01", mensaje: "ficha_registro", carpeta: "01" },
  constitucion: { nombre: "Formulario de Constitución", codigo: "EMP-F03", mensaje: "constitucion", carpeta: "01" },
  solicitud: { nombre: "Solicitud de Servicio", codigo: "EMP-F04", mensaje: "solicitud_servicio", carpeta: "06" },
};
export const ESTADOS_FORMULARIO: Record<string, string> = { pendiente: "Enviado, sin respuesta", recibido: "Recibido, por revisar", aceptado: "Aceptado", descartado: "Descartado" };
export const SECCIONES_FICHA: Record<string, string> = {
  empresa: "Datos de la empresa", sociedad: "Sociedad", socios: "Socios", contactos: "Contactos", operaciones: "Operaciones", adjuntos: "Documentos adjuntos",
};
export const PRIORIDADES: Record<string, string> = { alta: "Alta", media: "Media", baja: "Baja" };
export const ESTADOS_SOLICITUD: Record<string, string> = { recibida: "Recibida", cotizada: "Cotizada", en_proceso: "En proceso", entregada: "Entregada", descartada: "Descartada" };
export const ORIGENES_SOLICITUD: Record<string, string> = { formulario: "Formulario en línea", whatsapp: "WhatsApp", escrito: "Por escrito", llamada: "Llamada o reunión", app: "Aplicación" };
export const CAPITAL_MINIMO = 10_000_000n; // RD$100,000 en centavos (Documento maestro, sección 6)
export const MAX_SOCIOS_FORMULARIO = 10;
export const DIAS_ENLACE = 30;

export class ErrorFormulario extends Error {}

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const nuevoToken = () => randomBytes(24).toString("base64url");

// Campos que se aceptan de cada formulario (lo demás se ignora).
const SOCIOS = Array.from({ length: MAX_SOCIOS_FORMULARIO }, (_, i) => ["nombre", "cedula", "telefono", "porcentaje"].map((k) => `s${i}_${k}`)).flat();
const CONTACTO = (rol: string) => ["nombre", "cedula", "cargo", "telefono", "whatsapp", "correo", "nacimiento"].map((k) => `c_${rol}_${k}`);
export const CAMPOS_FORMULARIO: Record<string, string[]> = {
  ficha: ["nombre", "nombre_comercial", "rnc", "direccion", "telefono", "correo", "tipo_sociedad", "fecha_constitucion", "municipio", "provincia",
    "capital_social", ...SOCIOS, ...ROLES_CONTACTO.flatMap(([r]) => CONTACTO(r)), "grupo_whatsapp", "ventas_mes", "facturas_mes", "empleados_mes",
    "tiene_tss", "emite_ecf", "sistema_usa"],
  constitucion: ["n1", "n2", "n3", "actividad", "direccion", "capital_social", ...SOCIOS, ...CONTACTO("gerente"), "tiene_tss", "notas"],
  solicitud: ["servicio_id", "servicio", "descripcion", "para_que", "fecha_requerida", "prioridad"],
};

const aFormData = (r: Record<string, string>) => { const fd = new FormData(); for (const [k, v] of Object.entries(r)) fd.set(k, v); return fd; };
const limpio = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 2000) : "");

// Lee y valida lo que envía el cliente. Devuelve solo los campos del formulario con algo escrito.
export function leerRespuestas(tipo: string, fd: FormData, servicios: Map<string, string> = new Map()): Record<string, string> {
  const campos = CAMPOS_FORMULARIO[tipo];
  if (!campos) throw new ErrorFormulario("Formulario no válido.");
  const r: Record<string, string> = {};
  for (const k of campos) { const v = limpio(fd.get(k)); if (v) r[k] = v; }
  const x = aFormData(r);
  try {
    if (tipo === "ficha") {
      if (!r.nombre) throw new ErrorFormulario("Escriba la razón social de la empresa.");
      if (r.rnc && !/^\d{9}$|^\d{11}$/.test(r.rnc.replace(/\D/g, ""))) throw new ErrorFormulario("El RNC lleva 9 dígitos (o 11 si es una cédula).");
      leerSociedad(x); leerOperaciones(x); leerSocios(x); leerContactos(x);
    } else if (tipo === "constitucion") {
      if (!r.n1) throw new ErrorFormulario("Escriba al menos un nombre propuesto para la empresa.");
      const capital = leerMonto(r.capital_social ?? "");
      if (!r.capital_social || capital === null) throw new ErrorFormulario("Escriba el capital social.");
      if (aCentavos(capital) < CAPITAL_MINIMO) throw new ErrorFormulario("El capital social debe ser de al menos RD$100,000.");
      if (leerSocios(x).length === 0) throw new ErrorFormulario("Agregue a los accionistas con su porcentaje.");
      if (!r.c_gerente_nombre) throw new ErrorFormulario("Escriba quién será el gerente o representante.");
      leerContactos(x);
    } else {
      if (!r.descripcion) throw new ErrorFormulario("Describa qué necesita.");
      if (r.servicio_id) {
        const nombre = servicios.get(r.servicio_id);
        if (!nombre) throw new ErrorFormulario("Elija el servicio de la lista.");
        r.servicio = nombre;
      }
      if (r.fecha_requerida && !/^\d{4}-\d{2}-\d{2}$/.test(r.fecha_requerida)) throw new ErrorFormulario("La fecha no es válida.");
      if (r.prioridad && !(r.prioridad in PRIORIDADES)) delete r.prioridad;
    }
  } catch (e) {
    if (e instanceof ErrorFicha) throw new ErrorFormulario(e.message);
    throw e;
  }
  return r;
}

export type FormularioPublico = { id: string; empresa_id: string; tipo: string; estado: string; creado_por: string; empresa: string; firma: string; propia: string | null };

// Busca el formulario por su enlace (sin sesión; conexión dueña: la tabla no lleva FORCE RLS).
export async function formularioPorToken(token: string): Promise<FormularioPublico | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [f] = await db()<FormularioPublico[]>`
    SELECT f.id, f.empresa_id, f.tipo, f.estado, f.creado_por, e.nombre AS empresa, fi.nombre AS firma, fi.empresa_propia_id AS propia
      FROM formularios f JOIN empresas e ON e.id = f.empresa_id JOIN firmas fi ON fi.id = e.firma_id
     WHERE f.token_hash = ${hashToken(token)} AND f.vence > now() AND f.estado <> 'descartado'`;
  return f ?? null;
}

// Servicios activos de la lista de precios de la firma (empresa propia), para la Solicitud de Servicio.
export async function serviciosDeLaFirma(propia: string | null): Promise<{ id: string; nombre: string; grupo: string | null }[]> {
  if (!propia) return [];
  return db().begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${propia}, true)`;
    return tx<{ id: string; nombre: string; grupo: string | null }[]>`
      SELECT id, nombre, grupo FROM servicios WHERE empresa_id = ${propia} AND activo ORDER BY grupo NULLS LAST, nombre`;
  }) as Promise<{ id: string; nombre: string; grupo: string | null }[]>;
}

// Pasa los adjuntos de un formulario al expediente; si el mismo archivo ya estaba ahí, no se repite.
export async function adjuntosAlExpediente(tx: Tx, formularioId: string, empresaId: string) {
  await tx`UPDATE documentos d SET eliminado = true, eliminado_en = now()
            WHERE d.entidad = 'formulario' AND d.entidad_id = ${formularioId} AND NOT d.eliminado
              AND EXISTS (SELECT 1 FROM documentos x WHERE x.empresa_id = d.empresa_id AND x.entidad = 'expediente' AND x.entidad_id = ${empresaId}
                                                        AND x.sha256 = d.sha256 AND NOT x.eliminado)`;
  await tx`UPDATE documentos SET entidad = 'expediente', entidad_id = ${empresaId}
            WHERE entidad = 'formulario' AND entidad_id = ${formularioId} AND NOT eliminado`;
}

// Lo que envía el cliente (corre en conEmpresa de esa empresa). La solicitud entra directo a la lista; la ficha y la constitución
// esperan revisión. Los adjuntos esperan en «documentos» (entidad 'formulario').
export async function recibirFormulario(tx: Tx, f: FormularioPublico, respuestas: Record<string, string>, archivos: Archivo[]) {
  const [actual] = await tx<{ estado: string }[]>`SELECT estado FROM formularios WHERE id = ${f.id} FOR UPDATE`;
  if (!actual || actual.estado !== "pendiente") throw new ErrorFormulario("Este formulario ya se envió. Gracias.");
  await guardarArchivos(tx, { empresaId: f.empresa_id, usuarioId: f.creado_por, archivos, entidad: "formulario", entidadId: f.id,
    carpeta: TIPOS_FORMULARIO[f.tipo].carpeta, anio: null, descripcion: `Adjunto de la ${TIPOS_FORMULARIO[f.tipo].nombre}` });
  if (f.tipo === "solicitud") {
    await tx`INSERT INTO solicitudes (empresa_id, origen, servicio_id, servicio, descripcion, para_que, fecha_requerida, prioridad, formulario_id)
             VALUES (${f.empresa_id}, 'formulario', ${respuestas.servicio_id ?? null}, ${respuestas.servicio ?? null}, ${respuestas.descripcion},
                     ${respuestas.para_que ?? null}, ${respuestas.fecha_requerida ?? null}, ${respuestas.prioridad ?? "media"}, ${f.id})`;
    await adjuntosAlExpediente(tx, f.id, f.empresa_id);
  }
  await tx`UPDATE formularios SET respuestas = ${tx.json(respuestas)}, estado = ${f.tipo === "solicitud" ? "aceptado" : "recibido"}, recibido_en = now(),
                                  aceptadas = ${f.tipo === "solicitud" ? ["solicitud"] : null}
            WHERE id = ${f.id}`;
}

// Sugerencia de categoría con lo que el cliente dijo de sus operaciones.
export function categoriaDe(r: Record<string, string>): string | null {
  const ventas = leerMonto(r.ventas_mes ?? "");
  return categoriaSugerida({
    ventas: r.ventas_mes && ventas !== null ? aCentavos(ventas) : null,
    facturas: r.facturas_mes ? Number(r.facturas_mes) : null, empleados: r.empleados_mes ? Number(r.empleados_mes) : null,
  });
}

const soloConValor = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

async function contactosRecibidos(tx: Tx, empresaId: string, x: FormData) {
  const { contactos, grupo_whatsapp } = leerContactos(x);
  for (const c of contactos) {
    await tx`INSERT INTO contactos_empresa (empresa_id, rol, nombre, cedula, cargo, telefono, whatsapp, correo, nacimiento)
             VALUES (${empresaId}, ${c.rol}, ${c.nombre}, ${c.cedula}, ${c.cargo}, ${c.telefono}, ${c.whatsapp}, ${c.correo}, ${c.nacimiento})
             ON CONFLICT (empresa_id, rol) DO UPDATE SET nombre = EXCLUDED.nombre, cedula = COALESCE(EXCLUDED.cedula, contactos_empresa.cedula),
               cargo = COALESCE(EXCLUDED.cargo, contactos_empresa.cargo), telefono = COALESCE(EXCLUDED.telefono, contactos_empresa.telefono),
               whatsapp = COALESCE(EXCLUDED.whatsapp, contactos_empresa.whatsapp), correo = COALESCE(EXCLUDED.correo, contactos_empresa.correo),
               nacimiento = COALESCE(EXCLUDED.nacimiento, contactos_empresa.nacimiento)`;
  }
  if (grupo_whatsapp) await tx`UPDATE empresas SET grupo_whatsapp = ${grupo_whatsapp} WHERE id = ${empresaId}`;
}

// Acepta las secciones elegidas: carga lo recibido en la ficha, el expediente o la lista de pasos (corre en conEmpresa).
// Solo se escriben los datos que el cliente llenó; lo que dejó en blanco no borra lo que ya estaba.
export async function aceptarFormulario(tx: Tx, d: { formularioId: string; empresaId: string; secciones: string[]; usuarioId: string }) {
  const [f] = await tx<{ tipo: string; estado: string; respuestas: Record<string, string> | null }[]>`
    SELECT tipo, estado, respuestas FROM formularios WHERE id = ${d.formularioId} FOR UPDATE`;
  if (!f || f.estado !== "recibido" || !f.respuestas) throw new ErrorFormulario("Ese formulario no está por revisar.");
  const r = f.respuestas, x = aFormData(r), s = new Set(d.secciones);
  const adjuntos = () => adjuntosAlExpediente(tx, d.formularioId, d.empresaId);
  try {
    if (f.tipo === "ficha") {
      if (s.has("empresa")) {
        const datos = soloConValor({ nombre: r.nombre, nombre_comercial: r.nombre_comercial, rnc: r.rnc?.replace(/\D/g, ""), direccion: r.direccion,
          telefono: r.telefono, correo: r.correo });
        if (Object.keys(datos).length) await tx`UPDATE empresas SET ${tx(datos)} WHERE id = ${d.empresaId}`;
      }
      if (s.has("sociedad")) {
        const datos = soloConValor(leerSociedad(x));
        if (Object.keys(datos).length) await tx`UPDATE empresas SET ${tx(datos)} WHERE id = ${d.empresaId}`;
      }
      if (s.has("socios")) { const socios = leerSocios(x); if (socios.length) await guardarSocios(tx, d.empresaId, socios); }
      if (s.has("contactos")) await contactosRecibidos(tx, d.empresaId, x);
      if (s.has("operaciones")) {
        const datos = soloConValor(leerOperaciones(x));
        if (Object.keys(datos).length) await tx`UPDATE empresas SET ${tx(datos)} WHERE id = ${d.empresaId}`;
      }
      if (s.has("adjuntos")) await adjuntos();
    } else if (f.tipo === "constitucion") {
      await abrirConstitucion(tx, d.empresaId);
      const capital = leerMonto(r.capital_social ?? "");
      await tx`UPDATE empresas SET ${tx(soloConValor({ capital_social: capital, direccion: r.direccion,
        tiene_tss: r.tiene_tss === "si" ? true : r.tiene_tss === "no" ? false : null }))} WHERE id = ${d.empresaId}`;
      const socios = leerSocios(x);
      if (socios.length) await guardarSocios(tx, d.empresaId, socios);
      await contactosRecibidos(tx, d.empresaId, x);
      const nombres = [r.n1, r.n2, r.n3].filter(Boolean).join(" / ");
      const nota = [`Nombres propuestos: ${nombres}`, r.actividad ? `Actividad: ${r.actividad}` : "", r.notas ?? ""].filter(Boolean).join(". ").slice(0, 500);
      await tx`UPDATE pasos_constitucion SET nota = ${nota} WHERE empresa_id = ${d.empresaId} AND paso = 1 AND nota IS NULL`;
      await adjuntos();
      s.clear(); s.add("constitucion");
    }
  } catch (e) {
    if (e instanceof ErrorFicha) throw new ErrorFormulario(e.message);
    throw e;
  }
  await tx`UPDATE formularios SET estado = 'aceptado', aceptadas = ${[...s]}, revisado_por = ${d.usuarioId}, revisado_en = now() WHERE id = ${d.formularioId}`;
}

export async function descartarFormulario(tx: Tx, formularioId: string, usuarioId: string) {
  const r = await tx`UPDATE formularios SET estado = 'descartado', revisado_por = ${usuarioId}, revisado_en = now(), token_hash = NULL
                      WHERE id = ${formularioId} AND estado IN ('pendiente', 'recibido')`;
  if (!r.count) throw new ErrorFormulario("Ese formulario ya se cerró.");
  await tx`UPDATE documentos SET eliminado = true, eliminado_en = now(), eliminado_por = ${usuarioId} WHERE entidad = 'formulario' AND entidad_id = ${formularioId}`;
}

// Un enlace nuevo para el formulario (por WhatsApp o para copiar): reemplaza el anterior y vence a los 30 días.
export async function ponerEnlace(tx: Tx, formularioId: string, token: string) {
  const r = await tx`UPDATE formularios SET token_hash = ${hashToken(token)}, vence = now() + make_interval(days => ${DIAS_ENLACE})
                      WHERE id = ${formularioId} AND estado = 'pendiente'`;
  if (!r.count) throw new ErrorFormulario("Ese formulario ya se respondió o se cerró.");
}

export type FilaFormulario = { id: string; tipo: string; estado: string; creado: Date; recibido_en: Date | null; vence: Date | null;
  respuestas: Record<string, string> | null; aceptadas: string[] | null; creado_por: string | null; revisado_por: string | null;
  adjuntos: { id: string; nombre: string }[] };

export const listarFormularios = (tx: Tx) => tx<FilaFormulario[]>`
  SELECT f.id, f.tipo, f.estado, f.creado, f.recibido_en, f.vence, f.respuestas, f.aceptadas, uc.nombre AS creado_por, ur.nombre AS revisado_por,
         COALESCE((SELECT json_agg(json_build_object('id', d.id, 'nombre', d.nombre)) FROM documentos d
                    WHERE d.entidad = 'formulario' AND d.entidad_id = f.id AND NOT d.eliminado), '[]') AS adjuntos
    FROM formularios f LEFT JOIN usuarios uc ON uc.id = f.creado_por LEFT JOIN usuarios ur ON ur.id = f.revisado_por
   ORDER BY f.estado = 'recibido' DESC, f.creado DESC`;

// ───── Solicitudes ─────
export type Solicitud = { id: string; empresa_id: string; origen: string; tipo: string; servicio_id: string | null; servicio: string | null; descripcion: string;
  para_que: string | null; fecha_requerida: string | null; prioridad: string; estado: string; responsable_id: string | null; responsable: string | null;
  propuesta_id: string | null; propuesta_numero: number | null; creado: Date };

export const listarSolicitudes = (tx: Tx, abiertas = false) => tx<Solicitud[]>`
  SELECT s.id, s.empresa_id, s.origen, s.tipo, s.servicio_id, s.servicio, s.descripcion, s.para_que, to_char(s.fecha_requerida, 'YYYY-MM-DD') AS fecha_requerida,
         s.prioridad, s.estado, s.responsable_id, u.nombre AS responsable, s.propuesta_id, s.propuesta_numero, s.creado
    FROM solicitudes s LEFT JOIN usuarios u ON u.id = s.responsable_id
   WHERE (NOT ${abiertas} OR s.estado NOT IN ('entregada', 'descartada'))
   ORDER BY s.estado IN ('entregada', 'descartada'), array_position(ARRAY['alta', 'media', 'baja'], s.prioridad), s.fecha_requerida NULLS LAST, s.creado`;

export const PASOS_SOLICITUD: Record<string, string[]> = {
  recibida: ["cotizada", "en_proceso", "entregada", "descartada"], cotizada: ["en_proceso", "entregada", "descartada", "recibida"],
  en_proceso: ["entregada", "descartada"], entregada: ["en_proceso"], descartada: ["recibida"],
};

export async function cambiarSolicitud(tx: Tx, id: string, estado: string) {
  const [s] = await tx<{ estado: string }[]>`SELECT estado FROM solicitudes WHERE id = ${id} FOR UPDATE`;
  if (!s) throw new ErrorFormulario("La solicitud no existe.");
  if (!(PASOS_SOLICITUD[s.estado] ?? []).includes(estado)) throw new ErrorFormulario("Ese cambio no es posible.");
  await tx`UPDATE solicitudes SET estado = ${estado}, entregada_en = ${estado === "entregada" ? new Date() : null} WHERE id = ${id}`;
}

export const totalPorcentaje = (r: Record<string, string>) =>
  deCentavos(Array.from({ length: MAX_SOCIOS_FORMULARIO }, (_, i) => leerMonto(r[`s${i}_porcentaje`]?.replace(/%$/, "") ?? "") ?? "0")
    .reduce((t, p) => t + aCentavos(p), 0n));


