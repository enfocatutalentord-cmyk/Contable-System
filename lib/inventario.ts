import { normal, type Celda } from "./archivos-banco.ts";
import type { Tx } from "./db.ts";

// Prioridad 3 · P3l · Inventario: conteos. El listado de existencias sale del Excel del cliente (código, nombre, cantidad y, si lo trae, costo, unidad y código de barras) y
// se guarda tal cual estaba el día del conteo. Lo contado se anota con un lector de código de barras que funciona como teclado (escribe el código y da «Enter») o a mano.
// Cantidades y costos van con 4 decimales, en enteros (bigint) y sin floats. El reporte de diferencias en cantidad y pesos es la entrega P3m.

export class ErrorInventario extends Error {}

export const ESCALA = 4;
export const MAX_ARTICULOS = 20000;
export const MAX_CANTIDAD = 1_000_000n * 10n ** BigInt(ESCALA);

export const ESTADOS_CONTEO: Record<string, string> = { abierto: "Abierto", cerrado: "Cerrado" };

// Para comparar códigos: sin espacios, en mayúsculas y sin ceros a la izquierda (Excel se los quita a los códigos que parecen números).
export const normCodigo = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "").replace(/^0+(?=.)/, "");

// «1,250.5» / «1.250,5» / «12» / 3.25 → entero en diezmilésimas. null si no es un número.
export function leerDecimal(v: Celda): bigint | null {
  if (v === null || v instanceof Date) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return BigInt(Math.round(v * 10 ** ESCALA));
  }
  let s = v.replace(/ /g, " ").trim().replace(/RD\$|US\$|DOP|USD|\$/gi, "").replace(/\s/g, "");
  if (s === "" || s === "-") return null;
  let negativo = false;
  if (s.startsWith("-")) { negativo = true; s = s.slice(1); } else if (s.startsWith("+")) s = s.slice(1);
  const coma = s.lastIndexOf(","), punto = s.lastIndexOf(".");
  if (coma >= 0 && punto >= 0) s = coma > punto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (coma >= 0) s = /,\d{1,4}$/.test(s) && s.split(",").length === 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  else if (s.split(".").length > 2) s = s.replace(/\./g, "");
  const m = s.match(/^(\d+)(?:\.(\d{1,4}))?$/);
  if (!m) return null;
  const n = BigInt(m[1]) * 10n ** BigInt(ESCALA) + BigInt((m[2] ?? "").padEnd(ESCALA, "0"));
  return negativo ? -n : n;
}

// El texto que guarda la base (numeric(18,4)).
export function aTexto(n: bigint): string {
  const neg = n < 0n, a = neg ? -n : n, e = 10n ** BigInt(ESCALA);
  return `${neg ? "-" : ""}${a / e}.${(a % e).toString().padStart(ESCALA, "0")}`;
}
// Lo que devuelve la base («12.5000» o «-3.0000») como entero.
export function deTexto(s: string): bigint {
  const neg = s.startsWith("-");
  const [e, d = ""] = (neg ? s.slice(1) : s).split(".");
  const n = BigInt(e || "0") * 10n ** BigInt(ESCALA) + BigInt(d.padEnd(ESCALA, "0").slice(0, ESCALA));
  return neg ? -n : n;
}
// Para mostrar: sin ceros de más y con comas de miles («1,250.5»).
export function verCantidad(n: bigint): string {
  const neg = n < 0n, a = neg ? -n : n, e = 10n ** BigInt(ESCALA);
  const dec = (a % e).toString().padStart(ESCALA, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${(a / e).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${dec ? `.${dec}` : ""}`;
}

// ───────────── Excel/CSV de existencias → artículos ─────────────

export type ArticuloLeido = { orden: number; codigo: string; barras: string; nombre: string; unidad: string; existencia: bigint; costo: bigint | null };
export type CampoInv = "codigo" | "barras" | "nombre" | "cantidad" | "costo" | "unidad";
export const NOMBRE_CAMPO: Record<CampoInv, string> = { codigo: "Código", barras: "Código de barras", nombre: "Nombre", cantidad: "Cantidad", costo: "Costo", unidad: "Unidad" };

const PISTAS: [CampoInv, RegExp][] = [
  ["barras", /(barra|barcode|\bean\b|\bupc\b)/],
  ["codigo", /(^cod|codigo|\bsku\b|^item\b|^ref|referencia|^id$|^no\.? ?art)/],
  ["cantidad", /(cantidad|existencia|stock|^qty|inventario|disponible|^cant\b|saldo)/],
  ["costo", /(costo|cost)/],
  ["unidad", /^(unidad|u\/m|um|und|unit)/],
  ["nombre", /(nombre|descripcion|articulo|producto|detalle|item)/],
];

// En cada columna del encabezado: de qué dato es. Cada dato se queda con la primera columna que lo parece.
export function columnasDeInventario(fila: Celda[]): Partial<Record<CampoInv, number>> {
  const r: Partial<Record<CampoInv, number>> = {};
  fila.forEach((c, i) => {
    const t = normal(c);
    if (!t) return;
    for (const [campo, patron] of PISTAS) {
      if (patron.test(t)) { if (r[campo] === undefined) r[campo] = i; return; }
    }
  });
  return r;
}

export type LecturaExistencias = {
  articulos: ArticuloLeido[]; errores: string[]; avisos: string[]; ignoradas: number; columnas: Partial<Record<CampoInv, string>>;
};

const texto = (c: Celda | undefined): string => (c === null || c === undefined ? "" : c instanceof Date ? "" : typeof c === "number" ? String(c) : c.trim());

// El encabezado es la primera fila (de las 30 primeras) con una columna de código y una de cantidad.
export function leerExistencias(filas: Celda[][]): LecturaExistencias {
  const salida: LecturaExistencias = { articulos: [], errores: [], avisos: [], ignoradas: 0, columnas: {} };
  let enc = -1, cols: Partial<Record<CampoInv, number>> = {};
  for (let i = 0; i < Math.min(30, filas.length); i++) {
    const c = columnasDeInventario(filas[i]);
    if (c.codigo !== undefined && c.cantidad !== undefined) { enc = i; cols = c; break; }
  }
  if (enc < 0) {
    salida.errores.push("No encontré las columnas del listado. La primera fila debe tener, como mínimo, «Código» y «Cantidad» (o «Existencia»). Opcionales: «Nombre», «Costo», «Unidad» y «Código de barras».");
    return salida;
  }
  for (const [campo, i] of Object.entries(cols) as [CampoInv, number][]) salida.columnas[campo] = texto(filas[enc][i]);
  if (cols.nombre === undefined) salida.avisos.push("El listado no trae nombre de los artículos: en pantalla solo se verá el código.");
  if (cols.costo === undefined) salida.avisos.push("El listado no trae costo: el reporte de diferencias saldrá en cantidades, sin pesos.");

  const vistos = new Map<string, number>(); // código normalizado → fila
  for (let f = enc + 1; f < filas.length; f++) {
    const fila = filas[f], n = f + 1;
    const at = (c: CampoInv) => (cols[c] === undefined ? undefined : fila[cols[c]!]);
    const codigo = texto(at("codigo")), cant = at("cantidad"), nombre = texto(at("nombre"));
    if (!codigo && texto(cant) === "" && !nombre) { salida.ignoradas++; continue; }
    if (/^total/i.test(codigo) || (!codigo && /^total/i.test(nombre))) { salida.ignoradas++; continue; } // fila de totales
    if (!codigo) { salida.errores.push(`Fila ${n}: falta el código.`); continue; }
    if (codigo.length > 60) { salida.errores.push(`Fila ${n}: el código «${codigo.slice(0, 20)}…» es muy largo (máximo 60).`); continue; }
    const existencia = leerDecimal(cant ?? null);
    if (existencia === null) { salida.errores.push(`Fila ${n} (${codigo}): la cantidad «${texto(cant)}» no es un número.`); continue; }
    if (existencia < 0n) { salida.errores.push(`Fila ${n} (${codigo}): la cantidad es negativa.`); continue; }
    if (existencia > MAX_CANTIDAD) { salida.errores.push(`Fila ${n} (${codigo}): la cantidad es demasiado grande.`); continue; }
    let costo: bigint | null = null;
    if (cols.costo !== undefined && texto(at("costo")) !== "") {
      costo = leerDecimal(at("costo") ?? null);
      if (costo === null || costo < 0n) { salida.errores.push(`Fila ${n} (${codigo}): el costo «${texto(at("costo"))}» no es válido.`); continue; }
    }
    const norm = normCodigo(codigo);
    if (vistos.has(norm)) { salida.errores.push(`Fila ${n}: el código «${codigo}» está repetido (ya salió en la fila ${vistos.get(norm)}).`); continue; }
    vistos.set(norm, n);
    salida.articulos.push({ orden: salida.articulos.length, codigo, barras: texto(at("barras")).slice(0, 60), nombre: nombre.slice(0, 200), unidad: texto(at("unidad")).slice(0, 30), existencia, costo });
  }
  if (salida.articulos.length > MAX_ARTICULOS) salida.errores.push(`El listado tiene ${salida.articulos.length} artículos y el máximo es ${MAX_ARTICULOS}: divídelo por bodega o por categoría.`);
  if (!salida.errores.length && !salida.articulos.length) salida.errores.push("El listado no tiene artículos debajo del encabezado.");
  return salida;
}

// ───────────── Conteos ─────────────

export type DatosConteo = { nombre: string; ubicacion: string; fecha: string; notas: string };

export function leerConteo(fd: FormData): DatosConteo {
  const t = (c: string) => String(fd.get(c) ?? "").replace(/\r\n?/g, "\n").trim();
  const nombre = t("nombre").replace(/\s+/g, " ");
  if (nombre.length < 3 || nombre.length > 150) throw new ErrorInventario("Escribe el nombre del conteo (entre 3 y 150 letras).");
  const ubicacion = t("ubicacion").replace(/\s+/g, " ");
  if (ubicacion.length > 150) throw new ErrorInventario("La ubicación puede tener hasta 150 letras.");
  const fecha = t("fecha");
  const d = new Date(`${fecha}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== fecha) throw new ErrorInventario("Revisa la fecha del conteo.");
  const notas = t("notas");
  if (notas.length > 2000) throw new ErrorInventario("Las notas pueden tener hasta 2,000 letras.");
  return { nombre, ubicacion, fecha, notas };
}

// Cantidad que se anota a mano o con el lector: más de 0 y no absurda.
export function leerCantidadLectura(v: string): bigint {
  const n = v.trim() === "" ? 10n ** BigInt(ESCALA) : leerDecimal(v);
  if (n === null) throw new ErrorInventario("La cantidad no es un número.");
  if (n <= 0n) throw new ErrorInventario("La cantidad tiene que ser mayor que cero.");
  if (n > MAX_CANTIDAD) throw new ErrorInventario("Esa cantidad es demasiado grande.");
  return n;
}

export async function crearConteo(tx: Tx, d: DatosConteo & { empresaId: string; usuarioId: string; archivoNombre: string; articulos: ArticuloLeido[] }): Promise<string> {
  const [{ numero }] = await tx<{ numero: number }[]>`SELECT COALESCE(max(numero), 0) + 1 AS numero FROM conteos_inventario WHERE empresa_id = ${d.empresaId}`;
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO conteos_inventario (empresa_id, numero, nombre, ubicacion, fecha, notas, archivo_nombre, creado_por)
    VALUES (${d.empresaId}, ${numero}, ${d.nombre}, ${d.ubicacion}, ${d.fecha}, ${d.notas}, ${d.archivoNombre.slice(0, 200)}, ${d.usuarioId}) RETURNING id`;
  for (let i = 0; i < d.articulos.length; i += 1000) {
    const filas = d.articulos.slice(i, i + 1000).map((a) => ({
      empresa_id: d.empresaId, conteo_id: id, orden: a.orden, codigo: a.codigo, codigo_norm: normCodigo(a.codigo), barras: a.barras, barras_norm: a.barras ? normCodigo(a.barras) : "",
      nombre: a.nombre, unidad: a.unidad, existencia: aTexto(a.existencia), costo: a.costo === null ? null : aTexto(a.costo),
    }));
    await tx`INSERT INTO conteo_articulos ${tx(filas)}`;
  }
  return id;
}

export type FilaConteo = {
  id: string; numero: number; nombre: string; ubicacion: string; fecha: string; estado: string; archivo_nombre: string;
  articulos: number; contados: number; lecturas: number; sin_listado: number;
};

export const listarConteos = (tx: Tx) => tx<FilaConteo[]>`
  SELECT c.id, c.numero, c.nombre, c.ubicacion, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.estado, c.archivo_nombre,
         (SELECT count(*)::int FROM conteo_articulos a WHERE a.conteo_id = c.id) AS articulos,
         (SELECT count(DISTINCT l.articulo_id)::int FROM conteo_lecturas l WHERE l.conteo_id = c.id AND NOT l.anulada AND l.articulo_id IS NOT NULL) AS contados,
         (SELECT count(*)::int FROM conteo_lecturas l WHERE l.conteo_id = c.id AND NOT l.anulada) AS lecturas,
         (SELECT count(DISTINCT l.codigo_norm)::int FROM conteo_lecturas l WHERE l.conteo_id = c.id AND NOT l.anulada AND l.articulo_id IS NULL) AS sin_listado
    FROM conteos_inventario c ORDER BY (c.estado = 'cerrado'), c.fecha DESC, c.numero DESC`;

export type ArticuloConteo = { id: string; codigo: string; barras: string; nombre: string; unidad: string; contado: bigint; lecturas: number; existencia: bigint; costo: bigint | null };
export type LecturaReciente = { id: string; codigo: string; nombre: string | null; cantidad: bigint; origen: string; nota: string; anulada: boolean; quien: string; creado_en: Date };
export type SinListado = { codigo: string; cantidad: bigint; lecturas: number };
export type DetalleConteo = {
  id: string; empresa_id: string; numero: number; nombre: string; ubicacion: string; fecha: string; notas: string; archivo_nombre: string; estado: string;
  creado_por: string; creado_en: Date; cerrado_por: string | null; cerrado_en: Date | null;
  total_articulos: number; con_costo: number; con_nombre: number; contados: number; lecturas: number; unidades: bigint;
  articulos: ArticuloConteo[]; hay_mas: boolean; recientes: LecturaReciente[]; sin_listado: SinListado[]; archivo_id: string | null;
};

export const FILTROS_ARTICULOS: Record<string, string> = { todos: "Todos", pendientes: "Por contar", contados: "Contados" };
export const LIMITE_ARTICULOS = 100;

export async function detalleConteo(tx: Tx, id: string, o: { q?: string; ver?: string } = {}): Promise<DetalleConteo | null> {
  const [c] = await tx<{ id: string; empresa_id: string; numero: number; nombre: string; ubicacion: string; fecha: string; notas: string; archivo_nombre: string; estado: string;
    creado_por: string; creado_en: Date; cerrado_por: string | null; cerrado_en: Date | null }[]>`
    SELECT c.id, c.empresa_id, c.numero, c.nombre, c.ubicacion, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.notas, c.archivo_nombre, c.estado, u.nombre AS creado_por, c.creado_en,
           k.nombre AS cerrado_por, c.cerrado_en
      FROM conteos_inventario c JOIN usuarios u ON u.id = c.creado_por LEFT JOIN usuarios k ON k.id = c.cerrado_por WHERE c.id = ${id}`;
  if (!c) return null;
  const [r] = await tx<{ total: number; con_costo: number; con_nombre: number; contados: number; lecturas: number; unidades: string }[]>`
    SELECT (SELECT count(*)::int FROM conteo_articulos WHERE conteo_id = ${id}) AS total,
           (SELECT count(*)::int FROM conteo_articulos WHERE conteo_id = ${id} AND costo IS NOT NULL) AS con_costo,
           (SELECT count(*)::int FROM conteo_articulos WHERE conteo_id = ${id} AND nombre <> '') AS con_nombre,
           (SELECT count(DISTINCT articulo_id)::int FROM conteo_lecturas WHERE conteo_id = ${id} AND NOT anulada AND articulo_id IS NOT NULL) AS contados,
           (SELECT count(*)::int FROM conteo_lecturas WHERE conteo_id = ${id} AND NOT anulada) AS lecturas,
           (SELECT COALESCE(sum(cantidad), 0)::text FROM conteo_lecturas WHERE conteo_id = ${id} AND NOT anulada) AS unidades`;
  const q = (o.q ?? "").trim().toLowerCase().slice(0, 60), ver = o.ver && o.ver in FILTROS_ARTICULOS ? o.ver : "todos";
  const filas = await tx<{ id: string; codigo: string; barras: string; nombre: string; unidad: string; contado: string; lecturas: number; existencia: string; costo: string | null }[]>`
    SELECT a.id, a.codigo, a.barras, a.nombre, a.unidad, COALESCE(l.contado, 0)::text AS contado, COALESCE(l.n, 0) AS lecturas, a.existencia::text AS existencia, a.costo::text AS costo
      FROM conteo_articulos a
      LEFT JOIN (SELECT articulo_id, sum(cantidad) AS contado, count(*)::int AS n FROM conteo_lecturas WHERE conteo_id = ${id} AND NOT anulada GROUP BY articulo_id) l ON l.articulo_id = a.id
     WHERE a.conteo_id = ${id}
       AND (${q} = '' OR strpos(lower(a.codigo), ${q}) > 0 OR strpos(lower(a.nombre), ${q}) > 0 OR strpos(lower(a.barras), ${q}) > 0)
       AND (${ver} = 'todos' OR (${ver} = 'pendientes' AND l.n IS NULL) OR (${ver} = 'contados' AND l.n IS NOT NULL))
     ORDER BY a.orden LIMIT ${LIMITE_ARTICULOS + 1}`;
  const recientes = await tx<{ id: string; codigo: string; nombre: string | null; cantidad: string; origen: string; nota: string; anulada: boolean; quien: string; creado_en: Date }[]>`
    SELECT l.id, l.codigo_leido AS codigo, a.nombre, l.cantidad::text AS cantidad, l.origen, l.nota, l.anulada, u.nombre AS quien, l.creado_en
      FROM conteo_lecturas l LEFT JOIN conteo_articulos a ON a.id = l.articulo_id JOIN usuarios u ON u.id = l.creado_por
     WHERE l.conteo_id = ${id} ORDER BY l.creado_en DESC, l.id LIMIT 12`;
  const sin = await tx<{ codigo: string; cantidad: string; lecturas: number }[]>`
    SELECT min(codigo_leido) AS codigo, sum(cantidad)::text AS cantidad, count(*)::int AS lecturas
      FROM conteo_lecturas WHERE conteo_id = ${id} AND NOT anulada AND articulo_id IS NULL GROUP BY codigo_norm HAVING sum(cantidad) <> 0 ORDER BY min(codigo_leido)`;
  const [arch] = await tx<{ id: string }[]>`SELECT id FROM documentos WHERE entidad = 'conteo' AND entidad_id = ${id} AND NOT eliminado ORDER BY subido_en LIMIT 1`;
  return {
    ...c, total_articulos: r.total, con_costo: r.con_costo, con_nombre: r.con_nombre, contados: r.contados, lecturas: r.lecturas, unidades: deTexto(r.unidades),
    articulos: filas.slice(0, LIMITE_ARTICULOS).map((a) => ({ ...a, contado: deTexto(a.contado), existencia: deTexto(a.existencia), costo: a.costo === null ? null : deTexto(a.costo) })),
    hay_mas: filas.length > LIMITE_ARTICULOS,
    recientes: recientes.map((x) => ({ ...x, cantidad: deTexto(x.cantidad) })),
    sin_listado: sin.map((x) => ({ ...x, cantidad: deTexto(x.cantidad) })), archivo_id: arch?.id ?? null,
  };
}

async function abierto(tx: Tx, conteoId: string): Promise<void> {
  const [c] = await tx<{ estado: string }[]>`SELECT estado FROM conteos_inventario WHERE id = ${conteoId}`;
  if (!c) throw new ErrorInventario("Ese conteo no existe.");
  if (c.estado === "cerrado") throw new ErrorInventario("El conteo está cerrado: reábrelo para anotar lecturas.");
}

export type ResultadoLectura = { articulo: { id: string; codigo: string; nombre: string; unidad: string } | null; codigo: string; cantidad: bigint; total: bigint };

// Anota una lectura: el código se busca entre los códigos y los códigos de barras del listado. Si no está, la lectura queda «sin listado» (un sobrante o un código mal escrito).
export async function registrarLectura(tx: Tx, d: { conteoId: string; empresaId: string; usuarioId: string; codigo: string; cantidad: bigint; origen: "lector" | "manual" }): Promise<ResultadoLectura> {
  const codigo = d.codigo.replace(/\s+/g, " ").trim();
  if (!codigo) throw new ErrorInventario("Escribe o escanea el código.");
  if (codigo.length > 60) throw new ErrorInventario("Ese código es muy largo.");
  await abierto(tx, d.conteoId);
  const norm = normCodigo(codigo);
  const [a] = await tx<{ id: string; codigo: string; nombre: string; unidad: string }[]>`
    SELECT id, codigo, nombre, unidad FROM conteo_articulos
     WHERE conteo_id = ${d.conteoId} AND (codigo_norm = ${norm} OR barras_norm = ${norm}) ORDER BY (codigo_norm = ${norm}) DESC LIMIT 1`;
  await tx`INSERT INTO conteo_lecturas (empresa_id, conteo_id, articulo_id, codigo_leido, codigo_norm, cantidad, origen, creado_por)
           VALUES (${d.empresaId}, ${d.conteoId}, ${a?.id ?? null}, ${codigo}, ${a ? normCodigo(a.codigo) : norm}, ${aTexto(d.cantidad)}, ${d.origen}, ${d.usuarioId})`;
  const [{ total }] = await tx<{ total: string }[]>`
    SELECT COALESCE(sum(cantidad), 0)::text AS total FROM conteo_lecturas
     WHERE conteo_id = ${d.conteoId} AND NOT anulada AND ${a ? tx`articulo_id = ${a.id}` : tx`articulo_id IS NULL AND codigo_norm = ${norm}`}`;
  return { articulo: a ?? null, codigo, cantidad: d.cantidad, total: deTexto(total) };
}

// Fija el total contado de un artículo (lo contó a mano): se anota la diferencia como una lectura de ajuste, así queda el rastro.
export async function fijarTotal(tx: Tx, d: { conteoId: string; empresaId: string; usuarioId: string; articuloId: string; total: bigint; nota: string }) {
  if (d.total < 0n || d.total > MAX_CANTIDAD) throw new ErrorInventario("El total contado no es válido.");
  await abierto(tx, d.conteoId);
  const [a] = await tx<{ id: string; codigo: string }[]>`SELECT id, codigo FROM conteo_articulos WHERE id = ${d.articuloId} AND conteo_id = ${d.conteoId}`;
  if (!a) throw new ErrorInventario("Ese artículo no es de este conteo.");
  const [{ actual }] = await tx<{ actual: string }[]>`SELECT COALESCE(sum(cantidad), 0)::text AS actual FROM conteo_lecturas WHERE articulo_id = ${a.id} AND NOT anulada`;
  const delta = d.total - deTexto(actual);
  if (delta === 0n) throw new ErrorInventario("Ese artículo ya tiene ese total contado.");
  await tx`INSERT INTO conteo_lecturas (empresa_id, conteo_id, articulo_id, codigo_leido, codigo_norm, cantidad, origen, nota, creado_por)
           VALUES (${d.empresaId}, ${d.conteoId}, ${a.id}, ${a.codigo}, ${normCodigo(a.codigo)}, ${aTexto(delta)}, 'ajuste', ${d.nota.slice(0, 300)}, ${d.usuarioId})`;
}

export async function deshacerLectura(tx: Tx, d: { id: string; conteoId: string; usuarioId: string }) {
  await abierto(tx, d.conteoId);
  const r = await tx`UPDATE conteo_lecturas SET anulada = true, anulada_por = ${d.usuarioId}, anulada_en = now() WHERE id = ${d.id} AND conteo_id = ${d.conteoId} AND NOT anulada`;
  if (!r.count) throw new ErrorInventario("Esa lectura ya estaba deshecha o no existe.");
}

export async function cambiarEstadoConteo(tx: Tx, id: string, estado: "abierto" | "cerrado", usuarioId: string) {
  const [c] = await tx<{ estado: string }[]>`SELECT estado FROM conteos_inventario WHERE id = ${id} FOR UPDATE`;
  if (!c) throw new ErrorInventario("Ese conteo no existe.");
  if (c.estado === estado) throw new ErrorInventario(`El conteo ya está ${estado}.`);
  await tx`UPDATE conteos_inventario SET estado = ${estado}, cerrado_por = ${estado === "cerrado" ? usuarioId : null}, cerrado_en = ${estado === "cerrado" ? new Date() : null} WHERE id = ${id}`;
}
