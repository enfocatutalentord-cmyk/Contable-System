import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { exigirUsuario, type Usuario } from "./auth";
import { db } from "./db";
import { puede, TODOS_LOS_PERMISOS, type Permiso } from "./permisos";
import { PESTANAS_CONTABLES, PESTANAS_SOLO_PROPIA, pestanaDeRuta, pestanasDelRol, pestanasEn, puedeVer } from "./pestanas";
import { esDuenaPlataforma, supervisionVigente, type Supervision } from "./plataforma";
import { alcanceIncluye } from "./permisos-persona.ts";

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
  supervision?: Supervision; // la dueña de la plataforma supervisando en solo lectura, con permiso de la firma
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (v: string) => UUID.test(v);

// Acceso a una empresa cliente: el administrador de la firma entra a todas sus empresas con todos los permisos;
// el resto del equipo solo a las que tenga asignadas, con los permisos de su perfil.
export const accesoEmpresa = cache(async (empresaId: string): Promise<Acceso> => {
  const usuario = await exigirUsuario();
  if (!UUID.test(empresaId)) notFound();
  const [fila] = await db()<(Empresa & { exigir_dos_pasos: boolean; suspendida: boolean; administrador: boolean; perfil: string | null; permisos: string[] | null; pestanas: string[] | null; para_clientes: boolean | null; rol_administrador: boolean | null; es_propia: boolean; lleva_contabilidad: boolean;
    responsable_id: string | null; mf_permisos_clientes: string[] | null; mf_pestanas_clientes: string[] | null; mf_alcance: string; mf_clientes: string[];
    mf_permisos_empire: string[] | null; mf_pestanas_empire: string[] | null })[]>`
    SELECT e.id, e.nombre, e.rnc, e.moneda, to_char(e.fecha_bloqueo, 'YYYY-MM-DD') AS fecha_bloqueo, e.firma_id,
           f.nombre AS firma, e.requiere_aprobacion, e.activa, f.exigir_dos_pasos, f.suspendida_en IS NOT NULL AS suspendida, mf.administrador, p.nombre AS perfil, p.permisos, p.pestanas, p.para_clientes,
           (p.sistema AND p.nombre = 'Administrador') AS rol_administrador, e.id = f.empresa_propia_id AS es_propia, e.lleva_contabilidad, e.responsable_id,
           mf.permisos_clientes AS mf_permisos_clientes, mf.pestanas_clientes AS mf_pestanas_clientes, mf.alcance AS mf_alcance,
           mf.clientes::text[] AS mf_clientes, mf.permisos_empire AS mf_permisos_empire, mf.pestanas_empire AS mf_pestanas_empire
      FROM empresas e
      JOIN firmas f ON f.id = e.firma_id
      JOIN miembros_firma mf ON mf.firma_id = e.firma_id AND mf.usuario_id = ${usuario.id}
      LEFT JOIN miembros m ON m.empresa_id = e.id AND m.usuario_id = ${usuario.id}
      LEFT JOIN perfiles p ON p.id = m.perfil_id
     WHERE e.id = ${empresaId}`;
  if (!fila) {
    const s = await accesoSupervision(usuario, empresaId);
    if (s) return s;
    notFound();
  }
  // Permisos propios de la persona (rediseño R6): en la empresa propia, los de Contabilidad Empire; en un cliente de su alcance, los de la
  // Firma. Mandan sobre el rol que tenga en esa empresa. Sin permisos propios, sigue su rol cliente por cliente.
  const propios = fila.administrador ? null
    : fila.es_propia ? (fila.mf_permisos_empire ? { permisos: fila.mf_permisos_empire, pestanas: fila.mf_pestanas_empire ?? [""] } : null)
    : fila.mf_permisos_clientes && alcanceIncluye({ alcance: fila.mf_alcance, clientes: fila.mf_clientes ?? [] }, fila, usuario.id)
      ? { permisos: fila.mf_permisos_clientes, pestanas: fila.mf_pestanas_clientes ?? [""] } : null;
  if (!fila.administrador && !fila.permisos && !propios) notFound();
  const { administrador, perfil, permisos: permisosRol, pestanas: pestanasRol, para_clientes, exigir_dos_pasos, suspendida, rol_administrador, es_propia, lleva_contabilidad,
    responsable_id: _r, mf_permisos_clientes: _a, mf_pestanas_clientes: _b, mf_alcance: _c, mf_clientes: _d, mf_permisos_empire: _e, mf_pestanas_empire: _f, ...empresa } = fila;
  void [_r, _a, _b, _c, _d, _e, _f];
  const permisos = propios ? propios.permisos : permisosRol;
  const pestanas = propios ? propios.pestanas : pestanasRol;
  // Firma suspendida desde la Consola de la plataforma: nadie de la firma entra (los datos se conservan).
  if (suspendida) redirect("/suspendida");
  exigirDosPasos(usuario, exigir_dos_pasos);
  const visibles = pestanasEn(propios ? pestanas : pestanasDelRol(pestanas, administrador || !!rol_administrador), es_propia, lleva_contabilidad);
  // Si el rol no ve la pestaña pedida, se le lleva a la primera que sí ve (la revisión es en el servidor, no solo en el menú).
  const ruta = (await headers()).get("x-ruta") ?? "";
  const resto = ruta.startsWith(`/e/${empresaId}`) ? ruta.slice(`/e/${empresaId}`.length) : null;
  const pestana = resto === null ? null : pestanaDeRuta(resto);
  if (pestana !== null && !puedeVer(visibles, pestana)) {
    // Igualas, recurrentes, propuestas y lo de la socia solo existen en la empresa propia (rediseño R2).
    if (!es_propia && PESTANAS_SOLO_PROPIA.includes(pestana)) redirect(`/e/${empresaId}?solo_empire=1`);
    // Asientos, libros, catálogo, bancos y cierre: a los clientes no se les lleva contabilidad (rediseño R3).
    if (!es_propia && !lleva_contabilidad && PESTANAS_CONTABLES.includes(pestana)) redirect(`/e/${empresaId}?sin_contabilidad=1`);
    const primera = visibles?.[0];
    if (primera === undefined) notFound();
    redirect(`/e/${empresaId}${primera}?sin_pestana=1`);
  }
  return {
    usuario,
    empresa,
    adminFirma: administrador,
    perfil: administrador ? "Administrador de la firma" : propios ? "Permisos propios" : perfil!,
    permisos: administrador ? TODOS_LOS_PERMISOS : (permisos!.filter((p) => (TODOS_LOS_PERMISOS as string[]).includes(p)) as Permiso[]),
    pestanas: visibles,
    paraClientes: !administrador && !propios && !!para_clientes,
  };
});

// Supervisión de la plataforma: la dueña (con dos pasos), una supervisión suya vigente en esa firma y el permiso de la firma
// vigente. Recibe solo el permiso «ver»: el servidor rechaza cualquier acción que guarde, emita, anule o descargue.
async function accesoSupervision(usuario: Usuario, empresaId: string): Promise<Acceso | null> {
  if (!usuario.dosPasos || !(await esDuenaPlataforma(usuario.email))) return null;
  const [e] = await db()<Empresa[]>`
    SELECT e.id, e.nombre, e.rnc, e.moneda, to_char(e.fecha_bloqueo, 'YYYY-MM-DD') AS fecha_bloqueo, e.firma_id,
           f.nombre AS firma, e.requiere_aprobacion, e.activa
      FROM empresas e JOIN firmas f ON f.id = e.firma_id WHERE e.id = ${empresaId}`;
  if (!e) return null;
  const supervision = await supervisionVigente(usuario.id, e.firma_id);
  if (!supervision) return null;
  return { usuario, empresa: e, adminFirma: false, perfil: "Supervisión de la plataforma (solo lectura)", permisos: ["ver"], pestanas: pestanasDelRol(null, false), paraClientes: false, supervision };
}

// Para server actions y páginas que requieren un permiso puntual. La pestaña se revisa aparte porque una acción del
// servidor se puede llamar desde cualquier página: así, quien no ve Asientos tampoco contabiliza un asiento por otra vía.
export async function exigirPermiso(empresaId: string, permiso: Permiso, pestana?: string): Promise<Acceso> {
  const acceso = await accesoEmpresa(empresaId);
  const inicio = `/e/${empresaId}${acceso.pestanas?.[0] ?? ""}`;
  if (pestana !== undefined && !puedeVer(acceso.pestanas, pestana)) redirect(`${inicio}?sin_pestana=1`);
  if (!puede(acceso.permisos, permiso)) redirect(`${inicio}?sin_permiso=1`);
  return acceso;
}

// Pestañas que la persona ve en la empresa propia de la firma (Contabilidad Empire en el menú, rediseño R2): null = todas;
// false = no tiene acceso a ella.
export async function pestanasDePropia(propiaId: string | null, usuarioId: string, administrador: boolean): Promise<string[] | null | false> {
  if (!propiaId) return false;
  if (administrador) return null;
  const [mf] = await db()<{ pestanas: string[] | null; permisos: string[] | null }[]>`
    SELECT mf.pestanas_empire AS pestanas, mf.permisos_empire AS permisos FROM miembros_firma mf JOIN empresas e ON e.firma_id = mf.firma_id
     WHERE e.id = ${propiaId} AND mf.usuario_id = ${usuarioId}`;
  if (mf?.permisos) return mf.pestanas ?? [""];
  const [m] = await db()<{ pestanas: string[] | null; rol_administrador: boolean }[]>`
    SELECT p.pestanas, (p.sistema AND p.nombre = 'Administrador') AS rol_administrador
      FROM miembros m JOIN perfiles p ON p.id = m.perfil_id WHERE m.empresa_id = ${propiaId} AND m.usuario_id = ${usuarioId}`;
  return m ? pestanasDelRol(m.pestanas, m.rol_administrador) : false;
}

export type Firma = { id: string; nombre: string; rnc: string | null; administrador: boolean; exigir_dos_pasos: boolean; suspendida: boolean; empresa_propia_id: string | null; alta_clientes: boolean; crear_clientes: boolean };

export const misFirmas = cache(async (usuarioId: string): Promise<Firma[]> => {
  return db()<Firma[]>`
    SELECT f.id, f.nombre, f.rnc, mf.administrador, f.exigir_dos_pasos, f.suspendida_en IS NOT NULL AS suspendida, f.empresa_propia_id, f.alta_clientes,
           mf.administrador OR mf.crear_clientes AS crear_clientes FROM miembros_firma mf JOIN firmas f ON f.id = mf.firma_id
     WHERE mf.usuario_id = ${usuarioId} ORDER BY f.nombre`;
});

export async function accesoFirma(firmaId: string, soloAdministrador = true): Promise<{ usuario: Usuario; firma: Firma }> {
  const usuario = await exigirUsuario();
  if (!UUID.test(firmaId)) notFound();
  const firma = (await misFirmas(usuario.id)).find((f) => f.id === firmaId);
  if (!firma) notFound();
  if (firma.suspendida) redirect("/suspendida");
  exigirDosPasos(usuario, firma.exigir_dos_pasos);
  if (soloAdministrador && !firma.administrador) redirect("/empresas?sin_permiso=1");
  return { usuario, firma };
}

// ¿La persona entra a esta firma solo como usuario de empresas cliente? Entonces no ve las pantallas de la firma.
export const soloCliente = cache(async (firmaId: string, usuarioId: string): Promise<boolean> => {
  const [r] = await db()<{ solo: boolean }[]>`
    SELECT NOT mf.administrador AND mf.permisos_clientes IS NULL AND mf.permisos_empire IS NULL AND EXISTS (SELECT 1 FROM miembros m JOIN empresas e ON e.id = m.empresa_id
                                             WHERE m.usuario_id = mf.usuario_id AND e.firma_id = mf.firma_id)
           AND NOT EXISTS (SELECT 1 FROM miembros m JOIN empresas e ON e.id = m.empresa_id JOIN perfiles p ON p.id = m.perfil_id
                            WHERE m.usuario_id = mf.usuario_id AND e.firma_id = mf.firma_id AND NOT p.para_clientes) AS solo
      FROM miembros_firma mf WHERE mf.firma_id = ${firmaId} AND mf.usuario_id = ${usuarioId}`;
  return !!r?.solo;
});

// Consola de la plataforma: solo las dueñas de la plataforma, y con la verificación en dos pasos.
export async function exigirDuena(): Promise<Usuario> {
  const usuario = await exigirUsuario();
  if (!(await esDuenaPlataforma(usuario.email))) notFound();
  if (!usuario.dosPasos) redirect("/cuenta?exigido=consola#dos-pasos");
  return usuario;
}
