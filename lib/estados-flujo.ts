import type { TipoCuenta } from "./catalogo-rd.ts";
import type { Tx } from "./db";
import type { Columna, Estado, Fila } from "./estados.ts";
import { aCentavos } from "./montos.ts";

// Estado de flujos de efectivo por el método indirecto (NIIF para PYMES, Sección 7) y estado de cambios en el patrimonio
// (Sección 6), desde los asientos contabilizados. Los asientos de cierre del ejercicio (origen «cierre») solo llevan
// resultados a patrimonio: no son movimientos del período.

export type Actividad = "efectivo" | "operacion" | "ajuste" | "inversion" | "financiamiento";
export const ACTIVIDADES: Record<Actividad, string> = {
  efectivo: "Efectivo y equivalentes", operacion: "Operación", ajuste: "Operación: partida que no es efectivo (depreciación, amortización)",
  inversion: "Inversión", financiamiento: "Financiamiento",
};

// Actividad sugerida por el código del catálogo dominicano; la firma la cambia por cuenta en el catálogo.
export function actividadSugerida(codigo: string, tipo: TipoCuenta, nombre: string): Actividad | null {
  if (tipo === "ingreso" || tipo === "costo" || tipo === "gasto") return null; // forman la utilidad neta
  if (codigo.startsWith("1101")) return "efectivo";
  if (/(depreciaci|amortizaci)[^ ]* acumulad/i.test(nombre) || /acumulad[ao]s? de (depreciaci|amortizaci)/i.test(nombre)) return "ajuste";
  if (codigo.startsWith("12")) return "inversion";
  if (codigo.startsWith("2104") || codigo.startsWith("22") || codigo.startsWith("3")) return "financiamiento";
  return "operacion";
}

type Saldo = { id: string; codigo: string; nombre: string; tipo: TipoCuenta; actividad: Actividad | null; inicial: bigint; mov: bigint; cierre: bigint };

async function saldos(tx: Tx, desde: string, hasta: string): Promise<Saldo[]> {
  const filas = await tx<{ id: string; codigo: string; nombre: string; tipo: TipoCuenta; actividad_flujo: Actividad | null; inicial: string; mov: string; cierre: string }[]>`
    SELECT c.id, c.codigo, c.nombre, c.tipo, c.actividad_flujo,
           COALESCE(sum(l.debe - l.haber) FILTER (WHERE a.fecha < ${desde}), 0)::text AS inicial,
           COALESCE(sum(l.debe - l.haber) FILTER (WHERE a.fecha >= ${desde} AND a.origen <> 'cierre'), 0)::text AS mov,
           COALESCE(sum(l.debe - l.haber) FILTER (WHERE a.fecha >= ${desde} AND a.origen = 'cierre'), 0)::text AS cierre
      FROM cuentas c
      LEFT JOIN lineas_asiento l ON l.cuenta_id = c.id
      LEFT JOIN asientos a ON a.id = l.asiento_id AND a.estado = 'contabilizado' AND a.fecha <= ${hasta}
     WHERE c.de_detalle
     GROUP BY c.id ORDER BY c.codigo`;
  return filas.map((f) => ({
    id: f.id, codigo: f.codigo, nombre: f.nombre, tipo: f.tipo,
    actividad: f.actividad_flujo ?? actividadSugerida(f.codigo, f.tipo, f.nombre),
    inicial: aCentavos(f.inicial), mov: aCentavos(f.mov), cierre: aCentavos(f.cierre),
  }));
}

const esResultado = (t: TipoCuenta) => t === "ingreso" || t === "costo" || t === "gasto";

export async function flujoEfectivo(tx: Tx, columnas: Columna[]): Promise<Estado & { cuadraEfectivo: boolean[] }> {
  const porColumna = await Promise.all(columnas.map((c) => saldos(tx, c.desde, c.hasta)));
  const n = columnas.length;
  const cero = () => Array.from({ length: n }, () => 0n);
  const utilidad = cero(), inicio = cero(), real = cero();
  const lineas: Record<"ajuste" | "operacion" | "inversion" | "financiamiento", Map<string, Fila>> = {
    ajuste: new Map(), operacion: new Map(), inversion: new Map(), financiamiento: new Map(),
  };
  porColumna.forEach((s, i) => {
    for (const c of s) {
      if (esResultado(c.tipo)) { utilidad[i] -= c.mov; continue; }
      if (c.actividad === "efectivo") { inicio[i] += c.inicial; real[i] += c.inicial + c.mov + c.cierre; continue; }
      const act = c.actividad ?? "operacion";
      let f = lineas[act].get(c.codigo);
      if (!f) {
        // En el método indirecto, el aumento de un activo usa efectivo y el aumento de un pasivo o del patrimonio lo provee.
        const texto = act === "operacion" ? `${c.tipo === "activo" ? "(Aumento) disminución" : "Aumento (disminución)"} en ${c.nombre.toLowerCase()}` : c.nombre;
        f = { tipo: "cuenta", texto: `${c.codigo} ${texto}`, cuentaId: c.id, valores: cero() };
        lineas[act].set(c.codigo, f);
      }
      f.valores[i] -= c.mov;
    }
  });
  const conValor = (m: Map<string, Fila>) => [...m.values()].filter((f) => f.valores.some((v) => v !== 0n));
  const suma = (fs: Fila[], base = cero()) => fs.reduce((t, f) => t.map((v, i) => v + f.valores[i]), base);
  const filas: Fila[] = [];
  const vacio = cero();

  filas.push({ tipo: "seccion", texto: "Actividades de operación", valores: vacio });
  filas.push({ tipo: "cuenta", texto: "Utilidad (pérdida) neta del período", valores: utilidad });
  const ajustes = conValor(lineas.ajuste), capital = conValor(lineas.operacion);
  if (ajustes.length) filas.push({ tipo: "seccion", texto: "Partidas que no son efectivo", valores: vacio }, ...ajustes);
  if (capital.length) filas.push({ tipo: "seccion", texto: "Cambios en el capital de trabajo", valores: vacio }, ...capital);
  const operacion = suma([...ajustes, ...capital], [...utilidad]);
  filas.push({ tipo: "subtotal", texto: "Efectivo neto de las actividades de operación", valores: operacion });

  const inversion = conValor(lineas.inversion);
  filas.push({ tipo: "seccion", texto: "Actividades de inversión", valores: vacio }, ...inversion);
  const totalInversion = suma(inversion);
  filas.push({ tipo: "subtotal", texto: "Efectivo neto de las actividades de inversión", valores: totalInversion });

  const financiamiento = conValor(lineas.financiamiento);
  filas.push({ tipo: "seccion", texto: "Actividades de financiamiento", valores: vacio }, ...financiamiento);
  const totalFinanciamiento = suma(financiamiento);
  filas.push({ tipo: "subtotal", texto: "Efectivo neto de las actividades de financiamiento", valores: totalFinanciamiento });

  const neto = operacion.map((v, i) => v + totalInversion[i] + totalFinanciamiento[i]);
  filas.push({ tipo: "total", texto: "Aumento (disminución) neto del efectivo", valores: neto });
  filas.push({ tipo: "cuenta", texto: "Efectivo y equivalentes al inicio del período", valores: inicio });
  const final = inicio.map((v, i) => v + neto[i]);
  filas.push({ tipo: "total", texto: "Efectivo y equivalentes al final del período", valores: final });
  return { columnas, filas, cuadraEfectivo: final.map((v, i) => v === real[i]) };
}

// Estado de cambios en el patrimonio del período: una columna por subgrupo del patrimonio (capital, reservas, resultados
// acumulados…) y una para los resultados que todavía no se han cerrado.
export async function cambiosPatrimonio(tx: Tx, desde: string, hasta: string): Promise<Estado> {
  const s = await saldos(tx, desde, hasta);
  const grupos = new Map<string, { nombre: string; ini: bigint; cierre: bigint; mov: bigint }>();
  const [nombres] = [new Map((await tx<{ codigo: string; nombre: string }[]>`SELECT codigo, nombre FROM cuentas WHERE length(codigo) = 4 AND codigo LIKE '3%'`).map((r) => [r.codigo, r.nombre]))];
  let resIni = 0n, resMov = 0n, resCierre = 0n;
  for (const c of s) {
    if (esResultado(c.tipo)) { resIni -= c.inicial; resMov -= c.mov; resCierre -= c.cierre; continue; }
    if (c.tipo !== "patrimonio") continue;
    const clave = c.codigo.slice(0, 4);
    const g = grupos.get(clave) ?? { nombre: nombres.get(clave) ?? clave, ini: 0n, cierre: 0n, mov: 0n };
    g.ini -= c.inicial; g.cierre -= c.cierre; g.mov -= c.mov;
    grupos.set(clave, g);
  }
  const lista = [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b)).filter(([, g]) => g.ini || g.cierre || g.mov);
  const columnas: Columna[] = [...lista.map(([, g]) => ({ titulo: g.nombre, desde, hasta })), { titulo: "Resultados sin cerrar", desde, hasta }, { titulo: "Total", desde, hasta }];
  const fila = (texto: string, tipo: Fila["tipo"], vals: bigint[], res: bigint): Fila => {
    const v = [...vals, res];
    return { tipo, texto, valores: [...v, v.reduce((a, b) => a + b, 0n)] };
  };
  const ini = fila("Saldo al inicio del período", "subtotal", lista.map(([, g]) => g.ini), resIni);
  const resultado = fila("Resultado del período", "cuenta", lista.map(() => 0n), resMov);
  const cierre = fila("Traspaso de resultados al cerrar el ejercicio", "cuenta", lista.map(([, g]) => g.cierre), resCierre);
  const otros = fila("Aportes, reservas, distribuciones y otros movimientos", "cuenta", lista.map(([, g]) => g.mov), 0n);
  const fin = { tipo: "total" as const, texto: "Saldo al final del período", valores: ini.valores.map((v, i) => v + resultado.valores[i] + cierre.valores[i] + otros.valores[i]) };
  return { columnas, filas: [ini, resultado, cierre, otros, fin], sinVariacion: true };
}
