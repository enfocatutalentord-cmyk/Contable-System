import { db, type Tx } from "./db";
import { enviarCorreo } from "./correo";
import { hashCodigo, nuevosCodigosRecuperacion, verificarCodigo } from "./dos-pasos";
import { urlApp } from "./enlaces";

// Lo que la verificación en dos pasos guarda de cada persona (tabla usuarios, migración 013).

// Comprueba el segundo paso: un código de la app (que no se haya usado ya) o un código de recuperación sin usar.
// Devuelve "app", la cantidad de códigos de recuperación que quedan, o null si no vale.
export async function comprobarSegundoPaso(usuarioId: string, codigo: string): Promise<"app" | number | null> {
  const [u] = await db()<{ secreto: string; ultimo: string | null }[]>`
    SELECT dos_pasos_secreto AS secreto, dos_pasos_ultimo::text AS ultimo FROM usuarios
     WHERE id = ${usuarioId} AND dos_pasos_desde IS NOT NULL`;
  if (!u) return null;
  const paso = verificarCodigo(u.secreto, codigo, u.ultimo === null ? null : BigInt(u.ultimo));
  if (paso !== null) {
    // Condición en la misma sentencia: si dos entradas mandan el mismo código a la vez, solo una lo usa.
    const r = await db()`UPDATE usuarios SET dos_pasos_ultimo = ${paso.toString()}::bigint
                          WHERE id = ${usuarioId} AND (dos_pasos_ultimo IS NULL OR dos_pasos_ultimo < ${paso.toString()}::bigint)`;
    return r.count ? "app" : null;
  }
  if (/^\d{6}$/.test(codigo.replace(/\s/g, ""))) return null;
  const r = await db()`UPDATE codigos_recuperacion SET usado = now()
                        WHERE usuario_id = ${usuarioId} AND codigo_hash = ${hashCodigo(codigo)} AND usado IS NULL`;
  if (!r.count) return null;
  const [{ n }] = await db()<{ n: number }[]>`SELECT count(*)::int AS n FROM codigos_recuperacion WHERE usuario_id = ${usuarioId} AND usado IS NULL`;
  return n;
}

// Reemplaza los códigos de recuperación (los anteriores dejan de servir) y devuelve los nuevos para mostrarlos una vez.
export async function renovarCodigos(tx: Tx, usuarioId: string): Promise<string[]> {
  const codigos = nuevosCodigosRecuperacion();
  await tx`DELETE FROM codigos_recuperacion WHERE usuario_id = ${usuarioId}`;
  await tx`INSERT INTO codigos_recuperacion ${tx(codigos.map((c) => ({ usuario_id: usuarioId, codigo_hash: hashCodigo(c) })))}`;
  return codigos;
}

export async function quitarDosPasos(tx: Tx, usuarioId: string): Promise<void> {
  await tx`UPDATE usuarios SET dos_pasos_secreto = NULL, dos_pasos_desde = NULL, dos_pasos_ultimo = NULL WHERE id = ${usuarioId}`;
  await tx`DELETE FROM codigos_recuperacion WHERE usuario_id = ${usuarioId}`;
  await tx`DELETE FROM entradas_pendientes WHERE usuario_id = ${usuarioId}`;
}

export type EstadoDosPasos = { secreto: string | null; desde: Date | null; quedan: number; exigida: string[] };

export async function estadoDosPasos(usuarioId: string): Promise<EstadoDosPasos> {
  const [u] = await db()<{ secreto: string | null; desde: Date | null; quedan: number; exigida: string[] }[]>`
    SELECT u.dos_pasos_secreto AS secreto, u.dos_pasos_desde AS desde,
           (SELECT count(*)::int FROM codigos_recuperacion c WHERE c.usuario_id = u.id AND c.usado IS NULL) AS quedan,
           ARRAY(SELECT f.nombre FROM miembros_firma mf JOIN firmas f ON f.id = mf.firma_id
                  WHERE mf.usuario_id = u.id AND f.exigir_dos_pasos ORDER BY f.nombre) AS exigida
      FROM usuarios u WHERE u.id = ${usuarioId}`;
  return u;
}

// Aviso por correo de cada cambio (OWASP: avisar a la persona para que detecte un cambio que no hizo ella).
export async function avisarCambio(para: string, nombre: string, que: string, extra?: string): Promise<void> {
  await enviarCorreo({
    para, asunto: `Seguridad de tu cuenta: ${que}`, titulo: `Hola, ${nombre}`,
    parrafos: [`En tu cuenta del sistema contable: ${que}.`, ...(extra ? [extra] : []),
      "Si no fuiste tú, cambia tu contraseña de inmediato y avisa al administrador de tu firma."],
    boton: { texto: "Ir a Mi cuenta", url: `${await urlApp()}/cuenta` },
  });
}
