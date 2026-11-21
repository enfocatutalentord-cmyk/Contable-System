import { createHash } from "node:crypto";
import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import { db, type Tx } from "./db.ts";
import { cedulaValida } from "./validar-fiscal.ts";

// Prioridad 3 · P3e: firma digital. Es una firma ELECTRÓNICA SIMPLE con constancia: el cliente abre un enlace seguro, lee un PDF, firma con el dedo y escribe su
// nombre y su identificación; el sistema guarda la hora, la dirección de internet y la huella (SHA-256) del documento, y le agrega al PDF una página de constancia.
// No es una firma digital con certificado (Ley 126-02): cada documento dice cuál es.

export class ErrorFirma extends Error {
  code = "P0001"; // mensajeError lo muestra tal cual
}

export const DIAS_ENLACE = 7; // el enlace para firmar vence a los 7 días
export const DIAS_DESCARGA = 30; // el cliente puede bajar su copia firmada 30 días
export const MAX_PDF = 4 * 1024 * 1024;

export const ESTADOS_FIRMA: Record<string, string> = {
  sin_enviar: "Sin enviar", pendiente: "Enviada", vista: "Vista", firmada: "Firmada", rechazada: "Rechazada", cancelada: "Cancelada", vencida: "Vencida",
};
export const TIPOS_EVENTO: Record<string, string> = {
  creada: "Solicitud creada", enlace: "Enlace creado", vista: "El cliente abrió el documento", firmada: "Firmado", rechazada: "Rechazado", cancelada: "Solicitud cancelada",
};

export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex"); // el mismo hash que usan los demás enlaces seguros
const esPdf = (b: Uint8Array) => b.length > 8 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d; // %PDF-

// El estado que se muestra: una enviada o vista cuyo enlace ya venció pasa a «vencida»; una pendiente sin enlace es «sin enviar».
export function estadoVisible(s: { estado: string; tiene_enlace: boolean; vence: Date | string | null }, ahora = new Date()): string {
  if (s.estado === "pendiente" || s.estado === "vista") {
    if (!s.tiene_enlace) return "sin_enviar";
    if (s.vence && new Date(s.vence).getTime() < ahora.getTime()) return "vencida";
  }
  return s.estado;
}

// Comprueba que el archivo sea un PDF que se pueda abrir, sin contraseña, y devuelve su número de páginas.
export async function validarPdf(bytes: Uint8Array): Promise<number> {
  if (bytes.length > MAX_PDF) throw new ErrorFirma("El PDF pasa de 4 MB.");
  if (!esPdf(bytes)) throw new ErrorFirma("El documento para firmar tiene que ser un PDF. Si es un Word, guárdalo como PDF desde Word y súbelo.");
  try {
    const doc = await PDFDocument.load(bytes);
    const n = doc.getPageCount();
    if (n < 1) throw new ErrorFirma("El PDF no tiene páginas.");
    return n;
  } catch (e) {
    if (e instanceof ErrorFirma) throw e;
    throw new ErrorFirma("No se pudo abrir el PDF: está protegido con contraseña o dañado. Guarda una copia sin protección.");
  }
}

// ───── La constancia ─────

type DatosConstancia = {
  solicitudId: string; titulo: string; empresa: string; firma: string; nombre: string; tipoDoc: "cedula" | "pasaporte"; documento: string;
  firmadoEn: Date; ip: string | null; agente: string | null; originalSha: string; firmaPng: Uint8Array;
};

export const verIdentificacion = (tipo: string, doc: string) =>
  tipo === "cedula" && /^\d{11}$/.test(doc) ? `Cédula ${doc.slice(0, 3)}-${doc.slice(3, 10)}-${doc[10]}` : `${tipo === "cedula" ? "Cédula" : "Pasaporte"} ${doc}`;

// Deja solo lo que la letra estándar sabe dibujar (Word y los nombres traen cosas raras).
function limpiar(t: string, f: PDFFont): string {
  let r = "";
  for (const ch of t.replace(/[\r\n\t]+/g, " ")) {
    try { f.encodeText(ch); r += ch; } catch { r += "?"; }
  }
  return r;
}

function partir(t: string, f: PDFFont, tam: number, ancho: number): string[] {
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of t.split(/\s+/)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (f.widthOfTextAtSize(prueba, tam) <= ancho) { actual = prueba; continue; }
    if (actual) lineas.push(actual);
    // una palabra más larga que la línea (la huella) se corta
    let resto = palabra;
    while (f.widthOfTextAtSize(resto, tam) > ancho) {
      let n = resto.length;
      while (n > 1 && f.widthOfTextAtSize(resto.slice(0, n), tam) > ancho) n--;
      lineas.push(resto.slice(0, n));
      resto = resto.slice(n);
    }
    actual = resto;
  }
  if (actual) lineas.push(actual);
  return lineas;
}

// El PDF original con una página de constancia al final. El original no se toca: su huella sigue siendo la del documento que se mandó a firmar.
export async function anexarConstancia(original: Uint8Array, d: DatosConstancia): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const pagina = doc.addPage([595.28, 841.89]);
  const verde = rgb(0, 0.239, 0.098), dorado = rgb(0.722, 0.541, 0.251), gris = rgb(0.35, 0.38, 0.36);
  const margen = 48, ancho = 595.28 - margen * 2;
  pagina.drawRectangle({ x: 0, y: 841.89 - 86, width: 595.28, height: 86, color: verde });
  pagina.drawRectangle({ x: 0, y: 841.89 - 90, width: 595.28, height: 4, color: dorado });
  pagina.drawText("Constancia de firma electrónica", { x: margen, y: 841.89 - 50, size: 20, font: negrita, color: rgb(1, 1, 1) });
  pagina.drawText(limpiar(d.firma, regular), { x: margen, y: 841.89 - 70, size: 10, font: regular, color: rgb(0.96, 0.9, 0.78) });

  let y = 841.89 - 126;
  const fecha = d.firmadoEn.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "long", timeStyle: "medium" });
  const filas: [string, string][] = [
    ["Documento", d.titulo], ["Empresa", d.empresa], ["Firmado por", d.nombre], ["Identificación", verIdentificacion(d.tipoDoc, d.documento)],
    ["Fecha y hora", `${fecha} (hora de República Dominicana)`], ["Dirección de internet", d.ip ?? "No disponible"],
    ["Dispositivo", (d.agente ?? "No disponible").slice(0, 140)],
    ["Huella SHA-256 del documento", d.originalSha], ["Número de solicitud", d.solicitudId],
  ];
  for (const [etiqueta, valor] of filas) {
    pagina.drawText(limpiar(etiqueta.toUpperCase(), negrita), { x: margen, y, size: 8, font: negrita, color: gris });
    y -= 13;
    for (const l of partir(limpiar(valor, regular), regular, 10.5, ancho)) {
      pagina.drawText(l, { x: margen, y, size: 10.5, font: regular, color: rgb(0.1, 0.12, 0.11) });
      y -= 14;
    }
    y -= 6;
  }

  y -= 4;
  pagina.drawText("FIRMA", { x: margen, y, size: 8, font: negrita, color: gris });
  const png = await doc.embedPng(d.firmaPng);
  const escala = Math.min(240 / png.width, 100 / png.height, 1.5);
  const w = png.width * escala, h = png.height * escala;
  pagina.drawRectangle({ x: margen, y: y - 12 - h - 6, width: 260, height: h + 12, borderColor: rgb(0.8, 0.78, 0.72), borderWidth: 0.8 });
  pagina.drawImage(png, { x: margen + 8, y: y - 12 - h, width: w, height: h });
  y -= h + 40;

  const texto = "El firmante declaró haber leído el documento completo y aceptó firmarlo por medios electrónicos desde un enlace seguro enviado por la firma. Esta página se agregó al " +
    "documento al momento de la firma. La huella (SHA-256) identifica el documento tal como se envió a firmar: si cambia una sola letra, la huella cambia; al calcularla sobre el " +
    "documento original debe dar el mismo valor que aparece arriba.";
  for (const l of partir(limpiar(texto, regular), regular, 9, ancho)) {
    pagina.drawText(l, { x: margen, y, size: 9, font: regular, color: gris });
    y -= 12;
  }
  pagina.drawText("Firma electrónica simple con constancia. No es una firma digital con certificado.", { x: margen, y: 40, size: 8.5, font: negrita, color: verde });
  return doc.save();
}

// ───── Lo que escribe el firmante ─────

export type DatosFirma = { nombre: string; tipoDoc: "cedula" | "pasaporte"; documento: string; firmaPng: Uint8Array };

export function leerFirma(fd: FormData): DatosFirma {
  const t = (c: string, max: number) => String(fd.get(c) ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const nombre = t("nombre", 120);
  if (nombre.length < 5 || !/\s/.test(nombre)) throw new ErrorFirma("Escribe tu nombre completo, como aparece en tu cédula.");
  const tipoDoc = t("tipo_doc", 10) === "pasaporte" ? "pasaporte" : "cedula";
  const bruto = t("documento", 30);
  let documento: string;
  if (tipoDoc === "cedula") {
    documento = bruto.replace(/\D/g, "");
    if (!cedulaValida(documento)) throw new ErrorFirma("La cédula no es válida: escribe los 11 números.");
  } else {
    documento = bruto.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (documento.length < 5 || documento.length > 20) throw new ErrorFirma("Escribe el número de tu pasaporte.");
  }
  if (fd.get("leido") !== "on") throw new ErrorFirma("Marca que leíste el documento completo.");
  if (fd.get("acepto") !== "on") throw new ErrorFirma("Marca que aceptas firmar este documento por medios electrónicos.");
  const trazos = Number(t("trazos", 6) || 0);
  const url = String(fd.get("firma") ?? "");
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!m || trazos < 12) throw new ErrorFirma("Dibuja tu firma en el recuadro con el dedo o el ratón.");
  const firmaPng = new Uint8Array(Buffer.from(m[1], "base64"));
  if (firmaPng.length > 300_000 || !(firmaPng[0] === 0x89 && firmaPng[1] === 0x50 && firmaPng[2] === 0x4e && firmaPng[3] === 0x47)) throw new ErrorFirma("La firma no se pudo leer: bórrala y dibújala de nuevo.");
  return { nombre, tipoDoc, documento, firmaPng };
}

// ───── Del lado de la firma (con sesión, dentro de una empresa) ─────

export type Solicitud = {
  id: string; titulo: string; origen: string; carpeta: string; firmante: string | null; estado: string; tiene_enlace: boolean; vence: Date | null; creado: Date;
  firmante_nombre: string | null; firmante_doc: string | null; firmado_en: Date | null; firmado_ip: string | null; rechazo_motivo: string | null; rechazado_en: Date | null;
  original_sha: string; firmado_sha: string | null; documento_firmado_id: string | null; vista_en: Date | null; creado_por: string | null; tamano: number;
};

export const listarSolicitudes = (tx: Tx) => tx<Solicitud[]>`
  SELECT s.id, s.titulo, s.origen, s.carpeta, s.firmante, s.estado, s.token_hash IS NOT NULL AS tiene_enlace, s.vence, s.creado, s.firmante_nombre, s.firmante_doc,
         s.firmado_en, s.firmado_ip, s.rechazo_motivo, s.rechazado_en, s.original_sha, s.firmado_sha, s.documento_firmado_id, s.vista_en, u.nombre AS creado_por,
         octet_length(s.original)::int AS tamano
    FROM solicitudes_firma s LEFT JOIN usuarios u ON u.id = s.creado_por ORDER BY s.creado DESC`;

export const eventosDe = (tx: Tx, solicitudId: string) => tx<{ tipo: string; detalle: string | null; ip: string | null; en: Date; quien: string | null }[]>`
  SELECT e.tipo, e.detalle, e.ip, e.en, u.nombre AS quien FROM firma_eventos e LEFT JOIN usuarios u ON u.id = e.quien WHERE e.solicitud_id = ${solicitudId} ORDER BY e.id`;

export async function crearSolicitud(tx: Tx, d: {
  empresaId: string; usuarioId: string; titulo: string; origen: "expediente" | "subido" | "propuesta"; origenId: string | null; carpeta: string; firmante: string | null; bytes: Uint8Array;
}): Promise<string> {
  const titulo = d.titulo.trim().slice(0, 200);
  if (!titulo) throw new ErrorFirma("Escribe cómo se llama el documento.");
  await validarPdf(d.bytes);
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO solicitudes_firma (empresa_id, titulo, origen, origen_id, carpeta, firmante, original, original_sha, creado_por)
    VALUES (${d.empresaId}, ${titulo}, ${d.origen}, ${d.origenId}, ${d.carpeta}, ${d.firmante?.trim().slice(0, 120) || null}, ${Buffer.from(d.bytes)}, ${sha256(d.bytes)}, ${d.usuarioId})
    RETURNING id`;
  await tx`INSERT INTO firma_eventos (solicitud_id, empresa_id, tipo, quien) VALUES (${id}, ${d.empresaId}, 'creada', ${d.usuarioId})`;
  return id;
}

// Un enlace nuevo (por WhatsApp o para copiar): reemplaza el anterior y vence a los 7 días. Solo de lo que todavía se puede firmar.
export async function ponerEnlaceFirma(tx: Tx, d: { empresaId: string; solicitudId: string; token: string; usuarioId: string }) {
  const r = await tx`
    UPDATE solicitudes_firma SET token_hash = ${hashToken(d.token)}, vence = now() + make_interval(days => ${DIAS_ENLACE})
     WHERE id = ${d.solicitudId} AND estado IN ('pendiente', 'vista')`;
  if (!r.count) throw new ErrorFirma("Esta solicitud ya se firmó, se rechazó o se canceló.");
  await tx`INSERT INTO firma_eventos (solicitud_id, empresa_id, tipo, quien) VALUES (${d.solicitudId}, ${d.empresaId}, 'enlace', ${d.usuarioId})`;
}

export async function cancelarSolicitud(tx: Tx, d: { empresaId: string; solicitudId: string; usuarioId: string }) {
  const r = await tx`
    UPDATE solicitudes_firma SET estado = 'cancelada', token_hash = NULL, cancelado_por = ${d.usuarioId}, cancelado_en = now()
     WHERE id = ${d.solicitudId} AND estado IN ('pendiente', 'vista')`;
  if (!r.count) throw new ErrorFirma("Solo se cancelan las solicitudes que todavía no se firman ni se rechazan.");
  await tx`INSERT INTO firma_eventos (solicitud_id, empresa_id, tipo, quien) VALUES (${d.solicitudId}, ${d.empresaId}, 'cancelada', ${d.usuarioId})`;
}

export async function archivoDe(tx: Tx, solicitudId: string, cual: "original" | "firmado"): Promise<{ titulo: string; bytes: Uint8Array } | null> {
  const [s] = cual === "original"
    ? await tx<{ titulo: string; bytes: Buffer | null }[]>`SELECT titulo, original AS bytes FROM solicitudes_firma WHERE id = ${solicitudId}`
    : await tx<{ titulo: string; bytes: Buffer | null }[]>`SELECT titulo, firmado AS bytes FROM solicitudes_firma WHERE id = ${solicitudId}`;
  return s?.bytes ? { titulo: s.titulo, bytes: new Uint8Array(s.bytes) } : null;
}

// ───── Del lado del cliente (sin sesión: se entra con el enlace) ─────

export type PorToken = {
  id: string; empresa_id: string; empresa: string; firma: string; titulo: string; estado: string; vence: Date | null; firmante: string | null;
  firmante_nombre: string | null; firmado_en: Date | null; rechazo_motivo: string | null; paginas: number | null;
};

const formatoToken = (t: string) => /^[A-Za-z0-9_-]{20,64}$/.test(t);

// La solicitud que corresponde al enlace. Se puede firmar mientras el enlace no venza; una firmada se puede ver 30 días para bajar la copia.
export async function porToken(token: string): Promise<PorToken | null> {
  if (!formatoToken(token)) return null;
  const [s] = await db()<PorToken[]>`
    SELECT s.id, s.empresa_id, e.nombre AS empresa, f.nombre AS firma, s.titulo, s.estado, s.vence, s.firmante, s.firmante_nombre, s.firmado_en, s.rechazo_motivo, NULL::int AS paginas
      FROM solicitudes_firma s JOIN empresas e ON e.id = s.empresa_id JOIN firmas f ON f.id = e.firma_id
     WHERE s.token_hash = ${hashToken(token)}
       AND ((s.estado IN ('pendiente', 'vista') AND s.vence > now()) OR (s.estado = 'firmada' AND s.firmado_en > now() - make_interval(days => ${DIAS_DESCARGA}))
            OR (s.estado = 'rechazada' AND s.rechazado_en > now() - make_interval(days => ${DIAS_DESCARGA})))`;
  return s ?? null;
}

// La primera vez que se abre queda anotado; las siguientes no repiten.
export async function marcarVista(id: string, empresaId: string, ip: string | null) {
  await db().begin(async (tx) => {
    const r = await tx`UPDATE solicitudes_firma SET estado = 'vista', vista_en = now() WHERE id = ${id} AND estado = 'pendiente'`;
    if (r.count) await tx`INSERT INTO firma_eventos (solicitud_id, empresa_id, tipo, ip) VALUES (${id}, ${empresaId}, 'vista', ${ip})`;
  });
}

export async function archivoPorToken(token: string, cual: "original" | "firmado"): Promise<{ titulo: string; bytes: Uint8Array } | null> {
  const s = await porToken(token);
  if (!s) return null;
  if (cual === "firmado" && s.estado !== "firmada") return null;
  if (cual === "original" && !["pendiente", "vista"].includes(s.estado)) return null;
  const [a] = cual === "original"
    ? await db()<{ bytes: Buffer }[]>`SELECT original AS bytes FROM solicitudes_firma WHERE id = ${s.id}`
    : await db()<{ bytes: Buffer }[]>`SELECT firmado AS bytes FROM solicitudes_firma WHERE id = ${s.id}`;
  return a?.bytes ? { titulo: s.titulo, bytes: new Uint8Array(a.bytes) } : null;
}

// Firmar: arma el PDF con la constancia, lo guarda en el expediente del cliente y cierra la solicitud, todo en una transacción.
export async function firmarPorToken(token: string, f: DatosFirma, ip: string | null, agente: string | null): Promise<{ firmadoSha: string }> {
  if (!formatoToken(token)) throw new ErrorFirma("El enlace no es válido.");
  return db().begin(async (tx) => {
    const [s] = await tx<{ id: string; empresa_id: string; titulo: string; carpeta: string; estado: string; vence: Date | null; original: Buffer; original_sha: string; creado_por: string; empresa: string; firma: string }[]>`
      SELECT s.id, s.empresa_id, s.titulo, s.carpeta, s.estado, s.vence, s.original, s.original_sha, s.creado_por, e.nombre AS empresa, fi.nombre AS firma
        FROM solicitudes_firma s JOIN empresas e ON e.id = s.empresa_id JOIN firmas fi ON fi.id = e.firma_id
       WHERE s.token_hash = ${hashToken(token)} FOR UPDATE OF s`;
    if (!s) throw new ErrorFirma("El enlace venció o ya no existe. Pide uno nuevo a la firma.");
    if (s.estado === "firmada") throw new ErrorFirma("Este documento ya se firmó.");
    if (!["pendiente", "vista"].includes(s.estado) || !s.vence || s.vence.getTime() < Date.now()) throw new ErrorFirma("El enlace venció o ya no se puede firmar. Pide uno nuevo a la firma.");
    const firmadoEn = new Date();
    const original = new Uint8Array(s.original);
    const firmado = await anexarConstancia(original, {
      solicitudId: s.id, titulo: s.titulo, empresa: s.empresa, firma: s.firma, nombre: f.nombre, tipoDoc: f.tipoDoc, documento: f.documento, firmadoEn,
      ip, agente, originalSha: s.original_sha, firmaPng: f.firmaPng,
    });
    const firmadoSha = sha256(firmado);
    // Lo de la empresa (documentos, bitácora) va con su contexto, como lo haría una persona de la firma.
    await tx`SELECT set_config('app.empresa_id', ${s.empresa_id}, true)`;
    const nombre = `${s.titulo} (firmado).pdf`.replace(/[^\p{L}\p{N} ._()-]/gu, "").slice(0, 150);
    const [{ id: documentoId }] = await tx<{ id: string }[]>`
      INSERT INTO documentos (empresa_id, entidad, entidad_id, nombre, tipo, tamano, sha256, contenido, descripcion, subido_por, carpeta, anio)
      VALUES (${s.empresa_id}, 'expediente', ${s.empresa_id}, ${nombre}, 'application/pdf', ${firmado.length}, ${firmadoSha}, ${Buffer.from(firmado)},
              ${`Firmado por ${f.nombre}: ${s.titulo}`}, ${s.creado_por}, ${s.carpeta}, ${firmadoEn.getFullYear()}) RETURNING id`;
    await tx`
      UPDATE solicitudes_firma SET estado = 'firmada', firmante_nombre = ${f.nombre}, firmante_tipo_doc = ${f.tipoDoc}, firmante_doc = ${f.documento}, firma_png = ${Buffer.from(f.firmaPng)},
             firmado_en = ${firmadoEn}, firmado_ip = ${ip}, firmado_agente = ${agente?.slice(0, 300) ?? null}, firmado = ${Buffer.from(firmado)}, firmado_sha = ${firmadoSha},
             documento_firmado_id = ${documentoId} WHERE id = ${s.id}`;
    await tx`INSERT INTO firma_eventos (solicitud_id, empresa_id, tipo, detalle, ip) VALUES (${s.id}, ${s.empresa_id}, 'firmada', ${`${f.nombre} · ${verIdentificacion(f.tipoDoc, f.documento)}`}, ${ip})`;
    return { firmadoSha };
  });
}

export async function rechazarPorToken(token: string, motivo: string, ip: string | null) {
  if (!formatoToken(token)) throw new ErrorFirma("El enlace no es válido.");
  const m = motivo.trim().slice(0, 500);
  if (m.length < 3) throw new ErrorFirma("Cuéntale a la firma por qué no firmas (por ejemplo, «hay un error en el monto»).");
  await db().begin(async (tx) => {
    const [s] = await tx<{ id: string; empresa_id: string; estado: string; vence: Date | null }[]>`
      SELECT id, empresa_id, estado, vence FROM solicitudes_firma WHERE token_hash = ${hashToken(token)} FOR UPDATE`;
    if (!s || !["pendiente", "vista"].includes(s.estado) || !s.vence || s.vence.getTime() < Date.now()) throw new ErrorFirma("El enlace venció o ya no se puede usar.");
    await tx`SELECT set_config('app.empresa_id', ${s.empresa_id}, true)`;
    await tx`UPDATE solicitudes_firma SET estado = 'rechazada', rechazo_motivo = ${m}, rechazado_en = now() WHERE id = ${s.id}`;
    await tx`INSERT INTO firma_eventos (solicitud_id, empresa_id, tipo, detalle, ip) VALUES (${s.id}, ${s.empresa_id}, 'rechazada', ${m}, ${ip})`;
  });
}

