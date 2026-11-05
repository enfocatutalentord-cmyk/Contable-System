import { ErrorContable } from "./asientos.ts";
import type { Tx } from "./db";

// Bloque 8, entrega 8a: la aplicación del cliente (documento «Sistema Empire · Fase 2», sección 2). Cualquiera crea su cuenta
// desde la página de la firma y queda como prospecto; cuando firma el contrato, la misma cuenta pasa a «cliente con aplicación».

export const ROL_PROSPECTO = "Cliente · Prospecto";
export const ROL_CLIENTE_APP = "Cliente · Con aplicación";
export const LIMITE_POR_IP = 5;       // registros por hora desde una misma dirección
export const LIMITE_POR_CORREO = 2;   // registros por hora con un mismo correo

export type DatosAlta = { nombre: string; email: string; telefono: string; negocio: string; identificacion: string | null; tipo: "rnc" | "cedula" | null };

// Lo que escribe la persona en la página pública. Devuelve un mensaje si algo no es válido.
export function leerAlta(fd: FormData): DatosAlta | string {
  const t = (c: string) => String(fd.get(c) ?? "").trim();
  const nombre = t("nombre").slice(0, 120);
  const email = t("email").toLowerCase().slice(0, 200);
  const telefono = t("telefono").replace(/[^\d+]/g, "").slice(0, 20);
  const negocio = t("negocio").slice(0, 200) || nombre;
  const id = t("identificacion").replace(/[-\s]/g, "");
  if (!nombre) return "Escribe tu nombre.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "El correo no es válido.";
  if (telefono.replace(/\D/g, "").length < 10) return "Escribe tu teléfono con el código de área (10 dígitos).";
  if (id && !/^\d{9}$/.test(id) && !/^\d{11}$/.test(id)) return "El RNC tiene 9 dígitos y la cédula 11.";
  if (fd.get("acepto") !== "on") return "Para crear la cuenta, acepta que Empire guarde tus datos para atenderte.";
  return { nombre, email, telefono, negocio, identificacion: id || null, tipo: id ? (id.length === 9 ? "rnc" : "cedula") : null };
}

// Cuántos registros recientes hay desde esa dirección y con ese correo (la tabla la usa solo la conexión dueña).
export async function altaPermitida(sql: Tx | import("postgres").Sql, email: string, ip: string | null): Promise<boolean> {
  const [r] = await sql<{ por_ip: number; por_correo: number }[]>`
    SELECT count(*) FILTER (WHERE ip = ${ip})::int AS por_ip, count(*) FILTER (WHERE email = ${email})::int AS por_correo
      FROM altas_prospecto WHERE creado > now() - interval '1 hour'`;
  return (ip === null || r.por_ip < LIMITE_POR_IP) && r.por_correo < LIMITE_POR_CORREO;
}

// Pasar a cliente: el prospecto firmó. La ficha queda activa con la fecha del contrato y las personas con el rol de prospecto
// pasan al de cliente con aplicación (la misma cuenta). Corre en conEmpresa de esa empresa; los roles son de la firma.
export async function pasarACliente(tx: Tx, empresaId: string, hoy: string): Promise<{ personas: { email: string; nombre: string }[] }> {
  const [e] = await tx<{ estado_cliente: string; firma_id: string }[]>`SELECT estado_cliente, firma_id FROM empresas WHERE id = ${empresaId} FOR UPDATE`;
  if (!e) throw new ErrorContable("La empresa no existe");
  if (e.estado_cliente !== "prospecto") throw new ErrorContable("Esta empresa ya es cliente.");
  await tx`UPDATE empresas SET estado_cliente = 'activo', paso_a_cliente = now(),
                               contrato_firmado = COALESCE(contrato_firmado, ${hoy}::date),
                               fecha_inicio_contrato = COALESCE(fecha_inicio_contrato, ${hoy}::date)
            WHERE id = ${empresaId}`;
  const personas = await tx<{ email: string; nombre: string }[]>`
    UPDATE miembros m SET perfil_id = (SELECT id FROM perfiles WHERE firma_id = ${e.firma_id} AND nombre = ${ROL_CLIENTE_APP})
      FROM perfiles p, usuarios u
     WHERE m.empresa_id = ${empresaId} AND p.id = m.perfil_id AND p.nombre = ${ROL_PROSPECTO} AND u.id = m.usuario_id
    RETURNING u.email, u.nombre`;
  return { personas };
}
