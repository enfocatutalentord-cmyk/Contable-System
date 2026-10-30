"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { CAMPOS, MENSAJE_XLS, tipoEstadoCuenta, type Formato, type TipoArchivo } from "@/lib/archivos-banco";
import { ErrorContable } from "@/lib/asientos";
import { confirmarImportacion, deshacerImportacion } from "@/lib/bancos";
import { conEmpresa, mensajeError } from "@/lib/db";
import { huella, nombreSeguro, TAMANO_MAXIMO } from "@/lib/documentos";
import { leerMonto } from "@/lib/montos";
import type { Estado } from "../../acciones-cuenta";

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Alta o cambio de una cuenta bancaria (permiso «catálogo», como la configuración de cuentas).
export async function guardarCuentaBancaria(empresaId: string, cuentaBancariaId: string | null, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "catalogo", "/bancos");
  const banco = texto(fd, "banco").slice(0, 80);
  const nombre = texto(fd, "nombre").slice(0, 80);
  const numero = texto(fd, "numero") || null;
  const moneda = texto(fd, "moneda");
  const cuentaId = texto(fd, "cuenta_id");
  const fechaInicial = texto(fd, "fecha_inicial");
  const saldo = leerMonto(texto(fd, "saldo_inicial").replace(/^-/, ""));
  const negativo = texto(fd, "saldo_inicial").startsWith("-");
  if (!banco || !nombre) return { error: "Escribe el banco y un nombre para la cuenta." };
  if (numero && !/^\d{4}$/.test(numero)) return { error: "Del número de cuenta, escribe solo los últimos 4 dígitos." };
  if (!["DOP", "USD"].includes(moneda)) return { error: "Elige la moneda." };
  if (!cuentaBancariaId && !esUuid(cuentaId)) return { error: "Elige la cuenta del catálogo." };
  if (!FECHA.test(fechaInicial)) return { error: "Escribe la fecha desde la que vas a conciliar." };
  if (saldo === null) return { error: "El saldo inicial no es un monto válido." };
  const saldoInicial = negativo && saldo !== "0.00" ? `-${saldo}` : saldo;
  try {
    await conEmpresa(empresaId, async (tx) => {
      if (cuentaBancariaId) {
        if (!esUuid(cuentaBancariaId)) throw new ErrorContable("Cuenta no encontrada");
        // Con movimientos importados, la fecha inicial no puede quedar después del primero.
        const [{ primero }] = await tx<{ primero: string | null }[]>`
          SELECT to_char(min(fecha), 'YYYY-MM-DD') AS primero FROM movimientos_banco WHERE cuenta_bancaria_id = ${cuentaBancariaId}`;
        if (primero && fechaInicial > primero) throw new ErrorContable("Ya hay movimientos importados antes de esa fecha.");
        const r = await tx`UPDATE cuentas_bancarias SET banco = ${banco}, nombre = ${nombre}, numero = ${numero}, saldo_inicial = ${saldoInicial},
                                  fecha_inicial = ${fechaInicial}, activa = ${fd.get("activa") === "on"}
                            WHERE id = ${cuentaBancariaId}`;
        if (r.count === 0) throw new ErrorContable("Cuenta no encontrada");
      } else {
        await tx`INSERT INTO cuentas_bancarias (empresa_id, cuenta_id, banco, nombre, numero, moneda, saldo_inicial, fecha_inicial, creado_por)
                 VALUES (${empresaId}, ${cuentaId}, ${banco}, ${nombre}, ${numero}, ${moneda}, ${saldoInicial}, ${fechaInicial}, ${usuario.id})`;
      }
    });
  } catch (e) {
    const err = e as { code?: string };
    return { error: err.code === "23505" ? "Esa cuenta del catálogo ya está asignada a otra cuenta bancaria." : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/bancos`, "layout");
  return { ok: cuentaBancariaId ? "Cuenta guardada." : "Cuenta bancaria agregada." };
}

async function leerArchivo(fd: FormData): Promise<{ nombre: string; tipo: TipoArchivo; bytes: Uint8Array } | string> {
  const a = fd.get("archivo");
  if (!(a instanceof File) || a.size === 0) return "Elige el archivo del estado de cuenta.";
  if (a.size > TAMANO_MAXIMO) return "El archivo pasa de 4 MB. Descarga un período más corto.";
  const bytes = new Uint8Array(await a.arrayBuffer());
  const tipo = tipoEstadoCuenta(bytes);
  if (tipo === "xls") return MENSAJE_XLS;
  if (!tipo) return "El archivo no es Excel (.xlsx), CSV ni OFX. Si el banco solo da PDF, pide en la banca en línea la descarga en Excel o CSV.";
  return { nombre: nombreSeguro(a.name), tipo, bytes };
}

async function crearBorrador(empresaId: string, cuentaBancariaId: string, usuarioId: string, a: { nombre: string; tipo: TipoArchivo; bytes: Uint8Array }, recepcionId: string | null) {
  return conEmpresa(empresaId, async (tx) => {
    const [i] = await tx<{ id: string }[]>`
      INSERT INTO importaciones_banco (empresa_id, cuenta_bancaria_id, nombre, tipo, tamano, sha256, contenido, recepcion_id, creado_por)
      VALUES (${empresaId}, ${cuentaBancariaId}, ${a.nombre}, ${a.tipo}, ${a.bytes.length}, ${huella(a.bytes)}, ${Buffer.from(a.bytes)}, ${recepcionId}, ${usuarioId})
      RETURNING id`;
    return i.id;
  });
}

// Sube el estado de cuenta y abre la vista previa (todavía no importa nada).
export async function subirEstadoCuenta(empresaId: string, cuentaBancariaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/bancos");
  if (!esUuid(cuentaBancariaId)) return { error: "Cuenta no encontrada." };
  const a = await leerArchivo(fd);
  if (typeof a === "string") return { error: a };
  let id: string;
  try {
    id = await crearBorrador(empresaId, cuentaBancariaId, usuario.id, a, null);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  redirect(`/e/${empresaId}/bancos/${cuentaBancariaId}/importar/${id}`);
}

const MIME_A_TIPO: Record<string, TipoArchivo> = {
  "text/csv": "csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx", "application/x-ofx": "ofx",
};

// Importa un estado de cuenta que el cliente subió en «Mis documentos».
export async function importarDesdeRecepcion(empresaId: string, recepcionId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/bancos");
  const cuentaBancariaId = texto(fd, "cuenta_bancaria_id");
  if (!esUuid(recepcionId) || !esUuid(cuentaBancariaId)) return { error: "Elige la cuenta bancaria." };
  let id: string;
  try {
    const r = await conEmpresa(empresaId, async (tx) => {
      const [r] = await tx<{ nombre: string; tipo: string; contenido: Buffer; categoria: string }[]>`
        SELECT nombre, tipo, contenido, categoria FROM recepciones WHERE id = ${recepcionId}`;
      return r;
    });
    const tipo = r && MIME_A_TIPO[r.tipo];
    if (!r || r.categoria !== "estado_bancario" || !tipo) return { error: "Ese documento no es un estado de cuenta en Excel, CSV u OFX." };
    id = await crearBorrador(empresaId, cuentaBancariaId, usuario.id, { nombre: r.nombre, tipo, bytes: new Uint8Array(r.contenido) }, recepcionId);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  redirect(`/e/${empresaId}/bancos/${cuentaBancariaId}/importar/${id}`);
}

// Cambia qué columna es cada dato (y la fila del encabezado) en una importación en borrador.
export async function guardarFormato(empresaId: string, importacionId: string, _: Estado, fd: FormData): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/bancos");
  if (!esUuid(importacionId)) return { error: "Importación no encontrada." };
  const col = (c: string) => texto(fd, c) || null;
  const encabezado = Number(texto(fd, "encabezado"));
  const orden = texto(fd, "orden");
  if (!Number.isInteger(encabezado) || encabezado < 0 || encabezado > 1000) return { error: "Fila del encabezado no válida." };
  if (!["dma", "mda", "amd"].includes(orden)) return { error: "Elige cómo vienen las fechas." };
  const formato: Formato = {
    encabezado, fecha: col("fecha") ?? "", descripcion: col("descripcion") ?? "", referencia: col("referencia"), debito: col("debito"),
    credito: col("credito"), monto: col("monto"), saldo: col("saldo"), orden: orden as Formato["orden"], invertir: fd.get("invertir") === "on",
  };
  if (formato.monto) formato.debito = formato.credito = null;
  for (const [c] of CAMPOS) if (typeof formato[c] === "string" && (formato[c] as string).length > 200) return { error: "Nombre de columna muy largo." };
  try {
    await conEmpresa(empresaId, async (tx) => {
      const r = await tx`UPDATE importaciones_banco SET formato = ${tx.json(formato)} WHERE id = ${importacionId} AND estado = 'borrador'`;
      if (r.count === 0) throw new ErrorContable("Esta importación ya no está en borrador");
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/bancos`, "layout");
  return { ok: "Formato aplicado. Revisa la vista previa." };
}

export async function importarMovimientos(empresaId: string, importacionId: string, _: Estado, _fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/bancos");
  if (!esUuid(importacionId)) return { error: "Importación no encontrada." };
  let destino: string;
  try {
    destino = await conEmpresa(empresaId, async (tx) => {
      const v = await confirmarImportacion(tx, importacionId, usuario.id);
      const [{ cuenta }] = await tx<{ cuenta: string }[]>`SELECT cuenta_bancaria_id AS cuenta FROM importaciones_banco WHERE id = ${importacionId}`;
      return `/e/${empresaId}/bancos/${cuenta}?importados=${v.nuevos}&repetidos=${v.repetidos}`;
    });
  } catch (e) {
    const err = e as { code?: string };
    return { error: err.code === "23505" ? "Este mismo archivo ya se importó en esta cuenta." : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(destino);
}

export async function descartarImportacion(empresaId: string, importacionId: string, _: Estado, _fd: FormData): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/bancos");
  if (!esUuid(importacionId)) return { error: "Importación no encontrada." };
  let cuenta: string;
  try {
    cuenta = await conEmpresa(empresaId, async (tx) => {
      const [r] = await tx<{ cuenta: string }[]>`UPDATE importaciones_banco SET estado = 'descartada' WHERE id = ${importacionId} AND estado = 'borrador'
                                                  RETURNING cuenta_bancaria_id AS cuenta`;
      if (!r) throw new ErrorContable("Esta importación ya no está en borrador");
      return r.cuenta;
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  redirect(`/e/${empresaId}/bancos/${cuenta}`);
}

export async function deshacer(empresaId: string, importacionId: string, _: Estado, _fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/bancos");
  if (!esUuid(importacionId)) return { error: "Importación no encontrada." };
  let cuenta: string;
  try {
    cuenta = await conEmpresa(empresaId, async (tx) => {
      await deshacerImportacion(tx, importacionId, usuario.id);
      return (await tx<{ c: string }[]>`SELECT cuenta_bancaria_id AS c FROM importaciones_banco WHERE id = ${importacionId}`)[0].c;
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/bancos/${cuenta}?deshecha=1`);
}
