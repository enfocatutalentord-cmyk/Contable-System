import type { Tx } from "./db";
import { leerPorcentaje, porcentajeTexto } from "./fiscal.ts";
import { verFecha } from "./montos.ts";
// Entrega B · Normas y tasas (propuesta del 6-nov-2026; «sí» de Patricia del 7-nov). Una ley o norma nueva de la DGII no se detecta
// sola: la firma la carga una vez y vale para sus clientes con su fecha de vigencia. Lo ya registrado no cambia: cada factura y compra
// guarda la tasa que se le aplicó, y la tasa anterior queda cerrada el día antes.

export const FORMATOS_CALENDARIO = ["606", "607", "608", "IT-1", "IR-17", "IR-2"] as const;
export const NOMBRE_FORMATO: Record<string, string> = {
  "606": "606 · Compras", "607": "607 · Ventas", "608": "608 · Anulados", "IT-1": "IT-1 · ITBIS", "IR-17": "IR-17 · Retenciones",
  "IR-2": "IR-2 · Renta de sociedades",
};
export const DIAS_SIN_REVISAR = 30; // recordatorio si pasan 30 días sin una revisión
export const DIAS_AVISO_CAMBIO = 30; // aviso de una tasa o fecha que cambia en los próximos 30 días

const masDias = (f: string, n: number) => { const d = new Date(`${f}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const entre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);
export const diaAntes = (f: string) => masDias(f, -1);

export type Clase = "impuesto" | "retencion";
export type FilaTasa = { clase: Clase; nombre: string; tipo: string; tasa: string; desde: string; hasta: string | null; activo: boolean };
export type Concepto = FilaTasa & { empresas: { id: string; nombre: string }[] };
// Las tasas de todos los clientes juntas: una fila por concepto, tasa y vigencia, con los clientes que la tienen.
export function agrupar(listas: { empresa: { id: string; nombre: string }; filas: FilaTasa[] }[]): Concepto[] {
  const mapa = new Map<string, Concepto>();
  for (const { empresa, filas } of listas) {
    for (const f of filas) {
      const tasa = porcentajeTexto(leerPorcentaje(f.tasa) ?? 0n);
      const clave = [f.clase, f.nombre, tasa, f.desde, f.hasta ?? "", f.activo].join("|");
      const c = mapa.get(clave) ?? { ...f, tasa, empresas: [] };
      c.empresas.push(empresa);
      mapa.set(clave, c);
    }
  }
  return [...mapa.values()].sort((a, b) => a.clase.localeCompare(b.clase) || a.nombre.localeCompare(b.nombre, "es") || a.desde.localeCompare(b.desde));
}

// ¿En qué estado queda una fila hoy? (para la tabla)
export function estadoVigencia(f: { desde: string; hasta: string | null; activo: boolean }, hoy: string): "vigente" | "proxima" | "cerrada" | "inactiva" {
  if (!f.activo) return "inactiva";
  if (f.desde > hoy) return "proxima";
  if (f.hasta && f.hasta < hoy) return "cerrada";
  return "vigente";
}

export type Resultado = "aplicada" | "sin_concepto" | "ya_estaba" | "empieza_despues" | "sin_cuentas";
export const TEXTO_RESULTADO: Record<Resultado, string> = {
  aplicada: "aplicada", sin_concepto: "no tiene ese concepto", ya_estaba: "ya la tenía desde esa fecha",
  empieza_despues: "su tasa actual empieza después de esa fecha", sin_cuentas: "el concepto no tiene cuentas asignadas (revísalo en su configuración tributaria)",
};

// Carga una tasa nueva en la empresa en curso: cierra la vigente el día antes y crea la nueva con las mismas cuentas y códigos.
// Corre en conEmpresa (cada cambio queda en el historial del cliente).
export async function cargarTasaNueva(tx: Tx, d: { clase: Clase; nombre: string; nuevoNombre: string; tasa: string; desde: string; nota: string }): Promise<Resultado> {
  const tabla = d.clase === "impuesto" ? "impuestos" : "retenciones";
  const [ya] = await tx`SELECT 1 FROM ${tx(tabla)} WHERE nombre = ${d.nuevoNombre} AND vigente_desde = ${d.desde}`;
  if (ya) return "ya_estaba";
  const [actual] = await tx<Record<string, unknown>[]>`
    SELECT * FROM ${tx(tabla)} WHERE nombre = ${d.nombre} AND activo AND (vigente_hasta IS NULL OR vigente_hasta >= ${d.desde})
     ORDER BY vigente_desde DESC LIMIT 1 FOR UPDATE`;
  if (!actual) return "sin_concepto";
  const desdeActual = actual.vigente_desde instanceof Date ? actual.vigente_desde.toISOString().slice(0, 10) : String(actual.vigente_desde);
  if (desdeActual >= d.desde) return "empieza_despues";
  if (d.clase === "impuesto" && Number(d.tasa) > 0 && (!actual.cuenta_ventas_id || !actual.cuenta_compras_id)) return "sin_cuentas";
  const { id, creado, ...resto } = actual;
  void [id, creado];
  await tx`UPDATE ${tx(tabla)} SET vigente_hasta = ${diaAntes(d.desde)} WHERE id = ${id as string}`;
  const nueva: Record<string, unknown> = {
    ...resto, nombre: d.nuevoNombre, tasa: d.tasa, vigente_desde: d.desde, vigente_hasta: actual.vigente_hasta ?? null, nota: d.nota,
  };
  await tx`INSERT INTO ${tx(tabla)} ${tx(nueva)}`;
  return "aplicada";
}

export type Prorroga = { id: string; formato: string; periodo: string; vence: string; motivo: string; creado_por: string | null };

export type AvisoNorma = { nivel: "urgente" | "aviso"; texto: string; enlace: string };

// Avisos de la firma (no de un cliente): tasas que cambian pronto, prórrogas que llegan y el recordatorio de revisar las normas.
export function avisosDeNormas(d: { firmaId: string; hoy: string; conceptos: Concepto[]; prorrogas: Prorroga[]; ultimaRevision: string | null; responsable: string | null }): AvisoNorma[] {
  const enlace = `/firma/${d.firmaId}/normas`;
  const avisos: AvisoNorma[] = [];
  const limite = masDias(d.hoy, DIAS_AVISO_CAMBIO);
  for (const c of d.conceptos) {
    if (c.activo && c.desde > d.hoy && c.desde <= limite) {
      const n = c.empresas.length;
      avisos.push({ nivel: "aviso", enlace, texto: `Desde el ${verFecha(c.desde)} «${c.nombre}» pasa a ${c.tasa} % en ${n} empresa${n === 1 ? "" : "s"} (faltan ${entre(d.hoy, c.desde)} días).` });
    }
  }
  for (const p of d.prorrogas) {
    if (p.vence >= d.hoy && p.vence <= limite) {
      avisos.push({ nivel: "aviso", enlace: `${enlace}#calendario`, texto: `El ${p.formato} de ${p.periodo.slice(4)}/${p.periodo.slice(0, 4)} vence el ${verFecha(p.vence)} por prórroga: ${p.motivo}.` });
    }
  }
  const sin = d.ultimaRevision ? entre(d.ultimaRevision, d.hoy) : null;
  if (sin === null || sin >= DIAS_SIN_REVISAR) {
    avisos.push({
      nivel: sin !== null && sin >= DIAS_SIN_REVISAR * 2 ? "urgente" : "aviso", enlace: `${enlace}#revisiones`,
      texto: `${sin === null ? "Aún no se ha registrado una revisión de las normas de la DGII" : `Hace ${sin} días que no se revisan las normas de la DGII`}${d.responsable ? ` (responsable: ${d.responsable})` : ""}.`,
    });
  }
  return avisos;
}

