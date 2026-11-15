// Integración con Vendario, parte 3: cuadre (acuerdo, sección 10). Empire pregunta a Vendario, firmado con E2V_SECRET, los totales de un
// rango de fechas (POST empire-ledger con {org_rnc, from, to}) y los compara con los eventos recibidos: por tipo de evento (cantidad y
// total), por cuenta neutral (débitos y créditos) y evento por evento (los que Vendario tiene y no llegaron, y al revés).
import { db } from "./db.ts";
import { clavesDe, firmar } from "./vendario-firma.ts";
import { centavos, texto } from "./vendario-contable.ts";

export type Ledger = {
  org_rnc: string; from: string; to: string;
  by_event: Record<string, { count: number; total: string }>;
  by_account: Record<string, { debit: string; credit: string }>;
  ids: string[];
};
export type Recibido = { id: string; tipo: string; total: string | null; entry: unknown };

export type Fila = { clave: string; vendario: [string, string]; empire: [string, string]; igual: boolean };
export type Comparacion = { eventos: Fila[]; cuentas: Fila[]; faltan: string[]; sobran: string[]; cuadra: boolean };

export class ErrorCuadre extends Error {}

const URL = () => (process.env.VENDARIO_URL || "https://semwrlqhurdgphahrvkv.supabase.co/functions/v1").replace(/\/+$/, "");

// Lee la respuesta de Vendario y revisa su forma.
export function leerLedger(j: unknown): Ledger {
  const o = (j ?? {}) as Record<string, unknown>;
  if (typeof o.by_event !== "object" || o.by_event === null || typeof o.by_account !== "object" || o.by_account === null || !Array.isArray(o.ids)) {
    throw new ErrorCuadre("Vendario respondió algo que no es el cuadre del acuerdo");
  }
  return { org_rnc: String(o.org_rnc ?? ""), from: String(o.from ?? ""), to: String(o.to ?? ""), by_event: o.by_event as Ledger["by_event"],
    by_account: o.by_account as Ledger["by_account"], ids: (o.ids as unknown[]).map((x) => String(x).toLowerCase()) };
}

// Compara lo que dice Vendario con lo recibido en Empire. Todo en centavos.
export function comparar(l: Ledger, recibidos: Recibido[]): Comparacion {
  const porEvento = new Map<string, { n: bigint; total: bigint }>();
  const porCuenta = new Map<string, { d: bigint; c: bigint }>();
  for (const r of recibidos) {
    const e = porEvento.get(r.tipo) ?? { n: 0n, total: 0n };
    porEvento.set(r.tipo, { n: e.n + 1n, total: e.total + (r.total ? centavos(r.total) : 0n) });
    for (const linea of Array.isArray(r.entry) ? r.entry : []) {
      const x = (linea ?? {}) as Record<string, unknown>;
      if (typeof x.account !== "string") continue;
      const a = porCuenta.get(x.account) ?? { d: 0n, c: 0n };
      porCuenta.set(x.account, { d: a.d + centavos(x.debit ?? x.d ?? "0"), c: a.c + centavos(x.credit ?? x.c ?? "0") });
    }
  }
  const eventos: Fila[] = [...new Set([...Object.keys(l.by_event), ...porEvento.keys()])].sort().map((k) => {
    const v = l.by_event[k] ?? { count: 0, total: "0.00" };
    const e = porEvento.get(k) ?? { n: 0n, total: 0n };
    const vv: [string, string] = [String(v.count), texto(centavos(v.total ?? "0"))];
    const ee: [string, string] = [String(e.n), texto(e.total)];
    return { clave: k, vendario: vv, empire: ee, igual: vv[0] === ee[0] && vv[1] === ee[1] };
  });
  const cuentas: Fila[] = [...new Set([...Object.keys(l.by_account), ...porCuenta.keys()])].sort().map((k) => {
    const v = l.by_account[k] ?? { debit: "0", credit: "0" };
    const e = porCuenta.get(k) ?? { d: 0n, c: 0n };
    const vv: [string, string] = [texto(centavos(v.debit ?? "0")), texto(centavos(v.credit ?? "0"))];
    const ee: [string, string] = [texto(e.d), texto(e.c)];
    return { clave: k, vendario: vv, empire: ee, igual: vv[0] === ee[0] && vv[1] === ee[1] };
  });
  const aqui = new Set(recibidos.map((r) => r.id.toLowerCase()));
  const alla = new Set(l.ids);
  const faltan = l.ids.filter((id) => !aqui.has(id));
  const sobran = [...aqui].filter((id) => !alla.has(id));
  return { eventos, cuentas, faltan, sobran, cuadra: !faltan.length && !sobran.length && eventos.every((f) => f.igual) && cuentas.every((f) => f.igual) };
}

export type Pedir = (url: string, init: RequestInit) => Promise<Response>;

// Consulta a Vendario y guarda el resultado (también si falla, con su motivo).
export async function cuadrar(d: { clienteId: string; desde: string; hasta: string; usuarioId: string | null; pedir?: Pedir }): Promise<string> {
  const [c] = await db()<{ rnc: string | null }[]>`SELECT rnc FROM vendario_clientes WHERE id = ${d.clienteId}`;
  if (!c) throw new ErrorCuadre("El cliente no existe");
  const guardar = async (x: { respuesta?: unknown; comparacion?: Comparacion; error?: string }) => {
    const [{ id }] = await db()<{ id: string }[]>`
      INSERT INTO vendario_cuadres (vendario_cliente_id, desde, hasta, respuesta, comparacion, cuadra, error, consultado_por)
      VALUES (${d.clienteId}, ${d.desde}, ${d.hasta}, ${x.respuesta === undefined ? null : db().json(x.respuesta as never)},
              ${x.comparacion ? db().json(x.comparacion as never) : null}, ${x.comparacion?.cuadra ?? null}, ${x.error ?? null}, ${d.usuarioId})
      RETURNING id`;
    return id;
  };
  if (!c.rnc) return guardar({ error: "Este cliente no tiene RNC en Vendario: la consulta de cuadre busca por RNC" });
  const [clave] = clavesDe(process.env.E2V_SECRET);
  if (!clave) return guardar({ error: "Falta E2V_SECRET en el servidor" });
  const cuerpo = JSON.stringify({ org_rnc: c.rnc, from: d.desde, to: d.hasta });
  let j: unknown;
  try {
    const r = await (d.pedir ?? fetch)(`${URL()}/empire-ledger`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Signature": firmar(clave, cuerpo) }, body: cuerpo, signal: AbortSignal.timeout(20_000),
    });
    const t = await r.text();
    if (!r.ok) return guardar({ error: `Vendario respondió ${r.status}: ${t.slice(0, 200)}` });
    j = JSON.parse(t);
  } catch (e) {
    return guardar({ error: `No se pudo consultar a Vendario: ${String((e as Error)?.message ?? e).slice(0, 200)}` });
  }
  let l: Ledger;
  try { l = leerLedger(j); } catch (e) { return guardar({ respuesta: j, error: (e as Error).message }); }
  const recibidos = await db()<Recibido[]>`
    SELECT id::text, tipo, total::text, datos->'entry' AS entry FROM vendario_eventos
     WHERE vendario_cliente_id = ${d.clienteId} AND fecha BETWEEN ${d.desde} AND ${d.hasta}`;
  return guardar({ respuesta: j, comparacion: comparar(l, recibidos) });
}

export const finDeMes = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};
