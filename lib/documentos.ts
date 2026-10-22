import { createHash } from "node:crypto";

export const TAMANO_MAXIMO = 4 * 1024 * 1024; // límite de Vercel por solicitud
export const TIPOS: Record<string, string> = { "application/pdf": "PDF", "image/jpeg": "JPG", "image/png": "PNG" };

// Reconoce el tipo por el contenido (no por el nombre), para que no se cuele otro tipo de archivo.
export function tipoPorContenido(b: Uint8Array): string | null {
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf"; // %PDF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  return null;
}

export function huella(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

export function nombreSeguro(nombre: string): string {
  return nombre.replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 150) || "documento";
}

export function verTamano(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
