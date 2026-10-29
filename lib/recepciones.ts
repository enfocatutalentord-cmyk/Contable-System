import type { Tx } from "./db";

// Documentos recibidos: lo que suben los clientes para que la firma lo procese (migración 012).
export const CATEGORIAS: Record<string, string> = {
  gasto: "Gasto o recibo",
  factura_recibida: "Factura de un proveedor",
  estado_bancario: "Estado bancario",
  contrato: "Contrato",
  otro: "Otro",
};

export const ESTADOS: Record<string, string> = { nuevo: "Nuevo", en_proceso: "En proceso", procesado: "Procesado", descartado: "Descartado" };

export type Recepcion = {
  id: string; categoria: string; nombre: string; tipo: string; tamano: number; nota: string | null; subido_en: Date; quien: string | null;
  estado: string; respuesta: string | null; procesado_en: Date | null; procesador: string | null; compra_id: string | null; compra_ncf: string | null;
};

export async function listarRecepciones(tx: Tx, estado: string | null): Promise<Recepcion[]> {
  return tx<Recepcion[]>`
    SELECT r.id, r.categoria, r.nombre, r.tipo, r.tamano, r.nota, r.subido_en, u.nombre AS quien, r.estado, r.respuesta, r.procesado_en,
           p.nombre AS procesador, r.compra_id, c.ncf AS compra_ncf
      FROM recepciones r
      LEFT JOIN usuarios u ON u.id = r.subido_por
      LEFT JOIN usuarios p ON p.id = r.procesado_por
      LEFT JOIN compras c ON c.id = r.compra_id
     WHERE ${estado}::text IS NULL OR (${estado} = 'pendientes' AND r.estado IN ('nuevo', 'en_proceso')) OR r.estado = ${estado}
     ORDER BY r.estado IN ('nuevo', 'en_proceso') DESC, r.subido_en DESC
     LIMIT 300`;
}

export async function pendientesRecepcion(tx: Tx): Promise<number> {
  const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM recepciones WHERE estado IN ('nuevo', 'en_proceso')`;
  return n;
}
