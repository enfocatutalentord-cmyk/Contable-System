// Conexión con los servicios de facturación electrónica de la DGII (entrega E2a), según la «Descripción Técnica Servicios DGII»:
// autenticación con semilla firmada → token (Bearer), recepción del e-CF → TrackId, y consulta del resultado. Tres ambientes:
// pre-certificación (testecf), certificación (certecf) y producción (ecf). La función de red se puede cambiar en las pruebas.
import { firmarXml } from "./ecf-firma.ts";

export const AMBIENTES = {
  testecf: "Pre-certificación (pruebas libres)",
  certecf: "Certificación (pruebas oficiales de la DGII)",
  ecf: "Producción (validez fiscal)",
} as const;
export type Ambiente = keyof typeof AMBIENTES;
export const esAmbiente = (a: string): a is Ambiente => a in AMBIENTES;

const BASE = "https://ecf.dgii.gov.do";
export const urls = (a: Ambiente, base = BASE) => ({
  semilla: `${base}/${a}/autenticacion/api/autenticacion/semilla`,
  validarSemilla: `${base}/${a}/autenticacion/api/autenticacion/validarsemilla`,
  recepcion: `${base}/${a}/recepcion/api/facturaselectronicas`,
  resultado: (trackId: string) => `${base}/${a}/consultaresultado/api/consultas/estado?trackid=${encodeURIComponent(trackId)}`,
});

export class ErrorDgii extends Error {
  tipo: "conexion" | "rechazo" | "respuesta";
  constructor(mensaje: string, tipo: "conexion" | "rechazo" | "respuesta") { super(mensaje); this.tipo = tipo; }
}

export type Pedir = (url: string, opciones: RequestInit) => Promise<Response>;
export type Opciones = { pedir?: Pedir; base?: string; tiempo?: number };
type Firma = { llavePem: string; certBase64: string };

async function llamar(url: string, init: RequestInit, o: Opciones): Promise<Response> {
  const pedir = o.pedir ?? fetch;
  try {
    return await pedir(url, { ...init, signal: AbortSignal.timeout(o.tiempo ?? 30_000) });
  } catch (e) {
    const causa = String((e as { cause?: { code?: string } })?.cause?.code ?? (e as Error)?.name ?? e);
    throw new ErrorDgii(
      /ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT|TimeoutError|AbortError|ENOTFOUND/.test(causa)
        ? `La DGII no aceptó la conexión desde el servidor del sistema (${causa}). Sus servicios de factura electrónica rechazan conexiones desde fuera del país; hay que pedirle que autorice la dirección del servidor.`
        : `No se pudo conectar con la DGII (${causa}).`,
      "conexion");
  }
}

async function cuerpo(r: Response): Promise<string> {
  const t = await r.text();
  if (!r.ok) throw new ErrorDgii(`La DGII respondió ${r.status}${t ? `: ${t.slice(0, 300)}` : ""}`, r.status === 401 || r.status === 403 ? "rechazo" : "respuesta");
  return t;
}

const archivo = (xml: string, nombre: string) => {
  const f = new FormData();
  f.append("xml", new Blob([xml], { type: "text/xml" }), nombre);
  return f;
};

// Token de la sesión: se pide la semilla, se firma con el certificado y se cambia por el token.
export type Token = { token: string; expira: string | null };
export async function obtenerToken(a: Ambiente, cert: Firma, o: Opciones = {}): Promise<Token> {
  const u = urls(a, o.base);
  const semilla = await cuerpo(await llamar(u.semilla, { method: "GET", headers: { accept: "application/xml" } }, o));
  if (!/<SemillaModel[\s>]/i.test(semilla)) throw new ErrorDgii("La DGII no devolvió una semilla válida", "respuesta");
  const firmada = firmarXml(semilla.replace(/^﻿/, "").trim(), cert);
  const t = await cuerpo(await llamar(u.validarSemilla, { method: "POST", headers: { accept: "application/json" }, body: archivo(firmada, "semilla.xml") }, o));
  let j: { token?: string; expira?: string };
  try { j = JSON.parse(t); } catch { throw new ErrorDgii("La DGII no devolvió el token", "respuesta"); }
  if (!j.token) throw new ErrorDgii("La DGII no aceptó el certificado (no devolvió token)", "rechazo");
  return { token: j.token, expira: j.expira ?? null };
}

export async function enviarEcf(a: Ambiente, token: string, nombre: string, xmlFirmado: string, o: Opciones = {}): Promise<string> {
  const t = await cuerpo(await llamar(urls(a, o.base).recepcion, {
    method: "POST", headers: { accept: "application/json", authorization: `Bearer ${token}` }, body: archivo(xmlFirmado, nombre),
  }, o));
  const j = JSON.parse(t) as { trackId?: string; error?: string; mensaje?: string };
  if (!j.trackId) throw new ErrorDgii(`La DGII no recibió el e-CF: ${j.mensaje ?? j.error ?? t.slice(0, 200)}`, "rechazo");
  return j.trackId;
}

// Estados de la consulta: 0 no encontrado, 1 aceptado, 2 rechazado, 3 en proceso, 4 aceptado condicional.
export type Resultado = {
  estado: "aceptado" | "aceptado_condicional" | "rechazado" | "en_proceso" | "no_encontrado";
  secuenciaUtilizada: boolean | null; mensajes: { codigo: number | string; valor: string }[];
};
export async function consultarResultado(a: Ambiente, token: string, trackId: string, o: Opciones = {}): Promise<Resultado> {
  const t = await cuerpo(await llamar(urls(a, o.base).resultado(trackId), { method: "GET", headers: { accept: "application/json", authorization: `Bearer ${token}` } }, o));
  const j = JSON.parse(t) as { estado?: string; codigo?: number; secuenciaUtilizada?: boolean; mensajes?: { codigo: number; valor: string }[] };
  const texto = (j.estado ?? "").toLowerCase();
  const estado: Resultado["estado"] = /condicional/.test(texto) ? "aceptado_condicional" : /aceptado/.test(texto) ? "aceptado"
    : /rechazado/.test(texto) ? "rechazado" : /proceso/.test(texto) ? "en_proceso"
    : ({ 1: "aceptado", 2: "rechazado", 3: "en_proceso", 4: "aceptado_condicional" } as Record<number, Resultado["estado"]>)[j.codigo ?? 0] ?? "no_encontrado";
  return { estado, secuenciaUtilizada: j.secuenciaUtilizada ?? null, mensajes: (j.mensajes ?? []).filter((m) => m?.valor) };
}
