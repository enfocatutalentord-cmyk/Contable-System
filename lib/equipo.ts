import { cifrarClave } from "./auth";
import { ErrorContable } from "./asientos";
import type { Tx } from "./db";

function claveTemporal(): string {
  const letras = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => letras[b % letras.length]).join("");
}

// Busca a la persona por correo; si no tiene cuenta, se la crea con una contraseña temporal (que se muestra una vez).
export async function asegurarUsuario(tx: Tx, email: string, nombre: string): Promise<{ id: string; temporal: string | null }> {
  const [u] = await tx<{ id: string }[]>`SELECT id FROM usuarios WHERE email = ${email}`;
  if (u) return { id: u.id, temporal: null };
  if (!nombre) throw new ErrorContable("Esa persona aún no tiene cuenta: escribe también su nombre");
  const temporal = claveTemporal();
  const [n] = await tx<{ id: string }[]>`
    INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${email}, ${nombre}, ${await cifrarClave(temporal)}) RETURNING id`;
  return { id: n.id, temporal };
}

export async function revisarQueQuedeAdministrador(tx: Tx, firmaId: string): Promise<void> {
  const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM miembros_firma WHERE firma_id = ${firmaId} AND administrador`;
  if (n === 0) throw new ErrorContable("La firma debe tener al menos un administrador");
}
