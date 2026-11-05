import type { Tx } from "@/lib/db";
import { listarUnidades } from "@/lib/empresa-propia";
import { listarImpuestos } from "@/lib/fiscal";
import { preciosVigentes } from "@/lib/precios";
import type { ClienteFactura, ImpuestoFactura, ServicioFactura } from "./nueva/formulario-factura";

// Lo que necesita el formulario de factura (nueva o edición de un borrador).
export async function datosFormulario(tx: Tx, hoy: string) {
  const [empresa] = await tx<{ contribuye_itbis: boolean }[]>`SELECT contribuye_itbis FROM empresas WHERE id = empresa_actual()`;
  const impuestos: ImpuestoFactura[] = (await listarImpuestos(tx)).filter((i) => i.activo)
    .map(({ id, nombre, tipo, tasa, vigente_desde, vigente_hasta }) => ({ id, nombre, tipo, tasa, vigente_desde, vigente_hasta }));
  const vigenteHoy = (i: ImpuestoFactura) => i.vigente_desde <= hoy && (!i.vigente_hasta || i.vigente_hasta >= hoy);
  // Por defecto: el ITBIS de mayor tasa si la empresa cobra ITBIS; si no, exento.
  const porDefecto = empresa.contribuye_itbis
    ? impuestos.filter((i) => i.tipo === "itbis" && vigenteHoy(i)).sort((a, b) => Number(b.tasa) - Number(a.tasa))[0]
    : impuestos.find((i) => i.tipo === "exento" && vigenteHoy(i));
  return {
    unidades: (await listarUnidades(tx)).map(({ id, nombre }) => ({ id, nombre })),
    impuestos,
    impuestoPorDefecto: porDefecto?.id ?? impuestos.find((i) => i.tipo === "exento")?.id ?? "",
    clientes: await tx<ClienteFactura[]>`
      SELECT id, nombre, rnc, dias_credito, ncf_predeterminado, tipo_ingreso, categoria FROM clientes WHERE activo ORDER BY nombre`,
    // Cada servicio con sus precios por categoría vigentes hoy (lista de precios) y su unidad de negocio.
    servicios: await (async () => {
      const precios = await preciosVigentes(tx, hoy);
      const filas = await tx<Omit<ServicioFactura, "precios">[]>`
        SELECT id, nombre, precio::text, impuesto_id, impuesto_adicional_id, unidad_id FROM servicios WHERE activo ORDER BY nombre`;
      return filas.map((s) => ({ ...s, precios: precios.get(s.id) ?? {} }));
    })(),
    disponibles: Object.fromEntries((await tx<{ tipo: string; n: number }[]>`
      SELECT tipo, sum(hasta - siguiente + 1)::int AS n FROM secuencias_ncf
       WHERE activa AND siguiente <= hasta AND vence >= ${hoy} GROUP BY tipo`).map((r) => [r.tipo, r.n])) as Record<string, number>,
  };
}
