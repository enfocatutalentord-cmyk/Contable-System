import type { Tx } from "./db.ts";
import { aCentavos, deCentavos } from "./montos.ts";

// Prioridad 1.6 del prompt de Patricia (20-nov-2026): el presupuesto de Empire como el Excel «Presupuesto_Empire_12_meses».
// Lo que se gasta nace en «Registrar salidas» (con su asiento); aquí se compara con lo presupuestado, mes por mes y por año.

export type ListaPresupuesto = "oficina" | "personal";
export const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

// Categorías de la hoja «Configuración» del Excel (se pueden agregar, renombrar o quitar desde la pantalla).
export const CATEGORIAS_OFICINA = [
  "Alquiler local", "Electricidad oficina", "Internet oficina", "Nómina", "Software", "Marketing", "Transporte laboral", "Material gastable",
  "Compra de equipos", "Otros gastos operativos", "Comisiones", "Otras comisiones", "Impuestos",
];
export const CATEGORIAS_PERSONAL = [
  "Vivienda", "Alimentación/compra general", "Transporte personal", "Salud", "Educación", "Entretenimiento", "Compras personales",
  "Servicios del hogar", "Otros", "Higiene personal", "Energia electrica", "COMPRA CASA/VARIOS", "Dieta", "ELECTRICIDAD CASA",
];

export type EstadoPartida = "Sin presupuesto" | "Excedido" | "Cerca del límite" | "Dentro";

// Misma regla de las hojas mensuales del Excel: sin presupuesto, excedido (real mayor), cerca del límite (90 % o más) o dentro.
export function estadoPartida(presupuesto: bigint, real: bigint): EstadoPartida {
  if (presupuesto <= 0n) return "Sin presupuesto";
  if (real > presupuesto) return "Excedido";
  if (real * 10n >= presupuesto * 9n) return "Cerca del límite";
  return "Dentro";
}

// % de desviación (real ÷ presupuesto − 1), en décimas de punto; null si no hay presupuesto.
export const desviacion = (presupuesto: bigint, real: bigint): number | null =>
  presupuesto <= 0n ? null : Number(((real - presupuesto) * 1000n) / presupuesto) / 10;

export const diasDelMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

export type Partida = { categoria: string; presupuesto: bigint; real: bigint };

// Lo que hay que buscar para cubrir el mes (hoja Dashboard): ingresos presupuestados menos todas las obligaciones presupuestadas.
export function necesidadDelMes(ingresos: bigint, oficina: bigint, personal: bigint, deuda: bigint, ahorro: bigint) {
  const diferencia = ingresos - oficina - personal - deuda - ahorro;
  return { diferencia, buscar: diferencia < 0n ? -diferencia : 0n };
}

// Meta por día laborable (lunes a viernes) y por quincena.
export const metaDiaria = (buscar: bigint, laborables: number) => (laborables > 0 ? buscar / BigInt(laborables) : 0n);
export const metaQuincenal = (buscar: bigint) => buscar / 2n;

// ───── Base de datos ─────

export type Categoria = { id: string; nombre: string; orden: number; activa: boolean };

// La primera vez carga las partidas del Excel con los montos vacíos (no hay montos reales cargados).
export async function sembrarCategorias(tx: Tx, empresaId: string) {
  const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM presupuesto_categorias`;
  if (n > 0) return;
  for (const [lista, nombres] of [["oficina", CATEGORIAS_OFICINA], ["personal", CATEGORIAS_PERSONAL]] as const) {
    for (const [i, nombre] of nombres.entries()) {
      await tx`INSERT INTO presupuesto_categorias (empresa_id, lista, nombre, orden) VALUES (${empresaId}, ${lista}, ${nombre}, ${i}) ON CONFLICT DO NOTHING`;
    }
  }
}

export const categoriasDe = (tx: Tx, lista: ListaPresupuesto, soloActivas = true) => tx<Categoria[]>`
  SELECT id, nombre, orden, activa FROM presupuesto_categorias WHERE lista = ${lista} AND (activa OR NOT ${soloActivas}) ORDER BY orden, nombre`;

export async function agregarCategoria(tx: Tx, empresaId: string, lista: ListaPresupuesto, nombre: string) {
  const n = nombre.trim();
  if (n.length < 1 || n.length > 80) throw new Error("Escribe el nombre de la categoría (hasta 80 letras).");
  const [{ orden }] = await tx<{ orden: number }[]>`SELECT COALESCE(max(orden), -1) + 1 AS orden FROM presupuesto_categorias WHERE lista = ${lista}`;
  const r = await tx`
    INSERT INTO presupuesto_categorias (empresa_id, lista, nombre, orden) VALUES (${empresaId}, ${lista}, ${n}, ${orden})
    ON CONFLICT (empresa_id, lista, (lower(btrim(nombre)))) DO UPDATE SET activa = true RETURNING id`;
  return r.length;
}

export const renombrarCategoria = async (tx: Tx, id: string, nombre: string) => {
  const n = nombre.trim();
  if (n.length < 1 || n.length > 80) throw new Error("Escribe el nombre de la categoría (hasta 80 letras).");
  await tx`UPDATE presupuesto_categorias SET nombre = ${n} WHERE id = ${id}`;
};

// No se borra: se esconde (lo que ya se gastó con esa categoría se sigue viendo en los años anteriores).
export const quitarCategoria = (tx: Tx, id: string) => tx`UPDATE presupuesto_categorias SET activa = false WHERE id = ${id}`;

// Lo presupuestado de un año: clave «lista|categoria|mes» → centavos.
export async function montosDelAnio(tx: Tx, anio: number) {
  const filas = await tx<{ lista: string; categoria: string; mes: number; monto: string }[]>`
    SELECT lista, categoria, mes, monto::text FROM presupuesto_montos WHERE anio = ${anio}`;
  const m = new Map<string, bigint>();
  for (const f of filas) m.set(`${f.lista}|${f.categoria}|${f.mes}`, aCentavos(f.monto));
  return m;
}

export const claveMonto = (lista: string, categoria: string, mes: number) => `${lista}|${categoria}|${mes}`;

// Guarda lo presupuestado de una categoría: 0 o vacío quita el renglón.
export async function guardarMonto(tx: Tx, empresaId: string, anio: number, mes: number, lista: string, categoria: string, monto: bigint) {
  if (!["oficina", "personal", "ahorro", "deuda"].includes(lista)) throw new Error("La lista no es válida.");
  if (mes < 1 || mes > 12) throw new Error("El mes no es válido.");
  if (monto < 0n) throw new Error("El monto no puede ser negativo.");
  if (monto === 0n) {
    await tx`DELETE FROM presupuesto_montos WHERE anio = ${anio} AND mes = ${mes} AND lista = ${lista} AND categoria = ${categoria}`;
    return;
  }
  await tx`
    INSERT INTO presupuesto_montos (empresa_id, anio, mes, lista, categoria, monto) VALUES (${empresaId}, ${anio}, ${mes}, ${lista}, ${categoria}, ${deCentavos(monto)})
    ON CONFLICT (empresa_id, anio, mes, lista, categoria) DO UPDATE SET monto = EXCLUDED.monto`;
}

// Copia lo presupuestado de un año a otro (solo donde el año nuevo no tiene nada): «cada año arranca con los mismos meses y categorías».
export async function copiarAnio(tx: Tx, empresaId: string, desde: number, hacia: number) {
  const r = await tx`
    INSERT INTO presupuesto_montos (empresa_id, anio, mes, lista, categoria, monto)
    SELECT empresa_id, ${hacia}, mes, lista, categoria, monto FROM presupuesto_montos WHERE anio = ${desde} AND empresa_id = ${empresaId}
    ON CONFLICT (empresa_id, anio, mes, lista, categoria) DO NOTHING RETURNING id`;
  return r.length;
}

export type RealDelMes = { oficina: Map<string, bigint>; personal: Map<string, bigint>; ahorro: bigint; deuda: bigint; traspaso: bigint };

// Lo que de verdad se pagó en cada mes del año (salidas vigentes), por categoría.
export async function realDelAnio(tx: Tx, anio: number): Promise<RealDelMes[]> {
  const filas = await tx<{ mes: number; tipo: string; categoria: string | null; total: string }[]>`
    SELECT extract(month FROM fecha)::int AS mes, tipo, categoria, sum(monto)::text AS total
      FROM salidas WHERE NOT anulada AND fecha >= make_date(${anio}, 1, 1) AND fecha <= make_date(${anio}, 12, 31)
     GROUP BY 1, 2, 3`;
  const meses: RealDelMes[] = Array.from({ length: 12 }, () => ({ oficina: new Map(), personal: new Map(), ahorro: 0n, deuda: 0n, traspaso: 0n }));
  for (const f of filas) {
    const m = meses[f.mes - 1], v = aCentavos(f.total);
    if (f.tipo === "oficina" || f.tipo === "personal") {
      const k = f.categoria?.trim() || "Sin categoría";
      m[f.tipo].set(k, (m[f.tipo].get(k) ?? 0n) + v);
    } else m[f.tipo as "ahorro" | "deuda" | "traspaso"] += v;
  }
  return meses;
}

export const GRUPOS_INGRESO = {
  igualas: "Igualas",
  servicios: "Servicios contables (extras)",
  generales: "Ingresos generales (talleres y otros)",
  anticipos: "Anticipos de clientes",
  cargo_app: "Cargo por la aplicación (cuenta exclusiva)", // P3b: la parte de lo cobrado que es el cargo; sale del grupo de su factura, el total no cambia
} as const;
export type GrupoIngreso = keyof typeof GRUPOS_INGRESO;

// Lo cobrado por mes (el Excel suma solo lo «Pagado»): cada cobro aplicado a una factura entra en el grupo de esa factura —iguala, servicio de
// la unidad «Firma contable» u otro ingreso—; los anticipos entran el día que se reciben y su aplicación posterior no vuelve a contar. De lo cobrado
// de las facturas con cargo por la aplicación (P3b), la parte del cargo se muestra aparte, en su propio grupo, y se quita del grupo de la factura.
export async function ingresosDelAnio(tx: Tx, anio: number): Promise<Record<GrupoIngreso, bigint>[]> {
  const meses = Array.from({ length: 12 }, () => ({ igualas: 0n, servicios: 0n, generales: 0n, anticipos: 0n, cargo_app: 0n }) as Record<GrupoIngreso, bigint>);
  const filas = await tx<{ mes: number; grupo: GrupoIngreso; total: string; cargo: string }[]>`
    SELECT extract(month FROM c.fecha)::int AS mes,
           CASE WHEN f.acuerdo_id IS NOT NULL THEN 'igualas'
                WHEN EXISTS (SELECT 1 FROM lineas_factura l JOIN unidades_negocio u ON u.id = l.unidad_id
                              WHERE l.factura_id = f.id AND lower(u.nombre) LIKE 'firma contable%') THEN 'servicios'
                ELSE 'generales' END AS grupo,
           sum(a.monto)::text AS total,
           coalesce(sum(round(a.monto * cargo_de_factura(f.id) / NULLIF(f.total, 0), 2)), 0)::text AS cargo
      FROM cobros c JOIN aplicaciones_cobro a ON a.cobro_id = c.id JOIN facturas f ON f.id = a.factura_id
     WHERE NOT c.anulado AND c.anticipo_id IS NULL AND c.fecha >= make_date(${anio}, 1, 1) AND c.fecha <= make_date(${anio}, 12, 31)
     GROUP BY 1, 2
    UNION ALL
    SELECT extract(month FROM fecha)::int, 'anticipos', sum(monto)::text, '0' FROM anticipos
     WHERE NOT anulado AND fecha >= make_date(${anio}, 1, 1) AND fecha <= make_date(${anio}, 12, 31) GROUP BY 1`;
  for (const f of filas) {
    const cargo = aCentavos(f.cargo);
    meses[f.mes - 1][f.grupo] += aCentavos(f.total) - cargo;
    meses[f.mes - 1].cargo_app += cargo;
  }
  return meses;
}

export const sumar = (m: Map<string, bigint>) => [...m.values()].reduce((a, b) => a + b, 0n);
export const totalIngresos = (i: Record<GrupoIngreso, bigint>) => i.igualas + i.servicios + i.generales + i.anticipos + i.cargo_app;

// Las listas para los formularios de «Registrar salidas»: las del presupuesto o, si todavía no se abrió, las del Excel.
export async function categoriasPresupuesto(tx: Tx): Promise<{ oficina: string[]; personal: string[] }> {
  const [o, p] = [await categoriasDe(tx, "oficina"), await categoriasDe(tx, "personal")];
  return { oficina: o.length ? o.map((c) => c.nombre) : CATEGORIAS_OFICINA, personal: p.length ? p.map((c) => c.nombre) : CATEGORIAS_PERSONAL };
}
