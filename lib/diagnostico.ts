import { ANEXOS, filasDe } from "./levantamiento.ts";
import { aCentavos, deCentavos, leerMonto } from "./montos.ts";

// Entrega 6b.3: el informe de diagnóstico. Las reglas sugieren los hallazgos a partir de las respuestas (tabla de la propuesta del
// 8-nov-2026); Patricia los cambia, quita o agrega antes de enviarlo. Los servicios son los nombres exactos de la lista EMP-P01.

export const AREAS = ["Contabilidad", "Tributaria", "Laboral", "Control interno", "Documentación", "Necesidades"];
export const NIVELES: Record<string, string> = { alta: "Alta", media: "Media", baja: "Baja" };
export type Hallazgo = { area: string; hallazgo: string; recomendacion: string; servicio: string | null; prioridad: string };

// Lo que cubre la iguala cada mes: no va en la propuesta de servicios iniciales.
export const S = {
  registros: "Registros contables mensuales (virtual)", itbis: "Preparación de ITBIS", nomina: "Preparación de nómina", tss: "Preparación de TSS",
  organizar: "Organización del sistema contable", rnc: "Activación de RNC", acuerdo: "Acuerdos de pago con la DGII", ir2: "Declaración anual IR-2 (empresas)", ir1: "Declaración anual IR-1 (personas físicas)",
  insTss: "Inscripción en la TSS", insMt: "Inscripción en el Ministerio de Trabajo", control: "Evaluación de control interno por área", estados: "Preparación de estados financieros",
  asesoria: "Asesorías y consultas tributarias", constitucion: "Constitución de empresas", levantamiento: "Levantamiento contable",
};
export const MENSUALES = [S.registros, S.itbis, S.nomina, S.tss];

const empleadosDe = (r: Record<string, string>) => Math.max(Number(r.empleados_fijos ?? 0) + Number(r.empleados_servicio ?? 0), filasDe(r, ANEXOS[0]).length);

export function hallazgosDe(r: Record<string, string>, tipoPersona: string | null): Hallazgo[] {
  const h: Hallazgo[] = [];
  const add = (area: string, hallazgo: string, recomendacion: string, servicio: string | null, prioridad: string) => h.push({ area, hallazgo, recomendacion, servicio, prioridad });
  const emp = empleadosDe(r);
  if (r.lleva_contabilidad === "No" || r.lleva_contabilidad === "Parcial") add("Contabilidad", r.lleva_contabilidad === "No" ? "La empresa no lleva contabilidad." : "La contabilidad se lleva de forma parcial.", "Organizar el sistema contable para tener información confiable.", S.organizar, "alta");
  if (r.al_dia === "No" || r.al_dia === "Atrasados") add("Contabilidad", `Los registros contables no están al día${r.ultimo_registro ? ` (último registro: ${r.ultimo_registro})` : ""}.`, "Actualizar los registros y mantenerlos cada mes.", S.registros, "alta");
  if (r.rnc_estado === "Suspendido") add("Tributaria", "El RNC está suspendido.", "Activar el RNC para poder operar y declarar.", S.rnc, "alta");
  if (r.dgii_al_dia === "Tiene deuda") add("Tributaria", `La empresa tiene deuda con la DGII${r.deudas_tributarias ? `: ${r.deudas_tributarias}` : ""}.`, "Regularizar la deuda con un acuerdo de pago.", S.acuerdo, "alta");
  if (r.declara_itbis === "No") add("Tributaria", "No declara el ITBIS mensual.", "Cumplir con la declaración mensual del ITBIS.", S.itbis, "alta");
  if (r.declara_ir === "No") add("Tributaria", "No presenta la declaración anual de renta.", "Presentar la declaración anual que le corresponde.", tipoPersona === "fisica" ? S.ir1 : S.ir2, "alta");
  if (emp > 0 && (r.en_tss === "No" || r.en_tss === "Parcial")) add("Laboral", r.en_tss === "No" ? "Los empleados no están registrados en la TSS." : "Parte de los empleados no está registrada en la TSS.", "Inscribir a la empresa y a todos los empleados para evitar recargos y riesgos.", S.insTss, "alta");
  if (emp > 0 && r.en_mt === "No") add("Laboral", "La empresa no está registrada en el Ministerio de Trabajo.", "Completar el registro.", S.insMt, "media");
  if (emp > 0 && r.nomina_formal === "No") add("Laboral", "No se prepara una nómina formal.", "Formalizar la nómina cada período.", S.nomina, "media");
  const facturas = r.guarda_facturas === "A veces" || r.guarda_facturas === "No", efectivo = r.registra_efectivo === "No" || r.registra_efectivo === "Parcial";
  if (facturas || efectivo) add("Control interno", [facturas && (r.guarda_facturas === "No" ? "No guarda las facturas de gastos" : "Solo a veces guarda las facturas de gastos"), efectivo && "no registra todas las ventas en efectivo"].filter(Boolean).join(" y ") + ".", "Evaluar y ordenar los controles, porque un gasto sin factura no se puede deducir.", S.control, "media");
  if (r.doc_faltantes) add("Documentación", `Documentos por obtener: ${r.doc_faltantes}.`, "Entregar estos documentos a la firma.", null, "media");
  const PEDIDOS: Record<string, string | null> = { "Organización contable": S.organizar, "Contabilidad mensual": S.registros, "Estados financieros": S.estados, "Asesoría tributaria": S.asesoria, "Preparación de nómina": S.nomina, "Constitución de empresa": S.constitucion, Fiscal: null, Auditoría: null, "Asesoría legal": null, Otro: null };
  for (const p of (r.servicios ?? "").split(", ").filter(Boolean)) {
    const servicio = PEDIDOS[p] ?? null;
    if (servicio && h.some((x) => x.servicio === servicio)) continue;
    add("Necesidades", `El cliente pidió: ${p}.`, servicio ? "Incluirlo en la propuesta." : "Definir con el cliente el alcance y elegir el servicio.", servicio, "media");
  }
  return h;
}

export type Diagnostico = {
  hallazgos: Hallazgo[]; resumen: string; categoria: string | null; iguala: string; incluirLevantamiento: boolean;
  economica?: { lineas: { descripcion: string; precio: string }[]; iguala: string | null; total: string; activos: string; pasivos: string; patrimonio: string; resultado: string | null; margen: string | null };
};

export const inicial = (r: Record<string, string>, tipoPersona: string | null, categoria: string | null): Diagnostico => ({
  hallazgos: hallazgosDe(r, tipoPersona), categoria, iguala: "", incluirLevantamiento: true,
  resumen: `Tras el levantamiento contable de ${r.nombre ?? "la empresa"}, estos son los puntos que requieren atención y lo que recomendamos.`,
});

// Lee lo que edita la firma: una fila sin hallazgo o marcada para quitar no se guarda.
export function leerDiagnostico(fd: FormData, previo: Diagnostico, servicios: Set<string>): Diagnostico {
  const t = (k: string, max = 500) => String(fd.get(k) ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const hallazgos: Hallazgo[] = [];
  for (let i = 0; i < 60; i++) {
    const hallazgo = t(`h${i}_hallazgo`);
    if (!hallazgo || fd.get(`h${i}_quitar`) === "on") continue;
    const servicio = t(`h${i}_servicio`, 200) || null, area = t(`h${i}_area`), prioridad = t(`h${i}_prioridad`);
    if (!AREAS.includes(area)) throw new Error(`Elige el área de: ${hallazgo.slice(0, 40)}.`);
    if (!(prioridad in NIVELES)) throw new Error(`Elige la prioridad de: ${hallazgo.slice(0, 40)}.`);
    if (servicio && !servicios.has(servicio)) throw new Error(`El servicio «${servicio}» no está en la lista de precios.`);
    hallazgos.push({ area, hallazgo, recomendacion: t(`h${i}_recomendacion`), servicio, prioridad });
  }
  const iguala = t("iguala", 30), categoria = t("categoria", 20) || null;
  if (iguala) { const m = leerMonto(iguala); if (m === null || aCentavos(m) < 0n) throw new Error("La iguala no es un monto válido."); }
  if (categoria && !["pequena", "mediana", "grande", "emprendedor"].includes(categoria)) throw new Error("Elige la categoría.");
  return { ...previo, hallazgos, resumen: t("resumen", 1500), categoria, iguala, incluirLevantamiento: fd.get("incluir_levantamiento") === "on" };
}

type Precios = Map<string, string>; // nombre del servicio → precio de la categoría

// Iguala de referencia: lo mensual que le toca, sin bajar del mínimo salvo emprendedor. Patricia escribe la final.
export function igualaReferencia(r: Record<string, string>, precios: Precios, categoria: string | null): string {
  const lista = [S.registros, ...(r.declara_itbis !== "No aplica" ? [S.itbis] : []), ...(empleadosDe(r) > 0 ? [S.nomina, S.tss] : [])];
  const suma = lista.reduce((t, s) => t + aCentavos(precios.get(s) ?? "0"), 0n);
  return deCentavos(categoria !== "emprendedor" && suma < 400000n ? 400000n : suma);
}

// Servicios de una sola vez para la propuesta: sin repetir, sin los mensuales (van en la iguala) y con el levantamiento primero si se cobra.
export function serviciosIniciales(d: Pick<Diagnostico, "hallazgos" | "incluirLevantamiento">): string[] {
  const unicos = [...new Set(d.hallazgos.map((h) => h.servicio).filter((s): s is string => !!s && !MENSUALES.includes(s) && s !== S.levantamiento))];
  return d.incluirLevantamiento ? [S.levantamiento, ...unicos] : unicos;
}
