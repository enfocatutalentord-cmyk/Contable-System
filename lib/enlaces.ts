import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { cifrarClave } from "./auth";
import { enviarCorreo } from "./correo";
import { db, type Tx } from "./db";

// Enlaces de un solo uso para crear la contraseña: invitación (72 horas) y recuperación (1 hora).
export const HORAS = { invitacion: 72, recuperacion: 1 } as const;
export type TipoEnlace = keyof typeof HORAS;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

// Dirección pública del sistema para armar el enlace (no se toma del navegador en producción).
export async function urlApp(): Promise<string> {
  if (process.env.URL_APP) return process.env.URL_APP.replace(/\/$/, "");
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
}

export async function crearEnlace(tx: Tx, usuarioId: string, tipo: TipoEnlace, creadoPor: string | null): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  // Un enlace nuevo deja sin efecto los anteriores de esa persona.
  await tx`UPDATE enlaces_acceso SET usado = now() WHERE usuario_id = ${usuarioId} AND usado IS NULL`;
  await tx`INSERT INTO enlaces_acceso (token_hash, usuario_id, tipo, creado_por, expira)
           VALUES (${hash(token)}, ${usuarioId}, ${tipo}, ${creadoPor}, now() + make_interval(hours => ${HORAS[tipo]}))`;
  return `${await urlApp()}/acceso/${token}`;
}

// Envía el enlace por correo. Devuelve si salió; si no, quien da el acceso ve el enlace para pasarlo a mano.
export async function enviarEnlace(d: { para: string; nombre: string; url: string; tipo: TipoEnlace; firma?: string; quien?: string }): Promise<boolean> {
  const invitacion = d.tipo === "invitacion";
  return enviarCorreo({
    para: d.para,
    asunto: invitacion ? "Tu acceso al sistema contable" : "Crea una nueva contraseña",
    titulo: `Hola, ${d.nombre}`,
    parrafos: invitacion
      ? [`${d.quien ?? "Tu firma"} te dio acceso al sistema contable${d.firma ? ` de ${d.firma}` : ""}.`,
         "Toca el botón para verificar tu correo y crear tu contraseña. Después entrarás con tu correo y esa contraseña."]
      : ["Recibimos un pedido para crear una nueva contraseña para tu usuario.", "Si no lo pediste tú, ignora este correo: tu contraseña no cambia."],
    boton: { texto: invitacion ? "Verificar mi correo y crear contraseña" : "Crear nueva contraseña", url: d.url },
    pie: `El enlace es personal, sirve una sola vez y vence en ${invitacion ? "72 horas" : "1 hora"}.`,
  });
}

export type EnlaceValido = { usuarioId: string; email: string; nombre: string; tipo: TipoEnlace };

export async function leerEnlace(token: string): Promise<EnlaceValido | null> {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return null;
  const [e] = await db()<EnlaceValido[]>`
    SELECT e.usuario_id AS "usuarioId", u.email, u.nombre, e.tipo
      FROM enlaces_acceso e JOIN usuarios u ON u.id = e.usuario_id
     WHERE e.token_hash = ${hash(token)} AND e.usado IS NULL AND e.expira > now()`;
  return e ?? null;
}

// Usa el enlace: verifica el correo, guarda la contraseña y cierra las sesiones anteriores. Solo una vez.
export async function usarEnlace(token: string, clave: string): Promise<string | null> {
  const nueva = await cifrarClave(clave);
  return db().begin(async (tx) => {
    const [e] = await tx<{ usuario_id: string }[]>`
      UPDATE enlaces_acceso SET usado = now()
       WHERE token_hash = ${hash(token)} AND usado IS NULL AND expira > now() RETURNING usuario_id`;
    if (!e) return null;
    await tx`UPDATE usuarios SET clave_hash = ${nueva}, correo_verificado = COALESCE(correo_verificado, now()) WHERE id = ${e.usuario_id}`;
    await tx`UPDATE enlaces_acceso SET usado = now() WHERE usuario_id = ${e.usuario_id} AND usado IS NULL`;
    await tx`DELETE FROM sesiones WHERE usuario_id = ${e.usuario_id}`;
    return e.usuario_id;
  }) as Promise<string | null>;
}

// Límite para «¿Olvidaste tu contraseña?»: 3 enlaces por hora por persona.
export async function recuperacionesRecientes(usuarioId: string): Promise<number> {
  const [{ n }] = await db()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM enlaces_acceso WHERE usuario_id = ${usuarioId} AND tipo = 'recuperacion' AND creado > now() - interval '1 hour'`;
  return n;
}
