import { COMPARAR, balanceGeneral, columnasBalance, columnasResultados, estadoResultados, type Columna, type Comparar, type Estado } from "./estados.ts";
import type { Tx } from "./db";
import { cambiosPatrimonio, flujoEfectivo } from "./estados-flujo.ts";
import { hoyISO } from "./montos.ts";
import { fechaValida, primerDiaMes, ultimoDiaMes } from "./reportes.ts";

// Lee los filtros de la pantalla (y de la descarga) de estados financieros y arma el estado pedido.
export type TipoEstado = "resultados" | "balance" | "flujo" | "patrimonio";
// unidad (solo estado de resultados): vacía = todas juntas, «columnas» = una columna por unidad de negocio, un id o «sin».
export type Filtros = { tipo: TipoEstado; desde: string; hasta: string; corte: string; comparar: Comparar; agrupar: "cuentas" | "grupos"; unidad: string };
export type Firmas = { firma_preparado: string | null; firma_icpard: string | null; firma_aprobado: string | null; firma_cargo: string | null };

export function leerFiltrosEstados(sp: Record<string, string | undefined>): Filtros {
  const hoy = hoyISO();
  // Por defecto, el año en curso hasta el último mes cerrado del calendario (el mes actual completo).
  const desde = fechaValida(sp.desde) ? sp.desde : `${hoy.slice(0, 4)}-01-01`;
  const hasta = fechaValida(sp.hasta) ? sp.hasta : ultimoDiaMes(hoy);
  return {
    tipo: sp.tipo && sp.tipo in TITULOS ? (sp.tipo as TipoEstado) : "resultados",
    desde: desde <= hasta ? desde : primerDiaMes(hasta), hasta,
    corte: fechaValida(sp.corte) ? sp.corte : ultimoDiaMes(hoy),
    comparar: sp.comparar && sp.comparar in COMPARAR ? (sp.comparar as Comparar) : "ninguno",
    agrupar: sp.agrupar === "grupos" ? "grupos" : "cuentas",
    unidad: sp.unidad === "columnas" || sp.unidad === "sin" || /^[0-9a-f-]{36}$/i.test(sp.unidad ?? "") ? sp.unidad! : "",
  };
}

export const consultaEstados = (f: Filtros) =>
  new URLSearchParams({ tipo: f.tipo, desde: f.desde, hasta: f.hasta, corte: f.corte, comparar: f.comparar, agrupar: f.agrupar, ...(f.unidad ? { unidad: f.unidad } : {}) }).toString();

// Columnas del estado de resultados según la unidad de negocio elegida.
function columnasPorUnidad(f: Filtros, unidades: { id: string; nombre: string }[]): Columna[] {
  const base = columnasResultados(f.desde, f.hasta, f.comparar);
  if (!f.unidad) return base;
  if (f.unidad === "columnas") {
    const { desde, hasta } = base[0];
    return [...unidades.map((u) => ({ titulo: u.nombre, desde, hasta, unidad: u.id })),
      { titulo: "Sin unidad", desde, hasta, unidad: "sin" }, { titulo: "Total", desde, hasta }];
  }
  return base.map((c) => ({ ...c, unidad: f.unidad }));
}

export async function armarEstado(tx: Tx, f: Filtros): Promise<{
  estado: Estado & { cuadraEfectivo?: boolean[] }; firmas: Firmas; mesCierre: number; unidades: { id: string; nombre: string }[]; unidad: string | null;
}> {
  const unidades = await tx<{ id: string; nombre: string }[]>`SELECT id, nombre FROM unidades_negocio ORDER BY orden, nombre`;
  const [e] = await tx<(Firmas & { mes_cierre: number })[]>`
    SELECT mes_cierre, firma_preparado, firma_icpard, firma_aprobado, firma_cargo FROM empresas WHERE id = empresa_actual()`;
  const { mes_cierre: mesCierre, ...firmas } = e;
  const estado = f.tipo === "balance" ? await balanceGeneral(tx, columnasBalance(f.corte, f.comparar, mesCierre), f.agrupar, mesCierre)
    : f.tipo === "flujo" ? await flujoEfectivo(tx, columnasResultados(f.desde, f.hasta, f.comparar))
    : f.tipo === "patrimonio" ? await cambiosPatrimonio(tx, f.desde, f.hasta)
    : await estadoResultados(tx, columnasPorUnidad(f, unidades), f.agrupar);
  // Nombre de la unidad elegida, para el título (pantalla, Excel y PDF).
  const unidad = f.tipo !== "resultados" || !f.unidad ? null
    : f.unidad === "columnas" ? "por unidad de negocio" : f.unidad === "sin" ? "sin unidad de negocio"
    : `unidad ${unidades.find((u) => u.id === f.unidad)?.nombre ?? "—"}`;
  return { estado, firmas, mesCierre, unidades, unidad };
}

export const TITULOS: Record<TipoEstado, string> = {
  resultados: "Estado de resultados", balance: "Estado de situación financiera", flujo: "Estado de flujos de efectivo", patrimonio: "Estado de cambios en el patrimonio",
};
