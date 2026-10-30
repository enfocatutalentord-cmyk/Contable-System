import { COMPARAR, balanceGeneral, columnasBalance, columnasResultados, estadoResultados, type Comparar, type Estado } from "./estados.ts";
import type { Tx } from "./db";
import { hoyISO } from "./montos.ts";
import { fechaValida, primerDiaMes, ultimoDiaMes } from "./reportes.ts";

// Lee los filtros de la pantalla (y de la descarga) de estados financieros y arma el estado pedido.
export type TipoEstado = "resultados" | "balance";
export type Filtros = { tipo: TipoEstado; desde: string; hasta: string; corte: string; comparar: Comparar; agrupar: "cuentas" | "grupos" };
export type Firmas = { firma_preparado: string | null; firma_icpard: string | null; firma_aprobado: string | null; firma_cargo: string | null };

export function leerFiltrosEstados(sp: Record<string, string | undefined>): Filtros {
  const hoy = hoyISO();
  // Por defecto, el año en curso hasta el último mes cerrado del calendario (el mes actual completo).
  const desde = fechaValida(sp.desde) ? sp.desde : `${hoy.slice(0, 4)}-01-01`;
  const hasta = fechaValida(sp.hasta) ? sp.hasta : ultimoDiaMes(hoy);
  return {
    tipo: sp.tipo === "balance" ? "balance" : "resultados",
    desde: desde <= hasta ? desde : primerDiaMes(hasta), hasta,
    corte: fechaValida(sp.corte) ? sp.corte : ultimoDiaMes(hoy),
    comparar: sp.comparar && sp.comparar in COMPARAR ? (sp.comparar as Comparar) : "ninguno",
    agrupar: sp.agrupar === "grupos" ? "grupos" : "cuentas",
  };
}

export const consultaEstados = (f: Filtros) =>
  new URLSearchParams({ tipo: f.tipo, desde: f.desde, hasta: f.hasta, corte: f.corte, comparar: f.comparar, agrupar: f.agrupar }).toString();

export async function armarEstado(tx: Tx, f: Filtros): Promise<{ estado: Estado; firmas: Firmas; mesCierre: number }> {
  const [e] = await tx<(Firmas & { mes_cierre: number })[]>`
    SELECT mes_cierre, firma_preparado, firma_icpard, firma_aprobado, firma_cargo FROM empresas WHERE id = empresa_actual()`;
  const { mes_cierre: mesCierre, ...firmas } = e;
  const estado = f.tipo === "balance"
    ? await balanceGeneral(tx, columnasBalance(f.corte, f.comparar, mesCierre), f.agrupar, mesCierre)
    : await estadoResultados(tx, columnasResultados(f.desde, f.hasta, f.comparar), f.agrupar);
  return { estado, firmas, mesCierre };
}

export const TITULOS: Record<TipoEstado, string> = { resultados: "Estado de resultados", balance: "Estado de situación financiera" };
