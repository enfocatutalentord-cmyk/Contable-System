import { exigirPermiso, esUuid } from "./acceso";
import { conciliarDocumento } from "./conciliacion";
import { conEmpresa } from "./db";
import { puede } from "./permisos";
import { puedeVer } from "./pestanas";

// Un cobro o pago registrado desde un movimiento del banco: si el monto coincide queda conciliado y se vuelve al banco.
// Si no coincide (o quien lo registra no ve Bancos), el documento queda registrado igual y se concilia después.
export async function conciliarDesdeBanco(empresaId: string, movimientoId: string, tabla: "cobros" | "pagos", numero: number, usuarioId: string): Promise<string | null> {
  if (!esUuid(movimientoId)) return null;
  const { permisos, pestanas } = await exigirPermiso(empresaId, "contabilizar");
  if (!puede(permisos, "contabilizar") || !puedeVer(pestanas, "/bancos")) return null;
  try {
    const cuenta = await conEmpresa(empresaId, async (tx) => {
      const [d] = tabla === "cobros"
        ? await tx<{ asiento_id: string }[]>`SELECT asiento_id FROM cobros WHERE numero = ${numero}`
        : await tx<{ asiento_id: string }[]>`SELECT asiento_id FROM pagos WHERE numero = ${numero}`;
      return d?.asiento_id ? conciliarDocumento(tx, { movimientoId, asientoId: d.asiento_id, usuarioId }) : null;
    });
    return cuenta ? `/e/${empresaId}/bancos/${cuenta}?aviso=conciliado` : null;
  } catch {
    return null;
  }
}
