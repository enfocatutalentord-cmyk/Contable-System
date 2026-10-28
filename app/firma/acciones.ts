"use server";

import { revalidatePath } from "next/cache";
import { accesoFirma, esUuid } from "@/lib/acceso";
import { ErrorContable } from "@/lib/asientos";
import { conUsuario, mensajeError } from "@/lib/db";
import { enviarCorreo } from "@/lib/correo";
import { crearEnlace, enviarEnlace, urlApp } from "@/lib/enlaces";
import { asegurarUsuario, avisoEnlace, revisarQueQuedeAdministrador } from "@/lib/equipo";
import { esPermiso, TODOS_LOS_PERMISOS } from "@/lib/permisos";
import type { Estado } from "../acciones-cuenta";

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();

export async function agregarPersona(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, firma } = await accesoFirma(firmaId);
  const email = texto(fd, "email").toLowerCase();
  const nombre = texto(fd, "nombre");
  const administrador = fd.get("administrador") === "on";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "El correo no es válido." };
  try {
    const r = await conUsuario(usuario.id, async (tx) => {
      const u = await asegurarUsuario(tx, email, nombre);
      const x = await tx`INSERT INTO miembros_firma (firma_id, usuario_id, administrador) VALUES (${firmaId}, ${u.id}, ${administrador}) ON CONFLICT DO NOTHING`;
      if (x.count === 0) throw new ErrorContable("Esa persona ya es parte de la firma");
      return { ...u, url: u.nuevo ? await crearEnlace(tx, u.id, "invitacion", usuario.id) : null };
    });
    revalidatePath(`/firma/${firmaId}/equipo`);
    if (r.url) {
      const enviado = await enviarEnlace({ para: email, nombre: r.nombre, url: r.url, tipo: "invitacion", firma: firma.nombre, quien: usuario.nombre });
      return { ok: `${avisoEnlace(email, enviado, r.url)} Asígnale clientes abajo.` };
    }
    // Ya tenía cuenta: solo se le avisa, entra con su contraseña de siempre.
    await enviarCorreo({
      para: email, asunto: `Acceso a ${firma.nombre}`, titulo: `Hola, ${r.nombre}`,
      parrafos: [`${usuario.nombre} te agregó a la firma ${firma.nombre} en el sistema contable.`, "Entra con tu correo y tu contraseña de siempre."],
      boton: { texto: "Entrar al sistema", url: `${await urlApp()}/entrar` },
    });
    return { ok: `${email} ya tenía cuenta: ahora es parte de la firma y entra con su contraseña de siempre. Asígnale clientes abajo.` };
  } catch (e) {
    return { error: mensajeError(e) };
  }
}

// Envía (o reenvía) a una persona del equipo el enlace para crear su contraseña: sirve si no le llegó la invitación
// o si la olvidó. El enlace anterior deja de servir.
export async function enviarAcceso(firmaId: string, personaId: string, _: Estado): Promise<Estado> {
  const { usuario, firma } = await accesoFirma(firmaId);
  if (!esUuid(personaId)) return { error: "Persona no válida." };
  try {
    const r = await conUsuario(usuario.id, async (tx) => {
      const [p] = await tx<{ email: string; nombre: string; verificado: boolean }[]>`
        SELECT u.email, u.nombre, u.correo_verificado IS NOT NULL AS verificado
          FROM miembros_firma mf JOIN usuarios u ON u.id = mf.usuario_id WHERE mf.firma_id = ${firmaId} AND mf.usuario_id = ${personaId}`;
      if (!p) throw new ErrorContable("Esa persona no es parte de la firma");
      const tipo = p.verificado ? "recuperacion" as const : "invitacion" as const;
      return { ...p, tipo, url: await crearEnlace(tx, personaId, tipo, usuario.id) };
    });
    const enviado = await enviarEnlace({ para: r.email, nombre: r.nombre, url: r.url, tipo: r.tipo, firma: firma.nombre, quien: usuario.nombre });
    return { ok: avisoEnlace(r.email, enviado, r.url, r.tipo === "invitacion") };
  } catch (e) {
    return { error: mensajeError(e) };
  }
}

export async function guardarAccesos(firmaId: string, personaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  if (!esUuid(personaId)) return { error: "Persona no válida." };
  try {
    await conUsuario(usuario.id, async (tx) => {
      const [m] = await tx`SELECT 1 FROM miembros_firma WHERE firma_id = ${firmaId} AND usuario_id = ${personaId}`;
      if (!m) throw new ErrorContable("Esa persona no es parte de la firma");
      await tx`UPDATE miembros_firma SET administrador = ${fd.get("administrador") === "on"}
               WHERE firma_id = ${firmaId} AND usuario_id = ${personaId}`;
      await revisarQueQuedeAdministrador(tx, firmaId);
      const empresas = await tx<{ id: string }[]>`SELECT id FROM empresas WHERE firma_id = ${firmaId}`;
      const perfiles = new Set((await tx<{ id: string }[]>`SELECT id FROM perfiles WHERE firma_id = ${firmaId}`).map((p) => p.id));
      for (const { id } of empresas) {
        const perfil = texto(fd, `acceso_${id}`);
        if (!perfil) {
          await tx`DELETE FROM miembros WHERE empresa_id = ${id} AND usuario_id = ${personaId}`;
        } else if (perfiles.has(perfil)) {
          await tx`INSERT INTO miembros (empresa_id, usuario_id, perfil_id) VALUES (${id}, ${personaId}, ${perfil})
                   ON CONFLICT (empresa_id, usuario_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id`;
        }
      }
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/firma/${firmaId}/equipo`);
  return { ok: "Accesos guardados." };
}

export async function quitarDeFirma(firmaId: string, personaId: string, _: Estado): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  try {
    await conUsuario(usuario.id, async (tx) => {
      await tx`DELETE FROM miembros WHERE usuario_id = ${personaId} AND empresa_id IN (SELECT id FROM empresas WHERE firma_id = ${firmaId})`;
      await tx`DELETE FROM miembros_firma WHERE firma_id = ${firmaId} AND usuario_id = ${personaId}`;
      await revisarQueQuedeAdministrador(tx, firmaId);
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/firma/${firmaId}/equipo`);
  return { ok: "La persona ya no tiene acceso a la firma." };
}

export async function guardarPerfil(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  const id = texto(fd, "id");
  const nombre = texto(fd, "nombre");
  const permisos = fd.getAll("permisos").map(String).filter(esPermiso);
  if (!nombre) return { error: "Escribe el nombre del perfil." };
  if (!permisos.includes("ver")) permisos.unshift("ver");
  try {
    await conUsuario(usuario.id, async (tx) => {
      if (id) {
        const [p] = await tx<{ nombre: string; sistema: boolean }[]>`SELECT nombre, sistema FROM perfiles WHERE id = ${id} AND firma_id = ${firmaId}`;
        if (!p) throw new ErrorContable("El perfil no existe");
        // El perfil Administrador siempre tiene todos los permisos.
        const finales = p.sistema && p.nombre === "Administrador" ? TODOS_LOS_PERMISOS : permisos;
        await tx`UPDATE perfiles SET nombre = ${p.sistema ? p.nombre : nombre}, permisos = ${finales} WHERE id = ${id}`;
      } else {
        await tx`INSERT INTO perfiles (firma_id, nombre, permisos) VALUES (${firmaId}, ${nombre}, ${permisos})`;
      }
    });
  } catch (e) {
    const err = e as { code?: string };
    return { error: err.code === "23505" ? "Ya hay un perfil con ese nombre." : mensajeError(e) };
  }
  revalidatePath(`/firma/${firmaId}/perfiles`);
  return { ok: id ? "Perfil actualizado." : `Perfil «${nombre}» creado.` };
}

export async function eliminarPerfil(firmaId: string, perfilId: string, _: Estado): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  try {
    await conUsuario(usuario.id, async (tx) => {
      const [p] = await tx<{ sistema: boolean; usos: number }[]>`
        SELECT sistema, (SELECT count(*)::int FROM miembros WHERE perfil_id = perfiles.id) AS usos
          FROM perfiles WHERE id = ${perfilId} AND firma_id = ${firmaId}`;
      if (!p) throw new ErrorContable("El perfil no existe");
      if (p.sistema) throw new ErrorContable("Los perfiles base no se eliminan; puedes ajustar sus permisos");
      if (p.usos > 0) throw new ErrorContable(`El perfil está asignado ${p.usos} ${p.usos === 1 ? "vez" : "veces"}; cambia esos accesos primero`);
      await tx`DELETE FROM perfiles WHERE id = ${perfilId}`;
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/firma/${firmaId}/perfiles`);
  return { ok: "Perfil eliminado." };
}

// Nombre y RNC de la firma (salen arriba en todas las pantallas y en los correos de acceso).
export async function guardarFirma(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  const nombre = texto(fd, "nombre");
  const rnc = texto(fd, "rnc").replace(/[-\s]/g, "");
  if (!nombre) return { error: "Escribe el nombre de la firma." };
  if (rnc && !/^(\d{9}|\d{11})$/.test(rnc)) return { error: "El RNC debe tener 9 dígitos (o 11 si es cédula)." };
  try {
    await conUsuario(usuario.id, (tx) => tx`UPDATE firmas SET nombre = ${nombre}, rnc = ${rnc || null} WHERE id = ${firmaId}`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/firma/${firmaId}`, "layout");
  return { ok: "Datos de la firma guardados." };
}

// Persona del equipo que se ocupa de un cliente.
export async function asignarResponsable(firmaId: string, empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  const responsable = texto(fd, "responsable");
  if (!esUuid(empresaId) || (responsable && !esUuid(responsable))) return { error: "Datos no válidos." };
  try {
    await conUsuario(usuario.id, async (tx) => {
      if (responsable) {
        const [m] = await tx`SELECT 1 FROM miembros_firma WHERE firma_id = ${firmaId} AND usuario_id = ${responsable}`;
        if (!m) throw new ErrorContable("Esa persona no es parte de la firma");
      }
      await tx`SELECT set_config('app.empresa_id', ${empresaId}, true)`;
      const r = await tx`UPDATE empresas SET responsable_id = ${responsable || null} WHERE id = ${empresaId} AND firma_id = ${firmaId}`;
      if (r.count === 0) throw new ErrorContable("Cliente no encontrado");
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/firma/${firmaId}`, "layout");
  return { ok: "Responsable guardado." };
}
