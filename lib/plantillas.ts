import { contabilizarAsiento, ErrorContable, insertarAsiento, type LineaAsiento } from "./asientos.ts";
import type { Tx } from "./db";
import { nombrePeriodo } from "./igualas.ts";
import { aCentavos, leerMonto } from "./montos.ts";

// Bloque 7, entrega 7a: plantillas de asientos frecuentes (como las transacciones recurrentes de QuickBooks Online): «sin
// programar» se usan a mano («Depósito a ahorro», «Pago de luz») y las mensuales preparan un borrador cada mes (depreciación,
// pagos fijos), que se contabiliza con un clic, igual que las igualas. Nada se contabiliza solo.

export type LineaPlantilla = { cuentaId: string; descripcion: string; debe: string; haber: string; unidad?: string; categoria?: string };
export type Plantilla = {
  id: string; nombre: string; concepto: string; referencia: string | null; lineas: LineaPlantilla[]; frecuencia: "ninguna" | "mensual";
  dia: number | null; proxima: string | null; hasta: string | null; activa: boolean;
};

export const listarPlantillas = (tx: Tx) => tx<Plantilla[]>`
  SELECT id, nombre, concepto, referencia, lineas, frecuencia, dia, to_char(proxima, 'YYYY-MM-DD') AS proxima,
         to_char(hasta, 'YYYY-MM-DD') AS hasta, activa
    FROM plantillas_asiento ORDER BY activa DESC, nombre`;

export const totalesLineas = (lineas: LineaPlantilla[]) => ({
  debe: lineas.reduce((s, l) => s + aCentavos(leerMonto(l.debe) ?? "0"), 0n),
  haber: lineas.reduce((s, l) => s + aCentavos(leerMonto(l.haber) ?? "0"), 0n),
});

// Revisa la plantilla: nombre, al menos dos líneas con cuenta y, si es mensual, que cuadre y tenga monto (va a preparar
// borradores sola). Las sin programar pueden quedar sin montos: se escriben al usarla.
export function revisarPlantilla(p: { nombre: string; concepto: string; lineas: LineaPlantilla[]; frecuencia: string; dia: number | null; proxima: string | null }): string | null {
  if (!p.nombre) return "Escribe el nombre de la plantilla.";
  if (!p.concepto) return "Escribe el concepto del asiento.";
  const conCuenta = p.lineas.filter((l) => l.cuentaId);
  if (conCuenta.length < 2) return "La plantilla necesita al menos dos líneas con cuenta.";
  for (const [i, l] of p.lineas.entries()) {
    if (leerMonto(l.debe || "0") === null || leerMonto(l.haber || "0") === null) return `Línea ${i + 1}: el monto no es válido.`;
    if (!l.cuentaId && (l.debe || l.haber)) return `Línea ${i + 1}: elige la cuenta.`;
  }
  if (p.frecuencia === "mensual") {
    if (!p.dia || p.dia < 1 || p.dia > 30) return "Elige el día del mes (del 1 al 30; el 30 es el último día).";
    if (!p.proxima) return "Escribe desde qué mes empieza.";
    const t = totalesLineas(p.lineas);
    if (t.debe === 0n) return "Una plantilla mensual necesita los montos: prepara el borrador sola cada mes.";
    if (t.debe !== t.haber) return "Una plantilla mensual debe cuadrar (el debe igual al haber).";
  }
  return null;
}

// Las líneas de la plantilla como líneas de asiento (sin las vacías).
export function lineasDePlantilla(lineas: LineaPlantilla[]): LineaAsiento[] {
  return lineas.filter((l) => l.cuentaId).map((l) => ({
    cuentaId: l.cuentaId, descripcion: l.descripcion?.trim() || null, debe: aCentavos(leerMonto(l.debe || "0") ?? "0"),
    haber: aCentavos(leerMonto(l.haber || "0") ?? "0"), unidadId: l.unidad || null, categoria: l.categoria?.trim() || null,
  }));
}

// Copia las líneas de un asiento para hacer una plantilla («Guardar como plantilla»).
export async function lineasDeAsiento(tx: Tx, asientoId: string): Promise<{ concepto: string; referencia: string | null; lineas: LineaPlantilla[] } | null> {
  const [a] = await tx<{ concepto: string; referencia: string | null }[]>`SELECT concepto, referencia FROM asientos WHERE id = ${asientoId}`;
  if (!a) return null;
  const ls = await tx<{ cuenta_id: string; descripcion: string | null; debe: string; haber: string; unidad_id: string | null; categoria_personal: string | null }[]>`
    SELECT cuenta_id, descripcion, debe::text, haber::text, unidad_id, categoria_personal FROM lineas_asiento WHERE asiento_id = ${asientoId} ORDER BY orden`;
  const monto = (m: string) => (aCentavos(m) === 0n ? "" : m);
  return {
    concepto: a.concepto, referencia: a.referencia,
    lineas: ls.map((l) => ({ cuentaId: l.cuenta_id, descripcion: l.descripcion ?? "", debe: monto(l.debe), haber: monto(l.haber), unidad: l.unidad_id ?? "", categoria: l.categoria_personal ?? "" })),
  };
}

// La fecha del borrador en un mes (AAAA-MM): el día elegido; el 30 es siempre el último día del mes (depreciación, cierres).
export function fechaEnMes(mes: string, dia: number): string {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${mes}-${String(dia >= 30 ? ultimo : Math.min(dia, ultimo)).padStart(2, "0")}`;
}
const mesSiguiente = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
};
const periodoDeFecha = (f: string) => f.slice(0, 7);

export type Preparados = { creados: { plantilla: string; fecha: string }[]; errores: string[] };

// Prepara los borradores de las plantillas mensuales que ya tocan (hasta 12 atrasados por plantilla) y avanza su próxima fecha.
// Si el mes está cerrado, no se prepara y se avisa (la próxima avanza igual, para no repetir el aviso cada vez).
export async function prepararRecurrentes(tx: Tx, empresaId: string, usuarioId: string, hoy: string): Promise<Preparados> {
  const r: Preparados = { creados: [], errores: [] };
  const [{ bloqueo }] = await tx<{ bloqueo: string | null }[]>`SELECT to_char(fecha_bloqueo, 'YYYY-MM-DD') AS bloqueo FROM empresas WHERE id = ${empresaId}`;
  const plantillas = await tx<Plantilla[]>`
    SELECT id, nombre, concepto, referencia, lineas, frecuencia, dia, to_char(proxima, 'YYYY-MM-DD') AS proxima, to_char(hasta, 'YYYY-MM-DD') AS hasta, activa
      FROM plantillas_asiento WHERE activa AND frecuencia = 'mensual' AND proxima <= ${hoy} FOR UPDATE`;
  for (const p of plantillas) {
    let fecha = p.proxima!;
    for (let n = 0; n < 12 && fecha <= hoy && (!p.hasta || fecha <= p.hasta); n++) {
      const periodo = periodoDeFecha(fecha);
      const [ya] = await tx`SELECT 1 FROM asientos WHERE plantilla_id = ${p.id} AND periodo = ${periodo} AND estado <> 'anulado'`;
      if (bloqueo && fecha <= bloqueo) {
        r.errores.push(`«${p.nombre}» de ${nombrePeriodo(periodo.replace("-", ""))}: el período está cerrado hasta el ${bloqueo}; no se preparó.`);
      } else if (!ya) {
        const { id } = await insertarAsiento(tx, {
          empresaId, usuarioId, fecha, concepto: `${p.concepto} · ${nombrePeriodo(periodo.replace("-", ""))}`, referencia: p.referencia,
          origen: "manual", juntar: false, lineas: lineasDePlantilla(p.lineas), contabilizar: false,
        });
        await tx`UPDATE asientos SET plantilla_id = ${p.id}, periodo = ${periodo} WHERE id = ${id}`;
        r.creados.push({ plantilla: p.nombre, fecha });
      }
      fecha = fechaEnMes(mesSiguiente(periodoDeFecha(fecha)), p.dia!);
    }
    const sigue = !p.hasta || fecha <= p.hasta;
    await tx`UPDATE plantillas_asiento SET proxima = ${fecha}, activa = ${sigue} WHERE id = ${p.id}`;
  }
  return r;
}

// La primera fecha de una plantilla mensual desde un mes (AAAA-MM) y el día elegido.
export const primeraFecha = (mes: string, dia: number) => fechaEnMes(mes, dia);

export type BorradorPlantilla = { id: string; fecha: string; concepto: string; total: string; plantilla: string; creado_por: string };

export const borradoresDePlantillas = (tx: Tx) => tx<BorradorPlantilla[]>`
  SELECT a.id, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.concepto, p.nombre AS plantilla, a.creado_por,
         (SELECT COALESCE(sum(debe), 0) FROM lineas_asiento WHERE asiento_id = a.id)::text AS total
    FROM asientos a JOIN plantillas_asiento p ON p.id = a.plantilla_id
   WHERE a.estado = 'borrador' ORDER BY a.fecha, p.nombre`;

// Contabiliza un borrador de plantilla; con aprobación obligatoria, no lo contabiliza quien lo preparó.
export async function contabilizarDePlantilla(tx: Tx, empresaId: string, asientoId: string, usuarioId: string, requiereAprobacion: boolean) {
  const [a] = await tx<{ creado_por: string; plantilla_id: string | null }[]>`SELECT creado_por, plantilla_id FROM asientos WHERE id = ${asientoId} AND estado = 'borrador'`;
  if (!a?.plantilla_id) throw new ErrorContable("El borrador no existe o ya se contabilizó");
  if (requiereAprobacion && a.creado_por === usuarioId) throw new ErrorContable("En esta empresa otra persona debe contabilizar lo que tú preparaste");
  return contabilizarAsiento(tx, empresaId, asientoId, usuarioId);
}

