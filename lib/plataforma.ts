import { cache } from "react";
import type { Usuario } from "./auth";
import { db } from "./db.ts";

// Consola de la plataforma (entrega 1): solo para las dueñas de la plataforma (`duenas_plataforma`, por correo). Ve todas
// las firmas con conteos (la entrada la revisa `exigirDuena` en lib/acceso.ts) —sin montos ni datos de sus clientes—, las suspende o reactiva con un motivo, y cada acción queda
// en `registro_plataforma`, que no se cambia ni se borra. Las firmas no tienen RLS: se leen con la conexión del dueño.

export const esDuenaPlataforma = cache(async (correo: string): Promise<boolean> => {
  const [r] = await db()<{ si: boolean }[]>`SELECT EXISTS (SELECT 1 FROM duenas_plataforma WHERE correo = ${correo.toLowerCase()}) AS si`;
  return r.si;
});

// Correo que ven las firmas suspendidas para pedir información (el de la primera dueña).
export async function contactoPlataforma(): Promise<string | null> {
  const [r] = await db()<{ correo: string }[]>`SELECT correo FROM duenas_plataforma ORDER BY agregada, correo LIMIT 1`;
  return r?.correo ?? null;
}

export type FirmaPlataforma = {
  id: string; nombre: string; rnc: string | null; creada: Date; clientes: number; personas: number;
  ultima_entrada: Date | null; suspendida_en: Date | null; suspendida_motivo: string | null; exigir_dos_pasos: boolean;
};

export async function firmasPlataforma(): Promise<FirmaPlataforma[]> {
  return db()<FirmaPlataforma[]>`
    SELECT f.id, f.nombre, f.rnc, f.creada, f.suspendida_en, f.suspendida_motivo, f.exigir_dos_pasos,
           (SELECT count(*)::int FROM empresas e WHERE e.firma_id = f.id) AS clientes,
           (SELECT count(*)::int FROM miembros_firma mf WHERE mf.firma_id = f.id) AS personas,
           (SELECT max(s.creada) FROM sesiones s JOIN miembros_firma mf ON mf.usuario_id = s.usuario_id WHERE mf.firma_id = f.id) AS ultima_entrada
      FROM firmas f ORDER BY f.nombre`;
}

export type Registro = { id: string; usuario_nombre: string; firma_id: string | null; firma_nombre: string | null; accion: string; motivo: string | null; en: Date };
export const ACCIONES: Record<string, string> = { ver_firma: "Vio el detalle", suspender: "Suspendió", reactivar: "Reactivó" };

export async function registroPlataforma(firmaId?: string): Promise<Registro[]> {
  return firmaId
    ? db()<Registro[]>`SELECT id::text, usuario_nombre, firma_id, firma_nombre, accion, motivo, en FROM registro_plataforma WHERE firma_id = ${firmaId} ORDER BY en DESC, id DESC LIMIT 200`
    : db()<Registro[]>`SELECT id::text, usuario_nombre, firma_id, firma_nombre, accion, motivo, en FROM registro_plataforma ORDER BY en DESC, id DESC LIMIT 500`;
}

export async function registrar(usuario: Usuario, firma: { id: string; nombre: string }, accion: keyof typeof ACCIONES, motivo: string | null = null) {
  await db()`INSERT INTO registro_plataforma (usuario_id, usuario_nombre, firma_id, firma_nombre, accion, motivo)
             VALUES (${usuario.id}, ${usuario.nombre}, ${firma.id}, ${firma.nombre}, ${accion}, ${motivo})`;
}

// Detalle de una firma: sus administradores y la lista de clientes (nombre y RNC), sin entrar a sus datos contables.
export async function detalleFirma(firmaId: string) {
  const [firma] = (await firmasPlataforma()).filter((f) => f.id === firmaId);
  if (!firma) return null;
  const administradores = await db()<{ nombre: string; email: string; dos_pasos: boolean }[]>`
    SELECT u.nombre, u.email, (u.dos_pasos_desde IS NOT NULL) AS dos_pasos FROM miembros_firma mf JOIN usuarios u ON u.id = mf.usuario_id
     WHERE mf.firma_id = ${firmaId} AND mf.administrador ORDER BY u.nombre`;
  const clientes = await db()<{ nombre: string; rnc: string | null; activa: boolean }[]>`
    SELECT nombre, rnc, activa FROM empresas WHERE firma_id = ${firmaId} ORDER BY activa DESC, nombre`;
  return { firma, administradores, clientes };
}
