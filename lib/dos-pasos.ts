import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

// Códigos de un solo uso basados en el tiempo (TOTP, RFC 6238): los mismos que generan Google Authenticator,
// Microsoft Authenticator o Authy. Intervalos de 30 s, HMAC-SHA1 y 6 dígitos (lo que todas esas apps leen del QR).

export const EMISOR = "Empire Tax’N Legal";
const PERIODO = 30;
const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function aBase32(b: Buffer): string {
  let bits = 0, valor = 0, salida = "";
  for (const byte of b) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) { salida += ALFABETO[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
  return salida;
}

export function deBase32(t: string): Buffer {
  const limpio = t.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, valor = 0;
  const bytes: number[] = [];
  for (const c of limpio) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) throw new Error("Clave base32 no válida");
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) { bytes.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

export const nuevoSecreto = () => aBase32(randomBytes(20)); // 160 bits, lo que recomienda el RFC 4226

// Código para un intervalo dado (RFC 4226, truncamiento dinámico).
export function codigoHotp(secreto: Buffer, contador: bigint, digitos = 6): string {
  const mensaje = Buffer.alloc(8);
  mensaje.writeBigUInt64BE(contador);
  const h = createHmac("sha1", secreto).update(mensaje).digest();
  const desfase = h[h.length - 1] & 15;
  const n = (h.readUInt32BE(desfase) & 0x7fffffff) % 10 ** digitos;
  return String(n).padStart(digitos, "0");
}

export const pasoActual = (ms = Date.now()) => BigInt(Math.floor(ms / 1000 / PERIODO));

// Devuelve el intervalo del código si es válido (acepta el anterior y el siguiente por desfase del reloj del celular)
// y es posterior al último aceptado, para que un código ya usado no sirva otra vez. null si no vale.
export function verificarCodigo(secreto: string, codigo: string, ultimo: bigint | null, ms = Date.now()): bigint | null {
  const limpio = codigo.replace(/\s/g, "");
  if (!/^\d{6}$/.test(limpio)) return null;
  const clave = deBase32(secreto);
  const ahora = pasoActual(ms);
  for (const d of [0n, -1n, 1n]) {
    const paso = ahora + d;
    if (ultimo !== null && paso <= ultimo) continue;
    if (timingSafeEqual(Buffer.from(codigoHotp(clave, paso)), Buffer.from(limpio))) return paso;
  }
  return null;
}

export function enlaceAutenticador(secreto: string, correo: string): string {
  const etiqueta = encodeURIComponent(`${EMISOR}:${correo}`);
  return `otpauth://totp/${etiqueta}?secret=${secreto}&issuer=${encodeURIComponent(EMISOR)}&algorithm=SHA1&digits=6&period=${PERIODO}`;
}

// Códigos de recuperación: 10 códigos de 10 caracteres (sin letras que se confundan), para cuando no se tiene el celular.
const LETRAS = "abcdefghjkmnpqrstuvwxyz23456789";
export function nuevosCodigosRecuperacion(cantidad = 10): string[] {
  return Array.from({ length: cantidad }, () => {
    const c = Array.from({ length: 10 }, () => LETRAS[randomInt(LETRAS.length)]).join("");
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
}
export const normalizarRecuperacion = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, "");
export const hashCodigo = (c: string) => createHash("sha256").update(normalizarRecuperacion(c)).digest("hex");
