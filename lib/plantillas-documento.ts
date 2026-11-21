import { db, type Tx } from "./db.ts";
import { WORD } from "./expediente.ts";
import { leerFicha } from "./ficha.ts";
import { huella, nombreSeguro, TAMANO_MAXIMO } from "./documentos.ts";
import { verMonto } from "./montos.ts";
import { CLAVES_ESPACIOS, ErrorPlantilla, fechaConAnio, leerEspacios, llenarDocx, nombreDelMes } from "./plantillas-word.ts";

// Prioridad 3 · P3d: plantillas de Word de la firma y los documentos que se generan con ellas para cada cliente.

export type Plantilla = {
  id: string; nombre: string; codigo: string; descripcion: string | null; carpeta: string; archivo_nombre: string; campos: string[]; tamano: number; creado: string;
};

export const plantillasDeFirma = (firmaId: string) => db()<Plantilla[]>`
  SELECT id, nombre, codigo, descripcion, carpeta, archivo_nombre, campos, octet_length(archivo)::int AS tamano,
         to_char(creado AT TIME ZONE 'America/Santo_Domingo', 'DD/MM/YYYY') AS creado
    FROM plantillas_documento WHERE firma_id = ${firmaId} AND activa ORDER BY nombre`;

export async function plantillaDe(firmaId: string, id: string): Promise<(Plantilla & { archivo: Uint8Array }) | null> {
  const [p] = await db()<(Plantilla & { archivo: Buffer })[]>`
    SELECT id, nombre, codigo, descripcion, carpeta, archivo_nombre, campos, octet_length(archivo)::int AS tamano, archivo,
           to_char(creado AT TIME ZONE 'America/Santo_Domingo', 'DD/MM/YYYY') AS creado
      FROM plantillas_documento WHERE id = ${id} AND firma_id = ${firmaId} AND activa`;
  return p ? { ...p, archivo: new Uint8Array(p.archivo) } : null;
}

export type DatosPlantilla = { nombre: string; codigo: string; carpeta: string; descripcion: string | null; archivo: { nombre: string; bytes: Uint8Array } | null };

export async function leerPlantilla(fd: FormData): Promise<DatosPlantilla> {
  const t = (c: string, max: number) => String(fd.get(c) ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const nombre = t("nombre", 120), codigo = t("codigo", 3).toUpperCase(), carpeta = t("carpeta", 2) || "06", descripcion = t("descripcion", 500);
  if (nombre.length < 3) throw new ErrorPlantilla("Escribe el nombre de la plantilla (por ejemplo, «Carta de ingresos»).");
  if (!/^[A-Z]{2,3}$/.test(codigo)) throw new ErrorPlantilla("El código son dos o tres letras (por ejemplo, CA para cartas): es el XX de la referencia ETL-XX-AAAA-NNNN.");
  if (!/^0[1-6]$/.test(carpeta)) throw new ErrorPlantilla("Elige la carpeta del expediente.");
  const a = fd.get("archivo");
  if (!(a instanceof File) || a.size === 0) return { nombre, codigo, carpeta, descripcion: descripcion || null, archivo: null };
  if (!/\.docx$/i.test(a.name)) throw new ErrorPlantilla("La plantilla tiene que ser un documento de Word guardado como .docx.");
  if (a.size > TAMANO_MAXIMO) throw new ErrorPlantilla("El archivo pasa de 4 MB.");
  return { nombre, codigo, carpeta, descripcion: descripcion || null, archivo: { nombre: a.name, bytes: new Uint8Array(await a.arrayBuffer()) } };
}

// Guarda una plantilla nueva leyendo los espacios del archivo. Sin espacios, no sirve.
export async function guardarPlantilla(firmaId: string, usuarioId: string, d: Omit<DatosPlantilla, "archivo"> & { archivo: { nombre: string; bytes: Uint8Array } }): Promise<{ id: string; campos: string[] }> {
  const campos = leerEspacios(d.archivo.bytes);
  if (!campos.length) throw new ErrorPlantilla("El documento no tiene ningún espacio para llenar. Escríbelos entre llaves dobles, por ejemplo {{nombre_empresa}}.");
  const [{ id }] = await db()<{ id: string }[]>`
    INSERT INTO plantillas_documento (firma_id, nombre, codigo, descripcion, carpeta, archivo_nombre, archivo, campos, creado_por)
    VALUES (${firmaId}, ${d.nombre}, ${d.codigo}, ${d.descripcion}, ${d.carpeta}, ${nombreSeguro(d.archivo.nombre)}, ${Buffer.from(d.archivo.bytes)}, ${campos}, ${usuarioId}) RETURNING id`;
  return { id, campos };
}

export const quitarPlantilla = (firmaId: string, id: string) => db()`UPDATE plantillas_documento SET activa = false WHERE id = ${id} AND firma_id = ${firmaId} AND activa`;

// 130000051 → 1-30-00005-1 (RNC); 40212345678 → 402-1234567-8 (cédula).
export function verRnc(rnc: string | null | undefined): string {
  const d = (rnc ?? "").replace(/\D/g, "");
  if (d.length === 9) return `${d[0]}-${d.slice(1, 3)}-${d.slice(3, 8)}-${d[8]}`;
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 10)}-${d[10]}`;
  return d;
}

// Lo que el sistema ya sabe del cliente para llenar los espacios conocidos (corre en conEmpresa). Lo que no se sabe va vacío.
export async function valoresDeCliente(tx: Tx, empresaId: string, ctx: { firmaNombre: string; firmaRnc: string | null; usuarioNombre: string; hoy: string }): Promise<Record<string, string>> {
  const [e] = await tx<{ nombre: string; nombre_comercial: string | null; rnc: string | null; direccion: string | null; telefono: string | null; correo: string | null; actividad: string | null }[]>`
    SELECT nombre, nombre_comercial, rnc, direccion, telefono, correo, actividad_economica AS actividad FROM empresas WHERE id = ${empresaId}`;
  const { ficha, socios, contactos } = await leerFicha(tx, empresaId, false);
  const contacto = (rol: string) => contactos.find((c) => c.rol === rol);
  const principal = contacto("principal") ?? contactos[0];
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const fechaLarga = (f: unknown) => (typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f) ? fechaConAnio(f) : "");
  return {
    nombre_empresa: s(e?.nombre), nombre_comercial: s(e?.nombre_comercial), rnc: verRnc(e?.rnc), rnc_sin_guiones: (e?.rnc ?? "").replace(/\D/g, ""),
    direccion: s(e?.direccion), telefono: s(e?.telefono), correo: s(e?.correo), actividad: s(e?.actividad),
    tipo_sociedad: s(ficha.tipo_sociedad), municipio: s(ficha.municipio), provincia: s(ficha.provincia),
    capital_social: ficha.capital_social ? `RD$${verMonto(ficha.capital_social)}` : "", fecha_constitucion: fechaLarga(ficha.fecha_constitucion),
    gerente: s(contacto("gerente")?.nombre), gerente_cedula: s(contacto("gerente")?.cedula),
    representante: s(contacto("representante")?.nombre), representante_cedula: s(contacto("representante")?.cedula),
    contacto: s(principal?.nombre), contacto_telefono: s(principal?.whatsapp || principal?.telefono), contacto_correo: s(principal?.correo),
    socios: socios.map((x, i) => `${i + 1}. ${x.nombre}${x.cedula ? `, cédula ${x.cedula}` : ""}${x.porcentaje ? `, ${Number(x.porcentaje)} %` : ""}`).join("\n"),
    socios_nombres: socios.map((x) => x.nombre).join(", "), numero_socios: socios.length ? String(socios.length) : "",
    fecha: fechaConAnio(ctx.hoy), fecha_corta: `${ctx.hoy.slice(8)}/${ctx.hoy.slice(5, 7)}/${ctx.hoy.slice(0, 4)}`, dia: String(Number(ctx.hoy.slice(8))),
    mes: nombreDelMes(ctx.hoy), anio: ctx.hoy.slice(0, 4), referencia: "",
    firma_nombre: ctx.firmaNombre, firma_rnc: verRnc(ctx.firmaRnc), preparado_por: ctx.usuarioNombre,
  };
}

export const esEspacioConocido = (campo: string) => CLAVES_ESPACIOS.has(campo);

// Genera el documento: toma el número de referencia, llena el Word, lo guarda en el expediente del cliente y deja el registro (corre en conEmpresa; todo en una
// sola transacción, así que si algo falla no se gasta el número).
export async function generarDocumento(tx: Tx, d: {
  empresaId: string; usuarioId: string; hoy: string; nombreCliente: string;
  plantilla: { id: string; nombre: string; codigo: string; carpeta: string; archivo: Uint8Array }; valores: Record<string, string>;
}): Promise<{ documentoId: string; referencia: string; sinLlenar: string[]; llenados: string[]; nombre: string }> {
  const anio = Number(d.hoy.slice(0, 4));
  const [{ n }] = await tx<{ n: number }[]>`SELECT siguiente_referencia_documento(${d.plantilla.codigo}, ${anio}) AS n`;
  const referencia = `ETL-${d.plantilla.codigo}-${anio}-${String(n).padStart(4, "0")}`;
  const valores = { ...d.valores, referencia };
  const r = llenarDocx(d.plantilla.archivo, valores);
  const nombre = nombreSeguro(`${referencia} ${d.plantilla.nombre} - ${d.nombreCliente}.docx`);
  const [{ id: documentoId }] = await tx<{ id: string }[]>`
    INSERT INTO documentos (empresa_id, entidad, entidad_id, nombre, tipo, tamano, sha256, contenido, descripcion, subido_por, carpeta, anio)
    VALUES (${d.empresaId}, 'expediente', ${d.empresaId}, ${nombre}, ${WORD}, ${r.bytes.length}, ${huella(r.bytes)}, ${Buffer.from(r.bytes)},
            ${`${referencia} · ${d.plantilla.nombre}`}, ${d.usuarioId}, ${d.plantilla.carpeta}, ${anio}) RETURNING id`;
  await tx`
    INSERT INTO documentos_generados (empresa_id, plantilla_id, plantilla_nombre, referencia, documento_id, valores, sin_llenar, generado_por)
    VALUES (${d.empresaId}, ${d.plantilla.id}, ${d.plantilla.nombre}, ${referencia}, ${documentoId}, ${tx.json(valores)}, ${r.sinValor}, ${d.usuarioId})`;
  return { documentoId, referencia, sinLlenar: r.sinValor, llenados: r.llenados, nombre };
}

export type Generado = { id: string; referencia: string; plantilla_nombre: string; documento_id: string; sin_llenar: string[]; creado: string; por: string | null };

// Lo generado para un cliente, lo más nuevo primero (corre en conEmpresa).
export const generadosDe = (tx: Tx) => tx<Generado[]>`
  SELECT g.id, g.referencia, g.plantilla_nombre, g.documento_id, g.sin_llenar, to_char(g.creado AT TIME ZONE 'America/Santo_Domingo', 'DD/MM/YYYY HH24:MI') AS creado, u.nombre AS por
    FROM documentos_generados g LEFT JOIN usuarios u ON u.id = g.generado_por ORDER BY g.creado DESC`;
