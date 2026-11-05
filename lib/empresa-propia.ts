import { nivelDeCodigo } from "./catalogo-rd.ts";
import type { Tx } from "./db";

// Bloque 1, entrega 1b: la empresa propia de la firma (Empire Tax’N Legal SRL se lleva como un cliente más) y sus unidades
// de negocio. Todo se puede volver a correr sin repetir nada: lo que ya existe (por nombre) se deja como está.

export const UNIDADES_EMPRESA_PROPIA = ["Firma contable", "Laboratorio de Imperios", "Sistema"];
export const BANCOS_EMPRESA_PROPIA = ["Banco Popular – cuenta corriente", "Banreservas – cuenta corriente", "BHD – cuenta corriente"];

export type Preparacion = { unidades: string[]; cuentas: string[]; avisos: string[] };

// Crea una cuenta de detalle bajo `padre` con el siguiente código libre, si no hay ya una con ese nombre debajo.
async function cuentaBajo(tx: Tx, empresaId: string, padreCodigo: string, nombre: string, creadas: string[]): Promise<string | null> {
  const [padre] = await tx<{ id: string; tipo: string; de_detalle: boolean }[]>`
    SELECT id, tipo, de_detalle FROM cuentas WHERE codigo = ${padreCodigo}`;
  if (!padre || padre.de_detalle) return null;
  const [ya] = await tx<{ id: string }[]>`SELECT id FROM cuentas WHERE padre_id = ${padre.id} AND lower(nombre) = lower(${nombre})`;
  if (ya) return ya.id;
  const hijas = await tx<{ codigo: string }[]>`SELECT codigo FROM cuentas WHERE padre_id = ${padre.id}`;
  const usados = new Set(hijas.map((h) => Number(h.codigo.slice(padreCodigo.length))));
  let n = 1;
  while (usados.has(n)) n++;
  if (n > 99) return null;
  const codigo = padreCodigo + String(n).padStart(2, "0");
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
    VALUES (${empresaId}, ${codigo}, ${nombre}, ${padre.tipo}, ${padre.id}, ${nivelDeCodigo(codigo)}, true) RETURNING id`;
  creadas.push(`${codigo} ${nombre}`);
  return id;
}

// Unidades de negocio, ingresos por unidad (4101), bancos (1101) y la cuenta corriente de cada socia (1102, cuenta por cobrar
// a la socia: activo, decidido por Patricia el 4-nov-2026). Corre dentro de la empresa propia (conEmpresa).
export async function prepararEmpresaPropia(tx: Tx, empresaId: string): Promise<Preparacion> {
  const r: Preparacion = { unidades: [], cuentas: [], avisos: [] };
  for (const [i, nombre] of UNIDADES_EMPRESA_PROPIA.entries()) {
    const nueva = await tx`INSERT INTO unidades_negocio (empresa_id, nombre, orden) VALUES (${empresaId}, ${nombre}, ${i + 1})
                           ON CONFLICT (empresa_id, nombre) DO NOTHING RETURNING id`;
    if (nueva.length) r.unidades.push(nombre);
  }
  const unidades = await tx<{ id: string; nombre: string; cuenta_ingreso_id: string | null }[]>`
    SELECT id, nombre, cuenta_ingreso_id FROM unidades_negocio WHERE activa ORDER BY orden, nombre`;
  for (const u of unidades) {
    if (u.cuenta_ingreso_id) continue;
    const cuenta = await cuentaBajo(tx, empresaId, "4101", `Ingresos – ${u.nombre}`, r.cuentas);
    if (cuenta) await tx`UPDATE unidades_negocio SET cuenta_ingreso_id = ${cuenta} WHERE id = ${u.id}`;
  }
  for (const banco of BANCOS_EMPRESA_PROPIA) await cuentaBajo(tx, empresaId, "1101", banco, r.cuentas);
  const socios = await tx<{ nombre: string }[]>`SELECT nombre FROM socios_empresa ORDER BY orden`;
  if (!socios.length) r.avisos.push("La ficha no tiene socios: la «Cuenta corriente – socia» se crea al registrarlos en Ficha › Socios y volver a preparar.");
  for (const s of socios) await cuentaBajo(tx, empresaId, "1102", `Cuenta corriente – ${s.nombre}`, r.cuentas);
  return r;
}

// ───── Unidades de negocio de cualquier empresa ─────

export type Unidad = { id: string; nombre: string; activa: boolean; cuenta_ingreso_id: string | null };

export const listarUnidades = (tx: Tx, soloActivas = true) => tx<Unidad[]>`
  SELECT id, nombre, activa, cuenta_ingreso_id FROM unidades_negocio WHERE (${!soloActivas} OR activa) ORDER BY orden, nombre`;

// La unidad que llega del formulario: vacía o un id de la empresa (la base revisa que sea suya y esté activa).
export function leerUnidad(v: unknown): string | null | undefined {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : undefined;
}
