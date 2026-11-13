// Sobre común de los mensajes de Vendario (acuerdo, sección 4) y estados del servicio (sección 6). Puro: sin base ni red.

export const TIPOS_ENTRADA = ["client.enroll", "client.update", "client.unenroll", "accounting.event", "sync.history_complete"] as const;
export type TipoEntrada = (typeof TIPOS_ENTRADA)[number];

export const SERVICIOS: Record<string, string> = {
  registro_contable: "Registro contable mensual",
  itbis_606_607_608: "Formatos 606/607/608 e IT-1",
  retenciones_ir17: "Retenciones (IR-17)",
  estados_financieros: "Estados financieros",
  ir2_anual: "Declaración anual (IR-1/IR-2)",
  asesoria: "Asesoría",
};
export const ESTADO_CLIENTE: Record<string, string> = {
  solicitud: "Solicitud nueva", necesita_info: "Esperando información", aceptada: "Activo", suspendida: "Suspendido", finalizada: "Dado de baja",
};

// Con estos servicios Empire lleva la contabilidad completa (asientos); con los demás, solo los registros fiscales.
export const SERVICIOS_CONTABLES = ["registro_contable", "estados_financieros", "ir2_anual"];

export type Sobre = {
  version: string; id: string; type: TipoEntrada; created_at: string | null;
  org: { vendario_id: string; rnc: string | null }; seq: number | null; data: Record<string, unknown>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// Revisa la forma del sobre. Solo rechaza (422) lo que nunca se podrá procesar: lo que falte y se pueda resolver después no.
export function leerSobre(cuerpo: string): { ok: true; sobre: Sobre } | { ok: false; error: string } {
  let j: unknown;
  try { j = JSON.parse(cuerpo); } catch { return { ok: false, error: "INVALID_JSON" }; }
  if (!esObjeto(j)) return { ok: false, error: "INVALID_JSON" };
  if (typeof j.version !== "string" || j.version.split(".")[0] !== "1") return { ok: false, error: "UNSUPPORTED_VERSION" };
  if (!esUuid(j.id)) return { ok: false, error: "MISSING_FIELDS: id" };
  if (!TIPOS_ENTRADA.includes(j.type as TipoEntrada)) return { ok: false, error: "UNKNOWN_TYPE" };
  const org = j.org;
  if (!esObjeto(org) || typeof org.vendario_id !== "string" || !org.vendario_id) return { ok: false, error: "MISSING_FIELDS: org.vendario_id" };
  if (!esObjeto(j.data)) return { ok: false, error: "MISSING_FIELDS: data" };
  const seq = j.seq === null || j.seq === undefined ? null : Number(j.seq);
  if (seq !== null && !Number.isSafeInteger(seq)) return { ok: false, error: "INVALID_SEQ" };
  if (j.type === "accounting.event" && typeof j.data.event_type !== "string") return { ok: false, error: "MISSING_FIELDS: data.event_type" };
  if (j.type === "client.enroll" && !Array.isArray(j.data.services)) return { ok: false, error: "MISSING_FIELDS: data.services" };
  return {
    ok: true,
    sobre: {
      version: j.version, id: (j.id as string).toLowerCase(), type: j.type as TipoEntrada,
      created_at: typeof j.created_at === "string" ? j.created_at : null,
      org: { vendario_id: org.vendario_id, rnc: typeof org.rnc === "string" && org.rnc ? org.rnc : null }, seq, data: j.data,
    },
  };
}

// ───── Estados que Empire manda a Vendario ─────

export const ESTADOS: Record<string, { texto: string; nota?: true; periodo?: true }> = {
  recibida: { texto: "Recibida" },
  vista: { texto: "Vista" },
  aceptada: { texto: "Aceptada" },
  en_proceso: { texto: "Trabajando el período", periodo: true },
  al_dia: { texto: "Al día hasta el período", periodo: true },
  necesita_info: { texto: "Necesita información", nota: true },
  suspendida: { texto: "Suspendida", nota: true },
  finalizada: { texto: "Finalizada" },
};
export type EstadoServicio = keyof typeof ESTADOS;

// Lo que Vendario puede pedir que se le mande (lista «requested»): sugerencias, se puede escribir otra cosa.
export const PEDIDOS_SUGERIDOS: Record<string, string> = {
  estado_cuenta_banco: "Estado de cuenta bancario",
  rnc_suplidor: "RNC de un suplidor",
  ncf_faltante: "NCF de una compra o gasto",
  inventario_inicial: "Inventario inicial",
  saldos_iniciales: "Saldos iniciales",
  documentos_empresa: "Documentos de la empresa",
};

export type DatosEstado = { status: string; at: string; accountant?: { name: string }; period?: string; note?: string; requested?: string[] };

export function sobreEstado(d: { id: string; ahora: Date; org: { vendario_id: string; rnc: string | null }; estado: EstadoServicio;
  contable?: string | null; periodo?: string | null; nota?: string | null; pedidos?: string[] }) {
  const data: DatosEstado = { status: d.estado, at: d.ahora.toISOString().replace(/\.\d{3}Z$/, "Z") };
  if (d.contable) data.accountant = { name: d.contable };
  if (d.periodo) data.period = d.periodo;
  if (d.nota) data.note = d.nota;
  if (d.pedidos?.length) data.requested = d.pedidos;
  return { version: "1.0", id: d.id, type: "service.status", created_at: data.at, org: d.org, data };
}

// Espera antes de cada reintento (acuerdo, sección 5): 1 min, 5 min, 30 min, 2 h, 6 h y 24 h. Después queda fallido.
export const ESPERAS_MIN = [1, 5, 30, 120, 360, 1440];

// Qué hacer con la respuesta de Vendario.
export function trasRespuesta(codigo: number | null, intentos: number): { estado: "enviado" | "pendiente" | "fallido" | "rechazado"; esperaMin?: number } {
  if (codigo === 200 || codigo === 202) return { estado: "enviado" };
  if (codigo === 401 || codigo === 422 || (codigo !== null && codigo >= 400 && codigo < 500 && codigo !== 408 && codigo !== 429)) return { estado: "rechazado" };
  if (intentos > ESPERAS_MIN.length) return { estado: "fallido" };
  return { estado: "pendiente", esperaMin: ESPERAS_MIN[intentos - 1] };
}

export const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;
