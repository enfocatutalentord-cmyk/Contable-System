export type Rol = "dueno" | "contador" | "auxiliar" | "lectura";
export type Accion = "ver" | "registrar" | "anular" | "catalogo" | "cerrar" | "reabrir" | "usuarios";

const PERMISOS: Record<Rol, Accion[]> = {
  dueno: ["ver", "registrar", "anular", "catalogo", "cerrar", "reabrir", "usuarios"],
  contador: ["ver", "registrar", "anular", "catalogo", "cerrar"],
  auxiliar: ["ver", "registrar"],
  lectura: ["ver"],
};

export const NOMBRE_ROL: Record<Rol, string> = {
  dueno: "Dueño",
  contador: "Contador",
  auxiliar: "Auxiliar",
  lectura: "Solo lectura",
};

export function puede(rol: Rol, accion: Accion): boolean {
  return PERMISOS[rol].includes(accion);
}
