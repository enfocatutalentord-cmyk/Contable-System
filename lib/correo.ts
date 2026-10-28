import nodemailer from "nodemailer";

// Correos del sistema (enlaces de acceso), enviados con Gmail como en la web de Empire.
// Requiere en Vercel: GMAIL_CLAVE_APP (contraseña de aplicación de Google, secreta). GMAIL_USUARIO es opcional
// (por defecto el correo de Empire). Sin la clave no se envía nada: quien da el acceso ve el enlace para pasarlo a mano.

const usuario = process.env.GMAIL_USUARIO || "empiretaxnlegal@gmail.com";
const clave = (process.env.GMAIL_CLAVE_APP || "").replace(/\s/g, ""); // Google la muestra en grupos de 4 con espacios

const transporte = clave
  ? nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: usuario, pass: clave } })
  : null;

export const escapar = (t: string) =>
  t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function enviarCorreo(d: { para: string; asunto: string; titulo: string; parrafos: string[]; boton?: { texto: string; url: string }; pie?: string }): Promise<boolean> {
  if (!transporte) return false;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1d241f;max-width:560px">
    <div style="background:#003D19;color:#F6F3EC;padding:16px 20px;border-bottom:3px solid #B88A40;font-weight:bold;letter-spacing:1px">EMPIRE TAX’N LEGAL · Sistema contable</div>
    <div style="padding:20px">
      <h2 style="color:#003D19;margin:0 0 12px">${escapar(d.titulo)}</h2>
      ${d.parrafos.map((p) => `<p style="margin:0 0 12px">${escapar(p)}</p>`).join("")}
      ${d.boton ? `<p style="margin:22px 0"><a href="${escapar(d.boton.url)}" style="background:#003D19;color:#F6F3EC;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">${escapar(d.boton.texto)}</a></p>
      <p style="font-size:13px;color:#4e5a52">Si el botón no abre, copia este enlace en el navegador:<br>${escapar(d.boton.url)}</p>` : ""}
      ${d.pie ? `<p style="font-size:13px;color:#4e5a52;margin-top:18px">${escapar(d.pie)}</p>` : ""}
    </div></div>`;
  const texto = [d.titulo, "", ...d.parrafos, ...(d.boton ? ["", `${d.boton.texto}: ${d.boton.url}`] : []), ...(d.pie ? ["", d.pie] : [])].join("\n");
  try {
    await transporte.sendMail({ from: `"Empire Tax’N Legal · Sistema contable" <${usuario}>`, to: d.para, subject: d.asunto, text: texto, html });
    return true;
  } catch (e) {
    console.error("No se pudo enviar el correo", e);
    return false;
  }
}
