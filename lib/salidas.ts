import { anularAsientoDeDocumento, ErrorContable, insertarAsiento, type LineaAsiento } from "./asientos.ts";
import type { Tx } from "./db";
import { aCentavos, deCentavos } from "./montos.ts";

// Bloque 7, entrega 7a: cada salida de dinero de la empresa propia a la cuenta que le toca (Documento maestro, sección 3).
// Empire no le paga sueldo a la socia: lo personal y el pago de sus deudas se cargan a su cuenta corriente (activo, cuenta por
// cobrar a la socia) con una categoría en la línea; el gasto de oficina va al gasto; ahorro y traspaso solo mueven el dinero.

export type TipoSalida = "oficina" | "personal" | "deuda" | "ahorro" | "traspaso";
export const TIPOS_SALIDA: Record<TipoSalida, { nombre: string; efecto: string }> = {
  oficina: { nombre: "Gasto de oficina", efecto: "Gasto de Empire por categoría: deducible, afecta el resultado." },
  personal: { nombre: "Gasto personal o del hogar", efecto: "Va a la cuenta corriente de la socia: no es gasto, es lo que la dueña retira." },
  deuda: { nombre: "Pago de deuda personal", efecto: "Va a la cuenta corriente de la socia: no es gasto. La deuda se sigue en el presupuesto personal." },
  ahorro: { nombre: "Ahorro", efecto: "Transferencia a la cuenta de ahorro: solo movimiento." },
  traspaso: { nombre: "Traspaso entre cuentas", efecto: "De un banco o caja a otro: solo movimiento." },
};
export const esTipoSalida = (v: string): v is TipoSalida => v in TIPOS_SALIDA;

// Categorías personales sugeridas (las del documento maestro y las de un presupuesto del hogar). Se puede escribir otra; se
// ajustan con el Excel PRESUPUESTO 2026 cuando llegue.
export const CATEGORIAS_PERSONALES = [
  "Vivienda", "Alimentación", "Transporte", "Salud", "Educación", "Servicios del hogar", "Ropa y cuidado personal",
  "Entretenimiento", "Seguros", "Donaciones", "Otros gastos personales",
];
export const CATEGORIA_DEUDA = "Pago de deuda";

export type CuentaOpcion = { id: string; codigo: string; nombre: string };
export type CuentasSalida = { efectivo: CuentaOpcion[]; gastos: CuentaOpcion[]; socias: CuentaOpcion[] };

// Efectivo: caja, bancos y ahorros (1101) y cualquier cuenta enlazada a una cuenta bancaria en pesos.
// Socias: las cuentas «Cuenta corriente – …» bajo 1102 (las crea la preparación de la empresa propia, una por socia de la ficha).
export async function cuentasParaSalida(tx: Tx): Promise<CuentasSalida> {
  const efectivo = await tx<CuentaOpcion[]>`
    SELECT c.id, c.codigo, c.nombre FROM cuentas c
     WHERE c.de_detalle AND c.activa AND (c.codigo LIKE '1101%' OR EXISTS (SELECT 1 FROM cuentas_bancarias b WHERE b.cuenta_id = c.id))
       AND NOT EXISTS (SELECT 1 FROM cuentas_bancarias b WHERE b.cuenta_id = c.id AND b.moneda <> 'DOP')
     ORDER BY c.codigo`;
  const gastos = await tx<CuentaOpcion[]>`
    SELECT id, codigo, nombre FROM cuentas WHERE de_detalle AND activa AND tipo IN ('gasto', 'costo') AND codigo NOT LIKE '63%' ORDER BY codigo`;
  const socias = await cuentasDeSocia(tx);
  return { efectivo, gastos, socias };
}

export const cuentasDeSocia = (tx: Tx) => tx<CuentaOpcion[]>`
  SELECT id, codigo, nombre FROM cuentas
   WHERE de_detalle AND activa AND codigo LIKE '1102%' AND nombre ILIKE 'Cuenta corriente%' ORDER BY codigo`;

export type DatosSalida = {
  tipo: TipoSalida; fecha: string; origenId: string; destinoId: string; monto: bigint;
  categoria?: string | null; acreedor?: string | null; descripcion?: string | null; referencia?: string | null; unidadId?: string | null;
};

// Lo que cada tipo pide además del monto y el banco.
export function revisarSalida(d: DatosSalida): string | null {
  if (d.monto <= 0n) return "Escribe el monto.";
  if (!d.origenId) return "Elige el banco o la caja de donde sale el dinero.";
  if (!d.destinoId) return d.tipo === "oficina" ? "Elige la cuenta de gasto." : d.tipo === "personal" || d.tipo === "deuda" ? "Elige la cuenta corriente de la socia." : "Elige la cuenta a la que va el dinero.";
  if (d.origenId === d.destinoId) return "La cuenta de origen y la de destino deben ser distintas.";
  if (d.tipo === "personal" && !d.categoria) return "Elige o escribe la categoría del gasto personal.";
  if (d.tipo === "deuda" && !d.acreedor) return "Escribe a quién se le paga la deuda.";
  return null;
}

// Concepto del asiento y su categoría (la de la línea de la cuenta corriente).
export function conceptoSalida(d: DatosSalida, destino: string): { concepto: string; categoria: string | null } {
  const extra = d.descripcion ? ` — ${d.descripcion}` : "";
  switch (d.tipo) {
    case "oficina": return { concepto: `Gasto de oficina: ${destino}${extra}`, categoria: null };
    case "personal": return { concepto: `Gasto personal: ${d.categoria}${extra}`, categoria: d.categoria ?? null };
    case "deuda": return { concepto: `Pago de deuda personal: ${d.acreedor}${extra}`, categoria: CATEGORIA_DEUDA };
    case "ahorro": return { concepto: `Ahorro: a ${destino}${extra}`, categoria: null };
    case "traspaso": return { concepto: `Traspaso a ${destino}${extra}`, categoria: null };
  }
}

// El asiento de la salida: debe a la cuenta de destino, haber al banco o caja.
export function lineasSalida(d: DatosSalida, categoria: string | null): LineaAsiento[] {
  const descripcion = d.tipo === "deuda" ? `Pago a ${d.acreedor}` : d.descripcion || null;
  return [
    { cuentaId: d.destinoId, debe: d.monto, haber: 0n, descripcion, unidadId: d.tipo === "oficina" ? d.unidadId ?? null : null, categoria },
    { cuentaId: d.origenId, debe: 0n, haber: d.monto, descripcion, unidadId: null, categoria: null },
  ];
}

export async function registrarSalida(tx: Tx, empresaId: string, usuarioId: string, d: DatosSalida): Promise<{ id: string; numero: number; asiento: number }> {
  const error = revisarSalida(d);
  if (error) throw new ErrorContable(error);
  const opciones = await cuentasParaSalida(tx);
  const busca = (lista: CuentaOpcion[], id: string) => lista.find((c) => c.id === id);
  const origen = busca(opciones.efectivo, d.origenId);
  if (!origen) throw new ErrorContable("La cuenta de origen debe ser un banco o caja en pesos.");
  const destino =
    d.tipo === "oficina" ? busca(opciones.gastos, d.destinoId)
    : d.tipo === "personal" || d.tipo === "deuda" ? busca(opciones.socias, d.destinoId)
    : busca(opciones.efectivo, d.destinoId);
  if (!destino) {
    throw new ErrorContable(d.tipo === "oficina" ? "La cuenta de destino debe ser de gasto o costo."
      : d.tipo === "personal" || d.tipo === "deuda" ? "La cuenta de destino debe ser la cuenta corriente de una socia."
      : "La cuenta de destino debe ser un banco, caja o cuenta de ahorro en pesos.");
  }
  const { concepto, categoria } = conceptoSalida(d, destino.nombre);
  const lineas = lineasSalida(d, categoria);
  const asiento = await insertarAsiento(tx, {
    empresaId, usuarioId, fecha: d.fecha, concepto, referencia: d.referencia ?? null, origen: "salida", juntar: false, lineas,
  });
  await tx`SELECT 1 FROM empresas WHERE id = ${empresaId} FOR UPDATE`;
  const [{ numero }] = await tx<{ numero: number }[]>`SELECT COALESCE(max(numero), 0) + 1 AS numero FROM salidas`;
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO salidas (empresa_id, numero, fecha, tipo, cuenta_origen_id, cuenta_destino_id, monto, categoria, acreedor, descripcion,
                         referencia, unidad_id, asiento_id, creado_por)
    VALUES (${empresaId}, ${numero}, ${d.fecha}, ${d.tipo}, ${d.origenId}, ${d.destinoId}, ${deCentavos(d.monto)}, ${categoria},
            ${d.tipo === "deuda" ? d.acreedor ?? null : null}, ${d.descripcion ?? null}, ${d.referencia ?? null},
            ${d.tipo === "oficina" ? d.unidadId ?? null : null}, ${asiento.id}, ${usuarioId})
    RETURNING id`;
  return { id, numero, asiento: asiento.numero! };
}

// Anular la salida anula su asiento (si ya está conciliado con el banco o en un período cerrado, la base lo impide).
export async function anularSalida(tx: Tx, salidaId: string, usuarioId: string, motivo: string) {
  if (motivo.trim().length < 3) throw new ErrorContable("Escribe el motivo de la anulación.");
  const [s] = await tx<{ asiento_id: string; anulada: boolean }[]>`SELECT asiento_id, anulada FROM salidas WHERE id = ${salidaId} FOR UPDATE`;
  if (!s) throw new ErrorContable("La salida no existe");
  if (s.anulada) throw new ErrorContable("La salida ya estaba anulada");
  await anularAsientoDeDocumento(tx, s.asiento_id, usuarioId, motivo);
  await tx`UPDATE salidas SET anulada = true, motivo_anulacion = ${motivo}, anulada_por = ${usuarioId}, anulada_en = now() WHERE id = ${salidaId}`;
}

export type SalidaLista = {
  id: string; numero: number; fecha: string; tipo: TipoSalida; monto: string; categoria: string | null; acreedor: string | null;
  descripcion: string | null; origen: string; destino: string; asiento: number | null; asiento_id: string; anulada: boolean; motivo_anulacion: string | null;
};

export const listarSalidas = (tx: Tx, desde: string, hasta: string, tipo: string | null) => tx<SalidaLista[]>`
  SELECT s.id, s.numero, to_char(s.fecha, 'YYYY-MM-DD') AS fecha, s.tipo, s.monto::text, s.categoria, s.acreedor, s.descripcion,
         o.nombre AS origen, d.nombre AS destino, a.numero AS asiento, s.asiento_id, s.anulada, s.motivo_anulacion
    FROM salidas s JOIN cuentas o ON o.id = s.cuenta_origen_id JOIN cuentas d ON d.id = s.cuenta_destino_id
    JOIN asientos a ON a.id = s.asiento_id
   WHERE s.fecha BETWEEN ${desde} AND ${hasta} AND (${tipo}::text IS NULL OR s.tipo = ${tipo})
   ORDER BY s.fecha DESC, s.numero DESC`;

// Totales del período por tipo (sin las anuladas), en centavos.
export function totalesPorTipo(salidas: SalidaLista[]): Record<TipoSalida, bigint> {
  const t = { oficina: 0n, personal: 0n, deuda: 0n, ahorro: 0n, traspaso: 0n } as Record<TipoSalida, bigint>;
  for (const s of salidas) if (!s.anulada) t[s.tipo] += aCentavos(s.monto);
  return t;
}
