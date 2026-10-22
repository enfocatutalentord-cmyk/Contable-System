import type { Tx } from "./db";
import { aCentavos, hoyISO, leerMonto } from "./montos";
import { fechaValida, primerDiaMes, ultimoDiaMes } from "./reportes";

export const ESTADOS: Record<string, string> = { todos: "Todos", borrador: "Borradores", contabilizado: "Contabilizados", anulado: "Anulados" };
export const ORIGENES: Record<string, string> = { manual: "Manual", factura: "Factura", nota_credito: "Nota de crédito", cobro: "Cobro" };

export type Filtros = {
  desde: string; hasta: string; estado: string; origen: string; q: string; cuenta: string; usuario: string;
  min: string | null; max: string | null; minTexto: string; maxTexto: string;
};

const uuid = (v?: string) => (/^[0-9a-f-]{36}$/i.test(v ?? "") ? v! : "");

export function leerFiltros(sp: Record<string, string | undefined>): Filtros {
  const hoy = hoyISO();
  // Los borradores se buscan en cualquier fecha; el resto, por defecto, en el mes en curso.
  const soloBorradores = sp.estado === "borrador";
  const montos = (v?: string) => {
    const m = leerMonto(v ?? "");
    return m && aCentavos(m) > 0n ? m : null;
  };
  return {
    desde: fechaValida(sp.desde) ? sp.desde : soloBorradores ? "" : primerDiaMes(hoy),
    hasta: fechaValida(sp.hasta) ? sp.hasta : soloBorradores ? "" : ultimoDiaMes(hoy),
    estado: ESTADOS[sp.estado ?? ""] ? sp.estado! : "todos",
    origen: ORIGENES[sp.origen ?? ""] ? sp.origen! : "",
    q: (sp.q ?? "").trim(),
    cuenta: uuid(sp.cuenta),
    usuario: uuid(sp.usuario),
    min: montos(sp.min),
    max: montos(sp.max),
    minTexto: sp.min ?? "",
    maxTexto: sp.max ?? "",
  };
}

export type FilaAsiento = {
  id: string; numero: number | null; fecha: string; concepto: string; referencia: string | null; estado: string; origen: string;
  total: string | null; creado_por: string | null; adjuntos: number; revertido: boolean; es_reversion: boolean;
};

export async function buscarAsientos(tx: Tx, f: Filtros, limite: number, desplazamiento = 0) {
  const [c] = f.cuenta ? await tx<{ codigo: string; de_detalle: boolean }[]>`SELECT codigo, de_detalle FROM cuentas WHERE id = ${f.cuenta}` : [];
  const filtro = tx`
      FROM asientos a
     WHERE (${f.desde} = '' OR a.fecha >= ${f.desde || null}::date)
       AND (${f.hasta} = '' OR a.fecha <= ${f.hasta || null}::date)
       AND (${f.estado} = 'todos' OR a.estado = ${f.estado})
       AND (${f.origen} = '' OR a.origen = ${f.origen})
       AND (${f.usuario} = '' OR a.creado_por = ${f.usuario || null}::uuid)
       AND (${f.q} = '' OR a.concepto ILIKE ${"%" + f.q + "%"} OR a.referencia ILIKE ${"%" + f.q + "%"} OR a.numero::text = ${f.q})
       AND (${c ? c.codigo : ""} = '' OR EXISTS (
             SELECT 1 FROM lineas_asiento l JOIN cuentas cu ON cu.id = l.cuenta_id
              WHERE l.asiento_id = a.id AND (cu.id = ${f.cuenta || null}::uuid OR (${c ? !c.de_detalle : false} AND cu.codigo LIKE ${(c?.codigo ?? "") + "%"}))))
       AND (${f.min}::numeric IS NULL OR (SELECT sum(debe) FROM lineas_asiento WHERE asiento_id = a.id) >= ${f.min}::numeric)
       AND (${f.max}::numeric IS NULL OR (SELECT sum(debe) FROM lineas_asiento WHERE asiento_id = a.id) <= ${f.max}::numeric)`;
  const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n ${filtro}`;
  const filas = await tx<FilaAsiento[]>`
    SELECT a.id, a.numero, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.concepto, a.referencia, a.estado, a.origen,
           (SELECT sum(debe)::text FROM lineas_asiento WHERE asiento_id = a.id) AS total,
           (SELECT nombre FROM usuarios WHERE id = a.creado_por) AS creado_por,
           (SELECT count(*)::int FROM documentos d WHERE d.entidad = 'asiento' AND d.entidad_id = a.id AND NOT d.eliminado) AS adjuntos,
           EXISTS (SELECT 1 FROM asientos r WHERE r.revierte_a = a.id) AS revertido, a.revierte_a IS NOT NULL AS es_reversion
    ${filtro}
    ORDER BY a.estado = 'borrador' DESC, a.fecha DESC, a.numero DESC NULLS FIRST
    LIMIT ${limite} OFFSET ${desplazamiento}`;
  return { filas, total: n };
}

export function estadoTexto(a: FilaAsiento): string {
  if (a.estado === "borrador") return "Borrador";
  if (a.estado === "anulado") return "Anulado";
  if (a.revertido) return "Revertido";
  if (a.es_reversion) return "Reversión";
  return a.origen === "manual" ? "Contabilizado" : ORIGENES[a.origen];
}

export function consultaFiltros(f: Filtros, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  const datos: Record<string, string> = {
    desde: f.desde, hasta: f.hasta, estado: f.estado, origen: f.origen, q: f.q, cuenta: f.cuenta, usuario: f.usuario,
    min: f.minTexto, max: f.maxTexto, ...extra,
  };
  for (const [k, v] of Object.entries(datos)) if (v && !(k === "estado" && v === "todos")) p.set(k, v);
  return p.toString();
}
