"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { bitacora } from "@/lib/asientos";
import { conEmpresa, mensajeError, type Tx } from "@/lib/db";
import { revisarSubida } from "@/lib/facturas-subidas";
import { combinar, ErrorLectura, leerFactura, MODELO_IA, type Actuales, type Campo, type MarcaIa } from "@/lib/lectura-ia";
import { aCentavos } from "@/lib/montos";
import type { Marca } from "@/lib/validar-fiscal";
import type { Estado } from "../../acciones-cuenta";

// Entrega 8c: la IA llena los datos, una persona del equipo los revisa y aprueba. La llamada a Google va fuera de la transacción.

const mensaje = (e: unknown) => (e instanceof ErrorLectura ? e.message : mensajeError(e));
const MAX_LOTE = 8;
type Archivo = { tipo: string; contenido: Buffer };
type MarcaGuardada = Marca & { origen?: string };

const archivoDe = async (tx: Tx, id: string) => (await tx<Archivo[]>`
  SELECT tipo, contenido FROM documentos WHERE entidad = 'factura_subida' AND entidad_id = ${id} AND NOT eliminado ORDER BY subido_en DESC LIMIT 1`)[0] ?? null;

// Guarda lo leído en una factura que siga por revisar: llena los vacíos y rehace sus marcas.
async function aplicar(tx: Tx, empresaId: string, usuarioId: string, id: string, l: Awaited<ReturnType<typeof leerFactura>>): Promise<Campo[]> {
  const [f] = await tx<(Actuales & { tipo: "gasto" | "ingreso"; estado: string; marcas: MarcaGuardada[] })[]>`
    SELECT tipo, estado, marcas, rnc_contraparte AS rnc, nombre_contraparte AS nombre, ncf, to_char(fecha, 'YYYY-MM-DD') AS fecha, subtotal::text, itbis::text, total::text
      FROM facturas_subidas WHERE id = ${id} FOR UPDATE`;
  if (!f || f.estado !== "recibida") throw new ErrorLectura("Esa factura ya se revisó.");
  const [{ rnc }] = await tx<{ rnc: string | null }[]>`SELECT rnc FROM empresas WHERE id = ${empresaId}`;
  const r = combinar(f, f.tipo, l, rnc);
  const v = r.valores, c = (x: string | null) => (x === null ? null : aCentavos(x));
  const revision = await revisarSubida(tx, empresaId, { tipo: f.tipo, rncContraparte: v.rnc, nombreContraparte: v.nombre, ncf: v.ncf, fecha: v.fecha, subtotal: c(v.subtotal), itbis: c(v.itbis), total: c(v.total), qr: null }, id);
  // Las marcas de antes se quedan (también la del QR), salvo las de una lectura anterior y «falta el NCF» si ya lo tiene.
  const previas = f.marcas.filter((m) => m.origen !== "ia" && !(v.ncf && m.texto.startsWith("Falta el NCF")));
  const nuevas: MarcaIa[] = revision.marcas.filter((m) => !previas.some((p) => p.texto === m.texto)).map((m) => ({ ...m, origen: "ia" }));
  await tx`UPDATE facturas_subidas SET rnc_contraparte = ${v.rnc}, nombre_contraparte = ${v.nombre}, ncf = ${v.ncf}, fecha = ${v.fecha}, subtotal = ${v.subtotal}, itbis = ${v.itbis}, total = ${v.total},
             marcas = ${tx.json([...previas, ...nuevas, ...r.marcas] as never)}, sin_credito = ${revision.sinCredito} WHERE id = ${id}`;
  await bitacora(tx, empresaId, usuarioId, "factura_leida_ia", { factura: id, modelo: MODELO_IA, llenados: r.llenados });
  return r.llenados;
}

async function leerUna(empresaId: string, usuarioId: string, id: string) {
  const a = await conEmpresa(empresaId, (tx) => archivoDe(tx, id));
  if (!a) throw new ErrorLectura("Esta factura no tiene foto ni PDF.");
  const l = await leerFactura({ tipo: a.tipo, bytes: new Uint8Array(a.contenido) });
  return { l, llenados: await conEmpresa(empresaId, (tx) => aplicar(tx, empresaId, usuarioId, id, l)) };
}

export async function leerSubidaConIa(empresaId: string, id: string): Promise<Estado> {
  const { usuario, paraClientes } = await exigirPermiso(empresaId, "registrar", "/facturas-subidas");
  if (paraClientes || !esUuid(id)) return { error: "Esto lo hace el equipo de la firma." };
  try {
    const { l, llenados } = await leerUna(empresaId, usuario.id, id);
    revalidatePath(`/e/${empresaId}/facturas-subidas`);
    if (!l.esFactura) return { error: "La IA dice que este archivo no parece una factura: no se llenó nada." };
    return { ok: llenados.length ? "Listo: revisa los datos contra el archivo antes de aprobar." : "No había datos vacíos que llenar; mira los avisos." };
  } catch (e) {
    return { error: mensaje(e) };
  }
}

export async function leerPendientesConIa(empresaId: string): Promise<Estado> {
  const { usuario, paraClientes } = await exigirPermiso(empresaId, "registrar", "/facturas-subidas");
  if (paraClientes) return { error: "Esto lo hace el equipo de la firma." };
  try {
    const filas = await conEmpresa(empresaId, (tx) => tx<{ id: string }[]>`
      SELECT f.id FROM facturas_subidas f
       WHERE f.estado = 'recibida' AND EXISTS (SELECT 1 FROM documentos d WHERE d.entidad = 'factura_subida' AND d.entidad_id = f.id AND NOT d.eliminado)
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f.marcas) m WHERE m->>'origen' = 'ia')
         AND (f.ncf IS NULL OR f.subtotal IS NULL OR f.fecha IS NULL)
       ORDER BY f.subido_en`);
    if (!filas.length) return { ok: "No hay facturas por leer." };
    let bien = 0; const fallos: string[] = [];
    for (const f of filas.slice(0, MAX_LOTE)) {
      try { await leerUna(empresaId, usuario.id, f.id); bien++; } catch (e) { fallos.push(mensaje(e)); if (e instanceof ErrorLectura && /cupo|llave|hablar|saturado/.test(e.message)) break; }
    }
    revalidatePath(`/e/${empresaId}/facturas-subidas`);
    const quedan = filas.length - bien - fallos.length;
    const texto = `Leídas: ${bien}.${quedan > 0 ? ` Quedan ${quedan}: toca el botón otra vez.` : ""}`;
    return fallos.length ? { error: `${texto} No se pudieron leer ${fallos.length}: ${fallos[0]}` } : { ok: `${texto} Revísalas contra el archivo antes de aprobar.` };
  } catch (e) {
    return { error: mensaje(e) };
  }
}

export type LecturaDocumento = { error?: string; valores?: Partial<Actuales>; avisos?: string[]; dudosos?: Campo[] };

// Documentos recibidos (rediseño R4): aún no hay factura guardada, así que los datos vuelven a la pantalla para llenar el formulario.
export async function leerDocumentoConIa(empresaId: string, recepcionId: string, tipo: string): Promise<LecturaDocumento> {
  const { usuario, empresa, paraClientes } = await exigirPermiso(empresaId, "registrar", "/recepcion");
  if (paraClientes || !esUuid(recepcionId)) return { error: "Esto lo hace el equipo de la firma." };
  try {
    const [r] = await conEmpresa(empresaId, (tx) => tx<Archivo[]>`SELECT tipo, contenido FROM recepciones WHERE id = ${recepcionId}`);
    if (!r || !["application/pdf", "image/jpeg", "image/png"].includes(r.tipo)) return { error: "Solo se lee una foto o un PDF." };
    const l = await leerFactura({ tipo: r.tipo, bytes: new Uint8Array(r.contenido) });
    const vacios: Actuales = { rnc: null, nombre: null, ncf: null, fecha: null, subtotal: null, itbis: null, total: null };
    const c = combinar(vacios, tipo === "ingreso" ? "ingreso" : "gasto", l, empresa.rnc);
    await conEmpresa(empresaId, (tx) => bitacora(tx, empresaId, usuario.id, "documento_leido_ia", { recepcion: recepcionId, modelo: MODELO_IA, llenados: c.llenados }));
    return { valores: c.valores, avisos: c.marcas.map((m) => m.texto), dudosos: c.marcas.flatMap((m) => (m.campo ? [m.campo] : [])) };
  } catch (e) {
    return { error: mensaje(e) };
  }
}
