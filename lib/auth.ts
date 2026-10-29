import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";

const scrypt = promisify(scryptCb) as (clave: string, sal: Buffer, largo: number) => Promise<Buffer>;
const COOKIE = "sesion";
const DURACION_MS = 30 * 24 * 3600_000;

export type Usuario = { id: string; email: string; nombre: string; dosPasos: boolean };

export async function cifrarClave(clave: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scrypt(clave, sal, 64);
  return `scrypt$${sal.toString("base64")}$${hash.toString("base64")}`;
}

export async function claveCorrecta(clave: string, guardada: string): Promise<boolean> {
  const [alg, sal, hash] = guardada.split("$");
  if (alg !== "scrypt" || !sal || !hash) return false;
  const esperado = Buffer.from(hash, "base64");
  const calculado = await scrypt(clave, Buffer.from(sal, "base64"), esperado.length);
  return timingSafeEqual(esperado, calculado);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function iniciarSesion(usuarioId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expira = new Date(Date.now() + DURACION_MS);
  await db()`INSERT INTO sesiones (token_hash, usuario_id, expira) VALUES (${hashToken(token)}, ${usuarioId}, ${expira})`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expira,
  });
}

// ───── Verificación en dos pasos al entrar (lib/dos-pasos.ts) ─────
// Con la contraseña correcta, quien tiene la verificación activa no recibe sesión todavía: recibe un permiso de 10 minutos
// (cookie aparte, solo para /entrar) para escribir el código de su app. Sin la verificación, entra directo.
const PENDIENTE = "verificacion";
export const MAX_FALLOS_CODIGO = 5;

export async function continuarEntrada(usuarioId: string, destino: string): Promise<never> {
  const [u] = await db()<{ activa: boolean }[]>`SELECT dos_pasos_desde IS NOT NULL AS activa FROM usuarios WHERE id = ${usuarioId}`;
  if (!u?.activa) {
    await iniciarSesion(usuarioId);
    redirect(destino);
  }
  const token = randomBytes(32).toString("base64url");
  await db()`DELETE FROM entradas_pendientes WHERE usuario_id = ${usuarioId} OR expira < now()`;
  await db()`INSERT INTO entradas_pendientes (token_hash, usuario_id, destino, expira)
             VALUES (${hashToken(token)}, ${usuarioId}, ${destino}, now() + interval '10 minutes')`;
  (await cookies()).set(PENDIENTE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/entrar", maxAge: 600,
  });
  redirect("/entrar/codigo");
}

export type EntradaPendiente = { token_hash: string; usuario_id: string; email: string; nombre: string; destino: string; fallos: number };

export async function entradaPendiente(): Promise<EntradaPendiente | null> {
  const token = (await cookies()).get(PENDIENTE)?.value;
  if (!token) return null;
  const [p] = await db()<EntradaPendiente[]>`
    SELECT p.token_hash, p.usuario_id, u.email, u.nombre, p.destino, p.fallos
      FROM entradas_pendientes p JOIN usuarios u ON u.id = p.usuario_id
     WHERE p.token_hash = ${hashToken(token)} AND p.expira > now()`;
  return p ?? null;
}

export async function cerrarPendiente(tokenHash: string): Promise<void> {
  await db()`DELETE FROM entradas_pendientes WHERE token_hash = ${tokenHash}`;
  (await cookies()).delete({ name: PENDIENTE, path: "/entrar" });
}

export async function cerrarSesion(): Promise<void> {
  const almacen = await cookies();
  const token = almacen.get(COOKIE)?.value;
  if (token) await db()`DELETE FROM sesiones WHERE token_hash = ${hashToken(token)}`;
  almacen.delete(COOKIE);
}

export const usuarioActual = cache(async (): Promise<Usuario | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [u] = await db()<Usuario[]>`
    SELECT u.id, u.email, u.nombre, u.dos_pasos_desde IS NOT NULL AS "dosPasos" FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token_hash = ${hashToken(token)} AND s.expira > now()`;
  return u ?? null;
});

export async function exigirUsuario(): Promise<Usuario> {
  const u = await usuarioActual();
  if (!u) redirect("/entrar");
  return u;
}
