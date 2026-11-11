// Emisión propia de e-CF (entrega E2a): certificado guardado cifrado, e-CF armado desde una factura del sistema, firmado y
// guardado, y prueba de conexión con la DGII. En esta entrega el XML es de prueba: no toma número del rango ni emite la factura.
import { bitacora, ErrorContable } from "./asientos.ts";
import { leerP12, vigente, type Certificado } from "./ecf-certificado.ts";
import { cifrar, descifrar } from "./ecf-cifrado.ts";
import { esAmbiente, obtenerToken, type Ambiente, type Opciones } from "./ecf-dgii.ts";
import { codigoSeguridad, firmaValida, firmarXml } from "./ecf-firma.ts";
import { armarXml, calcularTotales, ErrorEcf, fechaHoraFirma, monto, type DatosEcf, type ItemEcf, type TipoEcf } from "./ecf-xml.ts";
import type { Tx } from "./db";
import { aCentavos } from "./montos.ts";

export const CERT_MAXIMO = 100 * 1024; // un .p12 pesa unos pocos KB

export type CertificadoGuardado = { id: string; titular: string; identificacion: string | null; emisor: string | null; valido_desde: string; vence: string; subido_en: Date; subido_por: string | null };

export async function certificadoActivo(tx: Tx): Promise<CertificadoGuardado | null> {
  const [c] = await tx<CertificadoGuardado[]>`
    SELECT c.id, c.titular, c.identificacion, c.emisor, to_char(c.valido_desde, 'YYYY-MM-DD') AS valido_desde, to_char(c.vence, 'YYYY-MM-DD') AS vence,
           c.subido_en, u.nombre AS subido_por
      FROM certificados_ecf c LEFT JOIN usuarios u ON u.id = c.subido_por WHERE c.activo`;
  return c ?? null;
}

// Sube el .p12: se abre con su contraseña para comprobarlo y se guardan ambos cifrados. Reemplaza al anterior.
export async function guardarCertificado(tx: Tx, d: { empresaId: string; usuarioId: string; bytes: Uint8Array; clave: string; hoy: string }): Promise<Certificado> {
  if (!d.bytes.length) throw new ErrorContable("Elige el archivo .p12 del certificado");
  if (d.bytes.length > CERT_MAXIMO) throw new ErrorContable("El archivo es demasiado grande para ser un certificado .p12");
  const c = leerP12(d.bytes, d.clave);
  if (!vigente(c, d.hoy)) throw new ErrorContable(`El certificado no está vigente (válido del ${c.desde} al ${c.vence})`);
  await tx`UPDATE certificados_ecf SET activo = false, retirado_por = ${d.usuarioId}, retirado_en = now() WHERE activo`;
  await tx`
    INSERT INTO certificados_ecf (empresa_id, archivo, clave, titular, identificacion, emisor, valido_desde, vence, subido_por)
    VALUES (${d.empresaId}, ${cifrar(d.bytes)}, ${cifrar(Buffer.from(d.clave, "utf8"))}, ${c.titular}, ${c.identificacion}, ${c.emisor},
            ${c.desde}, ${c.vence}, ${d.usuarioId})`;
  await bitacora(tx, d.empresaId, d.usuarioId, "certificado_ecf_guardado", { titular: c.titular, vence: c.vence });
  return c;
}

export async function retirarCertificado(tx: Tx, d: { empresaId: string; usuarioId: string }) {
  const r = await tx`UPDATE certificados_ecf SET activo = false, retirado_por = ${d.usuarioId}, retirado_en = now() WHERE activo`;
  if (!r.count) throw new ErrorContable("No hay certificado guardado");
  await bitacora(tx, d.empresaId, d.usuarioId, "certificado_ecf_retirado", {});
}

export async function abrirCertificado(tx: Tx): Promise<Certificado> {
  const [c] = await tx<{ archivo: Buffer; clave: Buffer }[]>`SELECT archivo, clave FROM certificados_ecf WHERE activo`;
  if (!c) throw new ErrorContable("Sube primero el certificado en Perfil fiscal › Factura electrónica");
  return leerP12(descifrar(c.archivo), descifrar(c.clave).toString("utf8"));
}

export async function guardarAmbiente(tx: Tx, d: { empresaId: string; usuarioId: string; ambiente: string | null }) {
  if (d.ambiente !== null && !esAmbiente(d.ambiente)) throw new ErrorContable("Elige el ambiente de la DGII");
  // Producción solo cuando la DGII haya certificado el sistema (entrega E2c).
  if (d.ambiente === "ecf") throw new ErrorContable("Producción se activa cuando la DGII certifique el sistema");
  await tx`UPDATE empresas SET ecf_ambiente = ${d.ambiente} WHERE id = ${d.empresaId}`;
  await bitacora(tx, d.empresaId, d.usuarioId, "ecf_ambiente", { ambiente: d.ambiente });
}

// ───── Del sistema al e-CF ─────

const TIPO_DE: Record<string, TipoEcf> = { B01: "31", E31: "31", B02: "32", E32: "32", B04: "34", E34: "34" };
const dias = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

// Arma los datos del e-CF desde una factura (o nota de crédito) del sistema y revisa que el e-CF los pueda llevar.
export async function datosDeFactura(tx: Tx, facturaId: string, encf: string, venceSecuencia: string | null): Promise<DatosEcf> {
  const [f] = await tx<{
    tipo_ncf: string; fecha: string; vence: string; moneda: string; total: string; otros_impuestos: string; tipo_ingreso: string;
    cliente: string; rnc: string | null; origen_ncf: string | null; origen_fecha: string | null; origen_total: string | null; notas: string | null;
  }[]>`
    SELECT f.tipo_ncf, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, to_char(f.vence, 'YYYY-MM-DD') AS vence, f.moneda, f.total::text,
           f.otros_impuestos::text, f.tipo_ingreso, c.nombre AS cliente, c.rnc, o.ncf AS origen_ncf, to_char(o.fecha, 'YYYY-MM-DD') AS origen_fecha,
           o.total::text AS origen_total, f.notas
      FROM facturas f JOIN clientes c ON c.id = f.cliente_id LEFT JOIN facturas o ON o.id = f.factura_origen_id
     WHERE f.id = ${facturaId}`;
  if (!f) throw new ErrorContable("La factura no existe");
  const tipo = TIPO_DE[f.tipo_ncf];
  if (!tipo) throw new ErrorContable(`El ${f.tipo_ncf} llega en la entrega E2b; por ahora: crédito fiscal, consumo y nota de crédito`);
  if (f.moneda !== "DOP") throw new ErrorContable("Las facturas en dólares llegan en la entrega E2b");
  if (aCentavos(f.otros_impuestos) > 0n) throw new ErrorContable("Las facturas con propina u otros impuestos llegan en la entrega E2b");
  const [e] = await tx<{ rnc: string | null; nombre: string; nombre_comercial: string | null; direccion: string | null; correo: string | null }[]>`
    SELECT rnc, nombre, nombre_comercial, direccion, correo FROM empresas WHERE id = empresa_actual()`;
  const lineas = await tx<{ descripcion: string; cantidad: string; precio: string; subtotal: string; tipos: string[]; tasas: string[] }[]>`
    SELECT l.descripcion, l.cantidad::text, l.precio::text, l.subtotal::text,
           array_agg(i.tipo ORDER BY i.tipo) AS tipos, array_agg(i.tasa::text ORDER BY i.tipo) AS tasas
      FROM lineas_factura l JOIN impuestos_linea_factura i ON i.linea_id = l.id
     WHERE l.factura_id = ${facturaId} GROUP BY l.id ORDER BY l.orden`;
  const items: ItemEcf[] = lineas.map((l, n) => {
    const k = l.tipos.findIndex((t) => t === "itbis");
    const indicador = k < 0 ? 4 : ({ "18": 1, "16": 2, "0": 3 } as Record<string, 1 | 2 | 3>)[String(Number(l.tasas[k]))];
    if (!indicador) throw new ErrorContable(`Línea ${n + 1}: el e-CF tiene ITBIS al 18, 16 o 0 %, o exento`);
    // Cantidad × 10000 en el sistema; precio y monto en centavos.
    const [entero, decimales = ""] = l.cantidad.split(".");
    const cantidad = BigInt(entero) * 10000n + BigInt((decimales + "0000").slice(0, 4));
    return { nombre: l.descripcion, indicador, bienServicio: 2, cantidad, precio: aCentavos(l.precio), monto: aCentavos(l.subtotal) };
  });
  const credito = tipo !== "34" && f.vence > f.fecha;
  const nota = tipo === "34";
  const d: DatosEcf = {
    tipo, encf, venceSecuencia, tipoIngresos: f.tipo_ingreso, tipoPago: credito ? 2 : 1, fechaLimitePago: credito ? f.vence : null,
    emisor: { rnc: e.rnc ?? "", razonSocial: e.nombre, nombreComercial: e.nombre_comercial, direccion: e.direccion ?? "", correo: e.correo },
    fechaEmision: f.fecha,
    comprador: f.rnc ? { rnc: f.rnc, razonSocial: f.cliente } : null,
    items,
    referencia: nota && f.origen_ncf ? {
      ncf: f.origen_ncf, fecha: f.origen_fecha!, codigo: f.total === f.origen_total ? 1 : 2, razon: f.notas, notaTardia: dias(f.origen_fecha!, f.fecha) > 30,
    } : null,
  };
  // El total del e-CF (ITBIS calculado sobre el monto gravado de cada tasa) debe ser el de la factura.
  const t = calcularTotales(items);
  if (t.total !== aCentavos(f.total)) {
    throw new ErrorContable(`El total del e-CF (${monto(t.total)}) no coincide con el de la factura (${f.total}): la DGII calcula el ITBIS sobre el total de cada tasa y la factura lo redondeó por línea`);
  }
  return d;
}

// e-NCF para el XML de prueba: el siguiente del rango electrónico activo, sin tomarlo.
async function encfDePrueba(tx: Tx, tipo: TipoEcf): Promise<{ encf: string; vence: string }> {
  const [s] = await tx<{ siguiente: string; vence: string }[]>`
    SELECT siguiente::text, to_char(vence, 'YYYY-MM-DD') AS vence FROM secuencias_ncf
     WHERE tipo = ${"E" + tipo} AND activa AND siguiente <= hasta ORDER BY vence, desde LIMIT 1`;
  if (!s) throw new ErrorContable(`Carga en Comprobantes fiscales el rango E${tipo} (puede ser el de pruebas que da la DGII)`);
  return { encf: `E${tipo}${s.siguiente.padStart(10, "0")}`, vence: s.vence };
}

// XML de prueba firmado de una factura: se guarda para revisarlo y descargarlo. No toma número ni emite la factura.
export async function xmlDePrueba(tx: Tx, d: { empresaId: string; usuarioId: string; facturaId: string; ahora: Date }) {
  const [emp] = await tx<{ ecf_ambiente: string | null }[]>`SELECT ecf_ambiente FROM empresas WHERE id = ${d.empresaId}`;
  const ambiente = (emp?.ecf_ambiente ?? "testecf") as Ambiente;
  const [{ tipo_ncf }] = await tx<{ tipo_ncf: string }[]>`SELECT tipo_ncf FROM facturas WHERE id = ${d.facturaId}`;
  const tipo = TIPO_DE[tipo_ncf];
  if (!tipo) throw new ErrorContable(`El ${tipo_ncf} llega en la entrega E2b`);
  const { encf, vence } = await encfDePrueba(tx, tipo);
  const datos = await datosDeFactura(tx, d.facturaId, encf, vence);
  const cert = await abrirCertificado(tx);
  if (!vigente(cert, d.ahora.toISOString().slice(0, 10))) throw new ErrorContable(`El certificado venció el ${cert.vence}`);
  const firma = fechaHoraFirma(d.ahora);
  let xml: string;
  try {
    xml = firmarXml(armarXml(datos, firma), cert);
  } catch (e) {
    if (e instanceof ErrorEcf) throw new ErrorContable(e.message);
    throw e;
  }
  if (!firmaValida(xml, cert.certPem)) throw new ErrorContable("La firma del XML no se pudo verificar");
  const codigo = codigoSeguridad(xml);
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO ecf_envios (empresa_id, factura_id, ambiente, encf, prueba, xml, codigo_seguridad, fecha_firma, creado_por)
    VALUES (${d.empresaId}, ${d.facturaId}, ${ambiente}, ${encf}, true, ${xml}, ${codigo}, ${firma}, ${d.usuarioId}) RETURNING id`;
  await bitacora(tx, d.empresaId, d.usuarioId, "ecf_xml_prueba", { encf, codigo });
  return { id, encf, codigo, firma };
}

export async function enviosDeFactura(tx: Tx, facturaId: string) {
  return tx<{ id: string; encf: string; ambiente: string; prueba: boolean; codigo_seguridad: string; fecha_firma: string; estado: string; creado_en: Date }[]>`
    SELECT id, encf, ambiente, prueba, codigo_seguridad, fecha_firma, estado, creado_en FROM ecf_envios
     WHERE factura_id = ${facturaId} ORDER BY creado_en DESC LIMIT 10`;
}

// Prueba de conexión: pide la semilla a la DGII, la firma con el certificado y la cambia por el token.
export async function probarConexion(tx: Tx, d: { empresaId: string; usuarioId: string }, o: Opciones = {}): Promise<string> {
  const [emp] = await tx<{ ecf_ambiente: string | null }[]>`SELECT ecf_ambiente FROM empresas WHERE id = ${d.empresaId}`;
  const ambiente = (emp?.ecf_ambiente ?? "testecf") as Ambiente;
  const cert = await abrirCertificado(tx);
  const t = await obtenerToken(ambiente, cert, o);
  await bitacora(tx, d.empresaId, d.usuarioId, "ecf_conexion_ok", { ambiente });
  return t.expira ? `La DGII aceptó el certificado; el permiso vence ${t.expira}.` : "La DGII aceptó el certificado.";
}
