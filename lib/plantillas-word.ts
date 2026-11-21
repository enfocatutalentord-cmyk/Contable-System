import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

// Prioridad 3 · P3d: plantillas de Word con espacios {{nombre}}. Se sube cualquier documento de Word (carta, acta, nómina de socios…) con espacios escritos
// entre llaves dobles y el sistema los llena con los datos del cliente. Este archivo no toca la base: lee los espacios de un .docx y los reemplaza.
// Word parte el texto en pedazos («runs») sin avisar: un espacio escrito de corrido puede quedar en dos o tres pedazos, así que se trabaja por párrafo.

export class ErrorPlantilla extends Error {
  code = "P0001"; // mensajeError lo muestra tal cual
}

export const LIMITE_DESCOMPRIMIDO = 40 * 1024 * 1024; // un .docx de 4 MB no debería pasar de aquí al abrirse

// Los espacios que el sistema sabe llenar con los datos del cliente. Todo espacio que no esté aquí se escribe a mano al generar el documento.
export const ESPACIOS: { clave: string; nombre: string; grupo: string }[] = [
  { clave: "nombre_empresa", nombre: "Nombre de la empresa", grupo: "Empresa" },
  { clave: "nombre_comercial", nombre: "Nombre comercial", grupo: "Empresa" },
  { clave: "rnc", nombre: "RNC o cédula (con guiones)", grupo: "Empresa" },
  { clave: "rnc_sin_guiones", nombre: "RNC o cédula (solo números)", grupo: "Empresa" },
  { clave: "direccion", nombre: "Dirección", grupo: "Empresa" },
  { clave: "telefono", nombre: "Teléfono", grupo: "Empresa" },
  { clave: "correo", nombre: "Correo", grupo: "Empresa" },
  { clave: "actividad", nombre: "Actividad económica", grupo: "Empresa" },
  { clave: "tipo_sociedad", nombre: "Tipo de sociedad", grupo: "Empresa" },
  { clave: "municipio", nombre: "Municipio", grupo: "Empresa" },
  { clave: "provincia", nombre: "Provincia", grupo: "Empresa" },
  { clave: "capital_social", nombre: "Capital social", grupo: "Empresa" },
  { clave: "fecha_constitucion", nombre: "Fecha de constitución", grupo: "Empresa" },
  { clave: "gerente", nombre: "Gerente", grupo: "Personas" },
  { clave: "gerente_cedula", nombre: "Cédula del gerente", grupo: "Personas" },
  { clave: "representante", nombre: "Representante legal", grupo: "Personas" },
  { clave: "representante_cedula", nombre: "Cédula del representante legal", grupo: "Personas" },
  { clave: "contacto", nombre: "Contacto principal", grupo: "Personas" },
  { clave: "contacto_telefono", nombre: "Teléfono del contacto", grupo: "Personas" },
  { clave: "contacto_correo", nombre: "Correo del contacto", grupo: "Personas" },
  { clave: "socios", nombre: "Socios, uno por línea (nombre, cédula y %)", grupo: "Socios" },
  { clave: "socios_nombres", nombre: "Nombres de los socios, en una línea", grupo: "Socios" },
  { clave: "numero_socios", nombre: "Cantidad de socios", grupo: "Socios" },
  { clave: "fecha", nombre: "Fecha de hoy (21 de noviembre de 2026)", grupo: "Fecha" },
  { clave: "fecha_corta", nombre: "Fecha de hoy (21/11/2026)", grupo: "Fecha" },
  { clave: "dia", nombre: "Día", grupo: "Fecha" },
  { clave: "mes", nombre: "Mes", grupo: "Fecha" },
  { clave: "anio", nombre: "Año", grupo: "Fecha" },
  { clave: "referencia", nombre: "Número de referencia del documento (ETL-XX-AAAA-NNNN)", grupo: "Documento" },
  { clave: "firma_nombre", nombre: "Nombre de la firma", grupo: "Firma" },
  { clave: "firma_rnc", nombre: "RNC de la firma", grupo: "Firma" },
  { clave: "preparado_por", nombre: "Quién prepara el documento", grupo: "Firma" },
];
export const CLAVES_ESPACIOS = new Set(ESPACIOS.map((e) => e.clave));

// «Nombre de la Empresa » → «nombre_de_la_empresa»: sin tildes, en minúsculas y con guion bajo.
export function normalizar(nombre: string): string {
  return nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[\s.-]+/g, "_").replace(/[^a-z0-9_ñ]/g, "");
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
// «2026-11-21» → «21 de noviembre de 2026»
export function fechaConAnio(fecha: string): string {
  return `${Number(fecha.slice(8, 10))} de ${MESES[Number(fecha.slice(5, 7)) - 1]} de ${fecha.slice(0, 4)}`;
}
export const nombreDelMes = (fecha: string) => MESES[Number(fecha.slice(5, 7)) - 1];

// Las partes del .docx donde puede haber texto con espacios.
const PARTE = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const PARRAFO = /<w:p\b[^>]*>(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g;
const TEXTO = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
const ESPACIO = /\{\{\s*([^{}]{1,80}?)\s*\}\}/g;

const decodificar = (t: string) => t.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (_, n: string, d: string, h: string) =>
  n ? ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[n.toLowerCase()] : String.fromCodePoint(d ? Number(d) : parseInt(h, 16)));
const escapar = (t: string) => t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Los saltos de línea del valor (los socios, uno por línea) se vuelven saltos de línea de Word.
const enXml = (t: string) => escapar(t.replace(/\r\n?/g, "\n")).replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">');

// Abre el .docx comprobando que lo sea y que no sea una bomba de compresión. Devuelve sus partes.
export function abrirDocx(bytes: Uint8Array): Record<string, Uint8Array> {
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) throw new ErrorPlantilla("El archivo no es un documento de Word (.docx).");
  let total = 0;
  try {
    unzipSync(bytes, { filter: (f) => { total += f.originalSize; return false; } });
    if (total > LIMITE_DESCOMPRIMIDO) throw new ErrorPlantilla("El documento es demasiado grande por dentro.");
    const partes = unzipSync(bytes);
    if (!partes["[Content_Types].xml"] || !partes["word/document.xml"]) throw new ErrorPlantilla("El archivo no es un documento de Word (.docx).");
    return partes;
  } catch (e) {
    if (e instanceof ErrorPlantilla) throw e;
    throw new ErrorPlantilla("No se pudo abrir el documento de Word: el archivo parece dañado.");
  }
}

type Resultado = { xml: string; encontrados: string[]; sinValor: string[]; llenados: string[] };

// Recorre los párrafos de una parte del documento: reconoce los espacios y, si se dan valores, los reemplaza.
function procesarParte(xml: string, valores: Record<string, string> | null): Resultado {
  const encontrados: string[] = [], sinValor: string[] = [], llenados: string[] = [];
  const salida = xml.replace(PARRAFO, (p) => {
    const segs: { ini: number; fin: number; abre: string; texto: string }[] = [];
    for (const m of p.matchAll(TEXTO)) {
      const completo = m[0];
      segs.push({ ini: m.index!, fin: m.index! + completo.length, abre: completo.slice(0, completo.indexOf(">") + 1), texto: decodificar(m[1]) });
    }
    if (!segs.length) return p;
    const total = segs.map((s) => s.texto).join("");
    const cambios: { ini: number; fin: number; valor: string }[] = [];
    for (const m of total.matchAll(ESPACIO)) {
      const nombre = normalizar(m[1]);
      if (!nombre) continue;
      encontrados.push(nombre);
      const valor = valores?.[nombre];
      if (valores === null) continue;
      if (valor === undefined || valor.trim() === "") { sinValor.push(nombre); continue; }
      llenados.push(nombre);
      cambios.push({ ini: m.index!, fin: m.index! + m[0].length, valor: valor.trim() });
    }
    if (!cambios.length) return p;
    // Cada pedazo de texto se reescribe: el valor va en el pedazo donde empezaba el espacio y los demás pedazos pierden lo que era del espacio.
    let desde = 0;
    const nuevos = segs.map((s) => {
      let t = "";
      let g = desde;
      desde += s.texto.length;
      for (const ch of s.texto) {
        const c = cambios.find((x) => g >= x.ini && g < x.fin);
        if (!c) t += escapar(ch);
        else if (g === c.ini) t += enXml(c.valor);
        g += ch.length;
      }
      return t;
    });
    let r = "", cursor = 0;
    segs.forEach((s, i) => {
      r += p.slice(cursor, s.ini) + `<w:t xml:space="preserve">${nuevos[i]}</w:t>`;
      cursor = s.fin;
    });
    return r + p.slice(cursor);
  });
  return { xml: salida, encontrados, sinValor, llenados };
}

const unicos = (a: string[]) => [...new Set(a)];

// Los espacios {{…}} que tiene el documento, en el orden en que aparecen, ya normalizados.
export function leerEspacios(bytes: Uint8Array): string[] {
  const partes = abrirDocx(bytes);
  const todos: string[] = [];
  for (const [nombre, contenido] of Object.entries(partes)) if (PARTE.test(nombre)) todos.push(...procesarParte(strFromU8(contenido), null).encontrados);
  return unicos(todos);
}

// El documento con los espacios llenados. Los que no tienen valor se dejan como están (con sus llaves) y se devuelven en `sinValor`.
export function llenarDocx(bytes: Uint8Array, valores: Record<string, string>): { bytes: Uint8Array; llenados: string[]; sinValor: string[] } {
  const partes = abrirDocx(bytes);
  const llenados: string[] = [], sinValor: string[] = [];
  for (const [nombre, contenido] of Object.entries(partes)) {
    if (!PARTE.test(nombre)) continue;
    const r = procesarParte(strFromU8(contenido), valores);
    partes[nombre] = strToU8(r.xml);
    llenados.push(...r.llenados);
    sinValor.push(...r.sinValor);
  }
  return { bytes: zipSync(partes, { level: 6 }), llenados: unicos(llenados), sinValor: unicos(sinValor).filter((n) => !llenados.includes(n)) };
}
