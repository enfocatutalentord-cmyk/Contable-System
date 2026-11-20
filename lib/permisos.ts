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
  { clave: "impuestos", nombre: "Configurar impuestos, retenciones y comprobantes" },
  { clave: "usuarios", nombre: "Dar y quitar acceso a la empresa" },
  { clave: "aprobar", nombre: "Aprobar o devolver lo que otros preparan (Por aprobar)" },
] as const;

export type Permiso = (typeof PERMISOS)[number]["clave"];
export const TODOS_LOS_PERMISOS: Permiso[] = PERMISOS.map((p) => p.clave);

export function esPermiso(v: string): v is Permiso {
  return (TODOS_LOS_PERMISOS as string[]).includes(v);
}

export function puede(permisos: readonly string[], permiso: Permiso): boolean {
  return permisos.includes(permiso);
}

// Prioridad 2.1 (P2a): cada permiso de una persona tiene tres niveles: No puede, Puede hacerlo (queda en firme) y Puede hacerlo, con
// aprobación (queda pendiente hasta que alguien con «aprobar» lo apruebe). Se guarda en la misma lista de permisos de la persona: el
// permiso solo = «Puede»; el permiso con el sufijo «~aprob» = «Puede, con aprobación». Solo estos permisos admiten el tercer nivel.
export const SUFIJO_APROBACION = "~aprob";
export const CON_APROBACION: readonly Permiso[] = ["contabilizar", "revertir", "cerrar", "impuestos"];
export type Nivel = "no" | "si" | "aprob";
export const NIVELES: Record<Nivel, string> = { no: "No puede", si: "Puede hacerlo", aprob: "Puede, con aprobación" };

// De la lista guardada: los permisos que la persona tiene (con y sin aprobación) y cuáles de ellos piden aprobación.
export function leerNiveles(guardados: readonly string[]): { permisos: Permiso[]; conAprobacion: Permiso[] } {
  const permisos = new Set<Permiso>(), conAprobacion = new Set<Permiso>();
  for (const g of guardados) {
    const aprob = g.endsWith(SUFIJO_APROBACION);
    const clave = aprob ? g.slice(0, -SUFIJO_APROBACION.length) : g;
    if (!esPermiso(clave)) continue;
    if (aprob && !CON_APROBACION.includes(clave)) continue;
    permisos.add(clave);
    if (aprob) conAprobacion.add(clave);
  }
  return { permisos: [...permisos], conAprobacion: [...conAprobacion] };
}

export const nivelDe = (guardados: readonly string[], permiso: Permiso): Nivel => {
  const { permisos, conAprobacion } = leerNiveles(guardados);
  return !permisos.includes(permiso) ? "no" : conAprobacion.includes(permiso) ? "aprob" : "si";
};

export const guardarNivel = (permiso: Permiso, nivel: Nivel): string | null =>
  nivel === "no" ? null : nivel === "aprob" && CON_APROBACION.includes(permiso) ? `${permiso}${SUFIJO_APROBACION}` : permiso;

export const REGIMENES: Record<string, string> = {
  ordinario: "Régimen ordinario",
  rst: "Régimen Simplificado de Tributación (RST)",
  no_lucrativa: "Entidad sin fines de lucro",
  zona_franca: "Zona franca",
  otro: "Otro régimen especial",
};

export const TIPOS_IDENTIFICACION: Record<string, string> = { rnc: "RNC", cedula: "Cédula", pasaporte: "Pasaporte" };

export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// Para mostrar un botón de lo que la persona puede hacer en firme o puede pedir con aprobación.
export const puedeOPide = (permisos: readonly string[], conAprobacion: readonly string[], permiso: Permiso): boolean =>
  permisos.includes(permiso) || conAprobacion.includes(permiso);
