import { esDeudora, type TipoCuenta } from "./catalogo-rd.ts";
import type { Tx } from "./db";
import { aCentavos } from "./montos.ts";

export type CuentaSaldo = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  nivel: number;
  de_detalle: boolean;
  inicial: bigint; // debe - haber antes de «desde»
  debe: bigint;
  haber: bigint;
  final: bigint; // debe - haber al cierre de «hasta»
};

// Saldos de todas las cuentas en un rango, con las cuentas de grupo sumando a sus hijas por código.
export async function saldosPorCuenta(tx: Tx, desde: string, hasta: string): Promise<CuentaSaldo[]> {
  const filas = await tx<
    { id: string; codigo: string; nombre: string; tipo: TipoCuenta; nivel: number; de_detalle: boolean; inicial: string; debe: string; haber: string }[]
  >`
    SELECT c.id, c.codigo, c.nombre, c.tipo, c.nivel, c.de_detalle,
           COALESCE(sum(l.debe - l.haber) FILTER (WHERE a.fecha < ${desde}), 0)::text AS inicial,
           COALESCE(sum(l.debe) FILTER (WHERE a.fecha BETWEEN ${desde} AND ${hasta}), 0)::text AS debe,
           COALESCE(sum(l.haber) FILTER (WHERE a.fecha BETWEEN ${desde} AND ${hasta}), 0)::text AS haber
      FROM cuentas c
      LEFT JOIN lineas_asiento l ON l.cuenta_id = c.id
      LEFT JOIN asientos a ON a.id = l.asiento_id AND a.estado = 'contabilizado' AND a.fecha <= ${hasta}
     GROUP BY c.id
     ORDER BY c.codigo`;

  const cuentas: CuentaSaldo[] = filas.map((f) => ({
    ...f,
    inicial: aCentavos(f.inicial),
    debe: aCentavos(f.debe),
    haber: aCentavos(f.haber),
    final: 0n,
  }));
  // Las líneas de borradores y asientos anulados se unen con a = NULL; la consulta ya las deja fuera de los FILTER.
  const porCodigo = new Map(cuentas.map((c) => [c.codigo, c]));
  for (const c of cuentas) {
    if (!c.de_detalle) continue;
    for (const anc of ancestros(c.codigo)) {
      const p = porCodigo.get(anc);
      if (!p || p.de_detalle) continue;
      p.inicial += c.inicial;
      p.debe += c.debe;
      p.haber += c.haber;
    }
  }
  for (const c of cuentas) c.final = c.inicial + c.debe - c.haber;
  return cuentas;
}

function ancestros(codigo: string): string[] {
  const r: string[] = [];
  let c = codigo;
  while (c.length > 1) {
    c = c.length === 2 ? c.slice(0, 1) : c.slice(0, c.length - 2);
    r.push(c);
  }
  return r;
}

// Saldo con el signo de la naturaleza de la cuenta (positivo = saldo normal).
export function saldoNatural(tipo: TipoCuenta, debeMenosHaber: bigint): bigint {
  return esDeudora(tipo) ? debeMenosHaber : -debeMenosHaber;
}

export function primerDiaMes(fecha: string): string {
  return `${fecha.slice(0, 7)}-01`;
}

export function ultimoDiaMes(fecha: string): string {
  const [a, m] = fecha.split("-").map(Number);
  const d = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${fecha.slice(0, 7)}-${String(d).padStart(2, "0")}`;
}

export function fechaValida(f: string | undefined | null): f is string {
  return !!f && /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(f));
}
