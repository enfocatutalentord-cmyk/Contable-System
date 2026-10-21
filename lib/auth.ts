import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";

const scrypt = promisify(scryptCb) as (clave: string, sal: Buffer, largo: number) => Promise<Buffer>;
const COOKIE = "sesion";
const DURACION_MS = 30 * 24 * 3600_000;

export type Usuario = { id: string; email: string; nombre: string };

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
    SELECT u.id, u.email, u.nombre FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token_hash = ${hashToken(token)} AND s.expira > now()`;
  return u ?? null;
});

export async function exigirUsuario(): Promise<Usuario> {
  const u = await usuarioActual();
  if (!u) redirect("/entrar");
  return u;
}
