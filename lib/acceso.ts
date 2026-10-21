import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { exigirUsuario, type Usuario } from "./auth";
import { db } from "./db";
import { puede, type Accion, type Rol } from "./permisos";

export type Empresa = { id: string; nombre: string; rnc: string | null; moneda: string; fecha_bloqueo: string | null };
export type Acceso = { usuario: Usuario; empresa: Empresa; rol: Rol };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const accesoEmpresa = cache(async (empresaId: string): Promise<Acceso> => {
  const usuario = await exigirUsuario();
  if (!UUID.test(empresaId)) notFound();
  const [fila] = await db()<(Empresa & { rol: Rol })[]>`
    SELECT e.id, e.nombre, e.rnc, e.moneda, to_char(e.fecha_bloqueo, 'YYYY-MM-DD') AS fecha_bloqueo, m.rol
      FROM miembros m JOIN empresas e ON e.id = m.empresa_id
     WHERE m.empresa_id = ${empresaId} AND m.usuario_id = ${usuario.id}`;
  if (!fila) notFound();
  const { rol, ...empresa } = fila;
  return { usuario, empresa, rol };
});

// Para server actions: además de pertenecer a la empresa, el rol debe permitir la acción.
export async function exigirPermiso(empresaId: string, accion: Accion): Promise<Acceso> {
  const acceso = await accesoEmpresa(empresaId);
  if (!puede(acceso.rol, accion)) redirect(`/e/${empresaId}?sin_permiso=1`);
  return acceso;
}
