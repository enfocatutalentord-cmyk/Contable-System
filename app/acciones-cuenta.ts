"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cerrarSesion, cifrarClave, claveCorrecta, iniciarSesion, exigirUsuario } from "@/lib/auth";
import { db, mensajeError } from "@/lib/db";
import { accesoFirma } from "@/lib/acceso";
import { crearEmpresa, crearFirma, leerFicha, limpiarRnc, rncValido } from "@/lib/empresas";
import { anotarIntento, entradaBloqueada, MINUTOS } from "@/lib/intentos";

export type Estado = { error?: string; ok?: string };

function texto(fd: FormData, campo: string): string {
  return String(fd.get(campo) ?? "").trim();
}

// Alta de una firma contable: crea la cuenta de la persona, la firma y la deja como administradora.
export async function registrarse(_: Estado, fd: FormData): Promise<Estado> {
  const nombre = texto(fd, "nombre");
  const email = texto(fd, "email").toLowerCase();
  const clave = String(fd.get("clave") ?? "");
  const firma = texto(fd, "firma");
  const rnc = limpiarRnc(texto(fd, "rnc"));
  if (!nombre || !firma) return { error: "Escribe tu nombre y el de la firma." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "El correo no es válido." };
  if (clave.length < 10) return { error: "La contraseña debe tener al menos 10 caracteres." };
  if (rnc && !rncValido(rnc)) return { error: "El RNC debe tener 9 dígitos (o 11 si es cédula)." };

  let usuarioId: string;
  try {
    const existe = await db()`SELECT 1 FROM usuarios WHERE email = ${email}`;
    if (existe.length) return { error: "Ya hay una cuenta con ese correo. Entra con tu contraseña." };
    const hash = await cifrarClave(clave);
    usuarioId = (await db().begin(async (tx) => {
      const [{ id }] = await tx<{ id: string }[]>`
        INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${email}, ${nombre}, ${hash}) RETURNING id`;
      await crearFirma(tx, { nombre: firma, rnc: rnc || null, usuarioId: id });
      return id;
    })) as string;
  } catch (e) {
    return { error: mensajeError(e) };
  }
  await iniciarSesion(usuarioId);
  redirect("/empresas");
}

export async function entrar(_: Estado, fd: FormData): Promise<Estado> {
  const email = texto(fd, "email").toLowerCase();
  const clave = String(fd.get("clave") ?? "");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() || null;
  if (await entradaBloqueada(db(), email, ip)) {
    return { error: `Demasiados intentos fallidos. Espera ${MINUTOS} minutos y vuelve a intentarlo, o pide a un administrador de la firma una clave temporal.` };
  }
  const [u] = await db()<{ id: string; clave_hash: string }[]>`SELECT id, clave_hash FROM usuarios WHERE email = ${email}`;
  const correcta = !!u && (await claveCorrecta(clave, u.clave_hash));
  await anotarIntento(db(), email, ip, correcta);
  if (!correcta) return { error: "Correo o contraseña incorrectos." };
  await iniciarSesion(u.id);
  redirect("/empresas");
}

export async function salir(): Promise<void> {
  await cerrarSesion();
  redirect("/entrar");
}

// Nuevo cliente de la firma (solo administradores de la firma).
export async function nuevaEmpresa(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  const ficha = leerFicha(fd);
  if (typeof ficha === "string") return { error: ficha };
  let id: string;
  try {
    id = await crearEmpresa({ firmaId, usuarioId: usuario.id, ficha });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  redirect(`/e/${id}`);
}

export async function cambiarClave(_: Estado, fd: FormData): Promise<Estado> {
  const usuario = await exigirUsuario();
  const actual = String(fd.get("actual") ?? "");
  const nueva = String(fd.get("nueva") ?? "");
  if (nueva.length < 10) return { error: "La nueva contraseña debe tener al menos 10 caracteres." };
  const [u] = await db()<{ clave_hash: string }[]>`SELECT clave_hash FROM usuarios WHERE id = ${usuario.id}`;
  if (!u || !(await claveCorrecta(actual, u.clave_hash))) return { error: "La contraseña actual no es correcta." };
  const hash = await cifrarClave(nueva);
  await db().begin(async (tx) => {
    await tx`UPDATE usuarios SET clave_hash = ${hash} WHERE id = ${usuario.id}`;
    await tx`DELETE FROM sesiones WHERE usuario_id = ${usuario.id}`; // cierra las demás sesiones
  });
  await iniciarSesion(usuario.id);
  return { ok: "Contraseña cambiada. Se cerraron tus otras sesiones." };
}
