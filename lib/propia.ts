import { db } from "./db";

// ¿Es la empresa propia de la firma? Lo de la socia (salidas, cuenta corriente) solo existe ahí.
export async function esEmpresaPropia(empresaId: string): Promise<boolean> {
  const [f] = await db()`SELECT 1 FROM firmas WHERE empresa_propia_id = ${empresaId}`;
  return !!f;
}
