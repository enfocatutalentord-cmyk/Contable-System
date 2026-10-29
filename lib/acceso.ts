import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { exigirUsuario, type Usuario } from "./auth";
import { db } from "./db";
import { puede, TODOS_LOS_PERMISOS, type Permiso } from "./permisos";
import { pestanaDeRuta, puedeVer, TODAS_LAS_PESTANAS } from "./pestanas";

export type Empresa = {
  id: string; nombre: string; rnc: string | null; moneda: string; fecha_bloqueo: string | null;
  firma_id: string; firma: string; requiere_aprobacion: boolean; activa: boolean;
};

// Si la firma exige la verificación en dos pasos y la persona no la tiene, se la lleva a activarla antes de seguir.
const exigirDosPasos = (usuario: Usuario, exigida: boolean) => {
  if (exigida && !usuario.dosPasos) redirect("/cuenta?exigido=1#dos-pasos");
};
export type Acceso = {
  usuario: Usuario; empresa: Empresa; permisos: Permiso[]; perfil: string; adminFirma: boolean;
  pestanas: string[] | null; // pestañas que ve su rol; null = todas
  paraClientes: boolean;     // rol de usuario de la empresa cliente (no del equipo de la firma)
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (v: string) => UUID.test(v);

// Acceso a una empresa cliente: el administrador de la firma entra a todas sus empresas con todos los permisos;
// el resto del equipo solo a las que tenga asignadas, con los permisos de su perfil.
export const accesoEmpresa = cache(async (empresaId: string): Promise<Acceso> => {
  const usuario = await exigirUsuario();
  if (!UUID.test(empresaId)) notFound();
  const [fila] = await db()<(Empresa & { exigir_dos_pasos: boolean; administrador: boolean; perfil: string | null; permisos: string[] | null; pestanas: string[] | null; para_clientes: boolean | null })[]>`
    SELECT e.id, e.nombre, e.rnc, e.moneda, to_char(e.fecha_bloqueo, 'YYYY-MM-DD') AS fecha_bloqueo, e.firma_id,
           f.nombre AS firma, e.requiere_aprobacion, e.activa, f.exigir_dos_pasos, mf.administrador, p.nombre AS perfil, p.permisos, p.pestanas, p.para_clientes
      FROM empresas e
      JOIN firmas f ON f.id = e.firma_id
      JOIN miembros_firma mf ON mf.firma_id = e.firma_id AND mf.usuario_id = ${usuario.id}
      LEFT JOIN miembros m ON m.empresa_id = e.id AND m.usuario_id = ${usuario.id}
      LEFT JOIN perfiles p ON p.id = m.perfil_id
     WHERE e.id = ${empresaId}`;
  if (!fila || (!fila.administrador && !fila.permisos)) notFound();
  const { administrador, perfil, permisos, pestanas, para_clientes, exigir_dos_pasos, ...empresa } = fila;
  exigirDosPasos(usuario, exigir_dos_pasos);
  const visibles = administrador || !pestanas ? null : pestanas.filter((p) => TODAS_LAS_PESTANAS.includes(p));
  // Si el rol no ve la pestaña pedida, se le lleva a la primera que sí ve (la revisión es en el servidor, no solo en el menú).
  const ruta = (await headers()).get("x-ruta") ?? "";
  const resto = ruta.startsWith(`/e/${empresaId}`) ? ruta.slice(`/e/${empresaId}`.length) : null;
  const pestana = resto === null ? null : pestanaDeRuta(resto);
  if (pestana !== null && !puedeVer(visibles, pestana)) {
    const primera = visibles?.[0];
    if (primera === undefined) notFound();
    redirect(`/e/${empresaId}${primera}?sin_pestana=1`);
  }
  return {
    usuario,
    empresa,
    adminFirma: administrador,
    perfil: administrador ? "Administrador de la firma" : perfil!,
    permisos: administrador ? TODOS_LOS_PERMISOS : (permisos!.filter((p) => (TODOS_LOS_PERMISOS as string[]).includes(p)) as Permiso[]),
    pestanas: visibles,
    paraClientes: !administrador && !!para_clientes,
  };
});

// Para server actions y páginas que requieren un permiso puntual. La pestaña se revisa aparte porque una acción del
// servidor se puede llamar desde cualquier página: así, quien no ve Asientos tampoco contabiliza un asiento por otra vía.
export async function exigirPermiso(empresaId: string, permiso: Permiso, pestana?: string): Promise<Acceso> {
  const acceso = await accesoEmpresa(empresaId);
  const inicio = `/e/${empresaId}${acceso.pestanas?.[0] ?? ""}`;
  if (pestana !== undefined && !puedeVer(acceso.pestanas, pestana)) redirect(`${inicio}?sin_pestana=1`);
  if (!puede(acceso.permisos, permiso)) redirect(`${inicio}?sin_permiso=1`);
  return acceso;
}

export type Firma = { id: string; nombre: string; rnc: string | null; administrador: boolean; exigir_dos_pasos: boolean };

export const misFirmas = cache(async (usuarioId: string): Promise<Firma[]> => {
  return db()<Firma[]>`
    SELECT f.id, f.nombre, f.rnc, mf.administrador, f.exigir_dos_pasos FROM miembros_firma mf JOIN firmas f ON f.id = mf.firma_id
     WHERE mf.usuario_id = ${usuarioId} ORDER BY f.nombre`;
});

export async function accesoFirma(firmaId: string, soloAdministrador = true): Promise<{ usuario: Usuario; firma: Firma }> {
  const usuario = await exigirUsuario();
  if (!UUID.test(firmaId)) notFound();
  const firma = (await misFirmas(usuario.id)).find((f) => f.id === firmaId);
  if (!firma) notFound();
  exigirDosPasos(usuario, firma.exigir_dos_pasos);
  if (soloAdministrador && !firma.administrador) redirect("/empresas?sin_permiso=1");
  return { usuario, firma };
}

// ¿La persona entra a esta firma solo como usuario de empresas cliente? Entonces no ve las pantallas de la firma.
export const soloCliente = cache(async (firmaId: string, usuarioId: string): Promise<boolean> => {
  const [r] = await db()<{ solo: boolean }[]>`
    SELECT NOT mf.administrador AND EXISTS (SELECT 1 FROM miembros m JOIN empresas e ON e.id = m.empresa_id
                                             WHERE m.usuario_id = mf.usuario_id AND e.firma_id = mf.firma_id)
           AND NOT EXISTS (SELECT 1 FROM miembros m JOIN empresas e ON e.id = m.empresa_id JOIN perfiles p ON p.id = m.perfil_id
                            WHERE m.usuario_id = mf.usuario_id AND e.firma_id = mf.firma_id AND NOT p.para_clientes) AS solo
      FROM miembros_firma mf WHERE mf.firma_id = ${firmaId} AND mf.usuario_id = ${usuarioId}`;
  return !!r?.solo;
});
