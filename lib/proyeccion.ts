import { TIPOS_GASTO } from "./compras.ts";
import type { Tx } from "./db";
import type { Tabla } from "./exportar.ts";
import { inicioEjercicio } from "./estados.ts";
import { finEjercicio } from "./cierre-ejercicio.ts";
import { nombrePeriodo } from "./igualas.ts";
import { UMBRAL_30 } from "./ir2-liquidacion.ts";
import { aCentavos, deCentavos, verMonto } from "./montos.ts";

// Bloque 4, entrega 4c: proyección del cierre fiscal (Documento maestro, sección 8). Lo acumulado del ejercicio mes a mes, el
// resultado proyectado al cierre ((utilidad acumulada ÷ meses con datos) × 12), el ISR estimado según el régimen y alertas
// preventivas. Todo sale de los asientos contabilizados y de las compras registradas (606); nada se guarda hasta prepararla.

export type Mes = { mes: string; ingresos: string; costos: string; gastos: string; utilidad: string };
export type Alerta = { nivel: "urgente" | "aviso"; texto: string };
export type Proyeccion = {
  periodo: string; mes: string; empresa: string; persona: "juridica" | "fisica"; inicio: string; fin: string;
  meses: Mes[]; mesesConDatos: number;
  acumulado: { ingresos: string; costos: string; gastos: string; utilidad: string };
  proyectado: { ingresos: string; utilidad: string };
  tasa: number | null; impuesto: string | null; retenciones: string; aPagar: string | null;
  categorias: { codigo: string; nombre: string; monto: string }[];
  comprobantes: { tipo: string; nombre: string; monto: string }[];
  sinComprobante: string;
  anterior: string | null; // utilidad del ejercicio anterior completo, si hay datos
  alertas: Alerta[];
};

// Umbrales de las alertas (sugeridos; se ajustan con Patricia).
export const UMBRALES = { gastosSobreIngresos: 95, sinComprobante: 10, cambioMes: 50, cambioAnual: 30, mesesAntesDelCierre: 2 };

// Gastos que no llevan comprobante de compra (nómina, seguridad social, depreciación): no cuentan como «sin documentar».
const SIN_FACTURA = /deprecia|amortiza|sueldo|salario|n[óo]mina|tss|seguridad social|infotep|prestaci|bonific|regal[íi]a|vacacion|horas extra|isr|impuesto sobre la renta/i;

const porc = (a: bigint, b: bigint) => (b === 0n ? 0 : Number((a * 10000n) / b) / 100);
const mesSiguiente = (p: string) => { const a = Number(p.slice(0, 4)), m = Number(p.slice(4)); return m === 12 ? `${a + 1}01` : `${a}${String(m + 1).padStart(2, "0")}`; };

async function resultadoPorMes(tx: Tx, desde: string, hasta: string) {
  return tx<{ mes: string; ingresos: string; costos: string; gastos: string }[]>`
    SELECT to_char(a.fecha, 'YYYYMM') AS mes,
           COALESCE(sum(l.haber - l.debe) FILTER (WHERE c.codigo LIKE '4%'), 0)::text AS ingresos,
           COALESCE(sum(l.debe - l.haber) FILTER (WHERE c.codigo LIKE '5%'), 0)::text AS costos,
           COALESCE(sum(l.debe - l.haber) FILTER (WHERE c.codigo LIKE '6%' AND c.codigo NOT LIKE '63%'), 0)::text AS gastos
      FROM lineas_asiento l JOIN asientos a ON a.id = l.asiento_id JOIN cuentas c ON c.id = l.cuenta_id
     WHERE a.estado = 'contabilizado' AND a.origen <> 'cierre' AND a.fecha BETWEEN ${desde} AND ${hasta}
     GROUP BY 1 ORDER BY 1`;
}

// Corre en conEmpresa. «periodo» = AAAAMM del último mes que se acumula.
export async function proyeccionDe(tx: Tx, periodo: string, hoy: string): Promise<Proyeccion> {
  const [e] = await tx<{ nombre: string; mes_cierre: number; tipo_persona: "juridica" | "fisica" }[]>`
    SELECT nombre, mes_cierre, tipo_persona FROM empresas WHERE id = empresa_actual()`;
  const finMes = new Date(Date.UTC(Number(periodo.slice(0, 4)), Number(periodo.slice(4)), 0)).toISOString().slice(0, 10);
  const inicio = inicioEjercicio(finMes, e.mes_cierre), fin = finEjercicio(finMes, e.mes_cierre);

  const filas = await resultadoPorMes(tx, inicio, finMes);
  const porMes = new Map(filas.map((f) => [f.mes, f]));
  const meses: Mes[] = [];
  for (let p = inicio.slice(0, 4) + inicio.slice(5, 7); p <= periodo; p = mesSiguiente(p)) {
    const f = porMes.get(p);
    const ing = aCentavos(f?.ingresos ?? "0"), cos = aCentavos(f?.costos ?? "0"), gas = aCentavos(f?.gastos ?? "0");
    meses.push({ mes: p, ingresos: deCentavos(ing), costos: deCentavos(cos), gastos: deCentavos(gas), utilidad: deCentavos(ing - cos - gas) });
  }
  const conDatos = meses.filter((m) => m.ingresos !== "0.00" || m.costos !== "0.00" || m.gastos !== "0.00");
  const suma = (k: keyof Omit<Mes, "mes">) => meses.reduce((s, m) => s + aCentavos(m[k]), 0n);
  const [ing, cos, gas, util] = [suma("ingresos"), suma("costos"), suma("gastos"), suma("utilidad")];
  const n = BigInt(conDatos.length);
  const proyIng = n ? (ing * 12n) / n : 0n, proyUtil = n ? (util * 12n) / n : 0n;

  // ISR estimado: personas jurídicas 27 % (30 % si los ingresos llegan al umbral del IR-2); personas físicas, cuando llegue la escala.
  const juridica = e.tipo_persona !== "fisica";
  const tasa = juridica ? (proyIng >= UMBRAL_30 ? 30 : 27) : null;
  const impuesto = tasa !== null ? (proyUtil > 0n ? (proyUtil * BigInt(tasa)) / 100n : 0n) : null;
  const [{ ret }] = await tx<{ ret: string }[]>`
    SELECT COALESCE(sum(round(retencion_isr * tasa, 2)), 0)::text AS ret FROM cobros WHERE NOT anulado AND fecha BETWEEN ${inicio} AND ${finMes}`;
  const retenciones = aCentavos(ret);

  const categorias = (await tx<{ codigo: string; nombre: string; monto: string }[]>`
    SELECT left(c.codigo, 4) AS codigo, COALESCE(p.nombre, left(c.codigo, 4)) AS nombre, sum(l.debe - l.haber)::text AS monto
      FROM lineas_asiento l JOIN asientos a ON a.id = l.asiento_id JOIN cuentas c ON c.id = l.cuenta_id
      LEFT JOIN cuentas p ON p.codigo = left(c.codigo, 4) AND p.empresa_id = c.empresa_id
     WHERE a.estado = 'contabilizado' AND a.origen <> 'cierre' AND a.fecha BETWEEN ${inicio} AND ${finMes}
       AND (c.codigo LIKE '5%' OR (c.codigo LIKE '6%' AND c.codigo NOT LIKE '63%'))
     GROUP BY 1, 2 HAVING sum(l.debe - l.haber) <> 0 ORDER BY 1`);
  const comprobantes = (await tx<{ tipo: string; monto: string }[]>`
    SELECT tipo_gasto AS tipo, sum(CASE WHEN tipo_comprobante IN ('B04', 'E34') THEN -1 ELSE 1 END * round(subtotal * tasa, 2))::text AS monto
      FROM compras WHERE estado = 'registrada' AND NOT anulada AND fecha BETWEEN ${inicio} AND ${finMes} GROUP BY 1 ORDER BY 1`)
    .map((c) => ({ ...c, nombre: TIPOS_GASTO[c.tipo] ?? c.tipo }));
  // Gastos registrados a mano o desde el banco (sin compra con comprobante), salvo los que no llevan factura.
  const sinDoc = (await tx<{ nombre: string; monto: string }[]>`
    SELECT c.nombre, sum(l.debe - l.haber)::text AS monto
      FROM lineas_asiento l JOIN asientos a ON a.id = l.asiento_id JOIN cuentas c ON c.id = l.cuenta_id
     WHERE a.estado = 'contabilizado' AND a.origen IN ('manual', 'banco') AND a.fecha BETWEEN ${inicio} AND ${finMes}
       AND (c.codigo LIKE '5%' OR (c.codigo LIKE '6%' AND c.codigo NOT LIKE '63%'))
     GROUP BY c.id, c.nombre`)
    .filter((x) => !SIN_FACTURA.test(x.nombre)).reduce((s, x) => s + aCentavos(x.monto), 0n);

  // Ejercicio anterior completo, para comparar.
  const finAnterior = new Date(Date.UTC(Number(inicio.slice(0, 4)), Number(inicio.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
  const previo = await resultadoPorMes(tx, inicioEjercicio(finAnterior, e.mes_cierre), finAnterior);
  const anterior = previo.length ? previo.reduce((s, f) => s + aCentavos(f.ingresos) - aCentavos(f.costos) - aCentavos(f.gastos), 0n) : null;

  const alertas: Alerta[] = [];
  const costosGastos = cos + gas;
  if (ing > 0n && porc(costosGastos, ing) >= UMBRALES.gastosSobreIngresos) {
    alertas.push({ nivel: "aviso", texto: `Los costos y gastos son el ${porc(costosGastos, ing)} % de los ingresos: revisar que cada gasto sea deducible y esté documentado.` });
  }
  if (costosGastos > 0n && porc(sinDoc, costosGastos) >= UMBRALES.sinComprobante) {
    alertas.push({ nivel: "urgente", texto: `RD$${verMonto(deCentavos(sinDoc))} en gastos registrados sin factura de compra (${porc(sinDoc, costosGastos)} % del total): sin comprobante fiscal no son deducibles.` });
  }
  if (conDatos.length >= 3) {
    const ultimo = aCentavos(conDatos[conDatos.length - 1].utilidad);
    const previos = conDatos.slice(0, -1);
    const promedio = previos.reduce((s, m) => s + aCentavos(m.utilidad), 0n) / BigInt(previos.length);
    if (promedio !== 0n) {
      const cambio = porc(ultimo - promedio, promedio < 0n ? -promedio : promedio);
      if (Math.abs(cambio) >= UMBRALES.cambioMes) {
        alertas.push({ nivel: "aviso", texto: `La utilidad de ${nombrePeriodo(conDatos[conDatos.length - 1].mes)} ${cambio > 0 ? "subió" : "bajó"} ${Math.abs(cambio)} % contra el promedio de los meses anteriores.` });
      }
    }
  }
  if (anterior !== null && anterior !== 0n && n > 0n) {
    const cambio = porc(proyUtil - anterior, anterior < 0n ? -anterior : anterior);
    if (Math.abs(cambio) >= UMBRALES.cambioAnual) {
      alertas.push({ nivel: "aviso", texto: `La utilidad proyectada (RD$${verMonto(deCentavos(proyUtil))}) está ${Math.abs(cambio)} % ${cambio > 0 ? "por encima" : "por debajo"} del ejercicio anterior (RD$${verMonto(deCentavos(anterior))}).` });
    }
  }
  const faltan = (Number(fin.slice(0, 4)) - Number(hoy.slice(0, 4))) * 12 + Number(fin.slice(5, 7)) - Number(hoy.slice(5, 7));
  if (faltan >= 0 && faltan <= UMBRALES.mesesAntesDelCierre) {
    alertas.push({ nivel: "urgente", texto: `El ejercicio cierra el ${fin.split("-").reverse().join("/")}: es momento de revisar antes del cierre (gastos pendientes de documentar, compras de activos, provisiones).` });
  }
  if (!juridica) alertas.push({ nivel: "aviso", texto: "Persona física (IR-1): el impuesto se estima cuando se cargue la escala vigente del IR-1." });

  return {
    periodo, mes: nombrePeriodo(periodo), empresa: e.nombre, persona: juridica ? "juridica" : "fisica", inicio, fin,
    meses, mesesConDatos: conDatos.length,
    acumulado: { ingresos: deCentavos(ing), costos: deCentavos(cos), gastos: deCentavos(gas), utilidad: deCentavos(util) },
    proyectado: { ingresos: deCentavos(proyIng), utilidad: deCentavos(proyUtil) },
    tasa, impuesto: impuesto === null ? null : deCentavos(impuesto), retenciones: deCentavos(retenciones),
    aPagar: impuesto === null ? null : deCentavos(impuesto > retenciones ? impuesto - retenciones : 0n),
    categorias, comprobantes, sinComprobante: deCentavos(sinDoc), anterior: anterior === null ? null : deCentavos(anterior), alertas,
  };
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const mesCorto = (p: string) => `${MESES_CORTOS[Number(p.slice(4)) - 1]} ${p.slice(0, 4)}`;

// El PDF «Proyección de cierre fiscal» con el formato de la firma.
export function tablaProyeccion(d: Proyeccion, notas: string | null, base: { empresa: string; generado: string }): Tabla {
  const filas: (string | number)[][] = [];
  const negritas: number[] = [];
  const seccion = (t: string) => { negritas.push(filas.length); filas.push([t, "", "", "", ""]); };
  seccion("Mes a mes");
  for (const m of d.meses) filas.push([mesCorto(m.mes), m.ingresos, m.costos, m.gastos, m.utilidad]);
  negritas.push(filas.length);
  filas.push(["Acumulado", d.acumulado.ingresos, d.acumulado.costos, d.acumulado.gastos, d.acumulado.utilidad]);
  seccion("Proyección al cierre");
  filas.push([`Ingresos proyectados (${d.mesesConDatos} meses con datos × 12)`, d.proyectado.ingresos, "", "", ""]);
  filas.push(["Utilidad proyectada", "", "", "", d.proyectado.utilidad]);
  if (d.anterior !== null) filas.push(["Utilidad del ejercicio anterior", "", "", "", d.anterior]);
  if (d.impuesto !== null) {
    filas.push([`ISR estimado (${d.tasa} %)`, "", "", "", d.impuesto], ["Retenciones de ISR que le hicieron sus clientes", "", "", "", d.retenciones === "0.00" ? "0.00" : `-${d.retenciones}`]);
    negritas.push(filas.length);
    filas.push(["ISR estimado a pagar al cierre", "", "", "", d.aPagar ?? ""]);
  } else filas.push(["ISR (IR-1): se estima cuando se cargue la escala vigente", "", "", "", ""]);
  if (d.categorias.length) { seccion("Costos y gastos por categoría"); for (const c of d.categorias) filas.push([`${c.codigo} ${c.nombre}`, "", "", c.monto, ""]); }
  if (d.comprobantes.length) { seccion("Compras con comprobante (606) por tipo de gasto"); for (const c of d.comprobantes) filas.push([`${c.tipo} ${c.nombre}`, "", "", c.monto, ""]); }
  if (d.alertas.length) { seccion("Alertas"); for (const a of d.alertas) filas.push([a.texto, "", "", "", ""]); }
  if (notas?.trim()) { seccion("Notas"); filas.push([notas.trim().split(/\s+/).join(" "), "", "", "", ""]); }
  return {
    ...base, titulo: `Proyección de cierre fiscal · ${d.mes}`, negritas, horizontal: true,
    detalle: `${d.empresa} · ejercicio del ${d.inicio.split("-").reverse().join("/")} al ${d.fin.split("-").reverse().join("/")} · acumulado a ${d.mes}. Es una estimación con lo registrado; no sustituye la declaración.`,
    columnas: [{ titulo: "Concepto", ancho: 50 }, { titulo: "Ingresos", num: true }, { titulo: "Costos", num: true }, { titulo: "Gastos", num: true }, { titulo: "Utilidad", num: true }],
    filas,
  };
}
