import type { Tx } from "./db";
import { aPdf } from "./exportar.ts";
import { llenar } from "./mensajes.ts";
import { datosDe, plantillasDe } from "./mensajes-db.ts";
import { tablaFactura } from "./pdf-documentos.ts";

// Facturas por correo (documento «Sistema Empire · Fase 2», sección 7; entrega A del 6-nov-2026). Se arma el correo de una factura
// o nota de crédito emitida: a quién (el correo del cliente), el asunto, el texto predeterminado ya lleno y el PDF adjunto.
// Las facturas de la empresa propia salen con la marca de Empire; las de un cliente, con su nombre y sin la marca, y la respuesta
// llega al correo de su ficha. El envío lo hace la acción (Gmail); aquí solo lo que no depende de la red.

export const MAX_DIRECCIONES = 5;

// Texto si la firma todavía no tiene la plantilla «correo_factura» (la crea la migración 045).
const TEXTO_RESPALDO =
  "Buenos días, [nombre]. Le compartimos su factura [número] por RD$[monto], que va adjunta en PDF. Agradecemos remitirnos el comprobante de pago respondiendo este correo.";

export async function plantillaCorreo(firmaId: string) {
  return (await plantillasDe(firmaId)).find((p) => p.clave === "correo_factura")?.texto ?? TEXTO_RESPALDO;
}
const DIRECCION = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/i;

// Una o varias direcciones separadas por coma, punto y coma o espacio.
export function leerDirecciones(texto: string): string[] | { error: string } {
  const partes = [...new Set(texto.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
  if (!partes.length) return { error: "Escribe el correo del cliente." };
  const mala = partes.find((x) => !DIRECCION.test(x));
  if (mala) return { error: `«${mala}» no es un correo válido.` };
  if (partes.length > MAX_DIRECCIONES) return { error: `Hasta ${MAX_DIRECCIONES} correos por envío.` };
  return partes;
}

// El texto se escribe en párrafos; una línea en blanco separa uno de otro.
export const parrafosDe = (texto: string) => texto.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);

export type Emisor = { nombre: string; rnc: string | null; correo: string | null };
export type Preparado = {
  para: string; asunto: string; texto: string; titulo: string; esNota: boolean; ncf: string; emisor: Emisor; cliente: string;
};

// Datos del correo de una factura emitida y vigente (datosDe ya lo exige). Corre en conEmpresa.
export async function prepararCorreo(tx: Tx, empresaId: string, facturaId: string, plantilla: string): Promise<Preparado> {
  const p = await datosDe(tx, empresaId, { tipo: "factura", id: facturaId });
  const [f] = await tx<{ tipo_ncf: string; ncf: string; email: string | null; cliente: string }[]>`
    SELECT f.tipo_ncf, f.ncf, c.email, c.nombre AS cliente FROM facturas f JOIN clientes c ON c.id = f.cliente_id WHERE f.id = ${facturaId}`;
  const [e] = await tx<Emisor[]>`SELECT nombre, rnc, NULLIF(btrim(correo), '') AS correo FROM empresas WHERE id = ${empresaId}`;
  const esNota = f.tipo_ncf === "B04" || f.tipo_ncf === "E34";
  const documento = esNota ? "Nota de crédito" : "Factura";
  // Sin contacto se saluda al cliente por su nombre; a «Consumidor final» no se le nombra.
  const nombre = p.destinatario.nombre ?? (/^consumidor final$/i.test(f.cliente.trim()) ? null : f.cliente);
  let texto = nombre ? plantilla : plantilla.replace(/,?\s*\[nombre\]/gi, "");
  texto = llenar(texto, { ...p.datos, ...(nombre ? { nombre } : {}), empresa: f.cliente });
  if (esNota) texto = texto.replace(/\bsu factura\b/i, "su nota de crédito");
  return {
    para: f.email?.trim() ?? "", asunto: `${documento} ${f.ncf} · ${e.nombre}`, texto, titulo: `${documento} ${f.ncf}`, esNota, ncf: f.ncf,
    emisor: e, cliente: f.cliente,
  };
}

// El PDF de la factura (el mismo de la descarga y del enlace de WhatsApp). Sin la marca de Empire si es de un cliente.
export async function pdfFactura(tx: Tx, facturaId: string, emisor: Emisor, conMarca: boolean) {
  const armado = await tablaFactura(tx, facturaId, {
    empresa: emisor.nombre + (emisor.rnc ? ` · RNC ${emisor.rnc}` : ""),
    generado: `Enviada por correo el ${new Date().toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" })}`,
  });
  if (!armado) return null;
  return { nombre: `${armado[0]}.pdf`, contenido: await aPdf({ ...armado[1], sinMarca: !conMarca }), tipo: "application/pdf" };
}

export async function registrarCorreo(tx: Tx, d: {
  empresaId: string; facturaId: string; para: string; responderA: string | null; asunto: string; texto: string; usuarioId: string;
  error: string | null;
}) {
  const [r] = await tx<{ id: string }[]>`
    INSERT INTO correos_enviados (empresa_id, ref_tipo, ref_id, para, responder_a, asunto, texto, estado, error, enviado_por)
    VALUES (${d.empresaId}, 'factura', ${d.facturaId}, ${d.para}, ${d.responderA}, ${d.asunto}, ${d.texto},
            ${d.error ? "no_salio" : "enviado"}, ${d.error}, ${d.usuarioId})
    RETURNING id`;
  return r.id;
}

export type CorreoFila = { id: string; para: string; asunto: string; estado: "enviado" | "no_salio"; error: string | null; por: string | null; en: Date };

export const correosDe = (tx: Tx, facturaId: string) => tx<CorreoFila[]>`
  SELECT c.id, c.para, c.asunto, c.estado, c.error, u.nombre AS por, c.enviado_en AS en
    FROM correos_enviados c LEFT JOIN usuarios u ON u.id = c.enviado_por
   WHERE c.ref_tipo = 'factura' AND c.ref_id = ${facturaId} ORDER BY c.enviado_en DESC`;

// Estado del correo de cada factura: el último intento manda («enviado» o «no salió»); sin intento, null.
export async function estadoCorreos(tx: Tx, facturaIds: string[]): Promise<Map<string, "enviado" | "no_salio">> {
  if (!facturaIds.length) return new Map();
  const filas = await tx<{ ref_id: string; estado: "enviado" | "no_salio" }[]>`
    SELECT DISTINCT ON (ref_id) ref_id, estado FROM correos_enviados
     WHERE ref_tipo = 'factura' AND ref_id = ANY(${facturaIds}::uuid[]) ORDER BY ref_id, (estado = 'enviado') DESC, enviado_en DESC`;
  return new Map(filas.map((f) => [f.ref_id, f.estado]));
}

// Igualas emitidas del mes que todavía no salieron por correo (las que nunca se enviaron o cuyo envío no salió).
export const igualasPorCorreo = (tx: Tx, periodo: string) => tx<{ id: string; ncf: string; cliente: string; email: string | null }[]>`
  SELECT f.id, f.ncf, c.nombre AS cliente, NULLIF(btrim(c.email), '') AS email
    FROM facturas f JOIN clientes c ON c.id = f.cliente_id
   WHERE f.acuerdo_id IS NOT NULL AND f.periodo = ${periodo} AND f.estado = 'emitida' AND NOT f.anulada
     AND NOT EXISTS (SELECT 1 FROM correos_enviados e WHERE e.ref_tipo = 'factura' AND e.ref_id = f.id AND e.estado = 'enviado')
   ORDER BY c.nombre`;
