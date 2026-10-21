"use server";

import { redirect } from "next/navigation";
import { cerrarSesion, cifrarClave, claveCorrecta, iniciarSesion, exigirUsuario } from "@/lib/auth";
import { db, mensajeError } from "@/lib/db";
import { crearEmpresa, limpiarRnc, rncValido } from "@/lib/empresas";

export type Estado = { error?: string; ok?: string };

function texto(fd: FormData, campo: string): string {
  return String(fd.get(campo) ?? "").trim();
}

export async function registrarse(_: Estado, fd: FormData): Promise<Estado> {
  const nombre = texto(fd, "nombre");
  const email = texto(fd, "email").toLowerCase();
  const clave = String(fd.get("clave") ?? "");
  const empresa = texto(fd, "empresa");
  const rnc = limpiarRnc(texto(fd, "rnc"));
  if (!nombre || !empresa) return { error: "Escribe tu nombre y el de la empresa." };
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
      await crearEmpresa({ nombre: empresa, rnc: rnc || null, usuarioId: id }, tx);
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
  const [u] = await db()<{ id: string; clave_hash: string }[]>`SELECT id, clave_hash FROM usuarios WHERE email = ${email}`;
  if (!u || !(await claveCorrecta(clave, u.clave_hash))) return { error: "Correo o contraseña incorrectos." };
  await iniciarSesion(u.id);
  redirect("/empresas");
}

export async function salir(): Promise<void> {
  await cerrarSesion();
  redirect("/entrar");
}

export async function nuevaEmpresa(_: Estado, fd: FormData): Promise<Estado> {
  const usuario = await exigirUsuario();
  const nombre = texto(fd, "empresa");
  const rnc = limpiarRnc(texto(fd, "rnc"));
  if (!nombre) return { error: "Escribe el nombre de la empresa." };
  if (rnc && !rncValido(rnc)) return { error: "El RNC debe tener 9 dígitos (o 11 si es cédula)." };
  let id: string;
  try {
    id = await crearEmpresa({ nombre, rnc: rnc || null, usuarioId: usuario.id });
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
