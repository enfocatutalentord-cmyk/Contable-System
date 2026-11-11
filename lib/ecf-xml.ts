// XML de los e-CF (entrega E2a) según los esquemas oficiales v1.0 de la DGII (e-CF 31, 32 y 34) y el documento «Formato
// Comprobante Fiscal Electrónico (e-CF) v1.0»: los elementos van en el orden del esquema, sin etiquetas vacías, sin espacios entre
// etiquetas (se firma sin preservarlos) y con los caracteres especiales escapados. Puro: no toca la base.

export class ErrorEcf extends Error {}

export type TipoEcf = "31" | "32" | "34";
export type ItemEcf = {
  nombre: string;
  indicador: 1 | 2 | 3 | 4; // 1 ITBIS 18 %, 2 ITBIS 16 %, 3 ITBIS 0 %, 4 exento
  bienServicio: 1 | 2;      // 1 bien, 2 servicio
  cantidad: bigint;         // × 10000, como en el sistema
  precio: bigint;           // centavos
  monto: bigint;            // centavos, sin impuestos
};
export type DatosEcf = {
  tipo: TipoEcf; encf: string; venceSecuencia: string | null; // AAAA-MM-DD
  tipoIngresos: string | null; tipoPago: 1 | 2 | 3; fechaLimitePago: string | null;
  emisor: { rnc: string; razonSocial: string; nombreComercial?: string | null; direccion: string; correo?: string | null };
  fechaEmision: string;
  comprador: { rnc: string; razonSocial: string } | null;
  items: ItemEcf[];
  referencia?: { ncf: string; fecha: string; codigo: 1 | 2 | 3 | 4 | 5; razon?: string | null; notaTardia: boolean } | null;
};
export type TotalesEcf = {
  gravado: [bigint, bigint, bigint]; exento: bigint; itbis: [bigint, bigint, bigint]; totalItbis: bigint; total: bigint;
  usados: [boolean, boolean, boolean]; conExento: boolean;
};

export const TASAS_ITBIS = [18n, 16n, 0n] as const;
// Las facturas de consumo menores de RD$250,000 no van completas a la DGII: se manda el resumen (RFCE, entrega E2b).
export const TOPE_CONSUMO = 25_000_000n;

// Montos: hasta 16 enteros y 2 decimales; fechas dd-MM-AAAA (formato del e-CF).
export const monto = (c: bigint) => {
  const s = (c < 0n ? -c : c).toString().padStart(3, "0");
  return `${c < 0n ? "-" : ""}${s.slice(0, -2)}.${s.slice(-2)}`;
};
export const fechaEcf = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
// Fecha y hora de firma en la hora de Santo Domingo (UTC−4, sin horario de verano): dd-MM-AAAA HH:mm:ss.
export function fechaHoraFirma(d: Date): string {
  const rd = new Date(d.getTime() - 4 * 3600_000).toISOString();
  return `${rd.slice(8, 10)}-${rd.slice(5, 7)}-${rd.slice(0, 4)} ${rd.slice(11, 19)}`;
}

function cantidad(c: bigint): string {
  if (c <= 0n) throw new ErrorEcf("La cantidad debe ser mayor que cero");
  if (c % 100n !== 0n) throw new ErrorEcf("El e-CF admite cantidades con hasta 2 decimales");
  return monto(c / 100n);
}

// Caracteres que la DGII pide escapar (Descripción Técnica Servicios Emisores); ©, € y ® con su referencia numérica.
export function escapar(t: string): string {
  return t.replace(/[&<>"'©€®]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;", "©": "&#169;", "€": "&#8364;", "®": "&#174;" })[c]!);
}
// Texto limpio y cortado al largo máximo del esquema (sin saltos de línea ni espacios de más).
const texto = (t: string, max: number) => t.replace(/\s+/g, " ").trim().slice(0, max);

// Una etiqueta con valor; sin valor no se escribe (el esquema rechaza etiquetas vacías).
const e = (nombre: string, valor: string | number | null | undefined) =>
  valor === null || valor === undefined || valor === "" ? "" : `<${nombre}>${typeof valor === "string" ? escapar(valor) : valor}</${nombre}>`;
const bloque = (nombre: string, contenido: string) => (contenido ? `<${nombre}>${contenido}</${nombre}>` : "");

export function calcularTotales(items: ItemEcf[]): TotalesEcf {
  const gravado: [bigint, bigint, bigint] = [0n, 0n, 0n];
  const usados: [boolean, boolean, boolean] = [false, false, false];
  let exento = 0n, conExento = false;
  for (const i of items) {
    if (i.indicador === 4) { exento += i.monto; conExento = true; }
    else { gravado[i.indicador - 1] += i.monto; usados[i.indicador - 1] = true; }
  }
  // ITBIS sobre el monto gravado de cada tasa (Formato e-CF, casillas 101 a 103), redondeado a centavos.
  const itbis = gravado.map((g, k) => (g * TASAS_ITBIS[k] * 2n + 100n) / 200n) as [bigint, bigint, bigint];
  const totalItbis = itbis[0] + itbis[1] + itbis[2];
  return { gravado, exento, itbis, totalItbis, total: gravado[0] + gravado[1] + gravado[2] + exento + totalItbis, usados, conExento };
}

// Revisa lo que el esquema y el formato exigen antes de firmar.
export function revisarEcf(d: DatosEcf): string[] {
  const errores: string[] = [];
  if (!new RegExp(`^E${d.tipo}\\d{10}$`).test(d.encf)) errores.push(`El e-NCF ${d.encf} no corresponde a un E${d.tipo}`);
  if (!/^(\d{9}|\d{11})$/.test(d.emisor.rnc)) errores.push("El RNC de la empresa debe tener 9 u 11 dígitos");
  if (!d.emisor.razonSocial.trim()) errores.push("Falta la razón social de la empresa");
  if (!d.emisor.direccion.trim()) errores.push("Falta la dirección de la empresa en su ficha: el e-CF la exige");
  if (d.tipo === "31" && !d.venceSecuencia) errores.push("Falta la fecha de vencimiento de la secuencia E31");
  if (d.tipo === "31" && !d.comprador) errores.push("Un E31 necesita el RNC o la cédula del comprador");
  // E32 de RD$250,000 o más: el formato exige RNC y nombre del comprador (los menores van con el RFCE, entrega E2b).
  if (d.tipo === "32" && !d.comprador) errores.push("Una factura de consumo de RD$250,000 o más necesita el RNC o la cédula y el nombre del comprador");
  if (d.comprador && !/^(\d{9}|\d{11})$/.test(d.comprador.rnc)) errores.push("El RNC o la cédula del comprador debe tener 9 u 11 dígitos");
  if (d.tipo === "34" && !d.referencia) errores.push("La nota E34 necesita la factura que modifica");
  if (d.tipoPago === 2 && !d.fechaLimitePago) errores.push("Una venta a crédito necesita la fecha límite de pago");
  if (d.tipoPago === 2 && d.fechaLimitePago && d.fechaLimitePago < d.fechaEmision) errores.push("La fecha límite de pago no puede ser antes de la fecha de emisión");
  if (!d.items.length) errores.push("El e-CF necesita al menos una línea");
  if (d.items.length > 1000) errores.push("El e-CF admite hasta 1,000 líneas");
  const t = calcularTotales(d.items);
  if (d.tipo === "32" && t.total < TOPE_CONSUMO) errores.push("Las facturas de consumo menores de RD$250,000 van con el resumen (RFCE), que llega en la entrega E2b");
  return errores;
}

// El XML del e-CF, sin firmar, con la fecha y hora de firma.
export function armarXml(d: DatosEcf, firma: string): string {
  const errores = revisarEcf(d);
  if (errores.length) throw new ErrorEcf(errores.join(". "));
  const t = calcularTotales(d.items);
  const nota = d.tipo === "34";
  const conItbis = t.usados.some(Boolean);

  const idDoc =
    e("TipoeCF", d.tipo) + e("eNCF", d.encf) +
    (nota ? e("IndicadorNotaCredito", d.referencia!.notaTardia ? 1 : 0) : "") +
    (d.tipo === "31" ? e("FechaVencimientoSecuencia", fechaEcf(d.venceSecuencia!)) : "") +
    (conItbis ? e("IndicadorMontoGravado", 0) : "") +
    e("TipoIngresos", d.tipoIngresos) +
    e("TipoPago", d.tipoPago) +
    (d.tipoPago === 2 ? e("FechaLimitePago", fechaEcf(d.fechaLimitePago!)) : "");
  const emisor =
    e("RNCEmisor", d.emisor.rnc) + e("RazonSocialEmisor", texto(d.emisor.razonSocial, 150)) +
    e("NombreComercial", d.emisor.nombreComercial ? texto(d.emisor.nombreComercial, 150) : null) +
    e("DireccionEmisor", texto(d.emisor.direccion, 100)) +
    e("CorreoEmisor", d.emisor.correo && /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/.test(d.emisor.correo) && d.emisor.correo.length <= 80 ? d.emisor.correo : null) +
    e("FechaEmision", fechaEcf(d.fechaEmision));
  const comprador = d.comprador ? e("RNCComprador", d.comprador.rnc) + e("RazonSocialComprador", texto(d.comprador.razonSocial, 150)) : "";
  const totales =
    (conItbis ? e("MontoGravadoTotal", monto(t.gravado[0] + t.gravado[1] + t.gravado[2])) : "") +
    t.gravado.map((g, k) => (t.usados[k] ? e(`MontoGravadoI${k + 1}`, monto(g)) : "")).join("") +
    (t.conExento ? e("MontoExento", monto(t.exento)) : "") +
    TASAS_ITBIS.map((x, k) => (t.usados[k] ? e(`ITBIS${k + 1}`, Number(x)) : "")).join("") +
    (conItbis ? e("TotalITBIS", monto(t.totalItbis)) : "") +
    t.itbis.map((x, k) => (t.usados[k] ? e(`TotalITBIS${k + 1}`, monto(x)) : "")).join("") +
    e("MontoTotal", monto(t.total));
  const items = d.items.map((i, n) => bloque("Item",
    e("NumeroLinea", n + 1) + e("IndicadorFacturacion", i.indicador) + e("NombreItem", texto(i.nombre, 80) || "Servicio") +
    e("IndicadorBienoServicio", i.bienServicio) + e("CantidadItem", cantidad(i.cantidad)) + e("PrecioUnitarioItem", monto(i.precio)) +
    e("MontoItem", monto(i.monto)))).join("");
  const referencia = d.referencia
    ? bloque("InformacionReferencia",
      e("NCFModificado", d.referencia.ncf) + e("FechaNCFModificado", fechaEcf(d.referencia.fecha)) +
      e("CodigoModificacion", d.referencia.codigo) + e("RazonModificacion", d.referencia.razon ? texto(d.referencia.razon, 90) : null))
    : "";

  return `<?xml version="1.0" encoding="utf-8"?><ECF>` +
    bloque("Encabezado", e("Version", "1.0") + bloque("IdDoc", idDoc) + bloque("Emisor", emisor) + bloque("Comprador", comprador) + bloque("Totales", totales)) +
    bloque("DetallesItems", items) + referencia + e("FechaHoraFirma", firma) + `</ECF>`;
}

// Nombre del archivo: RNC del emisor + e-NCF (Descripción Técnica Servicios Emisores).
export const nombreArchivo = (rnc: string, encf: string) => `${rnc}${encf}.xml`;

// Enlace del QR (Informe Técnico e-CF v1.0): consulta del timbre con los datos del comprobante y el código de seguridad.
export function enlaceQr(p: { ambiente: string; rncEmisor: string; rncComprador: string | null; encf: string; fechaEmision: string; total: bigint; fechaFirma: string; codigo: string }): string {
  const q = new URLSearchParams({ RncEmisor: p.rncEmisor });
  if (p.rncComprador) q.set("RncComprador", p.rncComprador);
  q.set("ENCF", p.encf); q.set("FechaEmision", fechaEcf(p.fechaEmision)); q.set("MontoTotal", monto(p.total));
  q.set("FechaFirma", p.fechaFirma); q.set("CodigoSeguridad", p.codigo);
  return `https://ecf.dgii.gov.do/${p.ambiente}/ConsultaTimbre?${q.toString().replace(/\+/g, "%20")}`;
}
