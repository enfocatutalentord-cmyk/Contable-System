import { enviarCorreo } from "./correo";
import { db } from "./db";
import { crearEmpresa } from "./empresas";
import { crearEnlace, urlApp } from "./enlaces";
import { asegurarUsuario } from "./equipo";
import { altaPermitida, ROL_PROSPECTO, type DatosAlta } from "./prospectos";

// Registro del prospecto desde la página pública de la firma (bloque 8a). Corre con la conexión dueña: todavía no hay sesión.
// Siempre responde lo mismo, exista o no la cuenta, para no revelar quién está registrado.
export type ResultadoAlta = { ok: true } | { ok: false; error: string };

export async function registrarProspecto(firmaId: string, d: DatosAlta, ip: string | null): Promise<ResultadoAlta> {
  const [firma] = await db()<{ nombre: string; alta_clientes: boolean; suspendida: boolean }[]>`
    SELECT nombre, alta_clientes, suspendida_en IS NOT NULL AS suspendida FROM firmas WHERE id = ${firmaId}`;
  if (!firma || !firma.alta_clientes || firma.suspendida) return { ok: false, error: "Esta página de registro no está disponible." };
  if (!(await altaPermitida(db(), d.email, ip))) return { ok: false, error: "Ya recibimos varios registros en poco tiempo. Espera una hora e inténtalo de nuevo." };
  await db()`INSERT INTO altas_prospecto (firma_id, email, ip) VALUES (${firmaId}, ${d.email}, ${ip})`;

  const [ya] = await db()<{ id: string; nombre: string }[]>`SELECT id, nombre FROM usuarios WHERE email = ${d.email}`;
  const app = await urlApp();
  if (ya) {
    // Ya tiene cuenta: no se crea otra empresa; se le recuerda cómo entrar.
    await enviarCorreo({
      para: d.email, asunto: `Tu cuenta en ${firma.nombre}`, titulo: `Hola, ${ya.nombre}`,
      parrafos: ["Alguien (quizás tú) intentó crear una cuenta con este correo, pero ya tienes una.",
        "Entra con tu correo y tu contraseña. Si no la recuerdas, usa «¿Olvidaste tu contraseña?» en la pantalla de entrada."],
      boton: { texto: "Entrar", url: `${app}/entrar` },
    });
    return { ok: true };
  }

  const r = await db().begin(async (tx) => {
    const u = await asegurarUsuario(tx, d.email, d.nombre);
    await tx`INSERT INTO miembros_firma (firma_id, usuario_id) VALUES (${firmaId}, ${u.id}) ON CONFLICT DO NOTHING`;
    const empresaId = await crearEmpresa({
      firmaId, usuarioId: u.id,
      ficha: {
        nombre: d.negocio, nombre_comercial: null, tipo_identificacion: d.tipo ?? "rnc", rnc: d.identificacion, actividad_economica: null,
        regimen: "ordinario", direccion: null, telefono: d.telefono, correo: d.email, mes_cierre: 12, inicio_operaciones: null,
        requiere_aprobacion: false, activa: true,
      },
    }, tx);
    await tx`UPDATE empresas SET estado_cliente = 'prospecto', alta_app = now() WHERE id = ${empresaId}`;
    await tx`INSERT INTO contactos_empresa (empresa_id, rol, nombre, telefono, whatsapp, correo)
             VALUES (${empresaId}, 'principal', ${d.nombre}, ${d.telefono}, ${d.telefono}, ${d.email})`;
    const [rol] = await tx<{ id: string }[]>`SELECT id FROM perfiles WHERE firma_id = ${firmaId} AND nombre = ${ROL_PROSPECTO}`;
    if (!rol) throw new Error("Falta el rol de prospecto en la firma");
    await tx`INSERT INTO miembros (empresa_id, usuario_id, perfil_id) VALUES (${empresaId}, ${u.id}, ${rol.id})`;
    const url = await crearEnlace(tx, u.id, "invitacion", null);
    const admins = await tx<{ email: string }[]>`
      SELECT u.email FROM miembros_firma mf JOIN usuarios u ON u.id = mf.usuario_id WHERE mf.firma_id = ${firmaId} AND mf.administrador`;
    return { url, empresaId, admins: admins.map((a) => a.email) };
  });

  const enviado = await enviarCorreo({
    para: d.email, asunto: `Bienvenido a ${firma.nombre}`, titulo: `Hola, ${d.nombre}`,
    parrafos: [`Creaste tu cuenta en la aplicación de ${firma.nombre}.`,
      "Toca el botón para verificar tu correo y crear tu contraseña. Después podrás pedir servicios, llenar tus formularios y subir tus documentos."],
    boton: { texto: "Verificar mi correo y crear contraseña", url: r.url },
    pie: "El enlace es personal, sirve una sola vez y vence en 72 horas.",
  });
  // Sin correo configurado (copia local), el enlace queda en el registro del servidor para poder probar.
  if (!enviado && !process.env.VERCEL) console.log(`[prospecto] Enlace de acceso de ${d.email}: ${r.url}`);
  for (const a of r.admins) {
    await enviarCorreo({
      para: a, asunto: `Prospecto nuevo: ${d.negocio}`, titulo: "Se registró un prospecto en la aplicación",
      parrafos: [`${d.nombre} (${d.email}, ${d.telefono}) creó su cuenta para «${d.negocio}».`,
        "Ya está en Clientes de la firma con el estado «Prospecto». Cuando firme el contrato, pásalo a cliente desde «Solicitudes y formularios»."],
      boton: { texto: "Ver sus solicitudes", url: `${app}/e/${r.empresaId}/solicitudes` },
    });
  }
  return { ok: true };
}
