import { esPermiso, type Permiso } from "./permisos.ts";
import { esPestana, PESTANAS_PRIVADAS, TODAS_LAS_PESTANAS } from "./pestanas.ts";

// Rediseño R6 (n.º 19 de la Lista de rediseños): permisos por persona con casillas, por sección. Una persona del equipo puede tener
// sus propios permisos y pantallas para la Firma (los clientes) y para Contabilidad Empire, con un alcance: todos los clientes,
// solo los suyos (donde es responsable) o los que se elijan. Los roles de la firma sirven de plantillas: se suman.

export type Alcance = "todos" | "mis_clientes" | "elegidos";
export const ALCANCES: Record<Alcance, string> = {
  todos: "Todos los clientes", mis_clientes: "Solo los clientes donde es responsable", elegidos: "Solo los clientes que se marquen",
};

export type Seccion = { permisos: Permiso[]; pestanas: string[] };
export type PermisosPersona = {
  clientes: Seccion | null; // null: sin permisos propios en los clientes (sigue con sus roles cliente por cliente)
  alcance: Alcance;
  elegidos: string[];
  empire: Seccion | null;   // null: sin acceso propio a Contabilidad Empire
  crearClientes: boolean;
  plantillas: string[];
};

// ¿El alcance de la persona incluye este cliente?
export function alcanceIncluye(p: { alcance: string; clientes: string[] }, empresa: { id: string; responsable_id: string | null }, usuarioId: string) {
  return p.alcance === "todos" || (p.alcance === "mis_clientes" && empresa.responsable_id === usuarioId) || p.clientes.includes(empresa.id);
}

// Suma las casillas de varios roles (las plantillas). Un rol sin lista de pantallas las tiene todas, menos las privadas de la socia.
export function sumarPlantillas(roles: { permisos: string[]; pestanas: string[] | null }[]): Seccion {
  const permisos = new Set<Permiso>(), pestanas = new Set<string>();
  for (const r of roles) {
    for (const p of r.permisos) if (esPermiso(p)) permisos.add(p);
    for (const t of r.pestanas ?? TODAS_LAS_PESTANAS.filter((x) => !PESTANAS_PRIVADAS.includes(x))) if (esPestana(t)) pestanas.add(t);
  }
  return { permisos: [...permisos], pestanas: TODAS_LAS_PESTANAS.filter((t) => pestanas.has(t)) };
}

const lista = (fd: FormData, campo: string) => fd.getAll(campo).map(String);

// Lee las casillas de la pantalla Personas y accesos.
export function leerPermisosPersona(fd: FormData): PermisosPersona {
  const seccion = (prefijo: string, activa: boolean): Seccion | null => {
    if (!activa) return null;
    const permisos = lista(fd, `${prefijo}_permiso`).filter(esPermiso);
    const pestanas = lista(fd, `${prefijo}_pestana`).filter(esPestana);
    // Sin «ver» no tiene sentido entrar: se marca solo si hay algo más marcado.
    if ((permisos.length || pestanas.length) && !permisos.includes("ver")) permisos.unshift("ver");
    return { permisos, pestanas: pestanas.includes("") || !pestanas.length ? ["", ...pestanas.filter((x) => x !== "")] : pestanas };
  };
  const alcance = String(fd.get("alcance") ?? "elegidos");
  return {
    clientes: seccion("c", fd.get("clientes_activo") === "on"),
    alcance: (alcance in ALCANCES ? alcance : "elegidos") as Alcance,
    elegidos: lista(fd, "cliente").filter((x) => /^[0-9a-f-]{36}$/i.test(x)),
    empire: seccion("e", fd.get("empire_activo") === "on"),
    crearClientes: fd.get("crear_clientes") === "on",
    plantillas: lista(fd, "plantilla").slice(0, 10),
  };
}
