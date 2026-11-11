"use server";

// Factura electrónica con emisión propia, entrega E2a: certificado, ambiente, prueba de conexión y XML de prueba.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPermiso } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { ErrorCertificado } from "@/lib/ecf-certificado";
import { ErrorLlave, hayLlave } from "@/lib/ecf-cifrado";
import { ErrorDgii } from "@/lib/ecf-dgii";
import { guardarAmbiente, guardarCertificado, probarConexion, retirarCertificado, xmlDePrueba } from "@/lib/ecf-emision";
import { hoyISO } from "@/lib/montos";
import type { Estado } from "../../acciones-cuenta";

const mensaje = (e: unknown) => (e instanceof ErrorCertificado || e instanceof ErrorLlave || e instanceof ErrorDgii ? e.message : mensajeError(e));

export async function subirCertificado(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "empresa", "/fiscal");
  if (!hayLlave()) return { error: "Falta la llave de cifrado ECF_LLAVE en Vercel. Pídesela a quien administra Vercel antes de subir el certificado." };
  const archivo = fd.get("certificado");
  const clave = String(fd.get("clave") ?? "");
  if (!(archivo instanceof File) || !archivo.size) return { error: "Elige el archivo .p12 del certificado." };
  if (!clave) return { error: "Escribe la contraseña del certificado." };
  try {
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const c = await conEmpresa(empresaId, (tx) => guardarCertificado(tx, { empresaId, usuarioId: usuario.id, bytes, clave, hoy: hoyISO() }));
    revalidatePath(`/e/${empresaId}/fiscal/ecf`);
    return { ok: `Certificado de ${c.titular} guardado, vigente hasta el ${c.vence}.` };
  } catch (e) {
    return { error: mensaje(e) };
  }
}

export async function quitarCertificado(empresaId: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "empresa", "/fiscal");
  try {
    await conEmpresa(empresaId, (tx) => retirarCertificado(tx, { empresaId, usuarioId: usuario.id }));
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath(`/e/${empresaId}/fiscal/ecf`);
  return { ok: "Certificado retirado." };
}

export async function cambiarAmbiente(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "empresa", "/fiscal");
  const ambiente = String(fd.get("ambiente") ?? "") || null;
  try {
    await conEmpresa(empresaId, (tx) => guardarAmbiente(tx, { empresaId, usuarioId: usuario.id, ambiente }));
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath(`/e/${empresaId}/fiscal/ecf`);
  return { ok: "Ambiente guardado." };
}

export async function probarConexionDgii(empresaId: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "empresa", "/fiscal");
  try {
    return { ok: await conEmpresa(empresaId, (tx) => probarConexion(tx, { empresaId, usuarioId: usuario.id })) };
  } catch (e) {
    return { error: mensaje(e) };
  }
}

export async function generarXmlPrueba(empresaId: string, facturaId: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "contabilizar", "/facturas");
  let id: string;
  try {
    ({ id } = await conEmpresa(empresaId, (tx) => xmlDePrueba(tx, { empresaId, usuarioId: usuario.id, facturaId, ahora: new Date() })));
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath(`/e/${empresaId}/facturas/${facturaId}`);
  redirect(`/e/${empresaId}/facturas/${facturaId}?xml=${id}#ecf`);
}
