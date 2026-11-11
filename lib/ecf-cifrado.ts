// Cifrado del certificado e-CF y su contraseña (entrega E2a). AES-256-GCM con una llave de 32 bytes en la variable ECF_LLAVE
// (base64), que vive en Vercel, fuera de la base de datos: con solo una copia de la base no se puede usar el certificado.
// Formato guardado: 12 bytes de vector + 16 de etiqueta + el contenido cifrado.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class ErrorLlave extends Error {}

function llave(texto = process.env.ECF_LLAVE): Buffer {
  if (!texto) throw new ErrorLlave("Falta la llave de cifrado ECF_LLAVE en Vercel: sin ella no se puede guardar ni usar el certificado.");
  const b = Buffer.from(texto.trim(), "base64");
  if (b.length !== 32) throw new ErrorLlave("La llave ECF_LLAVE debe ser de 32 bytes en base64.");
  return b;
}

export const hayLlave = (texto = process.env.ECF_LLAVE) => {
  try { llave(texto); return true; } catch { return false; }
};

export function cifrar(datos: Uint8Array, texto?: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", llave(texto), iv);
  const cuerpo = Buffer.concat([c.update(datos), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), cuerpo]);
}

export function descifrar(guardado: Uint8Array, texto?: string): Buffer {
  const b = Buffer.from(guardado);
  if (b.length < 29) throw new ErrorLlave("El certificado guardado está dañado.");
  const d = createDecipheriv("aes-256-gcm", llave(texto), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  try {
    return Buffer.concat([d.update(b.subarray(28)), d.final()]);
  } catch {
    throw new ErrorLlave("No se pudo abrir el certificado guardado: la llave ECF_LLAVE cambió o el dato se alteró. Súbelo de nuevo.");
  }
}

// Para generar una llave nueva (la pone una persona en Vercel; aquí solo se usa en pruebas).
export const nuevaLlave = () => randomBytes(32).toString("base64");
