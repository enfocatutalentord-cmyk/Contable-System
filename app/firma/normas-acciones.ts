"use server";

import { revalidatePath } from "next/cache";
import { accesoFirma, esUuid } from "@/lib/acceso";
import { conEmpresa, db, mensajeError } from "@/lib/db";
import { TAMANO_MAXIMO, tipoPorContenido } from "@/lib/documentos";
import { leerPorcentaje, porcentajeTexto } from "@/lib/fiscal";
import { anotar, cargarTasaNueva, empresasDeFirma, FORMATOS_CALENDARIO, NOMBRE_FORMATO, TEXTO_RESULTADO, type Clase, type Resultado } from "@/lib/normas";
import { fechaValida } from "@/lib/reportes";
import { verFecha } from "@/lib/montos";
import type { Estado } from "../acciones-cuenta";

// Entrega B · Normas y tasas: todo lo cambia un administrador de la firma (Patricia es la responsable por defecto).

const texto = (fd: FormData, c: string) => String(fd.get(c) ?? "").trim();
const listo = (fid: string) => revalidatePath(`/firma/${fid}`, "layout");

// Tasa o retención nueva para los clientes marcados: la anterior se cierra el día antes; lo ya registrado no cambia.
export async function cargarTasa(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  const [clase, ...partes] = texto(fd, "concepto").split("|");
  const nombre = partes.join("|");
  const nuevoNombre = texto(fd, "nuevo_nombre") || nombre;
  const tasa = leerPorcentaje(texto(fd, "tasa"));
  const desde = texto(fd, "desde");
  const norma = texto(fd, "norma");
  const marcadas = fd.getAll("empresa").map(String);
  if ((clase !== "impuesto" && clase !== "retencion") || !nombre) return { error: "Elige el impuesto o la retención que cambia." };
  if (tasa === null || (clase === "retencion" && tasa === 0n)) return { error: "La tasa nueva debe ser un porcentaje entre 0 y 100 (la de una retención, mayor que 0)." };
  if (!fechaValida(desde)) return { error: "Escribe desde qué fecha rige la tasa nueva." };
  if (norma.length < 3) return { error: "Escribe la ley o norma que la cambia (por ejemplo, «Ley 30-26, art. 12»)." };
  if (!marcadas.length || !marcadas.every(esUuid)) return { error: "Marca al menos una empresa." };
  const empresas = (await empresasDeFirma(firmaId)).filter((e) => marcadas.includes(e.id));
  if (empresas.length !== marcadas.length) return { error: "Una de las empresas marcadas no es de la firma." };
  const nota = `${norma} · cargada desde Normas y tasas el ${verFecha(new Date().toISOString().slice(0, 10))}`;
  const resultados: { nombre: string; r: Resultado | "error"; msg?: string }[] = [];
  for (const e of empresas) {
    try {
      const r = await conEmpresa(e.id, (tx) => cargarTasaNueva(tx, { clase: clase as Clase, nombre, nuevoNombre, tasa: porcentajeTexto(tasa), desde, nota }));
      resultados.push({ nombre: e.nombre, r });
    } catch (err) {
      resultados.push({ nombre: e.nombre, r: "error", msg: mensajeError(err) });
    }
  }
  const aplicadas = resultados.filter((x) => x.r === "aplicada");
  const otras = resultados.filter((x) => x.r !== "aplicada");
  if (aplicadas.length) {
    await anotar(firmaId, usuario.id, `Tasa nueva: «${nuevoNombre}» ${porcentajeTexto(tasa)} % desde el ${verFecha(desde)} (antes «${nombre}») en ${aplicadas.length} empresa${aplicadas.length === 1 ? "" : "s"}: ${aplicadas.map((x) => x.nombre).join(", ")}. ${norma}.`);
  }
  listo(firmaId);
  const detalle = otras.map((x) => `${x.nombre}: ${x.r === "error" ? x.msg : TEXTO_RESULTADO[x.r]}`).join(" · ");
  if (!aplicadas.length) return { error: `No se aplicó en ninguna empresa. ${detalle}` };
  return { ok: `Aplicada en ${aplicadas.length} empresa${aplicadas.length === 1 ? "" : "s"}.${detalle ? ` Sin aplicar: ${detalle}` : ""}` };
}

export async function guardarCalendario(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  const actuales = await db()<{ formato: string; dia: number; norma: string | null }[]>`SELECT formato, dia, norma FROM calendario_fiscal WHERE firma_id = ${firmaId}`;
  const cambios: string[] = [];
  for (const f of FORMATOS_CALENDARIO) {
    const dia = Number(texto(fd, `dia_${f}`));
    const norma = texto(fd, `norma_${f}`) || null;
    const max = f === "IR-2" ? 365 : 31;
    if (!Number.isInteger(dia) || dia < 1 || dia > max) return { error: `${NOMBRE_FORMATO[f]}: ${f === "IR-2" ? "los días después del cierre van de 1 a 365" : "el día va de 1 a 31"}.` };
    const a = actuales.find((x) => x.formato === f);
    if (a && a.dia === dia && (a.norma ?? null) === norma) continue;
    cambios.push(`${f}: ${a ? `${a.dia} → ` : ""}${dia}${f === "IR-2" ? " días" : ""}${norma && norma !== a?.norma ? ` (${norma})` : ""}`);
    await db()`INSERT INTO calendario_fiscal (firma_id, formato, dia, norma, cambiado_por, cambiado_en)
               VALUES (${firmaId}, ${f}, ${dia}, ${norma}, ${usuario.nombre}, now())
               ON CONFLICT (firma_id, formato) DO UPDATE SET dia = EXCLUDED.dia, norma = EXCLUDED.norma, cambiado_por = EXCLUDED.cambiado_por, cambiado_en = now()`;
  }
  if (!cambios.length) return { ok: "No había cambios." };
  await anotar(firmaId, usuario.id, `Calendario fiscal: ${cambios.join("; ")}.`);
  listo(firmaId);
  return { ok: "Calendario guardado. Las alertas, Impuestos del mes y el reporte mensual ya usan las fechas nuevas." };
}

export async function agregarProrroga(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  const formato = texto(fd, "formato");
  const mes = texto(fd, "mes"); // AAAA-MM
  const vence = texto(fd, "vence");
  const motivo = texto(fd, "motivo");
  if (!(FORMATOS_CALENDARIO as readonly string[]).includes(formato)) return { error: "Elige la declaración." };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return { error: formato === "IR-2" ? "Elige el mes de cierre del ejercicio." : "Elige el mes que se declara." };
  if (!fechaValida(vence)) return { error: "Escribe la nueva fecha límite." };
  if (motivo.length < 3) return { error: "Escribe el motivo (por ejemplo, «Feriado» o «Aviso DGII 12-26»)." };
  const periodo = mes.replace("-", "");
  try {
    await db()`INSERT INTO prorrogas_fiscales (firma_id, formato, periodo, vence, motivo, creado_por)
               VALUES (${firmaId}, ${formato}, ${periodo}, ${vence}, ${motivo}, ${usuario.nombre})`;
  } catch (e) {
    return { error: e && typeof e === "object" && "code" in e && e.code === "23505" ? "Ese mes ya tiene una prórroga para esa declaración: quítala primero." : mensajeError(e) };
  }
  await anotar(firmaId, usuario.id, `Prórroga: el ${formato} de ${mes.slice(5)}/${mes.slice(0, 4)} vence el ${verFecha(vence)} (${motivo}).`);
  listo(firmaId);
  return { ok: "Prórroga guardada." };
}

export async function quitarProrroga(firmaId: string, id: string): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  if (!esUuid(id)) return { error: "La prórroga no existe." };
  const [p] = await db()<{ formato: string; periodo: string }[]>`DELETE FROM prorrogas_fiscales WHERE id = ${id} AND firma_id = ${firmaId} RETURNING formato, periodo`;
  if (!p) return { error: "La prórroga no existe." };
  await anotar(firmaId, usuario.id, `Prórroga quitada: ${p.formato} de ${p.periodo.slice(4)}/${p.periodo.slice(0, 4)} (vuelve a la fecha del calendario).`);
  listo(firmaId);
  return { ok: "Prórroga quitada." };
}

export async function guardarResponsableNormas(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  const id = texto(fd, "responsable");
  if (id && !esUuid(id)) return { error: "Elige a una persona." };
  let nombre = "nadie";
  if (id) {
    const [m] = await db()<{ nombre: string }[]>`
      SELECT u.nombre FROM miembros_firma mf JOIN usuarios u ON u.id = mf.usuario_id WHERE mf.firma_id = ${firmaId} AND mf.usuario_id = ${id} AND mf.administrador`;
    if (!m) return { error: "La responsable debe ser administradora de la firma." };
    nombre = m.nombre;
  }
  await db()`UPDATE firmas SET responsable_normas_id = ${id || null} WHERE id = ${firmaId}`;
  await anotar(firmaId, usuario.id, `Responsable de las normas: ${nombre}.`);
  listo(firmaId);
  return { ok: "Responsable guardada." };
}

export async function registrarRevision(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId);
  const fecha = texto(fd, "fecha");
  const revisado = texto(fd, "revisado");
  const cambios = fd.get("hubo_cambios") === "on";
  if (!fechaValida(fecha) || fecha > new Date().toISOString().slice(0, 10)) return { error: "La fecha de la revisión no es válida (no puede ser futura)." };
  if (revisado.length < 3) return { error: "Escribe qué revisaste (por ejemplo, «Avisos y normas generales de la DGII de octubre»)." };
  const archivo = fd.get("archivo");
  let nombre: string | null = null, tipo: string | null = null, bytes: Uint8Array | null = null;
  if (archivo instanceof File && archivo.size > 0) {
    if (archivo.size > TAMANO_MAXIMO) return { error: "El documento pasa de 4 MB." };
    bytes = new Uint8Array(await archivo.arrayBuffer());
    tipo = tipoPorContenido(bytes);
    if (!tipo) return { error: "El documento debe ser PDF, JPG o PNG." };
    nombre = archivo.name.slice(0, 150) || "documento";
  }
  await db()`INSERT INTO revisiones_normas (firma_id, fecha, revisado, hubo_cambios, archivo_nombre, archivo_tipo, archivo, por)
             VALUES (${firmaId}, ${fecha}, ${revisado}, ${cambios}, ${nombre}, ${tipo}, ${bytes ? Buffer.from(bytes) : null}, ${usuario.id})`;
  await anotar(firmaId, usuario.id, `Revisión del ${verFecha(fecha)}: ${revisado}${cambios ? " (hubo cambios)" : " (sin cambios)"}${nombre ? ` · adjunto ${nombre}` : ""}.`);
  listo(firmaId);
  return { ok: cambios ? "Revisión registrada. Si la norma cambia una tasa o una fecha, cárgala arriba." : "Revisión registrada." };
}
