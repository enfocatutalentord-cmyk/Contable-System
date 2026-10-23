import type { Tx } from "./db";

// Límite de intentos de entrada: 5 fallidos seguidos por correo, o 20 por dirección IP, en 15 minutos bloquean la entrada
// hasta que pasen 15 minutos desde el último fallo.
export const MAX_POR_CORREO = 5;
export const MAX_POR_IP = 20;
export const MINUTOS = 15;

export async function entradaBloqueada(sql: Tx | import("postgres").Sql, email: string, ip: string | null): Promise<boolean> {
  const [r] = await sql<{ correo: number; ip: number }[]>`
    SELECT
      (SELECT count(*)::int FROM intentos_entrada
        WHERE email = ${email} AND NOT exito AND fecha > now() - make_interval(mins => ${MINUTOS})
          AND fecha > COALESCE((SELECT max(fecha) FROM intentos_entrada WHERE email = ${email} AND exito), '-infinity')) AS correo,
      (SELECT count(*)::int FROM intentos_entrada
        WHERE ${ip}::text IS NOT NULL AND ip = ${ip} AND NOT exito AND fecha > now() - make_interval(mins => ${MINUTOS})) AS ip`;
  return r.correo >= MAX_POR_CORREO || r.ip >= MAX_POR_IP;
}

export async function anotarIntento(sql: Tx | import("postgres").Sql, email: string, ip: string | null, exito: boolean) {
  await sql`INSERT INTO intentos_entrada (email, ip, exito) VALUES (${email}, ${ip}, ${exito})`;
  // Limpieza: no hace falta guardar intentos de más de 90 días.
  if (Math.random() < 0.02) await sql`DELETE FROM intentos_entrada WHERE fecha < now() - interval '90 days'`;
}
