import type { Tx } from "@/lib/db";
import { listarImpuestos } from "@/lib/fiscal";
import type { CuentaCompra, ImpuestoCompra, ProveedorCompra } from "./nueva/formulario-compra";

// Lo que necesita el formulario de compra (nueva, edición de un borrador o nota de crédito del proveedor).
export async function datosFormularioCompra(tx: Tx, hoy: string) {
  const impuestos: ImpuestoCompra[] = (await listarImpuestos(tx)).filter((i) => i.activo)
    .map(({ id, nombre, tipo, tasa, vigente_desde, vigente_hasta }) => ({ id, nombre, tipo, tasa, vigente_desde, vigente_hasta }));
  const vigenteHoy = (i: ImpuestoCompra) => i.vigente_desde <= hoy && (!i.vigente_hasta || i.vigente_hasta >= hoy);
  const porDefecto = impuestos.filter((i) => i.tipo === "itbis" && vigenteHoy(i)).sort((a, b) => Number(b.tasa) - Number(a.tasa))[0]
    ?? impuestos.find((i) => i.tipo === "exento");
  const [gasto] = await tx<{ cuenta_id: string }[]>`SELECT cuenta_id FROM cuentas_empresa WHERE clave = 'gasto_general'`;
  return {
    impuestos,
    impuestoPorDefecto: porDefecto?.id ?? "",
    cuentaPorDefecto: gasto?.cuenta_id ?? "",
    proveedores: await tx<ProveedorCompra[]>`
      SELECT id, nombre, rnc, tipo_identificacion, dias_credito, tipo_gasto, cuenta_gasto_id, del_exterior
        FROM proveedores WHERE activo ORDER BY nombre`,
    cuentas: await tx<CuentaCompra[]>`
      SELECT id, codigo, nombre FROM cuentas WHERE de_detalle AND activa AND tipo IN ('gasto', 'costo', 'activo') ORDER BY codigo`,
  };
}
