import { conEmpresas, db } from "./db.ts";

// Prioridad 2.2 (P2b): chat interno del equipo. Las conversaciones son generales, de un cliente o de un trabajo (una solicitud) de un cliente;
// no salen correos ni WhatsApp: el aviso es el número de mensajes sin leer en el menú. Los mensajes no se editan ni se borran.

export class ErrorChat extends Error {}

export const MAX_MENSAJE = 2000;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RE_CLIENTE = new RegExp(`^c:(${UUID})$`, "i");
const RE_TRABAJO = new RegExp(`^t:(${UUID}):(${UUID})$`, "i");

export type Hilo = { clave: string; tipo: "general" | "cliente" | "trabajo"; empresaId: string | null; solicitudId: string | null };

export const HILO_GENERAL: Hilo = { clave: "general", tipo: "general", empresaId: null, solicitudId: null };
export const hiloDeCliente = (empresaId: string): Hilo => ({ clave: `c:${empresaId}`, tipo: "cliente", empresaId, solicitudId: null });
export const hiloDeTrabajo = (empresaId: string, solicitudId: string): Hilo => ({ clave: `t:${empresaId}:${solicitudId}`, tipo: "trabajo", empresaId, solicitudId });

// Lee la clave de una conversación (como llega en la dirección o en un formulario); null si no tiene la forma de ninguna.
export function leerHilo(clave: string | null | undefined): Hilo | null {
  const c = (clave ?? "").trim().toLowerCase();
  if (c === "general") return HILO_GENERAL;
  const cl = RE_CLIENTE.exec(c);
  if (cl) return hiloDeCliente(cl[1]);
  const t = RE_TRABAJO.exec(c);
  if (t) return hiloDeTrabajo(t[1], t[2]);
  return null;
}

// El texto del mensaje: se conservan los saltos de línea, sin espacios de más al principio y al final.
export function leerTexto(bruto: string): string {
  const t = bruto.replace(/\r\n/g, "\n").trim();
  if (!t) throw new ErrorChat("Escribe el mensaje.");
  if (t.length > MAX_MENSAJE) throw new ErrorChat(`El mensaje va hasta ${MAX_MENSAJE.toLocaleString("es-DO")} caracteres.`);
  return t;
}

export type Mensaje = { id: string; autor_id: string; autor: string; texto: string; creado: Date };

export async function enviarMensaje(firmaId: string, autorId: string, hilo: Hilo, texto: string): Promise<string> {
  const t = leerTexto(texto);
  const [{ id }] = await db()<{ id: string }[]>`
    INSERT INTO chat_mensajes (firma_id, hilo, empresa_id, solicitud_id, autor_id, texto)
    VALUES (${firmaId}, ${hilo.clave}, ${hilo.empresaId}, ${hilo.solicitudId}, ${autorId}, ${t}) RETURNING id`;
  await marcarLeido(firmaId, autorId, hilo.clave);
  return id;
}

// Los últimos mensajes de una conversación, del más viejo al más nuevo.
export const mensajesDe = (firmaId: string, clave: string, limite = 200) => db()<Mensaje[]>`
  SELECT * FROM (
    SELECT m.id, m.autor_id, u.nombre AS autor, m.texto, m.creado
      FROM chat_mensajes m JOIN usuarios u ON u.id = m.autor_id
     WHERE m.firma_id = ${firmaId} AND m.hilo = ${clave} ORDER BY m.creado DESC, m.id LIMIT ${limite}) x
  ORDER BY creado, id`;

// Deja la conversación leída hasta este momento.
export async function marcarLeido(firmaId: string, usuarioId: string, clave: string): Promise<void> {
  await db()`
    INSERT INTO chat_lecturas (usuario_id, firma_id, hilo, leido_hasta) VALUES (${usuarioId}, ${firmaId}, ${clave}, clock_timestamp())
    ON CONFLICT (usuario_id, firma_id, hilo) DO UPDATE SET leido_hasta = clock_timestamp()`;
}

// Mensajes sin leer de las conversaciones que la persona puede ver: las generales y las de los clientes que ve (los de otros no cuentan).
export async function sinLeer(firmaId: string, usuarioId: string, empresaIds: string[]): Promise<number> {
  const [{ n }] = await db()<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM chat_mensajes m
      LEFT JOIN chat_lecturas l ON l.usuario_id = ${usuarioId} AND l.firma_id = m.firma_id AND l.hilo = m.hilo
     WHERE m.firma_id = ${firmaId} AND m.autor_id <> ${usuarioId}
       AND (m.empresa_id IS NULL OR m.empresa_id::text = ANY(${empresaIds}::text[]))
       AND (l.leido_hasta IS NULL OR m.creado > l.leido_hasta)`;
  return n;
}

export type ResumenHilo = { clave: string; empresa_id: string | null; solicitud_id: string | null; ultimo: Date; sin_leer: number; ultimo_autor: string; ultimo_texto: string };

// Las conversaciones que ya tienen mensajes, la más reciente primero.
export const hilosDe = (firmaId: string, usuarioId: string, empresaIds: string[]) => db()<ResumenHilo[]>`
  SELECT h.hilo AS clave, h.empresa_id, h.solicitud_id, h.ultimo, h.sin_leer, u.nombre AS ultimo_autor, m.texto AS ultimo_texto
    FROM (
      SELECT x.hilo, max(x.empresa_id::text)::uuid AS empresa_id, max(x.solicitud_id::text)::uuid AS solicitud_id, max(x.creado) AS ultimo,
             count(*) FILTER (WHERE x.autor_id <> ${usuarioId} AND (l.leido_hasta IS NULL OR x.creado > l.leido_hasta))::int AS sin_leer
        FROM chat_mensajes x LEFT JOIN chat_lecturas l ON l.usuario_id = ${usuarioId} AND l.firma_id = x.firma_id AND l.hilo = x.hilo
       WHERE x.firma_id = ${firmaId} AND (x.empresa_id IS NULL OR x.empresa_id::text = ANY(${empresaIds}::text[]))
       GROUP BY x.hilo) h
    JOIN LATERAL (SELECT autor_id, texto FROM chat_mensajes WHERE firma_id = ${firmaId} AND hilo = h.hilo ORDER BY creado DESC, id LIMIT 1) m ON true
    JOIN usuarios u ON u.id = m.autor_id
   ORDER BY h.ultimo DESC`;

// Cómo se llama cada trabajo de las conversaciones (la solicitud vive en su empresa, con su propia RLS).
export async function titulosDeTrabajos(trabajos: { empresaId: string; solicitudId: string }[]): Promise<Map<string, string>> {
  const titulos = new Map<string, string>();
  if (!trabajos.length) return titulos;
  await conEmpresas(async (tx, en) => {
    for (const empresaId of new Set(trabajos.map((t) => t.empresaId))) {
      await en(empresaId);
      const ids = trabajos.filter((t) => t.empresaId === empresaId).map((t) => t.solicitudId);
      for (const s of await tx<{ id: string; titulo: string }[]>`
          SELECT id, coalesce(nullif(btrim(servicio), ''), left(descripcion, 60)) AS titulo FROM solicitudes WHERE id::text = ANY(${ids}::text[])`) titulos.set(s.id, s.titulo);
    }
  });
  return titulos;
}

// ¿Existe ese trabajo en esa empresa? (para abrir una conversación sobre él)
export const existeTrabajo = (empresaId: string, solicitudId: string) =>
  conEmpresas(async (tx, en) => { await en(empresaId); return (await tx`SELECT 1 FROM solicitudes WHERE id = ${solicitudId}`).length > 0; });
