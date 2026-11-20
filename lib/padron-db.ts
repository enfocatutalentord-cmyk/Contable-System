import { db } from "./db.ts";
import { leerBloquePadron, normalizarRnc, rncConForma, type FilaPadron } from "./padron.ts";

// Padrón de la DGII (P2c.3), parte con base de datos: carga por tandas desde la Consola de la plataforma y consulta por RNC o cédula.

export type Carga = {
  id: string; archivo: string; usuario_nombre: string; iniciada: Date; terminada: Date | null;
  estado: "en_curso" | "completa" | "fallida"; filas: number; rechazadas: number; nota: string | null;
};

export async function iniciarCarga(usuario: { id: string; nombre: string }, archivo: string): Promise<string> {
  const [c] = await db()<{ id: string }[]>`
    INSERT INTO padron_cargas (archivo, usuario_id, usuario_nombre) VALUES (${archivo.slice(0, 200)}, ${usuario.id}, ${usuario.nombre}) RETURNING id`;
  return c.id;
}

// Una tanda de líneas del archivo: se leen aquí (el navegador solo corta el archivo) y se guardan o ponen al día por RNC; lo que no cambió no se reescribe.
export async function cargarTanda(cargaId: string, texto: string): Promise<{ filas: number; rechazadas: number }> {
  const [c] = await db()<{ estado: string }[]>`SELECT estado FROM padron_cargas WHERE id = ${cargaId}`;
  if (!c || c.estado !== "en_curso") throw new Error("Esta carga ya terminó o no existe: empieza otra.");
  const { filas, rechazadas } = leerBloquePadron(texto);
  if (filas.length) {
    const col = (f: (x: FilaPadron) => string | null) => filas.map(f);
    await db()`
      INSERT INTO padron_dgii (rnc, nombre, nombre_comercial, actividad, fecha_inicio, estado, regimen)
      SELECT * FROM unnest(${col((x) => x.rnc)}::text[], ${col((x) => x.nombre)}::text[], ${col((x) => x.nombre_comercial)}::text[],
                           ${col((x) => x.actividad)}::text[], ${col((x) => x.fecha_inicio)}::date[], ${col((x) => x.estado)}::text[], ${col((x) => x.regimen)}::text[])
      ON CONFLICT (rnc) DO UPDATE SET nombre = EXCLUDED.nombre, nombre_comercial = EXCLUDED.nombre_comercial, actividad = EXCLUDED.actividad,
             fecha_inicio = EXCLUDED.fecha_inicio, estado = EXCLUDED.estado, regimen = EXCLUDED.regimen
       WHERE (padron_dgii.nombre, padron_dgii.nombre_comercial, padron_dgii.actividad, padron_dgii.fecha_inicio, padron_dgii.estado, padron_dgii.regimen)
             IS DISTINCT FROM (EXCLUDED.nombre, EXCLUDED.nombre_comercial, EXCLUDED.actividad, EXCLUDED.fecha_inicio, EXCLUDED.estado, EXCLUDED.regimen)`;
  }
  await db()`UPDATE padron_cargas SET filas = filas + ${filas.length}, rechazadas = rechazadas + ${rechazadas} WHERE id = ${cargaId}`;
  return { filas: filas.length, rechazadas };
}

export async function terminarCarga(cargaId: string): Promise<Carga> {
  const [c] = await db()<Carga[]>`
    UPDATE padron_cargas SET estado = CASE WHEN filas > 0 THEN 'completa' ELSE 'fallida' END, terminada = now(),
           nota = CASE WHEN filas > 0 THEN nota ELSE 'El archivo no tenía ninguna línea que empezara con un RNC o una cédula.' END
     WHERE id = ${cargaId} AND estado = 'en_curso' RETURNING *`;
  if (!c) throw new Error("Esta carga ya terminó o no existe.");
  return c;
}

export async function fallarCarga(cargaId: string, motivo: string): Promise<void> {
  await db()`UPDATE padron_cargas SET estado = 'fallida', terminada = now(), nota = ${motivo.slice(0, 300)} WHERE id = ${cargaId} AND estado = 'en_curso'`;
}

export async function ultimasCargas(n = 10): Promise<Carga[]> {
  return db()<Carga[]>`SELECT * FROM padron_cargas ORDER BY iniciada DESC LIMIT ${n}`;
}

// Fecha de la última carga completa (null si nunca se ha cargado) y cuántos días lleva.
export async function estadoPadron(): Promise<{ al: Date | null; filas: number; dias: number | null }> {
  const [c] = await db()<{ terminada: Date; filas: number; dias: number }[]>`
    SELECT terminada, filas, (current_date - terminada::date)::int AS dias FROM padron_cargas WHERE estado = 'completa' ORDER BY terminada DESC LIMIT 1`;
  return c ? { al: c.terminada, filas: c.filas, dias: c.dias } : { al: null, filas: 0, dias: null };
}

export type ResultadoRnc =
  | { tipo: "invalido" }
  | { tipo: "sin_padron" }
  | { tipo: "no_esta"; al: Date }
  | { tipo: "encontrado"; al: Date; datos: FilaPadron };

// Busca un RNC (9 dígitos) o una cédula (11) en el padrón cargado.
export async function buscarRnc(valor: string): Promise<ResultadoRnc> {
  const rnc = normalizarRnc(valor);
  if (!rncConForma(rnc)) return { tipo: "invalido" };
  const { al } = await estadoPadron();
  if (!al) return { tipo: "sin_padron" };
  const [f] = await db()<FilaPadron[]>`
    SELECT rnc, nombre, nombre_comercial, actividad, estado, regimen, to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio FROM padron_dgii WHERE rnc = ${rnc}`;
  if (!f) return { tipo: "no_esta", al };
  return { tipo: "encontrado", al, datos: f };
}
