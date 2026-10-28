import { randomBytes } from "node:crypto";
import { cifrarClave } from "./auth";
import { ErrorContable } from "./asientos";
import type { Tx } from "./db";

// Busca a la persona por correo; si no tiene cuenta, se la crea con una contraseña al azar que nadie conoce:
// la persona crea la suya con el enlace que le llega por correo (lib/enlaces.ts).
export async function asegurarUsuario(tx: Tx, email: string, nombre: string): Promise<{ id: string; nombre: string; nuevo: boolean }> {
  const [u] = await tx<{ id: string; nombre: string }[]>`SELECT id, nombre FROM usuarios WHERE email = ${email}`;
  if (u) return { ...u, nuevo: false };
  if (!nombre) throw new ErrorContable("Esa persona aún no tiene cuenta: escribe también su nombre");
  const [n] = await tx<{ id: string }[]>`
    INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${email}, ${nombre}, ${await cifrarClave(randomBytes(32).toString("base64"))}) RETURNING id`;
  return { id: n.id, nombre, nuevo: true };
}

// Mensaje para quien dio el acceso: si el correo no salió, le muestra el enlace para pasarlo a mano (WhatsApp, etc.).
export function avisoEnlace(email: string, enviado: boolean, url: string, nuevo = true): string {
  const que = nuevo ? "verificar su correo y crear su contraseña" : "crear una nueva contraseña";
  return enviado
    ? `Le enviamos a ${email} un correo con el enlace para ${que}.`
    : `No se pudo enviar el correo. Pásale a ${email} este enlace para ${que} (es personal y sirve una sola vez): ${url}`;
}

export async function revisarQueQuedeAdministrador(tx: Tx, firmaId: string): Promise<void> {
  const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM miembros_firma WHERE firma_id = ${firmaId} AND administrador`;
  if (n === 0) throw new ErrorContable("La firma debe tener al menos un administrador");
}
