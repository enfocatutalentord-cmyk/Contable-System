import { pideAprobacion, type Acceso } from "@/lib/acceso";
import { pedirAccion } from "@/lib/aprobaciones";
import { bitacora, ErrorContable } from "@/lib/asientos";
import { conEmpresa, mensajeError } from "@/lib/db";
import type { Permiso } from "@/lib/permisos";
import type { Estado } from "../../acciones-cuenta";

// Prioridad 2.1 (P2a, parte 2): si la persona tiene el permiso «con aprobación», lo que iba a hacer no se hace: se guarda con sus datos y
// espera en «Por aprobar». Cada acción que lo admite llama esto al empezar y, si devuelve algo, termina con ese resultado.
// Módulo normal (no «use server») para poder exportar funciones auxiliares sin volverlas acciones.

// Un resumen corto de lo que se pidió, con los primeros datos del formulario.
function resumen(fd: FormData | undefined): string {
  const partes: string[] = [];
  for (const [k, v] of fd?.entries() ?? []) {
    if (typeof v !== "string" || !v.trim() || k.startsWith("$ACTION") || k === "tipo") continue;
    partes.push(`${k}: ${v.trim().slice(0, 60)}`);
    if (partes.length >= 4) break;
  }
  return partes.join(" · ");
}

export async function diferirSiPide(acceso: Acceso, permiso: Permiso, d: {
  empresaId: string; accion: string; args?: string[]; fd?: FormData; titulo: string; detalle?: string | null;
}): Promise<Estado | null> {
  if (!pideAprobacion(acceso, permiso)) return null;
  try {
    await conEmpresa(d.empresaId, async (tx) => {
      await pedirAccion(tx, { empresaId: d.empresaId, usuarioId: acceso.usuario.id, accion: d.accion, args: d.args ?? [], fd: d.fd, titulo: d.titulo, detalle: d.detalle ?? resumen(d.fd) });
      await bitacora(tx, d.empresaId, acceso.usuario.id, "aprobacion_solicitada", { tipo: "accion", accion: d.accion });
    });
  } catch (e) {
    return { error: e instanceof ErrorContable ? e.message : mensajeError(e) };
  }
  return { ok: "Quedó pendiente de aprobación: no se hace hasta que otra persona lo apruebe en «Por aprobar»." };
}
