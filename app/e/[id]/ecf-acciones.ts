"use server";

// Factura electrónica con emisión propia. E2a: ambiente, prueba de conexión y XML de prueba. E3a: cada persona sube su propio
// certificado en «Mi certificado» (rol Firmante de la DGII) y decide si lo comparte como principal de su empresa.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { ErrorCertificado } from "@/lib/ecf-certificado";
import { ErrorLlave, hayLlave } from "@/lib/ecf-cifrado";
import { ErrorDgii } from "@/lib/ecf-dgii";
import { compartirCertificado, guardarAmbiente, guardarCertificado, probarConexion, retirarCertificado, xmlDePrueba } from "@/lib/ecf-emision";
import { hoyISO } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import type { Estado } from "../../acciones-cuenta";

const mensaje = (e: unknown) => (e instanceof ErrorCertificado || e instanceof ErrorLlave || e instanceof ErrorDgii ? e.message : mensajeError(e));
const revalidar = (empresaId: string) => {
  revalidatePath(`/e/${empresaId}/certificado`);
  revalidatePath(`/e/${empresaId}/fiscal/ecf`);
};

// Cada persona sube el suyo (necesita poder emitir: permiso «contabilizar»).
export async function subirCertificado(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "contabilizar", "/certificado");
  if (!hayLlave()) return { error: "Falta la llave de cifrado ECF_LLAVE en Vercel. Pídesela a quien administra Vercel antes de subir el certificado." };
  const archivo = fd.get("certificado");
  const clave = String(fd.get("clave") ?? "");
  if (!(archivo instanceof File) || !archivo.size) return { error: "Elige el archivo .p12 del certificado." };
  if (!clave) return { error: "Escribe la contraseña del certificado." };
  try {
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const principal = fd.get("principal") === "1";
    const c = await conEmpresa(empresaId, (tx) => guardarCertificado(tx, { empresaId, usuarioId: usuario.id, bytes, clave, hoy: hoyISO(), principal }));
    revalidar(empresaId);
    return { ok: `Certificado de ${c.titular} guardado, vigente hasta el ${c.vence}.` };
  } catch (e) {
    return { error: mensaje(e) };
  }
}

// Sin certificadoId: el suyo. Con certificadoId: el de otra persona, solo con el permiso «empresa».
export async function quitarCertificado(empresaId: string, certificadoId: string | null): Promise<Estado> {
  const { usuario, permisos } = certificadoId
    ? await exigirPermiso(empresaId, "empresa", "/fiscal")
    : await exigirPermiso(empresaId, "contabilizar", "/certificado");
  if (certificadoId && !esUuid(certificadoId)) return { error: "Certificado no válido." };
  try {
    await conEmpresa(empresaId, (tx) => retirarCertificado(tx, { empresaId, usuarioId: usuario.id, certificadoId: certificadoId ?? undefined, deOtros: puede(permisos, "empresa") }));
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidar(empresaId);
  return { ok: "Certificado retirado." };
}

export async function compartirMiCertificado(empresaId: string, principal: boolean): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "contabilizar", "/certificado");
  try {
    await conEmpresa(empresaId, (tx) => compartirCertificado(tx, { empresaId, usuarioId: usuario.id, principal }));
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidar(empresaId);
  return { ok: principal ? "Tu certificado es ahora el principal de la empresa." : "Tu certificado ya no se comparte." };
}

export async function cambiarAmbiente(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "empresa", "/fiscal");
  const ambiente = String(fd.get("ambiente") ?? "") || null;
  try {
    await conEmpresa(empresaId, (tx) => guardarAmbiente(tx, { empresaId, usuarioId: usuario.id, ambiente }));
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidar(empresaId);
  return { ok: "Ambiente guardado." };
}

// Prueba la conexión con el certificado de quien la pide (o el principal).
export async function probarConexionDgii(empresaId: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "contabilizar", "/certificado");
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
