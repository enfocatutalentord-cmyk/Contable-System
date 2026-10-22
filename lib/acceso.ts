import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { exigirUsuario, type Usuario } from "./auth";
import { db } from "./db";
import { puede, TODOS_LOS_PERMISOS, type Permiso } from "./permisos";

export type Empresa = {
  id: string; nombre: string; rnc: string | null; moneda: string; fecha_bloqueo: string | null;
  firma_id: string; firma: string; requiere_aprobacion: boolean; activa: boolean;
};
export type Acceso = { usuario: Usuario; empresa: Empresa; permisos: Permiso[]; perfil: string; adminFirma: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (v: string) => UUID.test(v);

// Acceso a una empresa cliente: el administrador de la firma entra a todas sus empresas con todos los permisos;
// el resto del equipo solo a las que tenga asignadas, con los permisos de su perfil.
export const accesoEmpresa = cache(async (empresaId: string): Promise<Acceso> => {
  const usuario = await exigirUsuario();
  if (!UUID.test(empresaId)) notFound();
  const [fila] = await db()<(Empresa & { administrador: boolean; perfil: string | null; permisos: string[] | null })[]>`
    SELECT e.id, e.nombre, e.rnc, e.moneda, to_char(e.fecha_bloqueo, 'YYYY-MM-DD') AS fecha_bloqueo, e.firma_id,
           f.nombre AS firma, e.requiere_aprobacion, e.activa, mf.administrador, p.nombre AS perfil, p.permisos
      FROM empresas e
      JOIN firmas f ON f.id = e.firma_id
      JOIN miembros_firma mf ON mf.firma_id = e.firma_id AND mf.usuario_id = ${usuario.id}
      LEFT JOIN miembros m ON m.empresa_id = e.id AND m.usuario_id = ${usuario.id}
      LEFT JOIN perfiles p ON p.id = m.perfil_id
     WHERE e.id = ${empresaId}`;
  if (!fila || (!fila.administrador && !fila.permisos)) notFound();
  const { administrador, perfil, permisos, ...empresa } = fila;
  return {
    usuario,
    empresa,
    adminFirma: administrador,
    perfil: administrador ? "Administrador de la firma" : perfil!,
    permisos: administrador ? TODOS_LOS_PERMISOS : (permisos!.filter((p) => (TODOS_LOS_PERMISOS as string[]).includes(p)) as Permiso[]),
  };
});

// Para server actions y páginas que requieren un permiso puntual.
export async function exigirPermiso(empresaId: string, permiso: Permiso): Promise<Acceso> {
  const acceso = await accesoEmpresa(empresaId);
  if (!puede(acceso.permisos, permiso)) redirect(`/e/${empresaId}?sin_permiso=1`);
  return acceso;
}

export type Firma = { id: string; nombre: string; rnc: string | null; administrador: boolean };

export const misFirmas = cache(async (usuarioId: string): Promise<Firma[]> => {
  return db()<Firma[]>`
    SELECT f.id, f.nombre, f.rnc, mf.administrador FROM miembros_firma mf JOIN firmas f ON f.id = mf.firma_id
     WHERE mf.usuario_id = ${usuarioId} ORDER BY f.nombre`;
});

export async function accesoFirma(firmaId: string, soloAdministrador = true): Promise<{ usuario: Usuario; firma: Firma }> {
  const usuario = await exigirUsuario();
  if (!UUID.test(firmaId)) notFound();
  const firma = (await misFirmas(usuario.id)).find((f) => f.id === firmaId);
  if (!firma) notFound();
  if (soloAdministrador && !firma.administrador) redirect("/empresas?sin_permiso=1");
  return { usuario, firma };
}
