import { ErrorContable } from "./asientos.ts";
import { guardarBorradorCompra, TIPOS_GASTO, type TipoCompra } from "./compras.ts";
import type { Tx } from "./db";
import { huella, nombreSeguro } from "./documentos.ts";
import { listarImpuestos } from "./fiscal.ts";
import { aCentavos, deCentavos } from "./montos.ts";
import { leerNcf, revisarFactura, TIPOS_NCF, type DatosQr, type Marca } from "./validar-fiscal.ts";
import { guardarBorradorFactura, TIPOS_FACTURA, type TipoFactura } from "./ventas.ts";

// Bloque 8, entrega 8b: facturas de ingresos y de gastos que el cliente sube desde la aplicación (documento «Sistema Empire ·
// Fase 2», sección 3). Recibida → aprobada (pasa a borrador de compra o de venta), rechazada (la sube de nuevo) o desestimada.

export const ESTADOS_SUBIDA: Record<string, string> = { recibida: "Recibida, en revisión", rechazada: "Rechazada", aprobada: "Aprobada", desestimada: "Desestimada" };
export const FORMAS_SUBIDA: Record<string, string> = { foto: "Foto", pdf: "PDF", qr: "Código QR", manual: "Escrita a mano" };
// Compras que se pueden registrar con lo que trae una factura del proveedor (las propias B11/B13/B17 las emite la empresa).
const COMPRA_DEL_PROVEEDOR = ["B01", "B02", "B14", "B15", "E31", "E32", "E44", "E45"];

export type DatosSubida = {
  tipo: "gasto" | "ingreso"; rncContraparte: string | null; nombreContraparte: string | null; ncf: string | null; fecha: string | null;
  subtotal: bigint | null; itbis: bigint | null; total: bigint | null; qr: DatosQr | null;
};

// ¿Ya existe ese NCF? Entre las subidas vigentes y, si es un gasto, entre las compras de ese proveedor; si es un ingreso, entre
// las facturas de la empresa.
export async function ncfRepetido(tx: Tx, d: { tipo: "gasto" | "ingreso"; rnc: string | null; ncf: string | null; excepto?: string | null }): Promise<boolean> {
  if (!d.ncf) return false;
  const [s] = await tx`SELECT 1 FROM facturas_subidas WHERE tipo = ${d.tipo} AND ncf = ${d.ncf} AND rnc_contraparte IS NOT DISTINCT FROM ${d.rnc}
                         AND estado IN ('recibida', 'aprobada') AND id IS DISTINCT FROM ${d.excepto ?? null}::uuid`;
  if (s) return true;
  if (d.tipo === "gasto") {
    const [c] = await tx`SELECT 1 FROM compras c JOIN proveedores p ON p.id = c.proveedor_id WHERE c.ncf = ${d.ncf} AND NOT c.anulada AND p.rnc IS NOT DISTINCT FROM ${d.rnc}`;
    return !!c;
  }
  const [f] = await tx`SELECT 1 FROM facturas WHERE (ncf = ${d.ncf} OR ncf_externo = ${d.ncf}) AND NOT anulada`;
  return !!f;
}

export async function revisarSubida(tx: Tx, empresaId: string, d: DatosSubida, excepto: string | null = null) {
  const [{ rnc }] = await tx<{ rnc: string | null }[]>`SELECT rnc FROM empresas WHERE id = ${empresaId}`;
  const repetida = await ncfRepetido(tx, { tipo: d.tipo, rnc: d.rncContraparte, ncf: d.ncf, excepto });
  return revisarFactura({ ...d, rncEmpresa: rnc, repetida });
}

export async function subirFactura(tx: Tx, d: DatosSubida & {
  empresaId: string; usuarioId: string; archivo: { nombre: string; tipo: string; bytes: Uint8Array } | null;
}): Promise<{ id: string; numero: number; marcas: Marca[] }> {
  if (!d.archivo && !d.qr && !(d.ncf && d.total !== null)) throw new ErrorContable("Sube la foto o el PDF, escanea el QR o escribe al menos el NCF y el total.");
  if (d.archivo) {
    const [igual] = await tx`SELECT 1 FROM documentos d JOIN facturas_subidas f ON f.id = d.entidad_id
                              WHERE d.entidad = 'factura_subida' AND d.sha256 = ${huella(d.archivo.bytes)} AND NOT d.eliminado
                                AND f.estado IN ('recibida', 'aprobada')`;
    if (igual) throw new ErrorContable("Ese mismo archivo ya se subió.");
  }
  const { marcas, sinCredito } = await revisarSubida(tx, d.empresaId, d);
  await tx`SELECT 1 FROM empresas WHERE id = ${d.empresaId} FOR UPDATE`;
  const [{ numero }] = await tx<{ numero: number }[]>`SELECT COALESCE(max(numero), 0) + 1 AS numero FROM facturas_subidas`;
  const forma = d.qr ? "qr" : d.archivo ? (d.archivo.tipo === "application/pdf" ? "pdf" : "foto") : "manual";
  const c = (v: bigint | null) => (v === null ? null : deCentavos(v));
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO facturas_subidas (empresa_id, numero, tipo, forma, rnc_contraparte, nombre_contraparte, ncf, fecha, subtotal, itbis, total, qr_url,
                                  marcas, sin_credito, subido_por)
    VALUES (${d.empresaId}, ${numero}, ${d.tipo}, ${forma}, ${d.rncContraparte}, ${d.nombreContraparte}, ${d.ncf}, ${d.fecha}, ${c(d.subtotal)},
            ${c(d.itbis)}, ${c(d.total)}, ${d.qr?.url ?? null}, ${tx.json(marcas as never)}, ${sinCredito}, ${d.usuarioId})
    RETURNING id`;
  if (d.archivo) {
    await tx`INSERT INTO documentos (empresa_id, entidad, entidad_id, nombre, tipo, tamano, sha256, contenido, subido_por)
             VALUES (${d.empresaId}, 'factura_subida', ${id}, ${nombreSeguro(d.archivo.nombre)}, ${d.archivo.tipo}, ${d.archivo.bytes.length},
                     ${huella(d.archivo.bytes)}, ${Buffer.from(d.archivo.bytes)}, ${d.usuarioId})`;
  }
  return { id, numero, marcas };
}

// Contador del mes: lo subido y lo aprobado, por tipo (pantalla de inicio del cliente y reporte mensual).
export async function contadorMes(tx: Tx, mes: string) {
  const [r] = await tx<{ gastos: number; ingresos: number; gastos_ok: number; ingresos_ok: number; revision: number }[]>`
    SELECT count(*) FILTER (WHERE tipo = 'gasto')::int AS gastos, count(*) FILTER (WHERE tipo = 'ingreso')::int AS ingresos,
           count(*) FILTER (WHERE tipo = 'gasto' AND estado = 'aprobada')::int AS gastos_ok,
           count(*) FILTER (WHERE tipo = 'ingreso' AND estado = 'aprobada')::int AS ingresos_ok,
           count(*) FILTER (WHERE estado = 'recibida')::int AS revision
      FROM facturas_subidas WHERE to_char(subido_en AT TIME ZONE 'America/Santo_Domingo', 'YYYY-MM') = ${mes} AND estado <> 'desestimada'`;
  return r;
}

export type Subida = {
  id: string; numero: number; tipo: "gasto" | "ingreso"; forma: string; rnc_contraparte: string | null; nombre_contraparte: string | null; ncf: string | null;
  fecha: string | null; subtotal: string | null; itbis: string | null; total: string | null; qr_url: string | null; marcas: Marca[]; sin_credito: boolean;
  estado: string; motivo: string | null; compra_id: string | null; factura_id: string | null; subido_en: Date; subido_por: string | null; revisado_por: string | null;
  documento: string | null;
};

export const listarSubidas = (tx: Tx, estado: string | null) => tx<Subida[]>`
  SELECT f.id, f.numero, f.tipo, f.forma, f.rnc_contraparte, f.nombre_contraparte, f.ncf, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, f.subtotal::text,
         f.itbis::text, f.total::text, f.qr_url, f.marcas, f.sin_credito, f.estado, f.motivo, f.compra_id, f.factura_id, f.subido_en,
         us.nombre AS subido_por, ur.nombre AS revisado_por,
         (SELECT d.id FROM documentos d WHERE d.entidad = 'factura_subida' AND d.entidad_id = f.id AND NOT d.eliminado LIMIT 1) AS documento
    FROM facturas_subidas f LEFT JOIN usuarios us ON us.id = f.subido_por LEFT JOIN usuarios ur ON ur.id = f.revisado_por
   WHERE (${estado}::text IS NULL OR f.estado = ${estado})
   ORDER BY f.estado <> 'recibida', f.subido_en DESC
   LIMIT 300`;

export async function rechazarSubida(tx: Tx, id: string, usuarioId: string, estado: "rechazada" | "desestimada", motivo: string) {
  if (motivo.trim().length < 3) throw new ErrorContable("Escribe el motivo: el cliente lo ve.");
  const r = await tx`UPDATE facturas_subidas SET estado = ${estado}, motivo = ${motivo.trim().slice(0, 500)}, revisado_por = ${usuarioId}, revisado_en = now()
                      WHERE id = ${id} AND estado = 'recibida'`;
  if (!r.count) throw new ErrorContable("Esa factura ya se revisó.");
}

// El ITBIS de la línea: el 18 % vigente si la factura trae ITBIS; si no, exento.
async function impuestoDeLinea(tx: Tx, fecha: string, conItbis: boolean): Promise<string> {
  const vigentes = await listarImpuestos(tx, fecha);
  const i = conItbis ? vigentes.find((x) => x.tipo === "itbis" && Number(x.tasa) === 18) : vigentes.find((x) => x.tipo === "exento");
  if (!i) throw new ErrorContable(conItbis ? "No hay ITBIS del 18 % vigente en Tasas de impuestos." : "No hay un impuesto «exento» vigente en Tasas de impuestos.");
  return i.id;
}

// Aprobar: con los datos ya revisados, el gasto pasa a borrador de compra y el ingreso a borrador de venta con el NCF del cliente.
// El archivo queda copiado como soporte del borrador. Quien revisa completa o corrige los datos antes.
export async function aprobarSubida(tx: Tx, d: {
  empresaId: string; usuarioId: string; id: string; rnc: string | null; nombre: string | null; ncf: string; fecha: string; subtotal: bigint; itbis: bigint;
  tipoGasto: string; clase: "bien" | "servicio";
}): Promise<{ compraId: string | null; facturaId: string | null }> {
  const [s] = await tx<{ tipo: "gasto" | "ingreso"; estado: string; numero: number }[]>`SELECT tipo, estado, numero FROM facturas_subidas WHERE id = ${d.id} FOR UPDATE`;
  if (!s) throw new ErrorContable("La factura no existe");
  if (s.estado !== "recibida") throw new ErrorContable("Esa factura ya se revisó.");
  const n = leerNcf(d.ncf);
  if (!n) throw new ErrorContable("El NCF no es válido (B y 10 dígitos, o E y 12).");
  if (d.subtotal + d.itbis <= 0n) throw new ErrorContable("Escribe los montos.");
  if (await ncfRepetido(tx, { tipo: s.tipo, rnc: d.rnc, ncf: n.ncf, excepto: d.id })) throw new ErrorContable(`El NCF ${n.ncf} ya está registrado.`);
  const nota = `Subida por el cliente en la aplicación (n.º ${s.numero}).`;
  const impuesto = await impuestoDeLinea(tx, d.fecha, d.itbis > 0n);
  let compraId: string | null = null, facturaId: string | null = null;

  if (s.tipo === "gasto") {
    if (!COMPRA_DEL_PROVEEDOR.includes(n.tipo)) throw new ErrorContable(`Un ${n.tipo} (${TIPOS_NCF[n.tipo]}) no se registra como compra desde aquí; regístralo en Compras.`);
    if (!d.rnc) throw new ErrorContable("Escribe el RNC o la cédula del proveedor.");
    if (!TIPOS_GASTO[d.tipoGasto]) throw new ErrorContable("Elige el tipo de gasto del 606.");
    let [p] = await tx<{ id: string }[]>`SELECT id FROM proveedores WHERE rnc = ${d.rnc} AND activo ORDER BY creado LIMIT 1`;
    if (!p) {
      [p] = await tx<{ id: string }[]>`
        INSERT INTO proveedores (empresa_id, nombre, rnc, tipo_identificacion, tipo_gasto)
        VALUES (${d.empresaId}, ${d.nombre || `Proveedor ${d.rnc}`}, ${d.rnc}, ${d.rnc.length === 9 ? "rnc" : "cedula"}, ${d.tipoGasto}) RETURNING id`;
    }
    compraId = await guardarBorradorCompra(tx, {
      empresaId: d.empresaId, usuarioId: d.usuarioId, proveedorId: p.id, tipo: n.tipo as TipoCompra, ncf: n.ncf, fecha: d.fecha, vence: d.fecha,
      moneda: "DOP", tasa: 10000n, tipoGasto: d.tipoGasto, itbisAlCosto: false, notas: nota,
      lineas: [{ descripcion: `Factura ${n.ncf}`, clase: d.clase, cantidad: 10000n, precio: d.subtotal, cuentaId: null, impuestoIds: [impuesto] }],
    });
  } else {
    if (!(TIPOS_FACTURA as readonly string[]).includes(n.tipo)) throw new ErrorContable(`Un ${n.tipo} no se registra como venta desde aquí (las electrónicas, a mano en Facturas).`);
    const tipo = n.tipo as TipoFactura;
    let cliente: { id: string } | undefined;
    if (d.rnc) [cliente] = await tx<{ id: string }[]>`SELECT id FROM clientes WHERE rnc = ${d.rnc} AND activo ORDER BY creado LIMIT 1`;
    else [cliente] = await tx<{ id: string }[]>`SELECT id FROM clientes WHERE rnc IS NULL AND lower(nombre) = 'consumidor final' AND activo LIMIT 1`;
    if (!cliente) {
      if (!d.rnc && tipo !== "B02") throw new ErrorContable(`Para un ${tipo} escribe el RNC o la cédula del cliente.`);
      [cliente] = await tx<{ id: string }[]>`
        INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion, ncf_predeterminado)
        VALUES (${d.empresaId}, ${d.rnc ? d.nombre || `Cliente ${d.rnc}` : "Consumidor final"}, ${d.rnc}, ${d.rnc ? (d.rnc.length === 9 ? "rnc" : "cedula") : null}, ${tipo})
        RETURNING id`;
    }
    facturaId = await guardarBorradorFactura(tx, {
      empresaId: d.empresaId, usuarioId: d.usuarioId, clienteId: cliente.id, tipo, fecha: d.fecha, vence: d.fecha, moneda: "DOP", tasa: 10000n,
      notas: `${nota} Factura hecha fuera del sistema: al emitirla conserva su NCF.`,
      lineas: [{ servicioId: null, descripcion: `Venta según factura ${n.ncf}`, cantidad: 10000n, precio: d.subtotal, impuestoIds: [impuesto] }],
    });
    await tx`UPDATE facturas SET ncf_externo = ${n.ncf} WHERE id = ${facturaId}`;
  }
  // El archivo, copiado como soporte del borrador.
  await tx`INSERT INTO documentos (empresa_id, entidad, entidad_id, nombre, tipo, tamano, sha256, contenido, subido_por)
           SELECT empresa_id, ${compraId ? "compra" : "factura"}, ${compraId ?? facturaId}, nombre, tipo, tamano, sha256, contenido, subido_por
             FROM documentos WHERE entidad = 'factura_subida' AND entidad_id = ${d.id} AND NOT eliminado`;
  await tx`UPDATE facturas_subidas SET estado = 'aprobada', revisado_por = ${d.usuarioId}, revisado_en = now(), compra_id = ${compraId}, factura_id = ${facturaId},
                                       rnc_contraparte = ${d.rnc}, nombre_contraparte = ${d.nombre}, ncf = ${n.ncf}, fecha = ${d.fecha},
                                       subtotal = ${deCentavos(d.subtotal)}, itbis = ${deCentavos(d.itbis)}, total = ${deCentavos(d.subtotal + d.itbis)}
            WHERE id = ${d.id}`;
  return { compraId, facturaId };
}

export const montoOpcional = (v: string | null) => (v ? aCentavos(v) : null);
