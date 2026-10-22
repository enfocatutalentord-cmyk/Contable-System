// Permisos por función. Cada perfil de la firma es un conjunto de estos permisos (tabla `perfiles`, editable).
export const PERMISOS = [
  { clave: "ver", nombre: "Ver libros y reportes" },
  { clave: "registrar", nombre: "Registrar asientos y documentos" },
  { clave: "contabilizar", nombre: "Contabilizar (aprobar) asientos" },
  { clave: "revertir", nombre: "Revertir asientos y anular documentos" },
  { clave: "catalogo", nombre: "Editar catálogo y configuración contable" },
  { clave: "cerrar", nombre: "Cerrar períodos" },
  { clave: "reabrir", nombre: "Reabrir períodos cerrados" },
  { clave: "adjuntar", nombre: "Adjuntar y retirar documentos" },
  { clave: "exportar", nombre: "Descargar Excel y PDF" },
  { clave: "auditoria", nombre: "Ver el historial de cambios" },
  { clave: "empresa", nombre: "Editar la ficha de la empresa" },
  { clave: "usuarios", nombre: "Dar y quitar acceso a la empresa" },
] as const;

export type Permiso = (typeof PERMISOS)[number]["clave"];
export const TODOS_LOS_PERMISOS: Permiso[] = PERMISOS.map((p) => p.clave);

export function esPermiso(v: string): v is Permiso {
  return (TODOS_LOS_PERMISOS as string[]).includes(v);
}

export function puede(permisos: readonly string[], permiso: Permiso): boolean {
  return permisos.includes(permiso);
}

export const REGIMENES: Record<string, string> = {
  ordinario: "Régimen ordinario",
  rst: "Régimen Simplificado de Tributación (RST)",
  no_lucrativa: "Entidad sin fines de lucro",
  zona_franca: "Zona franca",
  otro: "Otro régimen especial",
};

export const TIPOS_IDENTIFICACION: Record<string, string> = { rnc: "RNC", cedula: "Cédula", pasaporte: "Pasaporte" };

export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
