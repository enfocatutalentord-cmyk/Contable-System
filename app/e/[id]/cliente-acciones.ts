"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accesoEmpresa, esUuid, exigirPermiso } from "@/lib/acceso";
import { enviarCorreo } from "@/lib/correo";
import { db, conEmpresa, mensajeError } from "@/lib/db";
import { urlApp } from "@/lib/enlaces";
import { nuevoToken, ponerEnlace, PRIORIDADES, serviciosDeLaFirma } from "@/lib/formularios";
import { hoyISO } from "@/lib/montos";
import { puedeVer } from "@/lib/pestanas";
import { pasarACliente } from "@/lib/prospectos";
import type { Estado } from "../../acciones-cuenta";

const texto = (fd: FormData, campo: string) => String(fd.get(campo) ?? "").trim();

// Lo que hace el cliente (o el prospecto) desde su cuenta en la aplicación (bloque 8a). Pide solo «ver» y la pestaña de
// Solicitudes: el cliente no tiene «registrar», pero sí puede pedir y llenar lo suyo.
async function accesoCliente(empresaId: string) {
  const a = await accesoEmpresa(empresaId);
  if (a.supervision || !puedeVer(a.pestanas, "/solicitudes")) redirect(`/e/${empresaId}?sin_pestana=1`);
  return a;
}

export async function pedirServicio(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, empresa } = await accesoCliente(empresaId);
  const tipo = texto(fd, "tipo") === "requerimiento" ? "requerimiento" : "servicio";
  const descripcion = texto(fd, "descripcion").slice(0, 2000);
  const paraQue = texto(fd, "para_que").slice(0, 1000) || null;
  const fecha = texto(fd, "fecha_requerida") || null;
  const prioridad = texto(fd, "prioridad") in PRIORIDADES ? texto(fd, "prioridad") : "media";
  const servicioId = texto(fd, "servicio_id") || null;
  if (!descripcion) return { error: "Describe qué necesitas." };
  if (fecha && (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha < hoyISO())) return { error: "La fecha para cuándo lo necesitas no es válida." };
  let servicio: string | null = null;
  if (servicioId) {
    const [{ propia }] = await db()<{ propia: string | null }[]>`SELECT empresa_propia_id AS propia FROM firmas WHERE id = ${empresa.firma_id}`;
    const s = (await serviciosDeLaFirma(propia)).find((x) => x.id === servicioId);
    if (!s) return { error: "Elige el servicio de la lista." };
    servicio = s.nombre;
  }
  try {
    await conEmpresa(empresaId, (tx) => tx`
      INSERT INTO solicitudes (empresa_id, origen, tipo, servicio_id, servicio, descripcion, para_que, fecha_requerida, prioridad, creado_por)
      VALUES (${empresaId}, 'app', ${tipo}, ${servicioId}, ${servicio}, ${descripcion}, ${paraQue}, ${fecha}, ${prioridad}, ${usuario.id})`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: "Recibimos tu solicitud. Aquí verás cuando la coticemos y cómo va." };
}

// Abre su formulario (Ficha de Registro o Constitución) en la misma página en línea que se envía por WhatsApp (bloque 6a).
export async function llenarFormulario(empresaId: string, tipo: string): Promise<Estado> {
  const { usuario } = await accesoCliente(empresaId);
  if (tipo !== "ficha" && tipo !== "constitucion") return { error: "Ese formulario no existe." };
  const token = nuevoToken();
  try {
    await conEmpresa(empresaId, async (tx) => {
      const [f] = await tx<{ id: string }[]>`SELECT id FROM formularios WHERE tipo = ${tipo} AND estado = 'pendiente' ORDER BY creado DESC LIMIT 1`;
      const id = f?.id ?? (await tx<{ id: string }[]>`INSERT INTO formularios (empresa_id, tipo, creado_por) VALUES (${empresaId}, ${tipo}, ${usuario.id}) RETURNING id`)[0].id;
      await ponerEnlace(tx, id, token);
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  redirect(`/f/${token}`);
}

// El prospecto firmó: pasa a cliente con aplicación, con la misma cuenta. Lo hace el equipo (permiso «registrar»).
export async function pasarAClienteAccion(empresaId: string, _: Estado): Promise<Estado> {
  const { usuario, empresa, paraClientes } = await exigirPermiso(empresaId, "registrar", "/solicitudes");
  if (paraClientes) return { error: "Esto lo hace el equipo de la firma." };
  if (!esUuid(empresaId)) return { error: "La empresa no existe." };
  let personas: { email: string; nombre: string }[];
  try {
    // Los roles y las personas son de la firma: se usa la conexión dueña con la empresa y quién lo hace fijados (historial).
    ({ personas } = await db().begin(async (tx) => {
      await tx`SELECT set_config('app.empresa_id', ${empresaId}, true)`;
      await tx`SELECT set_config('app.usuario_id', ${usuario.id}, true)`;
      return pasarACliente(tx, empresaId, hoyISO());
    }) as { personas: { email: string; nombre: string }[] });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  const app = await urlApp();
  for (const p of personas) {
    await enviarCorreo({
      para: p.email, asunto: `Ya eres cliente de ${empresa.firma}`, titulo: `Hola, ${p.nombre}`,
      parrafos: [`Bienvenido como cliente de ${empresa.firma}. En tu cuenta ya ves tu pantalla de inicio con lo de cada mes.`,
        "Desde ahí sigues pidiendo servicios y subiendo tus documentos."],
      boton: { texto: "Entrar a mi cuenta", url: `${app}/e/${empresaId}` },
    });
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/solicitudes?paso_a_cliente=${personas.length}`);
}
