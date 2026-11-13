// Firma de los mensajes entre Vendario y Empire (acuerdo docs/vendario/acuerdo.md, sección 3), igual que Vendario
// (supabase/functions/_shared/hmac.ts): X-Signature: t=<segundos unix>,v1=<hex(HMAC_SHA256(clave, "<t>.<cuerpo exacto>"))>.
// Se aceptan varias v1 y varias claves (rotación) y una diferencia de hora de hasta 5 minutos. Comparación en tiempo constante.
import { createHmac, timingSafeEqual } from "node:crypto";

export const TOLERANCIA_SEG = 300;

const hmacHex = (clave: string, datos: string) => createHmac("sha256", clave).update(datos, "utf8").digest("hex");

export function firmar(clave: string, cuerpo: string, ahora = Math.floor(Date.now() / 1000)): string {
  return `t=${ahora},v1=${hmacHex(clave, `${ahora}.${cuerpo}`)}`;
}

export type Verificacion = { ok: true } | { ok: false; motivo: "sin_firma" | "sin_clave" | "hora" | "firma" };

export function verificar(encabezado: string | null, cuerpo: string, claves: string[], ahora = Math.floor(Date.now() / 1000)): Verificacion {
  if (!claves.length) return { ok: false, motivo: "sin_clave" };
  if (!encabezado) return { ok: false, motivo: "sin_firma" };
  const partes = encabezado.split(",").map((p) => p.trim().split("="));
  const t = Number(partes.find(([k]) => k === "t")?.[1]);
  const firmas = partes.filter(([k]) => k === "v1").map(([, v]) => (v ?? "").toLowerCase()).filter((v) => /^[0-9a-f]{64}$/.test(v));
  if (!Number.isFinite(t) || !firmas.length) return { ok: false, motivo: "sin_firma" };
  if (Math.abs(ahora - t) > TOLERANCIA_SEG) return { ok: false, motivo: "hora" };
  let ok = false;
  for (const clave of claves) {
    const esperada = Buffer.from(hmacHex(clave, `${t}.${cuerpo}`), "hex");
    // Se revisan todas sin cortar antes, para no revelar por el tiempo cuál coincidió.
    for (const f of firmas) ok = timingSafeEqual(esperada, Buffer.from(f, "hex")) || ok;
  }
  return ok ? { ok: true } : { ok: false, motivo: "firma" };
}

// Claves de una variable (separadas por coma durante una rotación).
export const clavesDe = (valor: string | undefined) => (valor ?? "").split(",").map((s) => s.trim()).filter(Boolean);
