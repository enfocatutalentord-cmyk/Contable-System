"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cerrarPendiente, cerrarSesion, cifrarClave, claveCorrecta, continuarEntrada, entradaPendiente, exigirUsuario, iniciarSesion, MAX_FALLOS_CODIGO } from "@/lib/auth";
import { avisarCambio, comprobarSegundoPaso } from "@/lib/cuenta-dos-pasos";
import { db, mensajeError } from "@/lib/db";
import { accesoFirma } from "@/lib/acceso";
import { crearEmpresa, crearFirma, leerFicha, limpiarRnc, rncValido } from "@/lib/empresas";
import { crearEnlace, enviarEnlace, recuperacionesRecientes, usarEnlace } from "@/lib/enlaces";
import { anotarIntento, entradaBloqueada, MINUTOS } from "@/lib/intentos";

export type Estado = { error?: string; ok?: string; codigos?: string[] };

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
    return { error: `Demasiados intentos fallidos. Espera ${MINUTOS} minutos y vuelve a intentarlo, o usa «¿Olvidaste tu contraseña?».` };
  }
  const [u] = await db()<{ id: string; clave_hash: string }[]>`SELECT id, clave_hash FROM usuarios WHERE email = ${email}`;
  const correcta = !!u && (await claveCorrecta(clave, u.clave_hash));
  await anotarIntento(db(), email, ip, correcta);
  if (!correcta) return { error: "Correo o contraseña incorrectos." };
  return continuarEntrada(u.id, "/empresas");
}

// Segundo paso: el código de 6 dígitos de la app o un código de recuperación. Cinco códigos errados anulan el paso
// (hay que volver a poner la contraseña) y cuentan para el límite de intentos del correo.
export async function verificarEntrada(_: Estado, fd: FormData): Promise<Estado> {
  const p = await entradaPendiente();
  if (!p) return { error: "Pasaron más de 10 minutos o ya no es válido. Vuelve a entrar con tu correo y contraseña." };
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() || null;
  if (p.fallos >= MAX_FALLOS_CODIGO || (await entradaBloqueada(db(), p.email, ip))) {
    await cerrarPendiente(p.token_hash);
    return { error: `Demasiados códigos incorrectos. Espera ${MINUTOS} minutos y vuelve a entrar.` };
  }
  const r = await comprobarSegundoPaso(p.usuario_id, texto(fd, "codigo"));
  await anotarIntento(db(), p.email, ip, r !== null);
  if (r === null) {
    await db()`UPDATE entradas_pendientes SET fallos = fallos + 1 WHERE token_hash = ${p.token_hash}`;
    const quedan = MAX_FALLOS_CODIGO - p.fallos - 1;
    return { error: `El código no es correcto.${quedan > 0 ? ` Te quedan ${quedan} intentos.` : ""} Revisa que la hora del celular esté en automático.` };
  }
  await cerrarPendiente(p.token_hash);
  if (r !== "app") {
    await avisarCambio(p.email, p.nombre, "se entró con un código de recuperación",
      r > 0 ? `Te quedan ${r} códigos. Si perdiste el celular, configura la app de nuevo en Mi cuenta.` : "Ya no te quedan códigos: genera nuevos en Mi cuenta.");
  }
  await iniciarSesion(p.usuario_id);
  redirect(p.destino);
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

// ───── Acceso por correo (enlaces de un solo uso, lib/enlaces.ts) ─────

export async function crearClaveConEnlace(token: string, _: Estado, fd: FormData): Promise<Estado> {
  const clave = String(fd.get("clave") ?? "");
  const repetida = String(fd.get("repetida") ?? "");
  if (clave.length < 10) return { error: "La contraseña debe tener al menos 10 caracteres." };
  if (clave !== repetida) return { error: "Las dos contraseñas no coinciden." };
  const usuarioId = await usarEnlace(token, clave);
  if (!usuarioId) return { error: "Este enlace ya se usó o venció. Pide uno nuevo en «¿Olvidaste tu contraseña?» o al administrador de tu firma." };
  // Recuperar la contraseña por correo no se salta la verificación en dos pasos.
  return continuarEntrada(usuarioId, "/empresas?bienvenida=1");
}

// Siempre responde lo mismo, exista o no la cuenta, para no revelar qué correos están registrados.
export async function pedirRecuperacion(_: Estado, fd: FormData): Promise<Estado> {
  const email = texto(fd, "email").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "El correo no es válido." };
  const respuesta = { ok: `Si ${email} tiene una cuenta, le llegará en unos minutos un correo con el enlace para crear una nueva contraseña (vale 1 hora). Revisa también la carpeta de spam.` };
  const [u] = await db()<{ id: string; nombre: string }[]>`SELECT id, nombre FROM usuarios WHERE email = ${email}`;
  if (!u || (await recuperacionesRecientes(u.id)) >= 3) return respuesta;
  const url = await db().begin((tx) => crearEnlace(tx, u.id, "recuperacion", null)) as string;
  await enviarEnlace({ para: email, nombre: u.nombre, url, tipo: "recuperacion" });
  return respuesta;
}
