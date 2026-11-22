"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { leerTabla, MENSAJE_XLS, tipoEstadoCuenta } from "@/lib/archivos-banco";
import { clienteDeFormulario } from "@/lib/cliente-rapido";
import { conEmpresa, mensajeError } from "@/lib/db";
import { ErrorExpediente, guardarArchivos, leerArchivos } from "@/lib/expediente";
import {
  cambiarEstadoConteo, crearConteo, deshacerLectura, ErrorInventario, fijarTotal, leerCantidadLectura, leerConteo, leerDecimal, leerExistencias, registrarLectura, verCantidad,
} from "@/lib/inventario";
import { CARPETA_REPORTE, descripcionReporte, pdfInventario, reporteConteo } from "@/lib/inventario-reporte";
import { hoyISO } from "@/lib/montos";
import type { Permiso } from "@/lib/permisos";
import type { Estado } from "../acciones-cuenta";

// Prioridad 3 · P3l · Inventario: conteos. Se trabaja desde las pantallas de la firma; cada acción pide su permiso en el cliente (pestaña Expediente y trámites): «registrar» para abrir
// el conteo y anotar lecturas, «cerrar» para cerrarlo y «reabrir» para abrirlo de nuevo.

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();
const mensaje = (e: unknown) => (e instanceof ErrorInventario || e instanceof ErrorExpediente ? e.message : mensajeError(e));
const ruta = (firmaId: string, empresaId: string, conteoId: string) => `/firma/${firmaId}/inventario/${empresaId}/${conteoId}`;

async function acceso(firmaId: string, empresaId: string, conteoId: string | null, permiso: Permiso) {
  if (!esUuid(empresaId) || (conteoId !== null && !esUuid(conteoId))) throw new ErrorInventario("Ese conteo no existe.");
  const a = await exigirPermiso(empresaId, permiso, "/expediente");
  if (a.empresa.firma_id !== firmaId) throw new ErrorInventario("Ese cliente no es de la firma.");
  if (await soloCliente(firmaId, a.usuario.id)) throw new ErrorInventario("Solo el equipo de la firma hace los conteos.");
  return a;
}

const listo = (firmaId: string, empresaId: string, conteoId: string, ok: string): Estado => {
  revalidatePath(ruta(firmaId, empresaId, conteoId));
  revalidatePath(`/firma/${firmaId}/inventario`);
  return { ok };
};

// Abre un conteo con el Excel (o CSV) de existencias del cliente. Si algo del archivo está mal no se crea nada y se dice qué fila y por qué.
export async function crearConteoAccion(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  let destino = "";
  try {
    const d = leerConteo(fd);
    const archivos = await leerArchivos(fd, "archivo", 1);
    if (!archivos.length) throw new ErrorInventario("Sube el Excel (.xlsx) o CSV con las existencias del cliente.");
    const { nombre, bytes } = archivos[0];
    const tipo = tipoEstadoCuenta(bytes);
    if (tipo === "xls") throw new ErrorInventario(MENSAJE_XLS);
    if (tipo !== "xlsx" && tipo !== "csv") throw new ErrorInventario("El listado debe ser un Excel (.xlsx) o un CSV.");
    let filas;
    try { filas = await leerTabla(bytes, tipo); } catch { throw new ErrorInventario("No se pudo leer el archivo: parece dañado."); }
    const lectura = leerExistencias(filas);
    if (lectura.errores.length) {
      const primeros = lectura.errores.slice(0, 8).join(" · ");
      throw new ErrorInventario(`${lectura.errores.length === 1 ? "Hay 1 problema" : `Hay ${lectura.errores.length} problemas`} en el listado y no se creó el conteo. ${primeros}${lectura.errores.length > 8 ? " · …" : ""}`);
    }
    const empresaId = (await clienteDeFormulario(firmaId, fd)).id;
    const { usuario } = await acceso(firmaId, empresaId, null, "registrar");
    const id = await conEmpresa(empresaId, async (tx) => {
      const conteoId = await crearConteo(tx, { ...d, empresaId, usuarioId: usuario.id, archivoNombre: nombre, articulos: lectura.articulos });
      // El Excel original queda guardado con el conteo (el CSV no: el expediente solo guarda Word, Excel, PDF e imágenes).
      if (tipo === "xlsx" && /\.xlsx$/i.test(nombre)) {
        await guardarArchivos(tx, { empresaId, usuarioId: usuario.id, archivos: [{ nombre, bytes }], entidad: "conteo", entidadId: conteoId, carpeta: null, anio: null, descripcion: "Existencias del cliente" });
      }
      return conteoId;
    });
    destino = `${ruta(firmaId, empresaId, id)}?creado=${lectura.articulos.length}${lectura.avisos.length ? "&avisos=1" : ""}`;
  } catch (e) {
    return { error: mensaje(e) };
  }
  revalidatePath(`/firma/${firmaId}/inventario`);
  redirect(destino);
}

export type RespuestaLectura =
  | { error: string }
  | { ok: true; codigo: string; encontrado: boolean; nombre: string; unidad: string; cantidad: string; total: string };

// Una lectura: la llama el lector de la pantalla del conteo, una por cada código que se escanea o se escribe.
export async function registrarLecturaAccion(firmaId: string, empresaId: string, conteoId: string, codigo: string, cantidad: string, origen: string): Promise<RespuestaLectura> {
  try {
    const { usuario } = await acceso(firmaId, empresaId, conteoId, "registrar");
    const n = leerCantidadLectura(cantidad);
    const r = await conEmpresa(empresaId, (tx) => registrarLectura(tx, { conteoId, empresaId, usuarioId: usuario.id, codigo: String(codigo), cantidad: n, origen: origen === "manual" ? "manual" : "lector" }));
    revalidatePath(ruta(firmaId, empresaId, conteoId));
    return { ok: true, codigo: r.articulo?.codigo ?? r.codigo, encontrado: !!r.articulo, nombre: r.articulo?.nombre || r.articulo?.codigo || "", unidad: r.articulo?.unidad ?? "", cantidad: verCantidad(r.cantidad), total: verCantidad(r.total) };
  } catch (e) {
    return { error: mensaje(e) };
  }
}

// Fijar a mano el total contado de un artículo.
export async function fijarTotalAccion(firmaId: string, empresaId: string, conteoId: string, articuloId: string, _: Estado, fd: FormData): Promise<Estado> {
  try {
    const { usuario } = await acceso(firmaId, empresaId, conteoId, "registrar");
    if (!esUuid(articuloId)) throw new ErrorInventario("Ese artículo no existe.");
    const total = leerDecimal(texto(fd, "total"));
    if (total === null || total < 0n) throw new ErrorInventario("El total contado no es un número válido.");
    await conEmpresa(empresaId, (tx) => fijarTotal(tx, { conteoId, empresaId, usuarioId: usuario.id, articuloId, total, nota: texto(fd, "nota") }));
    return listo(firmaId, empresaId, conteoId, `Total fijado en ${verCantidad(total)}.`);
  } catch (e) {
    return { error: mensaje(e) };
  }
}

export async function deshacerLecturaAccion(firmaId: string, empresaId: string, conteoId: string, lecturaId: string): Promise<Estado> {
  try {
    const { usuario } = await acceso(firmaId, empresaId, conteoId, "registrar");
    if (!esUuid(lecturaId)) throw new ErrorInventario("Esa lectura no existe.");
    await conEmpresa(empresaId, (tx) => deshacerLectura(tx, { id: lecturaId, conteoId, usuarioId: usuario.id }));
    return listo(firmaId, empresaId, conteoId, "Lectura deshecha.");
  } catch (e) {
    return { error: mensaje(e) };
  }
}

export async function cambiarEstadoConteoAccion(firmaId: string, empresaId: string, conteoId: string, estado: string): Promise<Estado> {
  try {
    if (estado !== "abierto" && estado !== "cerrado") throw new ErrorInventario("Elige el estado.");
    // Cerrar y reabrir tienen su propio permiso.
    const { usuario } = await acceso(firmaId, empresaId, conteoId, estado === "cerrado" ? "cerrar" : "reabrir");
    await conEmpresa(empresaId, (tx) => cambiarEstadoConteo(tx, conteoId, estado, usuario.id));
    return listo(firmaId, empresaId, conteoId, estado === "cerrado" ? "Conteo cerrado." : "Conteo abierto otra vez.");
  } catch (e) {
    return { error: mensaje(e) };
  }
}

// Guarda el reporte de diferencias (PDF para el cliente, con su logo) en la carpeta 05 · Reportes del expediente. Solo de un conteo cerrado. Cada vez que se guarda queda una
// copia nueva (si se reabre el conteo y se vuelve a cerrar, el reporte cambia).
export async function guardarReporteAccion(firmaId: string, empresaId: string, conteoId: string): Promise<Estado> {
  try {
    const { usuario, empresa } = await acceso(firmaId, empresaId, conteoId, "adjuntar");
    const { firma } = await accesoFirma(firmaId, false);
    await conEmpresa(empresaId, async (tx) => {
      const rep = await reporteConteo(tx, conteoId);
      if (!rep) throw new ErrorInventario("Ese conteo no existe.");
      if ("error" in rep) throw new ErrorInventario(rep.error);
      const pdf = await pdfInventario(tx, { empresaId, empresa: empresa.nombre, rnc: empresa.rnc, firma: firma.nombre, preparadoPor: usuario.nombre, rep });
      await guardarArchivos(tx, {
        empresaId, usuarioId: usuario.id, archivos: [{ nombre: pdf.nombre, bytes: pdf.datos }], carpeta: CARPETA_REPORTE, anio: Number(hoyISO().slice(0, 4)), descripcion: descripcionReporte(rep.numero, rep.nombre),
      });
    });
    revalidatePath(`/e/${empresaId}/expediente`);
    return listo(firmaId, empresaId, conteoId, "Reporte guardado en el expediente del cliente, carpeta 05 · Reportes.");
  } catch (e) {
    return { error: mensaje(e) };
  }
}
