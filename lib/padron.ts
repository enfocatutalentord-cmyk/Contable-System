// Padrón de contribuyentes de la DGII (P2c.3): lector puro del archivo DGII_RNC. Se confirma el orden de las columnas con el archivo real; mientras
// tanto se reconoce cada campo por su forma (RNC de 9 u 11 dígitos, fecha, estado) y se muestra una vista previa antes de cargar.

export type FilaPadron = {
  rnc: string; nombre: string; nombre_comercial: string | null; actividad: string | null;
  fecha_inicio: string | null; estado: string | null; regimen: string | null;
};

// Lo que la pantalla recibe al buscar un RNC (la fecha del padrón ya como aaaa-mm-dd).
export type RespuestaRnc =
  | { tipo: "invalido" } | { tipo: "sin_padron" } | { tipo: "no_esta"; al: string } | { tipo: "encontrado"; al: string; datos: FilaPadron };

export const NOMBRE_MAX = 300;
const ESTADO = /^(ACTIVO|INACTIVO|SUSPENDIDO|DADO DE BAJA|BAJA|CESE|CESADO|ANULADO|NO LOCALIZADO|CERRADO|RADIADO)/i;

// Separador más usado en las primeras líneas con datos (el archivo oficial va con «|»).
export function detectarSeparador(lineas: string[]): string {
  const muestra = lineas.filter((l) => l.trim()).slice(0, 20);
  let mejor = "|", cuenta = 0;
  for (const s of ["|", ";", "\t", ","]) {
    const n = muestra.reduce((t, l) => t + l.split(s).length - 1, 0);
    if (n > cuenta) { mejor = s; cuenta = n; }
  }
  return mejor;
}

// Corta una línea; con «,» o «;» respeta las comillas.
export function cortarLinea(linea: string, sep: string): string[] {
  if (sep !== "," && sep !== ";") return linea.split(sep).map((c) => c.trim().replace(/^"|"$/g, "").trim());
  const campos: string[] = [];
  let actual = "", entre = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (entre && linea[i + 1] === '"') { actual += '"'; i++; } else entre = !entre;
    } else if (c === sep && !entre) { campos.push(actual.trim()); actual = ""; } else actual += c;
  }
  campos.push(actual.trim());
  return campos;
}

// dd/mm/aaaa o aaaa-mm-dd → aaaa-mm-dd (null si no es una fecha de verdad).
export function leerFechaPadron(v: string): string | null {
  let a: string, m: string, d: string;
  let r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (r) { [, d, m, a] = r; } else if ((r = /^(\d{4})-(\d{2})-(\d{2})/.exec(v))) { [, a, m, d] = r; } else return null;
  const f = new Date(Date.UTC(Number(a), Number(m) - 1, Number(d)));
  if (f.getUTCFullYear() !== Number(a) || f.getUTCMonth() !== Number(m) - 1 || f.getUTCDate() !== Number(d)) return null;
  return `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

const limpio = (v: string | undefined, max = NOMBRE_MAX) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return t || null;
};

export const normalizarRnc = (v: string) => v.replace(/[-\s]/g, "");
export const rncConForma = (v: string) => /^(\d{9}|\d{11})$/.test(v);

// Una línea del archivo → su fila, o null si no empieza con un RNC o una cédula (encabezado, línea vacía, basura).
export function leerLineaPadron(linea: string, sep: string): FilaPadron | null {
  const c = cortarLinea(linea, sep);
  const rnc = normalizarRnc(c[0] ?? "");
  if (!rncConForma(rnc)) return null;
  const resto = c.slice(1);
  let iFecha = -1, iEstado = -1;
  resto.forEach((v, i) => {
    if (iFecha < 0 && leerFechaPadron(v)) iFecha = i;
    if (iEstado < 0 && ESTADO.test(v)) iEstado = i;
  });
  const reservados = new Set([iFecha, iEstado, iEstado >= 0 ? iEstado + 1 : -1]);
  const libres = resto.map((v, i) => ({ v, i })).filter((x) => x.v && !reservados.has(x.i)).map((x) => x.v);
  const nombre = limpio(libres[0]);
  if (!nombre) return null;
  const medio = libres.slice(1);
  // Dos o más campos de texto: el primero es el nombre comercial y el resto la actividad. Con uno solo no se sabe cuál es: se toma como actividad.
  const comercial = medio.length >= 2 ? limpio(medio[0]) : null;
  const actividad = limpio(medio.length >= 2 ? medio.slice(1).join(" · ") : medio[0], 400);
  const regimen = iEstado >= 0 ? limpio(resto[iEstado + 1], 60) : null;
  return {
    rnc, nombre, nombre_comercial: comercial, actividad,
    fecha_inicio: iFecha >= 0 ? leerFechaPadron(resto[iFecha]) : null,
    estado: iEstado >= 0 ? limpio(resto[iEstado], 60) : null, regimen,
  };
}

// Un bloque de texto con varias líneas. Cuenta las que traían datos pero no se pudieron leer (sin contar las vacías).
export function leerBloquePadron(texto: string, sep?: string): { filas: FilaPadron[]; rechazadas: number; separador: string } {
  const lineas = texto.split(/\r?\n/);
  const s = sep ?? detectarSeparador(lineas);
  const porRnc = new Map<string, FilaPadron>();
  let rechazadas = 0;
  for (const l of lineas) {
    if (!l.trim()) continue;
    const f = leerLineaPadron(l, s);
    if (f) porRnc.set(f.rnc, f); else rechazadas++;
  }
  return { filas: [...porRnc.values()], rechazadas, separador: s };
}

export const ETIQUETA_ESTADO = (e: string | null) => (e ? e.toUpperCase() : "sin dato");
export const estaActivo = (e: string | null) => !e || /^ACTIVO/i.test(e);
