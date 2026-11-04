"use server";

import { revalidatePath } from "next/cache";
import { exigirPermiso } from "@/lib/acceso";
import { conEmpresa, mensajeError, type Tx } from "@/lib/db";
import { huella, nombreSeguro, tipoPorContenido } from "@/lib/documentos";
import {
  ErrorFicha, guardarContactos, guardarEmpleados, guardarSocios, leerContactos, leerEmpleados, leerOperaciones, leerRelacion, leerSocios, leerSociedad,
} from "@/lib/ficha";
import type { Estado } from "../../acciones-cuenta";

// Ficha ampliada del cliente (bloque 1, entrega 1a): cada sección se guarda por separado y exige el permiso «empresa».
async function guardar(empresaId: string, ok: string, fn: (tx: Tx, usuarioId: string) => Promise<unknown>): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "empresa", "/empresa");
  try {
    await conEmpresa(empresaId, (tx) => fn(tx, usuario.id));
  } catch (e) {
    return { error: e instanceof ErrorFicha ? e.message : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/empresa`);
  return { ok };
}
const leer = <T>(fn: () => T): T | Estado => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErrorFicha) return { error: e.message };
    throw e;
  }
};
const esError = (x: unknown): x is Estado => !!x && typeof x === "object" && "error" in x;

export async function guardarFichaSociedad(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const d = leer(() => leerSociedad(fd));
  if (esError(d)) return d;
  return guardar(empresaId, "Datos de la sociedad guardados.", (tx) => tx`
    UPDATE empresas SET tipo_sociedad = ${d.tipo_sociedad}, fecha_constitucion = ${d.fecha_constitucion}, municipio = ${d.municipio},
           provincia = ${d.provincia}, capital_social = ${d.capital_social} WHERE id = ${empresaId}`);
}

export async function guardarFichaOperaciones(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const d = leer(() => leerOperaciones(fd));
  if (esError(d)) return d;
  return guardar(empresaId, "Operaciones guardadas.", (tx) => tx`
    UPDATE empresas SET ventas_mes = ${d.ventas_mes}, facturas_mes = ${d.facturas_mes}, empleados_mes = ${d.empleados_mes},
           tiene_tss = ${d.tiene_tss}, emite_ecf = ${d.emite_ecf}, sistema_usa = ${d.sistema_usa} WHERE id = ${empresaId}`);
}

export async function guardarFichaRelacion(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const d = leer(() => leerRelacion(fd));
  if (esError(d)) return d;
  return guardar(empresaId, "Relación con Empire guardada.", (tx) => tx`
    UPDATE empresas SET categoria = ${d.categoria}, tipo_cliente = ${d.tipo_cliente}, fecha_inicio_contrato = ${d.fecha_inicio_contrato},
           dia_facturacion = ${d.dia_facturacion}, estado_cliente = ${d.estado_cliente}, ficha_firmada = ${d.ficha_firmada},
           hoja_firmada = ${d.hoja_firmada}, contrato_firmado = ${d.contrato_firmado}, modalidad = ${d.modalidad},
           custodio_accesos = ${d.custodio_accesos} WHERE id = ${empresaId}`);
}

export async function guardarFichaSocios(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const d = leer(() => leerSocios(fd));
  if (esError(d)) return d;
  return guardar(empresaId, "Socios guardados.", (tx) => guardarSocios(tx, empresaId, d));
}

export async function guardarFichaContactos(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const d = leer(() => leerContactos(fd));
  if (esError(d)) return d;
  return guardar(empresaId, "Contactos guardados.", (tx) => guardarContactos(tx, empresaId, d));
}

export async function guardarFichaEmpleados(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const d = leer(() => leerEmpleados(fd));
  if (esError(d)) return d;
  return guardar(empresaId, "Empleados guardados.", (tx) => guardarEmpleados(tx, empresaId, d));
}

// Logo o membrete del cliente: PNG o JPG de hasta 1 MB, reconocido por su contenido. El anterior queda retirado.
const LOGO_MAXIMO = 1024 * 1024;
export async function subirLogo(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const archivo = fd.get("logo");
  if (!(archivo instanceof File) || archivo.size === 0) return { error: "Elige una imagen." };
  if (archivo.size > LOGO_MAXIMO) return { error: "El logo debe pesar 1 MB o menos." };
  const b = new Uint8Array(await archivo.arrayBuffer());
  const tipo = tipoPorContenido(b);
  if (tipo !== "image/png" && tipo !== "image/jpeg") return { error: "El logo debe ser una imagen PNG o JPG." };
  return guardar(empresaId, "Logo guardado.", async (tx, usuarioId) => {
    await tx`UPDATE documentos SET eliminado = true, eliminado_por = ${usuarioId}, eliminado_en = now()
              WHERE entidad = 'empresa' AND entidad_id = ${empresaId} AND descripcion = 'logo' AND NOT eliminado`;
    await tx`INSERT INTO documentos (empresa_id, entidad, entidad_id, nombre, tipo, tamano, sha256, contenido, descripcion, subido_por)
             VALUES (${empresaId}, 'empresa', ${empresaId}, ${nombreSeguro(archivo.name)}, ${tipo}, ${b.length}, ${huella(b)}, ${Buffer.from(b)}, 'logo', ${usuarioId})`;
  });
}
