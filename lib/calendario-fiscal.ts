import { conEmpresa, db, type Tx } from "./db.ts";
import { obligacionesActivas } from "./impuestos-mes.ts";
import { NOMBRE_FORMATO } from "./normas-reglas.ts";

// Prioridad 3 · P3a: calendario fiscal y renovaciones. Junta en un solo calendario por mes lo que vence de cada cliente: las declaraciones (606, 607,
// 608, IT-1, IR-17, IR-2), el anticipo del ISR y la TSS, y las renovaciones (registro mercantil, nombre comercial, asamblea, otros documentos,
// rangos de comprobantes y certificados de firma). No guarda nada: todo se calcula con el calendario fiscal de la firma (Normas y tasas), sus
// prórrogas y lo que ya registra cada cliente. Las fechas salen de las mismas reglas que Impuestos del mes y las alertas.

export type DiaCalendario = { formato: string; dia: number | null };
export type Prorroga = { formato: string; periodo: string; vence: string };

export type Tipo = "declaracion" | "pago" | "renovacion" | "comprobantes" | "certificado";
export type Estado = "hecho" | "vencido" | "por_vencer" | "pendiente" | "recordatorio";
export type Evento = { fecha: string; empresaId: string; empresa: string; tipo: Tipo; titulo: string; corto: string; detalle: string | null; estado: Estado; enlace: string };

export const DIAS_POR_VENCER = 7; // una declaración sin presentar se marca «por vencer» desde 7 días antes
export const DIAS_ATRASADO = 90; // cuánto hacia atrás se muestran las declaraciones atrasadas
const DIA_DEFECTO: Record<string, number> = { "606": 15, "607": 15, "608": 15, "IT-1": 20, "IR-17": 10, "IR-2": 120, Anticipo: 15 };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const CLAVE_A_FORMATO: Record<string, string> = { f606: "606", f607: "607", f608: "608", it1: "IT-1", ir17: "IR-17", anticipo: "Anticipo" };

const pad = (n: number) => String(n).padStart(2, "0");
export const sumarDias = (f: string, n: number) => { const d = new Date(`${f}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);
export const finDeMes = (mes: string) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);
export const mesDe = (periodo: string) => `${periodo.slice(0, 4)}-${periodo.slice(4)}`;
const mesMas = (mes: string, n: number) => { const t = Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`; };
export const nombreDelMes = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1];

// Fecha límite de una declaración del período AAAAMM. Es la misma regla de la función `vencimiento_fiscal` de la base: la prórroga de ese mes
// si la hay; si no, el día del calendario de la firma en el mes siguiente (sin pasar del último día) o, para el IR-2, los días después del
// cierre del ejercicio. Sin día (la TSS mientras no se confirme) no hay fecha.
export function fechaLimite(formato: string, periodo: string, calendario: DiaCalendario[], prorrogas: Prorroga[]): string | null {
  const p = prorrogas.find((x) => x.formato === formato && x.periodo === periodo);
  if (p) return p.vence;
  const fila = calendario.find((c) => c.formato === formato);
  const dia = fila ? fila.dia : (DIA_DEFECTO[formato] ?? null);
  if (dia === null) return null;
  if (formato === "IR-2") return sumarDias(finDeMes(mesDe(periodo)), dia);
  const siguiente = mesMas(mesDe(periodo), 1);
  const ultimo = Number(finDeMes(siguiente).slice(8));
  return `${siguiente}-${pad(Math.min(dia, ultimo))}`;
}

export type DatosEmpresa = {
  id: string; nombre: string; creada: string; mesCierre: number; tieneTss: boolean; obligaciones: string[];
  presentados: { formato: string; periodo: string }[];
  registro: string | null; comercial: string | null; asamblea: string | null;
  vencimientos: { nombre: string; vence: string; avisar_dias: number }[];
  ncf: { tipo: string; vence: string; quedan: number }[];
  certificados: { titular: string; vence: string }[];
  tss: { periodo: string; pagada: boolean }[];
};

function estadoDeclaracion(fecha: string, hecho: boolean, hoy: string): Estado {
  if (hecho) return "hecho";
  if (fecha < hoy) return "vencido";
  return diasEntre(hoy, fecha) <= DIAS_POR_VENCER ? "por_vencer" : "pendiente";
}
function estadoRenovacion(fecha: string, aviso: number, hoy: string): Estado {
  if (fecha < hoy) return "vencido";
  return diasEntre(hoy, fecha) <= aviso ? "por_vencer" : "pendiente";
}

// Los eventos de una empresa para un mes (AAAA-MM): lo que vence en el mes más lo atrasado de los 90 días anteriores (declaraciones) y las
// renovaciones vencidas que siguen sin renovarse.
export function eventosDeEmpresa(d: DatosEmpresa, calendario: DiaCalendario[], prorrogas: Prorroga[], mes: string, hoy: string): Evento[] {
  const desde = `${mes}-01`, hasta = finDeMes(mes);
  const limiteAtrasado = sumarDias(desde, -DIAS_ATRASADO);
  const dentro = (f: string) => f >= desde && f <= hasta;
  const eventos: Evento[] = [];
  const base = `/e/${d.id}`;
  const poner = (e: Omit<Evento, "empresaId" | "empresa">) => eventos.push({ ...e, empresaId: d.id, empresa: d.nombre });

  // Declaraciones y pagos que dependen de un período: los de los 4 meses anteriores cuyo vencimiento cae en el mes o quedó atrasado.
  const presentados = new Set(d.presentados.map((p) => `${p.formato}:${p.periodo}`));
  const formatos = d.obligaciones.map((c) => CLAVE_A_FORMATO[c]).filter(Boolean);
  if (d.tieneTss) formatos.push("TSS");
  for (let atras = 1; atras <= 4; atras++) {
    const m = mesMas(mes, -atras), periodo = m.replace("-", "");
    for (const formato of formatos) {
      const fecha = fechaLimite(formato, periodo, calendario, prorrogas);
      if (!fecha || fecha < d.creada) continue;
      let estado: Estado;
      if (formato === "Anticipo") estado = "recordatorio"; // el sistema no sabe si se pagó
      else if (formato === "TSS") {
        const n = d.tss.find((t) => t.periodo === periodo);
        estado = !n ? "recordatorio" : estadoDeclaracion(fecha, n.pagada, hoy);
      } else estado = estadoDeclaracion(fecha, presentados.has(`${formato}:${periodo}`), hoy);
      if (!(dentro(fecha) || (estado === "vencido" && fecha < desde && fecha >= limiteAtrasado))) continue;
      const nombre = `${nombreDelMes(m)} ${m.slice(0, 4)}`;
      const titulos: Record<string, string> = {
        "606": `606 de ${nombre}`, "607": `607 de ${nombre}`, "608": `608 de ${nombre}`, "IT-1": `IT-1 de ${nombre}`, "IR-17": `IR-17 de ${nombre}`,
        Anticipo: `Anticipo del ISR de ${nombre}`, TSS: `Pago a la TSS de ${nombre}`,
      };
      const enlaces: Record<string, string> = {
        "606": `${base}/dgii?mes=${m}#f606`, "607": `${base}/dgii?mes=${m}#f607`, "608": `${base}/dgii?mes=${m}#f608`,
        "IT-1": `${base}/dgii/it1?mes=${m}`, "IR-17": `${base}/dgii/ir17?mes=${m}`, Anticipo: `${base}/dgii`, TSS: `${base}/notificaciones`,
      };
      poner({ fecha, tipo: formato === "Anticipo" || formato === "TSS" ? "pago" : "declaracion", titulo: titulos[formato], corto: formato === "Anticipo" ? "Anticipo ISR" : formato, detalle: NOMBRE_FORMATO[formato] ?? null, estado, enlace: enlaces[formato] });
    }
  }

  // IR-2: 120 días después del cierre del ejercicio (período = mes de cierre del ejercicio).
  if (d.obligaciones.includes("ir2")) {
    for (const anio of [Number(mes.slice(0, 4)) - 1, Number(mes.slice(0, 4))]) {
      const periodo = `${anio}${pad(d.mesCierre)}`;
      const fecha = fechaLimite("IR-2", periodo, calendario, prorrogas);
      if (!fecha || fecha < d.creada) continue;
      const estado = estadoDeclaracion(fecha, presentados.has(`IR-2:${periodo}`), hoy);
      if (!(dentro(fecha) || (estado === "vencido" && fecha < desde && fecha >= limiteAtrasado))) continue;
      poner({ fecha, tipo: "declaracion", titulo: `IR-2 del ejercicio ${finDeMes(mesDe(periodo)).slice(0, 4)}`, corto: "IR-2", detalle: NOMBRE_FORMATO["IR-2"], estado, enlace: `${base}/dgii/ir2` });
    }
  }

  // Renovaciones. Las vencidas siguen saliendo hasta que se renueva la fecha.
  const renovacion = (fecha: string | null, titulo: string, aviso: number, enlace: string, detalle: string | null = null) => {
    if (!fecha) return;
    const estado = estadoRenovacion(fecha, aviso, hoy);
    if (dentro(fecha) || (estado === "vencido" && fecha < desde)) poner({ fecha, tipo: "renovacion", titulo, corto: titulo, detalle, estado, enlace });
  };
  renovacion(d.registro, "Registro mercantil", 60, `${base}/empresa?seccion=sociedad`);
  renovacion(d.comercial, "Nombre comercial (ONAPI)", 60, `${base}/empresa?seccion=sociedad`);
  renovacion(d.asamblea, "Asamblea ordinaria anual", 30, `${base}/empresa?seccion=sociedad`);
  for (const v of d.vencimientos) renovacion(v.vence, v.nombre, v.avisar_dias, `${base}/empresa?seccion=vencimientos`);
  for (const c of d.certificados) renovacion(c.vence, `Certificado de firma de ${c.titular}`, 30, `${base}/certificado`);
  for (const n of d.ncf) {
    const estado = estadoRenovacion(n.vence, 30, hoy);
    if (dentro(n.vence)) poner({ fecha: n.vence, tipo: "comprobantes", titulo: `Rango de comprobantes ${n.tipo}`, corto: `Comprobantes ${n.tipo}`, detalle: n.quedan <= 0 ? "Se agotaron" : `Quedan ${n.quedan}`, estado, enlace: `${base}/comprobantes` });
  }
  return eventos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.titulo.localeCompare(b.titulo));
}

export async function datosDeEmpresa(tx: Tx, c: { id: string; nombre: string; creada: string }): Promise<DatosEmpresa> {
  const [e] = await tx<{ mes_cierre: number; tiene_tss: boolean; registro: string | null; comercial: string | null; asamblea: string | null }[]>`
    SELECT mes_cierre, COALESCE(tiene_tss, false) AS tiene_tss, to_char(vence_registro_mercantil, 'YYYY-MM-DD') AS registro,
           to_char(vence_nombre_comercial, 'YYYY-MM-DD') AS comercial, to_char(fecha_asamblea, 'YYYY-MM-DD') AS asamblea
      FROM empresas WHERE id = ${c.id}`;
  const { activas } = await obligacionesActivas(tx);
  const [presentados, ncf, vencimientos, certificados, tss] = await Promise.all([
    tx<{ formato: string; periodo: string }[]>`SELECT formato, periodo FROM envios_dgii`,
    tx<{ tipo: string; vence: string; quedan: number }[]>`
      SELECT tipo, to_char(vence, 'YYYY-MM-DD') AS vence, (hasta - siguiente + 1)::int AS quedan FROM secuencias_ncf WHERE activa AND vence IS NOT NULL`,
    tx<{ nombre: string; vence: string; avisar_dias: number }[]>`
      SELECT nombre, to_char(vence, 'YYYY-MM-DD') AS vence, avisar_dias FROM vencimientos_empresa WHERE activo`,
    tx<{ titular: string; vence: string }[]>`SELECT titular, to_char(vence, 'YYYY-MM-DD') AS vence FROM certificados_ecf WHERE activo`,
    tx<{ periodo: string; pagada: boolean }[]>`SELECT periodo, (estado = 'pagada') AS pagada FROM notificaciones_pago WHERE tipo = 'tss'`,
  ]);
  return {
    id: c.id, nombre: c.nombre, creada: c.creada, mesCierre: e?.mes_cierre ?? 12, tieneTss: !!e?.tiene_tss, obligaciones: [...activas],
    presentados, registro: e?.registro ?? null, comercial: e?.comercial ?? null, asamblea: e?.asamblea ?? null, vencimientos, ncf, certificados, tss,
  };
}

// Los eventos del mes de los clientes dados. El calendario fiscal y las prórrogas son de la firma; lo demás, de cada cliente.
export async function calendarioDeFirma(firmaId: string, clientes: { id: string; nombre: string; creada: string }[], mes: string, hoy: string): Promise<Evento[]> {
  const [calendario, prorrogas] = await Promise.all([
    db()<DiaCalendario[]>`SELECT formato, dia FROM calendario_fiscal WHERE firma_id = ${firmaId}`,
    db()<Prorroga[]>`SELECT formato, periodo, to_char(vence, 'YYYY-MM-DD') AS vence FROM prorrogas_fiscales WHERE firma_id = ${firmaId}`,
  ]);
  const listas = await Promise.all(clientes.map((c) => conEmpresa(c.id, async (tx) => eventosDeEmpresa(await datosDeEmpresa(tx, c), calendario, prorrogas, mes, hoy))));
  return listas.flat().sort((a, b) => a.fecha.localeCompare(b.fecha) || a.empresa.localeCompare(b.empresa) || a.titulo.localeCompare(b.titulo));
}
