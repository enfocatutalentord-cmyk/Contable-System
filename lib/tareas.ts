import type { Tx } from "./db";

// Bloque 3, entrega 3b: el cronograma operativo de la firma (Documento maestro, sección 9). Cada plantilla genera sus tareas del
// mes al abrir la pantalla (como los trabajos recurrentes de Karbon y TaxDome); las de un cliente, al hacerse, van a su bitácora.
// Son de la firma, no de un cliente: se leen con la conexión de la firma y siempre filtradas por firma_id.

export const ALCANCES: Record<string, string> = {
  firma: "Una para la firma", todos: "Una por cliente activo", tss: "Una por cliente con TSS", iguala: "Una por cliente con iguala",
};
export const DIAS_SEMANA = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export type Plantilla = {
  id: string; orden: number; titulo: string; dia_desde: number | null; dia_hasta: number | null; dia_semana: number | null; alcance: string; activa: boolean;
};

const ultimoDia = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const iso = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// Las fechas de una plantilla en un mes (AAAA-MM): un rango (desde, hasta) o, si es semanal, un día por semana.
export function fechasDe(p: Pick<Plantilla, "dia_desde" | "dia_hasta" | "dia_semana">, mes: string): { desde: string; hasta: string; periodo: string }[] {
  const a = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7));
  const fin = ultimoDia(a, m);
  if (p.dia_semana) {
    const fechas = [];
    for (let d = 1; d <= fin; d++) {
      const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay() || 7; // 1 = lunes … 7 = domingo
      if (dow === p.dia_semana) fechas.push({ desde: iso(a, m, d), hasta: iso(a, m, d), periodo: iso(a, m, d) });
    }
    return fechas;
  }
  return [{ desde: iso(a, m, Math.min(p.dia_desde!, fin)), hasta: iso(a, m, Math.min(p.dia_hasta!, fin)), periodo: mes }];
}

export const listarPlantillas = (tx: Tx, firmaId: string) => tx<Plantilla[]>`
  SELECT id, orden, titulo, dia_desde, dia_hasta, dia_semana, alcance, activa FROM plantillas_tarea WHERE firma_id = ${firmaId} ORDER BY orden, titulo`;

// Crea las tareas del mes que falten (no repite: una por plantilla, cliente y período). Devuelve cuántas creó.
export async function generarTareas(tx: Tx, firmaId: string, mes: string): Promise<number> {
  const plantillas = (await listarPlantillas(tx, firmaId)).filter((p) => p.activa);
  if (!plantillas.length) return 0;
  const clientes = await tx<{ id: string; tiene_tss: boolean | null; tipo_cliente: string | null }[]>`
    SELECT e.id, e.tiene_tss, e.tipo_cliente FROM empresas e JOIN firmas f ON f.id = e.firma_id
     WHERE e.firma_id = ${firmaId} AND e.activa AND e.id IS DISTINCT FROM f.empresa_propia_id
       AND e.estado_cliente IS DISTINCT FROM 'retirado'`;
  let creadas = 0;
  for (const p of plantillas) {
    const para = p.alcance === "firma" ? [null]
      : clientes.filter((c) => p.alcance === "todos" || (p.alcance === "tss" && c.tiene_tss) || (p.alcance === "iguala" && c.tipo_cliente === "iguala")).map((c) => c.id);
    for (const f of fechasDe(p, mes)) {
      for (const empresaId of para) {
        const r = await tx`
          INSERT INTO tareas (firma_id, plantilla_id, empresa_id, titulo, desde, hasta, periodo)
          VALUES (${firmaId}, ${p.id}, ${empresaId}, ${p.titulo}, ${f.desde}, ${f.hasta}, ${f.periodo})
          ON CONFLICT (plantilla_id, COALESCE(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), periodo) WHERE plantilla_id IS NOT NULL DO NOTHING`;
        creadas += r.count;
      }
    }
  }
  return creadas;
}

export type Tarea = {
  id: string; titulo: string; desde: string; hasta: string; estado: string; empresa_id: string | null; cliente: string | null;
  responsable_id: string | null; responsable: string | null; hecha_por: string | null; hecha_en: Date | null;
};

export const listarTareas = (tx: Tx, firmaId: string, mes: string) => tx<Tarea[]>`
  SELECT t.id, t.titulo, to_char(t.desde, 'YYYY-MM-DD') AS desde, to_char(t.hasta, 'YYYY-MM-DD') AS hasta, t.estado, t.empresa_id,
         e.nombre AS cliente, t.responsable_id, r.nombre AS responsable, h.nombre AS hecha_por, t.hecha_en
    FROM tareas t LEFT JOIN empresas e ON e.id = t.empresa_id LEFT JOIN usuarios r ON r.id = t.responsable_id LEFT JOIN usuarios h ON h.id = t.hecha_por
   WHERE t.firma_id = ${firmaId} AND to_char(t.desde, 'YYYY-MM') = ${mes}
   ORDER BY t.estado = 'hecha', t.desde, t.hasta, t.titulo, e.nombre NULLS FIRST`;

// Marca una tarea hecha (o la reabre). La de un cliente, al hacerse, queda en su bitácora.
export async function marcarTarea(tx: Tx, d: { firmaId: string; tareaId: string; hecha: boolean; usuarioId: string }) {
  const [t] = await tx<{ empresa_id: string | null; titulo: string; estado: string }[]>`
    SELECT empresa_id, titulo, estado FROM tareas WHERE id = ${d.tareaId} AND firma_id = ${d.firmaId} FOR UPDATE`;
  if (!t) throw new Error("La tarea no existe");
  if (d.hecha === (t.estado === "hecha")) return;
  if (d.hecha) {
    await tx`UPDATE tareas SET estado = 'hecha', hecha_por = ${d.usuarioId}, hecha_en = now() WHERE id = ${d.tareaId}`;
    if (t.empresa_id) {
      await tx`SELECT set_config('app.empresa_id', ${t.empresa_id}, true), set_config('app.usuario_id', ${d.usuarioId}, true)`;
      await tx`INSERT INTO gestiones (empresa_id, tipo, descripcion, responsable_id, estado, creado_por)
               VALUES (${t.empresa_id}, 'otro', ${`Tarea del cronograma: ${t.titulo}`}, ${d.usuarioId}, 'hecha', ${d.usuarioId})`;
    }
  } else {
    await tx`UPDATE tareas SET estado = 'pendiente', hecha_por = NULL, hecha_en = NULL WHERE id = ${d.tareaId}`;
  }
}
