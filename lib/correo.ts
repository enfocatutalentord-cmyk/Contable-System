import nodemailer from "nodemailer";

// Correos del sistema (enlaces de acceso), enviados con Gmail como en la web de Empire.
// Requiere en Vercel: GMAIL_CLAVE_APP (contraseña de aplicación de Google, secreta). GMAIL_USUARIO es opcional
// (por defecto el correo de Empire). Sin la clave no se envía nada: quien da el acceso ve el enlace para pasarlo a mano.

const usuario = process.env.GMAIL_USUARIO || "empiretaxnlegal@gmail.com";
const clave = (process.env.GMAIL_CLAVE_APP || "").replace(/\s/g, ""); // Google la muestra en grupos de 4 con espacios

// Solo en una computadora de prueba (nunca en Vercel): con CORREO_PRUEBA_CARPETA el correo no sale, se guarda como .eml en esa
// carpeta para revisar el adjunto, el remitente y «responder a».
const carpetaPrueba = !process.env.VERCEL && !clave ? process.env.CORREO_PRUEBA_CARPETA || "" : "";

const transporte = clave
  ? nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: usuario, pass: clave } })
  : carpetaPrueba ? nodemailer.createTransport({ streamTransport: true, buffer: true }) : null;

export const escapar = (t: string) =>
  t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type Adjunto = { nombre: string; contenido: Buffer; tipo: string };
export type Envio = {
  para: string; asunto: string; titulo: string; parrafos: string[]; boton?: { texto: string; url: string }; pie?: string;
  adjuntos?: Adjunto[];
  responderA?: string | null; // a dónde llega la respuesta del cliente (el correo de la ficha de quien factura)
  remitente?: string; // nombre que ve el cliente; la dirección sigue siendo la de Gmail
  encabezado?: string | null; // sin marca de Empire: el nombre de la empresa que factura en una franja sobria
};
export type Resultado = { ok: true } | { ok: false; error: string; limite: boolean };

export const configurado = () => transporte !== null;

// Gmail frena los envíos cuando se pasa del límite del día (unos 500 correos en una cuenta gratuita): 550 5.4.5 o 421 4.7.0.
export function errorDeGmail(e: unknown): { error: string; limite: boolean } {
  const t = String((e as { response?: string; message?: string })?.response ?? (e as Error)?.message ?? e);
  if (/5\.4\.5|4\.7\.0|quota|limit|rate/i.test(t))
    return { error: "Gmail frenó el envío por el límite de correos del día. Se puede volver a enviar mañana.", limite: true };
  if (/5\.1\.1|does not exist|no such user|invalid recipient|recipient address rejected/i.test(t))
    return { error: "Gmail no aceptó la dirección del destinatario. Revisa el correo.", limite: false };
  return { error: "Gmail no aceptó el envío. Intenta de nuevo en unos minutos.", limite: false };
}

export function armarHtml(d: Envio): string {
  const cabeza = d.encabezado
    ? `<div style="background:#f2f2f2;color:#222;padding:16px 20px;border-bottom:2px solid #999;font-weight:bold">${escapar(d.encabezado)}</div>`
    : `<div style="background:#003D19;color:#F6F3EC;padding:16px 20px;border-bottom:3px solid #B88A40;font-weight:bold;letter-spacing:1px">EMPIRE TAX’N LEGAL · Sistema contable</div>`;
  const color = d.encabezado ? "#222" : "#003D19";
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1d241f;max-width:560px">
    ${cabeza}
    <div style="padding:20px">
      <h2 style="color:${color};margin:0 0 12px">${escapar(d.titulo)}</h2>
      ${d.parrafos.map((p) => `<p style="margin:0 0 12px">${escapar(p)}</p>`).join("")}
      ${d.boton ? `<p style="margin:22px 0"><a href="${escapar(d.boton.url)}" style="background:${color};color:#F6F3EC;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">${escapar(d.boton.texto)}</a></p>
      <p style="font-size:13px;color:#4e5a52">Si el botón no abre, copia este enlace en el navegador:<br>${escapar(d.boton.url)}</p>` : ""}
      ${d.pie ? `<p style="font-size:13px;color:#4e5a52;margin-top:18px">${escapar(d.pie)}</p>` : ""}
    </div></div>`;
}

// Nombre para el «De:» sin comillas ni saltos que rompan el encabezado del correo.
const nombreSeguro = (t: string) => t.replace(/["\r\n<>]/g, "").trim().slice(0, 120);

export async function enviarConDetalle(d: Envio): Promise<Resultado> {
  if (!transporte) return { ok: false, error: "El correo del sistema no está configurado (falta la clave de Gmail en Vercel).", limite: false };
  const texto = [d.titulo, "", ...d.parrafos, ...(d.boton ? ["", `${d.boton.texto}: ${d.boton.url}`] : []), ...(d.pie ? ["", d.pie] : [])].join("\n");
  try {
    const info = await transporte.sendMail({
      from: `"${nombreSeguro(d.remitente ?? "Empire Tax’N Legal · Sistema contable")}" <${usuario}>`,
      to: d.para, subject: d.asunto, text: texto, html: armarHtml(d),
      ...(d.responderA ? { replyTo: d.responderA } : {}),
      ...(d.adjuntos?.length ? { attachments: d.adjuntos.map((a) => ({ filename: a.nombre, content: a.contenido, contentType: a.tipo })) } : {}),
    });
    if (carpetaPrueba) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(`${carpetaPrueba}/correo-${Date.now()}.eml`, (info as { message: Buffer }).message);
    }
    return { ok: true };
  } catch (e) {
    console.error("No se pudo enviar el correo", e);
    return { ok: false, ...errorDeGmail(e) };
  }
}

export async function enviarCorreo(d: Envio): Promise<boolean> {
  return (await enviarConDetalle(d)).ok;
}
