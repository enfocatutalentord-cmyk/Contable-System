import type { Tx } from "./db";
import { guardarPrecios, type CategoriaPrecio } from "./precios.ts";

// Entrega 6b.1: la Lista de Precios EMP-P01, edición octubre 2026, copiada del PDF de Empire. Montos en pesos, sin ITBIS, en el orden
// Pequeña, Mediana, Grande, Emprendedor. El código no se llena porque la lista no lo trae.
export const VIGENTE_P01 = "2026-10-01";
type Fila = [nombre: string, pequena: number, mediana: number, grande: number, emprendedor: number];
export const LISTA_P01: Record<string, Fila[]> = {
  contabilidad: [
    ["Organización del sistema contable", 10000, 15000, 20000, 6000],
    ["Registros contables en su empresa (presencial)", 5000, 8000, 12000, 3000],
    ["Registros contables mensuales (virtual)", 4000, 7000, 10000, 2500],
    ["Preparación de estados financieros", 6000, 9000, 14000, 3500],
    ["Revisión de transacciones por terceros", 3500, 6000, 9000, 2000],
  ],
  control_interno: [
    ["Evaluación de control interno por área", 8000, 12000, 18000, 5000],
    ["Diseño de controles internos", 10000, 15000, 20000, 6000],
    ["Manual de procedimientos", 12000, 18000, 25000, 7000],
    ["Seguimiento a controles internos", 7000, 10000, 15000, 4500],
  ],
  auditoria: [
    ["Auditoría tributaria", 10000, 15000, 22000, 6500],
    ["Auditoría de procesos y procedimientos", 12000, 18000, 25000, 7500],
    ["Auditoría de estados financieros", 15000, 22000, 30000, 9000],
    ["Comisario de cuentas", 7000, 12000, 18000, 4500],
  ],
  laboral_tss: [
    ["Asesoría en temas laborales", 5000, 8000, 12000, 3000],
    ["Cálculo de prestaciones laborales", 6000, 9000, 14000, 3500],
    ["Cálculo de horas extras, bonificación y regalía", 5000, 6000, 9000, 3000],
    ["Preparación de nómina", 5000, 8000, 12000, 3000],
    ["Preparación de TSS", 4000, 6000, 9000, 2500],
    ["Formularios del Ministerio de Trabajo", 3000, 5000, 8000, 1800],
    ["Inscripción en la TSS", 2500, 4000, 6000, 1500],
    ["Inscripción en el Ministerio de Trabajo", 2500, 4000, 6000, 1500],
    ["Reclutamiento y evaluación de personal", 7000, 12000, 18000, 4500],
  ],
  tributario: [
    ["Preparación de retenciones", 3000, 5000, 8000, 1800],
    ["Preparación de ITBIS", 4000, 6000, 10000, 2500],
    ["Asesorías y consultas tributarias", 5000, 8000, 12000, 3000],
    ["Declaración anual IR-2 (empresas)", 5000, 8000, 18000, 3000],
    ["Declaración anual IR-1 (personas físicas)", 5000, 8000, 12000, 2500],
    ["Declaración DIOR", 6000, 9000, 14000, 3500],
    ["Rectificativas", 3000, 5000, 7000, 1800],
    ["Acuerdos de pago con la DGII", 5000, 8000, 12000, 3000],
    ["Activación de RNC", 5000, 8000, 12000, 2500],
    ["Declaración anual en cero", 1500, 2500, 3500, 1000],
    ["Declaración de ITBIS en cero (mensual)", 1000, 1200, 1500, 600],
    ["Cierre de negocios", 6000, 9000, 14000, 3500],
  ],
  otros: [
    ["Constitución de empresas", 22500, 25000, 25000, 14000],
    ["Levantamiento contable", 10000, 15000, 20000, 6000],
    ["Registro de marca y nombre comercial", 7000, 7000, 7000, 5000],
  ],
};

export type ResultadoP01 = { creados: number; actualizados: number; sinCambios: number };

// Crea o pone al día los 37 servicios en la empresa propia. El precio general queda en 0: quien factura a un cliente sin categoría ve
// el aviso y no se le cobra por error otra columna. Se puede repetir: los precios van con la fecha de la edición, así que un precio que
// Patricia haya cambiado después sigue mandando.
export async function cargarListaP01(tx: Tx, empresaId: string, hoy: string): Promise<ResultadoP01> {
  const [itbis] = await tx<{ id: string }[]>`
    SELECT id FROM impuestos WHERE tipo = 'itbis' AND tasa = 18 AND activo AND vigente_desde <= ${hoy} AND (vigente_hasta IS NULL OR vigente_hasta >= ${hoy})
     ORDER BY vigente_desde DESC LIMIT 1`;
  if (!itbis) throw new Error("La empresa no tiene un ITBIS de 18 % vigente: revísalo en Configuración tributaria.");
  const [unidad] = await tx<{ id: string }[]>`SELECT id FROM unidades_negocio WHERE nombre = 'Firma contable' AND activa LIMIT 1`;
  const r: ResultadoP01 = { creados: 0, actualizados: 0, sinCambios: 0 };
  for (const [grupo, filas] of Object.entries(LISTA_P01)) {
    for (const [nombre, pequena, mediana, grande, emprendedor] of filas) {
      const [existe] = await tx<{ id: string }[]>`SELECT id FROM servicios WHERE lower(btrim(nombre)) = lower(${nombre}) ORDER BY activo DESC LIMIT 1`;
      let id = existe?.id;
      if (id) await tx`UPDATE servicios SET grupo = ${grupo} WHERE id = ${id} AND grupo IS DISTINCT FROM ${grupo}`;
      else {
        [{ id }] = await tx<{ id: string }[]>`
          INSERT INTO servicios (empresa_id, nombre, precio, impuesto_id, grupo, unidad_id)
          VALUES (${empresaId}, ${nombre}, 0, ${itbis.id}, ${grupo}, ${unidad?.id ?? null}) RETURNING id`;
      }
      const precios: Record<CategoriaPrecio, string> = { pequena: `${pequena}.00`, mediana: `${mediana}.00`, grande: `${grande}.00`, emprendedor: `${emprendedor}.00` };
      const cambios = await guardarPrecios(tx, empresaId, id, { desde: VIGENTE_P01, precios });
      if (!existe) r.creados++;
      else if (cambios) r.actualizados++;
      else r.sinCambios++;
    }
  }
  return r;
}
