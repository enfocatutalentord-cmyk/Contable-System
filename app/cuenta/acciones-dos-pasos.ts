"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { claveCorrecta, exigirUsuario } from "@/lib/auth";
import { avisarCambio, comprobarSegundoPaso, estadoDosPasos, quitarDosPasos, renovarCodigos } from "@/lib/cuenta-dos-pasos";
import { db } from "@/lib/db";
import { nuevoSecreto, verificarCodigo } from "@/lib/dos-pasos";
import type { Estado } from "../acciones-cuenta";

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();

// 1. Genera la clave nueva y muestra el QR. Todavía no está activa: falta confirmar con un código.
export async function empezarDosPasos(): Promise<Estado> {
  const usuario = await exigirUsuario();
  if (usuario.dosPasos) return { error: "La verificación en dos pasos ya está activa." };
  await db()`UPDATE usuarios SET dos_pasos_secreto = ${nuevoSecreto()} WHERE id = ${usuario.id} AND dos_pasos_desde IS NULL`;
  revalidatePath("/cuenta");
  return {};
}

export async function cancelarDosPasos(): Promise<Estado> {
  const usuario = await exigirUsuario();
  await db()`UPDATE usuarios SET dos_pasos_secreto = NULL WHERE id = ${usuario.id} AND dos_pasos_desde IS NULL`;
  revalidatePath("/cuenta");
  return {};
}

// 2. Con el primer código correcto queda activa y se entregan los códigos de recuperación (se muestran una sola vez).
export async function confirmarDosPasos(_: Estado, fd: FormData): Promise<Estado> {
  const usuario = await exigirUsuario();
  const [u] = await db()<{ secreto: string | null }[]>`
    SELECT dos_pasos_secreto AS secreto FROM usuarios WHERE id = ${usuario.id} AND dos_pasos_desde IS NULL`;
  if (!u?.secreto) return { error: "Vuelve a empezar la configuración." };
  const paso = verificarCodigo(u.secreto, texto(fd, "codigo"), null);
  if (paso === null) return { error: "El código no es correcto. Escribe el que muestra la app ahora (cambia cada 30 segundos) y revisa que la hora del celular esté en automático." };
  const codigos = await db().begin(async (tx) => {
    await tx`UPDATE usuarios SET dos_pasos_desde = now(), dos_pasos_ultimo = ${paso.toString()}::bigint WHERE id = ${usuario.id}`;
    return renovarCodigos(tx, usuario.id);
  }) as string[];
  await avisarCambio(usuario.email, usuario.nombre, "se activó la verificación en dos pasos");
  // Sin revalidar: la pantalla de configuración sigue a la vista con los códigos hasta que la persona diga que los guardó.
  return { ok: "Listo: la verificación en dos pasos está activa. Guarda ahora estos códigos de recuperación.", codigos };
}

export async function nuevosCodigos(_: Estado, fd: FormData): Promise<Estado> {
  const usuario = await exigirUsuario();
  if (!usuario.dosPasos) return { error: "Primero activa la verificación en dos pasos." };
  if ((await comprobarSegundoPaso(usuario.id, texto(fd, "codigo"))) !== "app") return { error: "Escribe el código que muestra tu app ahora." };
  const codigos = await db().begin((tx) => renovarCodigos(tx, usuario.id)) as string[];
  await avisarCambio(usuario.email, usuario.nombre, "se generaron códigos de recuperación nuevos", "Los anteriores ya no sirven.");
  revalidatePath("/cuenta");
  return { ok: "Códigos nuevos. Los anteriores ya no sirven.", codigos };
}

// Desactivar pide la contraseña y un código (OWASP: volver a autenticarse antes de quitar un factor).
export async function desactivarDosPasos(_: Estado, fd: FormData): Promise<Estado> {
  const usuario = await exigirUsuario();
  const estado = await estadoDosPasos(usuario.id);
  if (!estado.desde) return { error: "La verificación en dos pasos no está activa." };
  if (estado.exigida.length) return { error: `${estado.exigida.join(", ")} exige la verificación en dos pasos: no se puede quitar.` };
  const [u] = await db()<{ clave_hash: string }[]>`SELECT clave_hash FROM usuarios WHERE id = ${usuario.id}`;
  if (!(await claveCorrecta(String(fd.get("clave") ?? ""), u.clave_hash))) return { error: "La contraseña no es correcta." };
  if ((await comprobarSegundoPaso(usuario.id, texto(fd, "codigo"))) === null) return { error: "El código no es correcto." };
  await db().begin((tx) => quitarDosPasos(tx, usuario.id));
  await avisarCambio(usuario.email, usuario.nombre, "se desactivó la verificación en dos pasos");
  redirect("/cuenta?desactivada=1#dos-pasos");
}
