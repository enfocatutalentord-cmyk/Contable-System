"use server";

import { revalidatePath } from "next/cache";
import { accesoFirma, esUuid } from "@/lib/acceso";
import { ErrorContable } from "@/lib/asientos";
import { conUsuario, mensajeError } from "@/lib/db";
import { asegurarUsuario, revisarQueQuedeAdministrador } from "@/lib/equipo";
import { esPermiso, TODOS_LOS_PERMISOS } from "@/lib/permisos";
import type { Estado } from "../acciones-cuenta";

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();

export async function agregarPersona(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  const email = texto(fd, "email").toLowerCase();
  const nombre = texto(fd, "nombre");
  const administrador = fd.get("administrador") === "on";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "El correo no es válido." };
  try {
    const r = await conUsuario(usuario.id, async (tx) => {
      const u = await asegurarUsuario(tx, email, nombre);
      const x = await tx`INSERT INTO miembros_firma (firma_id, usuario_id, administrador) VALUES (${firmaId}, ${u.id}, ${administrador}) ON CONFLICT DO NOTHING`;
      if (x.count === 0) throw new ErrorContable("Esa persona ya es parte de la firma");
      return u;
    });
    revalidatePath(`/firma/${firmaId}/equipo`);
    return {
      ok: r.temporal
        ? `Cuenta creada. Contraseña temporal para ${email}: ${r.temporal} (cópiala ahora; no se vuelve a mostrar). Asígnale clientes abajo.`
        : `${email} ya es parte de la firma. Asígnale clientes abajo.`,
    };
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
