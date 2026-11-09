"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso, misFirmas, soloCliente } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { urlApp } from "@/lib/enlaces";
import { CAMPOS, type Datos, faltantes } from "@/lib/mensajes";
import {
  armarTexto, datosDe, deshacerEnvio, ErrorMensaje, nuevoToken, plantillasDe, type Ref, registrarEnvio,
} from "@/lib/mensajes-db";

// Bloque 3, entrega 3c: «Enviar por WhatsApp». Se arma el mensaje, la persona lo revisa y abre WhatsApp; al abrirlo queda en la
// bitácora (con un deshacer). Pide el permiso «exportar» (comparte un PDF) y no lo usan los usuarios de los clientes.

const TIPOS_REF = ["factura", "cobro", "propuesta", "notificacion", "reporte", "proyeccion", "expediente", "formulario", "diagnostico"];

async function acceso(empresaId: string) {
  const a = await exigirPermiso(empresaId, "exportar");
  if (await soloCliente(a.empresa.firma_id, a.usuario.id)) throw new Error("Solo para el equipo de la firma");
  return a;
}

function leerRef(ref: Ref | null): Ref | null {
  if (!ref) return null;
  if (!TIPOS_REF.includes(ref.tipo) || !esUuid(ref.id)) throw new ErrorMensaje("Documento no válido.");
  return { tipo: ref.tipo, id: ref.id };
}

// Solo campos conocidos y cortos (vienen de la pantalla: alertas, por ejemplo).
function leerExtra(extra: Record<string, string> | undefined): Datos {
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra ?? {})) if ((CAMPOS as readonly string[]).includes(k) && typeof v === "string") r[k] = v.slice(0, 120);
  return r;
}

export type Preparacion = {
  error?: string; clave?: string; nombre?: string; texto?: string; faltan?: string[]; telefono?: string | null; contacto?: string | null;
  grupo?: string | null; token?: string | null; enlace?: string | null;
};

export async function prepararMensaje(empresaId: string, clave: string, refEntrada: Ref | null, extra?: Record<string, string>): Promise<Preparacion> {
  const { empresa } = await acceso(empresaId); // fuera del try: si no tiene permiso, lleva a otra pantalla
  try {
    const ref = leerRef(refEntrada);
    const plantilla = (await plantillasDe(empresa.firma_id)).find((p) => p.clave === clave);
    if (!plantilla) return { error: "Ese mensaje no está en la configuración de la firma." };
    const p = await conEmpresa(empresaId, (tx) => datosDe(tx, empresaId, ref));
    const token = p.enlace ? nuevoToken() : null;
    const url = token ? `${await urlApp()}/${p.enlace?.tipo === "formulario" ? "f" : "d"}/${token}` : null;
    const texto = armarTexto(plantilla.texto, p, url, leerExtra(extra));
    return {
      clave, nombre: plantilla.nombre, texto, faltan: faltantes(texto), telefono: p.destinatario.telefono, contacto: p.destinatario.nombre,
      grupo: p.destinatario.grupo, token, enlace: p.enlace?.titulo ?? null,
    };
  } catch (e) {
    return { error: e instanceof ErrorMensaje ? e.message : mensajeError(e) };
  }
}

export async function registrarMensaje(empresaId: string, d: {
  clave: string; texto: string; destino: "contacto" | "elegir"; ref: Ref | null; token: string | null;
}): Promise<{ id?: string; error?: string }> {
  const { empresa, usuario } = await acceso(empresaId); // fuera del try: si no tiene permiso, lleva a otra pantalla
  try {
    const ref = leerRef(d.ref);
    const plantilla = (await plantillasDe(empresa.firma_id)).find((p) => p.clave === d.clave);
    if (!plantilla) return { error: "Ese mensaje no está en la configuración de la firma." };
    if (d.token !== null && !/^[A-Za-z0-9_-]{20,64}$/.test(d.token)) return { error: "Enlace no válido." };
    const id = await conEmpresa(empresaId, async (tx) => {
      const p = await datosDe(tx, empresaId, ref); // lo que se comparte se vuelve a leer aquí, no se toma de la pantalla
      return registrarEnvio(tx, {
        empresaId, usuarioId: usuario.id, clave: plantilla.clave, nombre: plantilla.nombre, texto: d.texto, destino: d.destino === "contacto" ? "contacto" : "elegir",
        telefono: p.destinatario.telefono, ref, enlace: p.enlace, token: d.token,
      });
    });
    revalidatePath(`/e/${empresaId}`, "layout");
    return { id };
  } catch (e) {
    return { error: e instanceof ErrorMensaje ? e.message : mensajeError(e) };
  }
}

export async function deshacerMensaje(empresaId: string, mensajeId: string): Promise<{ ok?: boolean; error?: string }> {
  const { empresa, usuario } = await acceso(empresaId); // fuera del try: si no tiene permiso, lleva a otra pantalla
  try {
    if (!esUuid(mensajeId)) return { error: "Ese envío ya no está." };
    const administrador = (await misFirmas(usuario.id)).some((f) => f.id === empresa.firma_id && f.administrador);
    await conEmpresa(empresaId, (tx) => deshacerEnvio(tx, { mensajeId, usuarioId: usuario.id, administrador }));
    revalidatePath(`/e/${empresaId}`, "layout");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof ErrorMensaje ? e.message : mensajeError(e) };
  }
}
