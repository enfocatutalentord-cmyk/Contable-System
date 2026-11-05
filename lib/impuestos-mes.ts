import { randomUUID } from "node:crypto";
import type { Tx } from "./db";
import { huella, nombreSeguro, TAMANO_MAXIMO, tipoPorContenido } from "./documentos.ts";
import { OBLIGACIONES, type PerfilFiscal } from "./fiscal.ts";
import { aCentavos, deCentavos } from "./montos.ts";

// Bloque 4, entrega 4a: impuestos del mes por cliente (Fase 2, sección 5). Qué declara cada cliente (según las obligaciones
// confirmadas en su perfil fiscal), qué ya se presentó, cuánto hay que pagar y si su mes se puede cerrar.

// Declaraciones mensuales: la clave de la obligación, el formato que guarda «envios_dgii», su pantalla y el día de vencimiento
// del mes siguiente.
export const MENSUALES = [
  { clave: "f606", formato: "606", nombre: "606 · Compras", ruta: "/dgii", dia: 15 },
  { clave: "f607", formato: "607", nombre: "607 · Ventas", ruta: "/dgii", dia: 15 },
  { clave: "f608", formato: "608", nombre: "608 · Anulados", ruta: "/dgii", dia: 15 },
  { clave: "it1", formato: "IT-1", nombre: "IT-1 · ITBIS", ruta: "/dgii/it1", dia: 20 },
  { clave: "ir17", formato: "IR-17", nombre: "IR-17 · Retenciones", ruta: "/dgii/ir17", dia: 10 },
] as const;
export type Mensual = (typeof MENSUALES)[number];

// Casillas con el total a pagar de cada declaración jurada (lo que se sugiere como monto de la constancia).
export const TOTAL_A_PAGAR: Record<string, string[]> = { "IT-1": ["I68"], "IR-17": ["R37"], "IR-2": ["I31", "X45"] };

export function montoSugerido(formulario: string, valores: Record<string, bigint>): string {
  return deCentavos((TOTAL_A_PAGAR[formulario] ?? []).reduce((s, k) => s + (valores[k] ?? 0n), 0n));
}

// Fecha límite de una declaración mensual del período AAAAMM: el día que toca del mes siguiente.
export function venceMensual(periodo: string, dia: number): string {
  const a = Number(periodo.slice(0, 4)), m = Number(periodo.slice(4));
  const [an, mn] = m === 12 ? [a + 1, 1] : [a, m + 1];
  return `${an}-${String(mn).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export const finDeMes = (periodo: string) =>
  new Date(Date.UTC(Number(periodo.slice(0, 4)), Number(periodo.slice(4)), 0)).toISOString().slice(0, 10);

export type EstadoDeclaracion = "presentada" | "en_cero" | "pendiente" | "vencida";
export type Declaracion = {
  formato: string; nombre: string; ruta: string; estado: EstadoDeclaracion; vence: string; monto: string | null; fechaLimite: string | null;
};
export type EstadoMes = {
  declaraciones: Declaracion[]; compras: number; revisadas: number; corregir: number; documentos: number; cerrado: boolean;
  bloqueo: string | null; listo: boolean; aPagar: string;
  sugeridas: boolean; // sin obligaciones confirmadas en el perfil fiscal: se usan las sugeridas por el perfil
};

// Estado del mes de una empresa (corre en conEmpresa).
export async function estadoDelMes(tx: Tx, periodo: string, hoy: string): Promise<EstadoMes> {
  const desde = `${periodo.slice(0, 4)}-${periodo.slice(4)}-01`, hasta = finDeMes(periodo);
  const confirmadas = await tx<{ clave: string; activa: boolean }[]>`SELECT clave, activa FROM obligaciones_empresa`;
  const sugeridas = confirmadas.length === 0;
  let activas: Set<string>;
  if (sugeridas) {
    const [perfil] = await tx<PerfilFiscal[]>`
      SELECT tipo_persona, regimen, contribuye_itbis, agente_retencion, emisor_ecf, to_char(ecf_desde, 'YYYY-MM-DD') AS ecf_desde
        FROM empresas WHERE id = empresa_actual()`;
    activas = new Set(perfil ? OBLIGACIONES.filter((o) => o.sugerida(perfil)).map((o) => o.clave) : []);
  } else {
    activas = new Set(confirmadas.filter((o) => o.activa).map((o) => o.clave));
  }
  const envios = new Map((await tx<{ formato: string; en_cero: boolean; monto_pagar: string | null; fecha_limite: string | null }[]>`
    SELECT formato, en_cero, monto_pagar::text, to_char(fecha_limite, 'YYYY-MM-DD') AS fecha_limite FROM envios_dgii WHERE periodo = ${periodo}`)
    .map((e) => [e.formato, e]));
  const declaraciones: Declaracion[] = MENSUALES.filter((m) => activas.has(m.clave)).map((m) => {
    const e = envios.get(m.formato);
    const vence = venceMensual(periodo, m.dia);
    const estado: EstadoDeclaracion = e ? (e.en_cero ? "en_cero" : "presentada") : vence < hoy ? "vencida" : "pendiente";
    return { formato: m.formato, nombre: m.nombre, ruta: m.ruta, estado, vence, monto: e?.monto_pagar ?? null, fechaLimite: e?.fecha_limite ?? null };
  });
  const [c] = await tx<{ compras: number; revisadas: number; corregir: number }[]>`
    SELECT count(*)::int AS compras, count(*) FILTER (WHERE r.estado = 'revisada')::int AS revisadas,
           count(*) FILTER (WHERE r.estado = 'corregir')::int AS corregir
      FROM compras c LEFT JOIN revisiones_compra r ON r.compra_id = c.id
     WHERE c.estado = 'registrada' AND NOT c.anulada AND c.fecha BETWEEN ${desde} AND ${hasta}`;
  const [{ documentos }] = await tx<{ documentos: number }[]>`
    SELECT count(*)::int AS documentos FROM recepciones WHERE estado IN ('nuevo', 'en_proceso')`;
  const [{ bloqueo }] = await tx<{ bloqueo: string | null }[]>`
    SELECT to_char(fecha_bloqueo, 'YYYY-MM-DD') AS bloqueo FROM empresas WHERE id = empresa_actual()`;
  const cerrado = !!bloqueo && bloqueo >= hasta;
  const aPagar = deCentavos(declaraciones.reduce((s, d) => s + (d.monto ? aCentavos(d.monto) : 0n), 0n));
  const listo = !cerrado && declaraciones.length > 0 && declaraciones.every((d) => d.estado === "presentada" || d.estado === "en_cero");
  return { declaraciones, ...c, documentos, cerrado, bloqueo, listo, aPagar, sugeridas };
}

// Revisar una compra registrada (o pedir que se corrija, con nota). Repetirlo reemplaza la revisión anterior.
export async function revisarCompra(tx: Tx, d: { empresaId: string; compraId: string; usuarioId: string; estado: "revisada" | "corregir"; nota: string | null }) {
  const [c] = await tx<{ estado: string; anulada: boolean }[]>`SELECT estado, anulada FROM compras WHERE id = ${d.compraId}`;
  if (!c || c.estado !== "registrada" || c.anulada) throw new Error("Solo se revisan compras registradas y vigentes");
  const nota = d.nota?.trim() || null;
  if (d.estado === "corregir" && !nota) throw new Error("Escribe qué hay que corregir");
  await tx`
    INSERT INTO revisiones_compra (compra_id, empresa_id, estado, nota, revisada_por)
    VALUES (${d.compraId}, ${d.empresaId}, ${d.estado}, ${nota}, ${d.usuarioId})
    ON CONFLICT (compra_id) DO UPDATE SET estado = EXCLUDED.estado, nota = EXCLUDED.nota, revisada_por = EXCLUDED.revisada_por, revisada_en = now()`;
}

export class ErrorImpuestos extends Error {}

export type Constancia = { nombre: string; bytes: Uint8Array } | null;

// Lee el archivo de la constancia (PDF, JPG o PNG de hasta 4 MB), comprobando el tipo por su contenido.
export async function leerConstancia(archivo: FormDataEntryValue | null): Promise<Constancia> {
  if (!(archivo instanceof File) || archivo.size === 0) return null;
  if (archivo.size > TAMANO_MAXIMO) throw new ErrorImpuestos("La constancia pasa de 4 MB.");
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  if (!tipoPorContenido(bytes)) throw new ErrorImpuestos("La constancia debe ser PDF, JPG o PNG.");
  return { nombre: archivo.name, bytes };
}

// Guarda la marca de presentada con su constancia, monto a pagar y fecha límite. Con monto a pagar crea la notificación de pago
// de la DGII (con la constancia como su PDF), que entra en las alertas y en «Enviar por WhatsApp».
export async function guardarPresentacion(tx: Tx, d: {
  empresaId: string; usuarioId: string; formato: string; periodo: string; nombre: string; enCero: boolean; referencia: string | null;
  huella: string; registros: number; casillas: Record<string, string> | null; monto: string | null; fechaLimite: string | null; constancia: Constancia;
}) {
  const envioId = randomUUID();
  const monto = d.monto && aCentavos(d.monto) > 0n ? d.monto : null;
  if (monto && !d.fechaLimite) throw new ErrorImpuestos("Pon la fecha límite de pago.");
  let notificacionId: string | null = null;
  if (monto) {
    [{ id: notificacionId }] = await tx<{ id: string }[]>`
      INSERT INTO notificaciones_pago (empresa_id, tipo, periodo, concepto, monto, fecha_limite, creado_por)
      VALUES (${d.empresaId}, 'dgii', ${d.periodo}, ${d.nombre}, ${monto}, ${d.fechaLimite}, ${d.usuarioId}) RETURNING id`;
  }
  let constanciaId: string | null = null;
  if (d.constancia) {
    const b = d.constancia.bytes;
    [{ id: constanciaId }] = await tx<{ id: string }[]>`
      INSERT INTO documentos (empresa_id, entidad, entidad_id, nombre, tipo, tamano, sha256, contenido, descripcion, subido_por)
      VALUES (${d.empresaId}, ${notificacionId ? "notificacion" : "declaracion"}, ${notificacionId ?? envioId}, ${nombreSeguro(d.constancia.nombre)},
              ${tipoPorContenido(b)}, ${b.length}, ${huella(b)}, ${Buffer.from(b)}, ${`Constancia ${d.nombre}`}, ${d.usuarioId}) RETURNING id`;
  }
  const r = await tx`
    INSERT INTO envios_dgii (id, empresa_id, formato, periodo, en_cero, referencia, huella, registros, enviado_por, casillas,
                             constancia_id, monto_pagar, fecha_limite, notificacion_id)
    VALUES (${envioId}, ${d.empresaId}, ${d.formato}, ${d.periodo}, ${d.enCero && !monto}, ${d.referencia}, ${d.huella}, ${d.registros}, ${d.usuarioId},
            ${d.casillas ? tx.json(d.casillas) : null}, ${constanciaId}, ${monto}, ${monto ? d.fechaLimite : null}, ${notificacionId})
    ON CONFLICT (empresa_id, formato, periodo) DO NOTHING`;
  if (r.count === 0) throw new ErrorImpuestos(`El ${d.formato} de ese período ya está marcado como presentado.`);
}

// Quitar la marca: si la notificación que creó sigue sin enviar, se va con ella (enviada o pagada queda, porque ya se usó).
export async function quitarPresentacion(tx: Tx, formato: string, periodo: string) {
  const [e] = await tx<{ notificacion_id: string | null; constancia_id: string | null }[]>`
    DELETE FROM envios_dgii WHERE formato = ${formato} AND periodo = ${periodo} RETURNING notificacion_id, constancia_id`;
  if (!e) return;
  if (e.notificacion_id) {
    const r = await tx`DELETE FROM notificaciones_pago WHERE id = ${e.notificacion_id} AND estado = 'pendiente'`;
    if (r.count) await tx`UPDATE documentos SET eliminado = true, eliminado_en = now() WHERE entidad = 'notificacion' AND entidad_id = ${e.notificacion_id}`;
  } else if (e.constancia_id) {
    await tx`UPDATE documentos SET eliminado = true, eliminado_en = now() WHERE id = ${e.constancia_id}`;
  }
}
