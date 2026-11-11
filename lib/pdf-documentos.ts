import type { Tx } from "./db";
import { type Celda, type Columna, type Tabla } from "./exportar.ts";
import { listarImpuestos } from "./fiscal.ts";
import { deCentavos, verFecha } from "./montos.ts";
import { aLinea, lineasDe, montoAnticipo, totalesPropuesta } from "./propuestas.ts";
import { NOMBRE_NCF, type TipoNcf } from "./ventas.ts";

// PDF de una factura y de una propuesta, para descargarlos desde Exportar y desde el enlace seguro de WhatsApp (bloque 3c).
// Se corren dentro de conEmpresa: solo ven lo de esa empresa.

type Base = { empresa: string; generado: string };
const col = (titulo: string, num = false, ancho?: number): Columna => ({ titulo, num, ancho });
const enUnaLinea = (x: string) => x.split(/\s+/).join(" ");

export async function tablaPropuesta(tx: Tx, id: string, base: Base): Promise<[string, Tabla] | null> {
  const [p] = await tx<{ numero: number; cliente: string; rnc: string | null; fecha: string; valida_hasta: string; requisitos: string | null;
    anticipo_pct: string; forma_pago: string | null; entrega: string | null; notas: string | null }[]>`
    SELECT p.numero, c.nombre AS cliente, c.rnc, to_char(p.fecha, 'YYYY-MM-DD') AS fecha, to_char(p.valida_hasta, 'YYYY-MM-DD') AS valida_hasta,
           p.requisitos, p.anticipo_pct::text, p.forma_pago, to_char(p.entrega, 'YYYY-MM-DD') AS entrega, p.notas
      FROM propuestas p JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ${id}`;
  if (!p) return null;
  const lineas = await lineasDe(tx, id);
  const impuestos = new Map((await listarImpuestos(tx)).map((i) => [i.id, i]));
  const t = totalesPropuesta(lineas.map(aLinea), impuestos);
  const anticipo = montoAnticipo(t.total, p.anticipo_pct);
  const filas: Celda[][] = lineas.map((l) => {
    const x = aLinea(l);
    return [l.descripcion, Number(l.cantidad), l.precio_lista, l.descuento, deCentavos(x.precioLista - x.descuento)];
  });
  const negritas = [filas.length, filas.length + 1];
  filas.push(["Impuestos", "", "", "", deCentavos(t.impuestos)], ["Total", "", "", "", deCentavos(t.total)]);
  const detalle = [
    `Para ${p.cliente}${p.rnc ? ` (RNC ${p.rnc})` : ""}`, `fecha ${verFecha(p.fecha)}`, `válida hasta ${verFecha(p.valida_hasta)}`,
    `anticipo ${Number(p.anticipo_pct)} % (RD$${deCentavos(anticipo)})`, p.forma_pago ? `forma de pago: ${p.forma_pago}` : "",
    p.entrega ? `entrega estimada ${verFecha(p.entrega)}` : "", p.requisitos ? `requisitos: ${enUnaLinea(p.requisitos)}` : "",
    p.notas ? enUnaLinea(p.notas) : "",
  ].filter(Boolean).join(" · ");
  return [`propuesta-${p.numero}`, {
    ...base, titulo: `Propuesta de servicios n.º ${p.numero}`, detalle, negritas,
    columnas: [col("Servicio", false, 46), col("Cantidad", true), col("Precio de lista", true), col("Descuento", true), col("Precio final", true)],
    filas, totales: ["Subtotal", "", deCentavos(t.lista), deCentavos(t.descuento), deCentavos(t.subtotal)],
  }];
}

// Factura emitida con sus líneas, impuestos, lo cobrado y el saldo pendiente (sirve de estado de cuenta de esa factura).
export async function tablaFactura(tx: Tx, id: string, base: Base): Promise<[string, Tabla] | null> {
  const [f] = await tx<{ ncf: string | null; tipo_ncf: TipoNcf; fecha: string; vence: string; moneda: string; subtotal: string; itbis: string;
    otros_impuestos: string; total: string; saldo: string | null; anulada: boolean; estado: string; cliente: string; rnc: string | null; notas: string | null }[]>`
    SELECT f.ncf, f.tipo_ncf, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, to_char(f.vence, 'YYYY-MM-DD') AS vence, f.moneda, f.subtotal::text,
           f.itbis::text, f.otros_impuestos::text, f.total::text, s.saldo::text, f.anulada, f.estado, c.nombre AS cliente, c.rnc, f.notas
      FROM facturas f JOIN clientes c ON c.id = f.cliente_id LEFT JOIN saldos_factura s ON s.factura_id = f.id
     WHERE f.id = ${id}`;
  if (!f || f.estado !== "emitida") return null;
  const lineas = await tx<{ descripcion: string; cantidad: string; precio: string; subtotal: string }[]>`
    SELECT descripcion, cantidad::text, precio::text, subtotal::text FROM lineas_factura WHERE factura_id = ${id} ORDER BY orden`;
  const simbolo = f.moneda === "USD" ? "US$" : "RD$";
  const filas: Celda[][] = lineas.map((l) => [l.descripcion, Number(l.cantidad), l.precio, l.subtotal]);
  const desde = filas.length;
  filas.push(["ITBIS", "", "", f.itbis]);
  if (Number(f.otros_impuestos)) filas.push(["Otros impuestos", "", "", f.otros_impuestos]);
  filas.push([`Total ${simbolo}`, "", "", f.total]);
  if (!f.anulada) filas.push([`Saldo pendiente ${simbolo}`, "", "", f.saldo ?? "0.00"]);
  const titulo = f.tipo_ncf === "B04" || f.tipo_ncf === "E34" ? `Nota de crédito${f.tipo_ncf === "E34" ? " electrónica" : ""}` : `Factura de ${NOMBRE_NCF[f.tipo_ncf].toLowerCase()}`;
  return [`factura-${f.ncf ?? id.slice(0, 8)}`, {
    ...base, titulo: `${titulo}${f.anulada ? " (ANULADA)" : ""}`,
    detalle: [`NCF ${f.ncf}`, `Cliente ${f.cliente}${f.rnc ? ` (RNC ${f.rnc})` : ""}`, `fecha ${verFecha(f.fecha)}`, `vence ${verFecha(f.vence)}`,
              f.notas ? enUnaLinea(f.notas) : ""].filter(Boolean).join(" · "),
    columnas: [col("Descripción", false, 50), col("Cantidad", true), col("Precio", true), col("Importe", true)],
    filas, negritas: filas.map((_, i) => i).filter((i) => i >= desde),
  }];
}
