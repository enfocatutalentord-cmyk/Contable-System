import type { Tx } from "./db";
import { aCentavos, leerMonto } from "./montos.ts";

// Prioridad 2.2 (P2d): el trabajo es la solicitud de servicio con sus requisitos, su precio y su factura. Los requisitos de cada servicio se
// escriben en la lista de precios de la empresa propia, se copian al trabajo y ahí se les marca lo que llegó; con uno obligatorio pendiente
// el trabajo no se entrega (lo cuida también la base).

export const ESTADOS_REQUISITO: Record<string, string> = { pendiente: "Pendiente", recibido: "Recibido", no_aplica: "No aplica" };

export type Requisito = { id: string; texto: string; obligatorio: boolean; estado: string; recibido_en: Date | null; recibido_por: string | null; nota: string | null };
export type RequisitoServicio = { id: string; texto: string; obligatorio: boolean };

export class ErrorTrabajo extends Error {
  code = "P0001"; // mensajeError lo muestra tal cual
}

export const listarRequisitos = (tx: Tx, solicitudId: string) => tx<Requisito[]>`
  SELECT r.id, r.texto, r.obligatorio, r.estado, r.recibido_en, u.nombre AS recibido_por, r.nota
    FROM requisitos_solicitud r LEFT JOIN usuarios u ON u.id = r.recibido_por
   WHERE r.solicitud_id = ${solicitudId} ORDER BY r.orden, r.creado`;

export const requisitosDeServicio = (tx: Tx, servicioId: string) => tx<RequisitoServicio[]>`
  SELECT id, texto, obligatorio FROM requisitos_servicio WHERE servicio_id = ${servicioId} AND activo ORDER BY orden, id`;

// Cuántos requisitos obligatorios faltan por recibir.
export const faltan = (r: Pick<Requisito, "obligatorio" | "estado">[]) => r.filter((x) => x.obligatorio && x.estado === "pendiente").length;

// La lista que se le manda al cliente por WhatsApp: solo lo que todavía falta.
export function textoRequisitos(r: Pick<Requisito, "texto" | "obligatorio" | "estado">[]): string {
  return r.filter((x) => x.estado === "pendiente").map((x) => `• ${x.texto}${x.obligatorio ? "" : " (opcional)"}`).join("\n");
}

export function leerRequisito(fd: FormData): { texto: string; obligatorio: boolean } {
  const texto = String(fd.get("texto") ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
  if (!texto) throw new ErrorTrabajo("Escribe el requisito.");
  return { texto, obligatorio: fd.get("opcional") !== "on" };
}

// Precio del trabajo: monto mayor que cero con dos decimales; vacío = se usa el de la lista según la categoría del cliente.
export function leerPrecioTrabajo(fd: FormData): string | null {
  const v = String(fd.get("precio") ?? "").trim();
  if (!v) return null;
  const m = leerMonto(v);
  if (m === null || aCentavos(m) < 0n) throw new ErrorTrabajo("El precio no es válido.");
  return m;
}
