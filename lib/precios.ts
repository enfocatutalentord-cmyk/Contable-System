import type { Tx } from "./db";
import { aCentavos, deCentavos, leerMonto } from "./montos.ts";

// Bloque 2, entrega 2a: Lista de Precios (EMP-P01). Un precio por categoría de cliente (la de la ficha, regla de dos de tres
// criterios) con fecha de vigencia; sin precio para la categoría se usa el precio general del servicio. Los precios no
// incluyen ITBIS: el impuesto sale del servicio, como siempre.

export const GRUPOS_SERVICIO: Record<string, string> = {
  contabilidad: "Contabilidad", control_interno: "Control interno", auditoria: "Auditoría",
  laboral_tss: "Laboral y TSS", tributario: "Tributario", otros: "Otros",
};
export const CATEGORIAS_PRECIO = ["pequena", "mediana", "grande", "emprendedor"] as const;
export type CategoriaPrecio = (typeof CATEGORIAS_PRECIO)[number];

export class ErrorPrecio extends Error {}

export type PreciosEntrada = { desde: string; precios: Partial<Record<CategoriaPrecio, string>> };

// Del formulario: p_pequena, p_mediana, p_grande, p_emprendedor (vacío = sin cambio) y vigente_desde (vacío = hoy).
export function leerPrecios(fd: FormData, hoy: string): PreciosEntrada {
  const desde = String(fd.get("vigente_desde") ?? "").trim() || hoy;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw new ErrorPrecio("La fecha de vigencia no es válida.");
  const precios: PreciosEntrada["precios"] = {};
  for (const c of CATEGORIAS_PRECIO) {
    const v = String(fd.get(`p_${c}`) ?? "").trim();
    if (!v) continue;
    const m = leerMonto(v);
    if (m === null || aCentavos(m) < 0n) throw new ErrorPrecio(`El precio para la categoría ${c === "pequena" ? "pequeña" : c} no es válido.`);
    precios[c] = deCentavos(aCentavos(m));
  }
  return { desde, precios };
}

export type PreciosVigentes = Map<string, Partial<Record<CategoriaPrecio, string>>>;

// El precio vigente de cada servicio y categoría en una fecha.
export async function preciosVigentes(tx: Tx, fecha: string): Promise<PreciosVigentes> {
  const filas = await tx<{ servicio_id: string; categoria: CategoriaPrecio; precio: string }[]>`
    SELECT DISTINCT ON (servicio_id, categoria) servicio_id, categoria, precio::text
      FROM precios_servicio WHERE vigente_desde <= ${fecha}
     ORDER BY servicio_id, categoria, vigente_desde DESC`;
  const mapa: PreciosVigentes = new Map();
  for (const f of filas) mapa.set(f.servicio_id, { ...mapa.get(f.servicio_id), [f.categoria]: f.precio });
  return mapa;
}

// Guarda los precios que cambian desde la fecha dada. Si ese día ya tenía un precio, se reemplaza; si el precio vigente ya es
// el mismo, no se guarda nada. Devuelve cuántos cambiaron.
export async function guardarPrecios(tx: Tx, empresaId: string, servicioId: string, entrada: PreciosEntrada): Promise<number> {
  const vigentes = (await preciosVigentes(tx, entrada.desde)).get(servicioId) ?? {};
  let cambios = 0;
  for (const [categoria, precio] of Object.entries(entrada.precios) as [CategoriaPrecio, string][]) {
    if (vigentes[categoria] !== undefined && aCentavos(vigentes[categoria]!) === aCentavos(precio)) continue;
    await tx`INSERT INTO precios_servicio (empresa_id, servicio_id, categoria, precio, vigente_desde)
             VALUES (${empresaId}, ${servicioId}, ${categoria}, ${precio}, ${entrada.desde})
             ON CONFLICT (servicio_id, categoria, vigente_desde) DO UPDATE SET precio = EXCLUDED.precio`;
    cambios++;
  }
  return cambios;
}

// El precio que toca para un cliente: el de su categoría o, si no hay, el general. `deLista` dice si salió de la categoría.
export function precioPara(general: string, precios: Partial<Record<CategoriaPrecio, string>> | undefined, categoria: string | null) {
  const p = categoria ? precios?.[categoria as CategoriaPrecio] : undefined;
  return p !== undefined ? { precio: p, deLista: true } : { precio: general, deLista: false };
}
