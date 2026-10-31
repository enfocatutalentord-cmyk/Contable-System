import { ErrorContable, insertarAsiento, type LineaAsiento } from "./asientos.ts";
import type { Tx } from "./db";
import { inicioEjercicio } from "./estados.ts";
import { aCentavos, deCentavos, hoyISO } from "./montos.ts";
import { ultimoDiaMes } from "./reportes.ts";

// Cierre del ejercicio (Fase 7, parte 3), como el cierre de fin de año de QuickBooks Online y Xero pero con asiento
// explícito, que es lo que pide la práctica dominicana: ingresos, costos y gastos quedan en cero contra «Resultado del
// ejercicio»; después, cuando se decide, el resultado pasa a «Resultados acumulados». Los dos asientos llevan origen
// «cierre» (el flujo de efectivo y el resultado del período no los cuentan) y el ejercicio queda bloqueado.

export type LineaCierre = { cuentaId: string; codigo: string; nombre: string; debe: bigint; haber: bigint };
export type Propuesta = { inicio: string; fin: string; lineas: LineaCierre[]; resultado: bigint; borradores: number };
export type Cierre = { fin: string; asiento_id: string; asiento: number; traspaso_id: string | null; traspaso: number | null; resultado: string; quien: string | null; cerrado_en: Date };

const anterior = (f: string) => new Date(Date.parse(f) - 86400000).toISOString().slice(0, 10);
const siguiente = (f: string) => new Date(Date.parse(f) + 86400000).toISOString().slice(0, 10);

// Fin del ejercicio que contiene la fecha.
export function finEjercicio(f: string, mesCierre: number): string {
  const inicio = inicioEjercicio(f, mesCierre);
  const [a, m] = inicio.split("-").map(Number);
  const total = a * 12 + (m - 1) + 11;
  return ultimoDiaMes(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`);
}

// Ejercicios con movimientos, del más reciente al más viejo, con su cierre si lo tienen.
export async function ejercicios(tx: Tx, mesCierre: number): Promise<{ inicio: string; fin: string; terminado: boolean; cierre: Cierre | null }[]> {
  const [r] = await tx<{ primero: string | null }[]>`SELECT to_char(min(fecha), 'YYYY-MM-DD') AS primero FROM asientos WHERE estado = 'contabilizado'`;
  const cierres = await tx<Cierre[]>`
    SELECT to_char(c.fin, 'YYYY-MM-DD') AS fin, c.asiento_id, a.numero AS asiento, c.traspaso_id, t.numero AS traspaso, c.resultado::text,
           u.nombre AS quien, c.cerrado_en
      FROM cierres_ejercicio c JOIN asientos a ON a.id = c.asiento_id LEFT JOIN asientos t ON t.id = c.traspaso_id
      LEFT JOIN usuarios u ON u.id = c.cerrado_por ORDER BY c.fin DESC`;
  if (!r.primero) return [];
  const hoy = hoyISO();
  const lista = [];
  for (let fin = finEjercicio(hoy, mesCierre); fin >= r.primero && lista.length < 10; fin = finEjercicio(anterior(inicioEjercicio(fin, mesCierre)), mesCierre)) {
    lista.push({ inicio: inicioEjercicio(fin, mesCierre), fin, terminado: fin < hoy, cierre: cierres.find((c) => c.fin === fin) ?? null });
  }
  return lista;
}

export async function propuestaCierre(tx: Tx, fin: string, mesCierre: number): Promise<Propuesta> {
  const inicio = inicioEjercicio(fin, mesCierre);
  const saldos = await tx<{ id: string; codigo: string; nombre: string; neto: string }[]>`
    SELECT c.id, c.codigo, c.nombre, sum(l.debe - l.haber)::text AS neto
      FROM cuentas c JOIN lineas_asiento l ON l.cuenta_id = c.id JOIN asientos a ON a.id = l.asiento_id
     WHERE c.tipo IN ('ingreso', 'costo', 'gasto') AND a.estado = 'contabilizado' AND a.fecha BETWEEN ${inicio} AND ${fin}
     GROUP BY c.id HAVING sum(l.debe - l.haber) <> 0 ORDER BY c.codigo`;
  const lineas = saldos.map((s) => {
    const n = aCentavos(s.neto);
    // Se deja la cuenta en cero: lo que tiene al debe va al haber y al revés.
    return { cuentaId: s.id, codigo: s.codigo, nombre: s.nombre, debe: n < 0n ? -n : 0n, haber: n > 0n ? n : 0n };
  });
  const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM asientos WHERE estado = 'borrador' AND fecha BETWEEN ${inicio} AND ${fin}`;
  return { inicio, fin, lineas, resultado: -saldos.reduce((t, s) => t + aCentavos(s.neto), 0n), borradores: n };
}

async function cuentaPatrimonio(tx: Tx, id: string) {
  const [c] = await tx<{ ok: boolean }[]>`SELECT tipo = 'patrimonio' AND de_detalle AND activa AS ok FROM cuentas WHERE id = ${id}`;
  if (!c?.ok) throw new ErrorContable("Elige una cuenta de patrimonio de detalle y activa");
}

export async function cerrarEjercicio(tx: Tx, d: { empresaId: string; fin: string; mesCierre: number; cuentaResultadoId: string; usuarioId: string }) {
  if (finEjercicio(d.fin, d.mesCierre) !== d.fin) throw new ErrorContable("Esa fecha no es el fin de un ejercicio");
  if (d.fin >= hoyISO()) throw new ErrorContable("El ejercicio todavía no ha terminado");
  const [ya] = await tx`SELECT 1 FROM cierres_ejercicio WHERE fin = ${d.fin}`;
  if (ya) throw new ErrorContable("Ese ejercicio ya está cerrado");
  const [{ bloqueo }] = await tx<{ bloqueo: string | null }[]>`SELECT to_char(fecha_bloqueo, 'YYYY-MM-DD') AS bloqueo FROM empresas WHERE id = ${d.empresaId}`;
  if (bloqueo && bloqueo >= d.fin) throw new ErrorContable(`El período está cerrado hasta el ${bloqueo.split("-").reverse().join("/")}: para registrar el cierre del ejercicio hay que reabrirlo hasta antes del ${d.fin.split("-").reverse().join("/")}.`);
  await cuentaPatrimonio(tx, d.cuentaResultadoId);
  const p = await propuestaCierre(tx, d.fin, d.mesCierre);
  if (p.borradores > 0) throw new ErrorContable(`Hay ${p.borradores} asiento${p.borradores > 1 ? "s" : ""} en borrador en el ejercicio: contabilízalos o descártalos antes de cerrar.`);
  if (!p.lineas.length) throw new ErrorContable("No hay ingresos, costos ni gastos que cerrar en ese ejercicio");
  const lineas: LineaAsiento[] = p.lineas.map((l) => ({ cuentaId: l.cuentaId, debe: l.debe, haber: l.haber }));
  lineas.push({ cuentaId: d.cuentaResultadoId, debe: p.resultado < 0n ? -p.resultado : 0n, haber: p.resultado > 0n ? p.resultado : 0n, descripcion: p.resultado >= 0n ? "Utilidad del ejercicio" : "Pérdida del ejercicio" });
  const { id } = await insertarAsiento(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, fecha: d.fin, origen: "cierre", juntar: false,
    concepto: `Cierre del ejercicio del ${p.inicio.split("-").reverse().join("/")} al ${d.fin.split("-").reverse().join("/")}`, lineas,
  });
  await tx`INSERT INTO cierres_ejercicio (empresa_id, fin, asiento_id, resultado, bloqueo_anterior, cerrado_por)
           VALUES (${d.empresaId}, ${d.fin}, ${id}, ${deCentavos(p.resultado)}, ${bloqueo}, ${d.usuarioId})`;
  // El ejercicio queda bloqueado (lock date): nada más se registra con fecha de ese año.
  await tx`UPDATE empresas SET fecha_bloqueo = ${d.fin} WHERE id = ${d.empresaId}`;
  await tx`INSERT INTO bitacora (empresa_id, usuario_id, accion, detalle)
           VALUES (${d.empresaId}, ${d.usuarioId}, 'periodo_cerrado', ${tx.json({ antes: bloqueo, despues: d.fin, motivo: "cierre del ejercicio" })})`;
  return { asientoId: id, resultado: p.resultado };
}

// Traspaso del resultado del ejercicio cerrado a resultados acumulados, con fecha del primer día del ejercicio siguiente.
export async function traspasarResultado(tx: Tx, d: { empresaId: string; fin: string; cuentaAcumuladosId: string; usuarioId: string }) {
  const [c] = await tx<{ resultado: string; traspaso_id: string | null; cuenta: string }[]>`
    SELECT c.resultado::text, c.traspaso_id,
           (SELECT l.cuenta_id FROM lineas_asiento l JOIN cuentas k ON k.id = l.cuenta_id WHERE l.asiento_id = c.asiento_id AND k.tipo = 'patrimonio' LIMIT 1) AS cuenta
      FROM cierres_ejercicio c WHERE c.fin = ${d.fin}`;
  if (!c) throw new ErrorContable("Ese ejercicio no está cerrado");
  if (c.traspaso_id) throw new ErrorContable("El resultado de ese ejercicio ya pasó a resultados acumulados");
  if (c.cuenta === d.cuentaAcumuladosId) throw new ErrorContable("Elige una cuenta distinta a la del resultado del ejercicio");
  await cuentaPatrimonio(tx, d.cuentaAcumuladosId);
  const r = aCentavos(c.resultado);
  if (r === 0n) throw new ErrorContable("El resultado del ejercicio es cero: no hay nada que traspasar");
  const abs = r < 0n ? -r : r;
  const { id } = await insertarAsiento(tx, {
    empresaId: d.empresaId, usuarioId: d.usuarioId, fecha: siguiente(d.fin), origen: "cierre", juntar: false,
    concepto: `Traspaso del resultado del ejercicio terminado el ${d.fin.split("-").reverse().join("/")} a resultados acumulados`,
    lineas: r > 0n
      ? [{ cuentaId: c.cuenta, debe: abs, haber: 0n }, { cuentaId: d.cuentaAcumuladosId, debe: 0n, haber: abs }]
      : [{ cuentaId: d.cuentaAcumuladosId, debe: abs, haber: 0n }, { cuentaId: c.cuenta, debe: 0n, haber: abs }],
  });
  await tx`UPDATE cierres_ejercicio SET traspaso_id = ${id} WHERE fin = ${d.fin}`;
  return id;
}

// Deshacer el cierre (permiso «reabrir»): anula sus asientos y devuelve el bloqueo que había.
export async function deshacerCierre(tx: Tx, d: { empresaId: string; fin: string; usuarioId: string }) {
  const [c] = await tx<{ asiento_id: string; traspaso_id: string | null; bloqueo_anterior: string | null }[]>`
    SELECT asiento_id, traspaso_id, to_char(bloqueo_anterior, 'YYYY-MM-DD') AS bloqueo_anterior FROM cierres_ejercicio WHERE fin = ${d.fin}`;
  if (!c) throw new ErrorContable("Ese ejercicio no está cerrado");
  const [posterior] = await tx`SELECT 1 FROM cierres_ejercicio WHERE fin > ${d.fin}`;
  if (posterior) throw new ErrorContable("Hay un ejercicio posterior cerrado: deshaz primero ese cierre");
  const [{ bloqueo }] = await tx<{ bloqueo: string | null }[]>`SELECT to_char(fecha_bloqueo, 'YYYY-MM-DD') AS bloqueo FROM empresas WHERE id = ${d.empresaId}`;
  if (bloqueo && bloqueo > d.fin) throw new ErrorContable(`El período está cerrado hasta el ${bloqueo.split("-").reverse().join("/")}: reábrelo hasta el ${d.fin.split("-").reverse().join("/")} antes de deshacer el cierre.`);
  await tx`UPDATE empresas SET fecha_bloqueo = ${c.bloqueo_anterior} WHERE id = ${d.empresaId}`;
  for (const a of [c.traspaso_id, c.asiento_id].filter(Boolean) as string[]) {
    await tx`UPDATE asientos SET estado = 'anulado', anulado_por = ${d.usuarioId}, anulado_en = now(), motivo_anulacion = 'Cierre del ejercicio deshecho' WHERE id = ${a}`;
  }
  await tx`DELETE FROM cierres_ejercicio WHERE fin = ${d.fin}`;
  await tx`INSERT INTO bitacora (empresa_id, usuario_id, accion, detalle)
           VALUES (${d.empresaId}, ${d.usuarioId}, 'periodo_reabierto', ${tx.json({ antes: bloqueo, despues: c.bloqueo_anterior, motivo: "cierre del ejercicio deshecho" })})`;
}
