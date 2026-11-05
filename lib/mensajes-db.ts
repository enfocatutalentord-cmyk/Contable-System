import { createHash, randomBytes } from "node:crypto";
import { cambiarNotificacion } from "./bitacora.ts";
import { db, type Tx } from "./db.ts";
import { nombrePeriodo } from "./igualas.ts";
import { type Datos, HORAS_DESHACER, llenar, telefonoWa } from "./mensajes.ts";
import { verFecha, verMonto } from "./montos.ts";

// Bloque 3, entrega 3c: lo de los mensajes de WhatsApp que toca la base (plantillas de la firma, datos de cada documento,
// enlaces seguros de 30 días y el registro de lo enviado, que pasa a la bitácora).

export class ErrorMensaje extends Error {}

export type Plantilla = { id: string; clave: string; orden: number; nombre: string; texto: string; editado_por: string | null; editado: string | null };
export type Ref = { tipo: "factura" | "cobro" | "propuesta" | "notificacion" | "reporte"; id: string };
export type Destinatario = { nombre: string | null; empresa: string; telefono: string | null; grupo: string | null };

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const nuevoToken = () => randomBytes(24).toString("base64url");

export const plantillasDe = (firmaId: string) => db()<Plantilla[]>`
  SELECT p.id, p.clave, p.orden, p.nombre, p.texto, u.nombre AS editado_por, to_char(p.editado AT TIME ZONE 'America/Santo_Domingo', 'DD/MM/YYYY HH24:MI') AS editado
    FROM plantillas_mensaje p LEFT JOIN usuarios u ON u.id = p.editado_por WHERE p.firma_id = ${firmaId} ORDER BY p.orden, p.nombre`;

// Contacto principal de una empresa de la firma (su WhatsApp, o el teléfono) y el grupo de WhatsApp guardado en la ficha.
// Lee con la conexión dueña fijando la empresa: sirve también para el cliente enlazado de la empresa propia.
export async function contactoDeEmpresa(empresaId: string): Promise<Destinatario | null> {
  const [c] = await db().begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${empresaId}, true)`;
    return tx<{ empresa: string; grupo: string | null; nombre: string | null; telefono: string | null }[]>`
      SELECT e.nombre AS empresa, e.grupo_whatsapp AS grupo, c.nombre, COALESCE(NULLIF(c.whatsapp, ''), NULLIF(c.telefono, ''), NULLIF(e.telefono, '')) AS telefono
        FROM empresas e
        LEFT JOIN LATERAL (SELECT nombre, whatsapp, telefono FROM contactos_empresa
                            WHERE empresa_id = e.id ORDER BY array_position(ARRAY['principal', 'alterno', 'representante', 'gerente'], rol) LIMIT 1) c ON true
       WHERE e.id = ${empresaId}`;
  });
  return c ? { empresa: c.empresa, grupo: c.grupo, nombre: c.nombre, telefono: telefonoWa(c.telefono) } : null;
}

// Destinatario de un documento de ventas: si el cliente es una empresa de la firma, su ficha; si no, los datos del cliente.
async function deCliente(tx: Tx, clienteId: string): Promise<Destinatario> {
  const [c] = await tx<{ nombre: string; telefono: string | null; vinculada: string | null }[]>`
    SELECT nombre, telefono, empresa_vinculada_id AS vinculada FROM clientes WHERE id = ${clienteId}`;
  const ficha = c?.vinculada ? await contactoDeEmpresa(c.vinculada) : null;
  if (ficha) return { ...ficha, empresa: c.nombre, telefono: ficha.telefono ?? telefonoWa(c.telefono) };
  return { nombre: null, empresa: c?.nombre ?? "", telefono: telefonoWa(c?.telefono), grupo: null };
}

export type Preparado = { datos: Datos; destinatario: Destinatario; enlace: { tipo: "factura" | "propuesta" | "documento" | "reporte"; refId: string; titulo: string } | null };

// Datos del documento para llenar el mensaje y, si lleva PDF, qué se comparte por el enlace seguro. Corre en conEmpresa.
export async function datosDe(tx: Tx, empresaId: string, ref: Ref | null): Promise<Preparado> {
  if (!ref) {
    const destinatario = (await contactoDeEmpresa(empresaId)) ?? { nombre: null, empresa: "", telefono: null, grupo: null };
    return { datos: {}, destinatario, enlace: null };
  }
  if (ref.tipo === "factura") {
    const [f] = await tx<{ cliente_id: string; ncf: string | null; total: string; saldo: string | null; periodo: string | null; fecha: string; estado: string; anulada: boolean; moneda: string }[]>`
      SELECT f.cliente_id, f.ncf, f.total::text, s.saldo::text, f.periodo, to_char(f.fecha, 'YYYYMM') AS fecha, f.estado, f.anulada, f.moneda
        FROM facturas f LEFT JOIN saldos_factura s ON s.factura_id = f.id WHERE f.id = ${ref.id}`;
    if (!f || f.estado !== "emitida" || f.anulada) throw new ErrorMensaje("Solo se envían facturas emitidas y vigentes.");
    const destinatario = await deCliente(tx, f.cliente_id);
    const pendiente = f.saldo !== null && Number(f.saldo) > 0 && Number(f.saldo) < Number(f.total);
    return {
      destinatario,
      datos: { mes: nombrePeriodo(f.periodo ?? f.fecha), monto: verMonto(pendiente ? f.saldo : f.total), número: f.ncf ?? "" },
      enlace: { tipo: "factura", refId: ref.id, titulo: `Factura ${f.ncf}` },
    };
  }
  if (ref.tipo === "cobro") {
    const [c] = await tx<{ cliente_id: string; numero: number; monto: string; anulado: boolean; concepto: string | null }[]>`
      SELECT c.cliente_id, c.numero, COALESCE((SELECT sum(a.monto) FROM aplicaciones_cobro a WHERE a.cobro_id = c.id), c.recibido)::text AS monto, c.anulado,
             (SELECT string_agg(COALESCE(CASE WHEN f.periodo IS NOT NULL THEN 'la iguala de ' END, 'la factura ') ||
                                COALESCE(f.periodo, f.ncf), ', ' ORDER BY f.fecha)
                FROM aplicaciones_cobro a JOIN facturas f ON f.id = a.factura_id WHERE a.cobro_id = c.id) AS concepto
        FROM cobros c WHERE c.id = ${ref.id}`;
    if (!c || c.anulado) throw new ErrorMensaje("El cobro no existe o está anulado.");
    const concepto = (c.concepto ?? "").replace(/\b(\d{6})\b/g, (p) => nombrePeriodo(p));
    return { destinatario: await deCliente(tx, c.cliente_id), datos: { monto: verMonto(c.monto), concepto: concepto || `el recibo n.º ${c.numero}` }, enlace: null };
  }
  if (ref.tipo === "propuesta") {
    const [p] = await tx<{ cliente_id: string; numero: number; servicio: string | null }[]>`
      SELECT p.cliente_id, p.numero, (SELECT descripcion FROM lineas_propuesta l WHERE l.propuesta_id = p.id ORDER BY l.orden LIMIT 1) AS servicio
        FROM propuestas p WHERE p.id = ${ref.id}`;
    if (!p) throw new ErrorMensaje("La propuesta no existe.");
    return {
      destinatario: await deCliente(tx, p.cliente_id), datos: { servicio: p.servicio ?? "" },
      enlace: { tipo: "propuesta", refId: ref.id, titulo: `Propuesta n.º ${p.numero}` },
    };
  }
  if (ref.tipo === "reporte") {
    // Reporte mensual (bloque 4b): solo aprobado; el enlace entrega el PDF de lo aprobado.
    const [r] = await tx<{ estado: string; periodo: string }[]>`SELECT estado, periodo FROM reportes_mensuales WHERE id = ${ref.id}`;
    if (!r || (r.estado !== "aprobado" && r.estado !== "enviado")) throw new ErrorMensaje("El reporte se envía cuando está aprobado.");
    const destinatario = (await contactoDeEmpresa(empresaId)) ?? { nombre: null, empresa: "", telefono: null, grupo: null };
    return { destinatario, datos: { mes: nombrePeriodo(r.periodo) }, enlace: { tipo: "reporte", refId: ref.id, titulo: `Reporte de ${nombrePeriodo(r.periodo)}` } };
  }
  const [n] = await tx<{ tipo: string; periodo: string; concepto: string | null; monto: string; fecha_limite: string; documento_id: string | null }[]>`
    SELECT n.tipo, n.periodo, n.concepto, n.monto::text, to_char(n.fecha_limite, 'YYYY-MM-DD') AS fecha_limite,
           (SELECT d.id FROM documentos d WHERE d.entidad = 'notificacion' AND d.entidad_id = n.id AND NOT d.eliminado ORDER BY d.subido_en DESC LIMIT 1) AS documento_id
      FROM notificaciones_pago n WHERE n.id = ${ref.id}`;
  if (!n) throw new ErrorMensaje("La notificación no existe.");
  const destinatario = (await contactoDeEmpresa(empresaId)) ?? { nombre: null, empresa: "", telefono: null, grupo: null };
  const mes = nombrePeriodo(n.periodo);
  return {
    destinatario,
    datos: { mes, período: mes, monto: verMonto(n.monto), "fecha límite": verFecha(n.fecha_limite), declaración: n.concepto ?? (n.tipo === "tss" ? "la TSS" : "la DGII") },
    enlace: n.documento_id ? { tipo: "documento", refId: n.documento_id, titulo: `Notificación ${n.tipo.toUpperCase()} de ${mes}` } : null,
  };
}

// Texto listo: la plantilla con los datos del documento, el nombre del contacto y la empresa.
export function armarTexto(plantilla: string, p: Preparado, url: string | null, extra: Datos = {}): string {
  return llenar(plantilla, {
    nombre: p.destinatario.nombre ?? undefined, empresa: p.destinatario.empresa, ...p.datos, ...extra, ...(url ? { enlace: url } : {}),
  });
}

// Registra el envío: guarda el enlace (solo su hash) si el mensaje lleva uno y deja la gestión en la bitácora (trigger).
// Si es una notificación de pago pendiente, queda «enviada».
export async function registrarEnvio(tx: Tx, d: {
  empresaId: string; usuarioId: string; clave: string; nombre: string; texto: string; destino: "contacto" | "elegir"; telefono: string | null;
  ref: Ref | null; enlace: Preparado["enlace"]; token: string | null;
}): Promise<string> {
  const texto = d.texto.trim();
  if (!texto || texto.length > 4000) throw new ErrorMensaje("El mensaje va de 1 a 4,000 caracteres.");
  let enlaceId: string | null = null;
  if (d.enlace && d.token && texto.includes(d.token)) {
    [{ id: enlaceId }] = await tx<{ id: string }[]>`
      INSERT INTO enlaces_documento (empresa_id, token_hash, tipo, ref_id, titulo, creado_por)
      VALUES (${d.empresaId}, ${hashToken(d.token)}, ${d.enlace.tipo}, ${d.enlace.refId}, ${d.enlace.titulo}, ${d.usuarioId}) RETURNING id`;
  }
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO mensajes_enviados (empresa_id, clave, nombre, texto, destino, telefono, ref_tipo, ref_id, enlace_id, enviado_por)
    VALUES (${d.empresaId}, ${d.clave}, ${d.nombre}, ${texto}, ${d.destino}, ${d.destino === "contacto" ? d.telefono : null},
            ${d.ref?.tipo ?? null}, ${d.ref?.id ?? null}, ${enlaceId}, ${d.usuarioId}) RETURNING id`;
  if (d.ref?.tipo === "reporte") await tx`UPDATE reportes_mensuales SET estado = 'enviado', enviado_en = now() WHERE id = ${d.ref.id} AND estado = 'aprobado'`;
  if (d.ref?.tipo === "notificacion") {
    const [n] = await tx<{ estado: string }[]>`SELECT estado FROM notificaciones_pago WHERE id = ${d.ref.id}`;
    if (n?.estado === "pendiente") await cambiarNotificacion(tx, d.ref.id, "enviada", d.usuarioId);
  }
  return id;
}

// Deshacer (el mismo día, quien lo envió o un administrador): quita el envío y su gestión, retira el enlace y, si la notificación
// quedó «enviada» por este mensaje, la devuelve a pendiente.
export async function deshacerEnvio(tx: Tx, d: { mensajeId: string; usuarioId: string; administrador: boolean }) {
  const [m] = await tx<{ enviado_por: string; enlace_id: string | null; ref_tipo: string | null; ref_id: string | null; viejo: boolean }[]>`
    SELECT enviado_por, enlace_id, ref_tipo, ref_id, enviado_en < now() - make_interval(hours => ${HORAS_DESHACER}) AS viejo
      FROM mensajes_enviados WHERE id = ${d.mensajeId} FOR UPDATE`;
  if (!m) throw new ErrorMensaje("Ese envío ya no está.");
  if (m.enviado_por !== d.usuarioId && !d.administrador) throw new ErrorMensaje("Solo quien lo envió (o un administrador) puede deshacerlo.");
  if (m.viejo) throw new ErrorMensaje(`Solo se deshace dentro de las ${HORAS_DESHACER} horas del envío.`);
  await tx`DELETE FROM mensajes_enviados WHERE id = ${d.mensajeId}`;
  if (m.enlace_id) await tx`UPDATE enlaces_documento SET revocado_en = now(), revocado_por = ${d.usuarioId} WHERE id = ${m.enlace_id} AND revocado_en IS NULL`;
  if (m.ref_tipo === "reporte" && m.ref_id) {
    const [otro] = await tx`SELECT 1 FROM mensajes_enviados WHERE ref_tipo = 'reporte' AND ref_id = ${m.ref_id}`;
    if (!otro) await tx`UPDATE reportes_mensuales SET estado = 'aprobado', enviado_en = NULL WHERE id = ${m.ref_id} AND estado = 'enviado'`;
  }
  if (m.ref_tipo === "notificacion" && m.ref_id) {
    const [otro] = await tx`SELECT 1 FROM mensajes_enviados WHERE ref_tipo = 'notificacion' AND ref_id = ${m.ref_id}`;
    const [n] = await tx<{ estado: string }[]>`SELECT estado FROM notificaciones_pago WHERE id = ${m.ref_id}`;
    if (!otro && n?.estado === "enviada") await cambiarNotificacion(tx, m.ref_id, "pendiente", d.usuarioId);
  }
}

export async function quitarEnlace(tx: Tx, enlaceId: string, usuarioId: string) {
  const r = await tx`UPDATE enlaces_documento SET revocado_en = now(), revocado_por = ${usuarioId} WHERE id = ${enlaceId} AND revocado_en IS NULL`;
  if (!r.count) throw new ErrorMensaje("Ese enlace ya no está activo.");
}

// Para la descarga sin sesión: el enlace vigente que corresponde al token (se busca por su hash) y cuenta la descarga.
export async function enlaceVigente(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [e] = await db()<{ id: string; empresa_id: string; tipo: "factura" | "propuesta" | "documento" | "reporte"; ref_id: string; titulo: string }[]>`
    UPDATE enlaces_documento SET descargas = descargas + 1, ultima_descarga = now()
     WHERE token_hash = ${hashToken(token)} AND revocado_en IS NULL AND vence > now()
     RETURNING id, empresa_id, tipo, ref_id, titulo`;
  return e ?? null;
}

export type EnlaceFila = { id: string; empresa_id: string; cliente: string; titulo: string; creado: string; vence: string; activo: boolean;
  estado: string; descargas: number; ultima: string | null; creado_por: string | null };

// Enlaces compartidos de todos los clientes de la firma (los más recientes primero).
export const enlacesDeFirma = (firmaId: string) => db()<EnlaceFila[]>`
  SELECT l.id, l.empresa_id, e.nombre AS cliente, l.titulo, to_char(l.creado AT TIME ZONE 'America/Santo_Domingo', 'DD/MM/YYYY HH24:MI') AS creado,
         to_char(l.vence AT TIME ZONE 'America/Santo_Domingo', 'DD/MM/YYYY') AS vence, (l.revocado_en IS NULL AND l.vence > now()) AS activo,
         CASE WHEN l.revocado_en IS NOT NULL THEN 'Retirado' WHEN l.vence <= now() THEN 'Vencido' ELSE 'Activo' END AS estado,
         l.descargas, to_char(l.ultima_descarga AT TIME ZONE 'America/Santo_Domingo', 'DD/MM/YYYY HH24:MI') AS ultima, u.nombre AS creado_por
    FROM enlaces_documento l JOIN empresas e ON e.id = l.empresa_id LEFT JOIN usuarios u ON u.id = l.creado_por
   WHERE e.firma_id = ${firmaId} ORDER BY l.creado DESC LIMIT 200`;
