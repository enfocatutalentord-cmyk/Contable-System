import { db, type Tx } from "./db.ts";
import { huella, nombreSeguro, TAMANO_MAXIMO, tipoPorContenido } from "./documentos.ts";
import { nombrePeriodo } from "./igualas.ts";

// Bloque 5, entrega 5a: expediente digital del cliente (Documento maestro, sección 5). Reemplaza la carpeta del Drive con la misma
// estructura. En cada carpeta aparece lo que se sube y lo que el sistema ya genera (facturas, constancias, reportes, propuestas),
// para no subir dos veces lo mismo. Los archivos van en «documentos» (entidad 'expediente').

export const CARPETAS: Record<string, { nombre: string; contenido: string }> = {
  "01": { nombre: "Documentos legales", contenido: "RNC, registro mercantil, estatutos, cédulas de socios, certificado ONAPI, logo" },
  "02": { nombre: "Contrato y acuerdo", contenido: "Ficha, Hoja de Acuerdo, contrato, cartas de ajuste y acuses" },
  "03": { nombre: "Facturación y cobros", contenido: "Facturas de iguala, recibos, estados de cuenta" },
  "04": { nombre: "Declaraciones", contenido: "Constancias de ITBIS, IR-17, IR-3, TSS y anuales, por año" },
  "05": { nombre: "Reportes", contenido: "Reportes mensuales y acumulado anual" },
  "06": { nombre: "Solicitudes", contenido: "Solicitudes, cotizaciones y entregables" },
};
export const esCarpeta = (c: string) => c in CARPETAS;

export const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const EXCEL = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Tipo del archivo por su contenido: PDF, JPG o PNG; Word y Excel (.docx/.xlsx son ZIP, se distinguen por la extensión).
export function tipoDeArchivo(bytes: Uint8Array, nombre: string): string | null {
  const t = tipoPorContenido(bytes);
  if (t) return t;
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!zip) return null;
  if (/\.docx$/i.test(nombre)) return WORD;
  if (/\.xlsx$/i.test(nombre)) return EXCEL;
  return null;
}

export class ErrorExpediente extends Error {}

export type Archivo = { nombre: string; bytes: Uint8Array };

export async function leerArchivos(fd: FormData, campo = "archivos", maximo = 10): Promise<Archivo[]> {
  const lista = fd.getAll(campo).filter((a): a is File => a instanceof File && a.size > 0);
  if (lista.length > maximo) throw new ErrorExpediente(`Sube hasta ${maximo} archivos a la vez.`);
  const total = lista.reduce((s, a) => s + a.size, 0);
  if (total > TAMANO_MAXIMO) throw new ErrorExpediente("Entre todos los archivos pasan de 4 MB: súbelos en varias veces.");
  return Promise.all(lista.map(async (a) => ({ nombre: a.name, bytes: new Uint8Array(await a.arrayBuffer()) })));
}

// Guarda archivos en el expediente (o en otra entidad, como el volante de un trámite). Devuelve los ids.
export async function guardarArchivos(tx: Tx, d: {
  empresaId: string; usuarioId: string; archivos: Archivo[]; entidad?: "expediente" | "tramite"; entidadId?: string;
  carpeta: string | null; anio: number | null; descripcion: string | null;
}): Promise<string[]> {
  const ids: string[] = [];
  for (const a of d.archivos) {
    const tipo = tipoDeArchivo(a.bytes, a.nombre);
    if (!tipo) throw new ErrorExpediente(`«${a.nombre}» no es PDF, JPG, PNG, Word (.docx) ni Excel (.xlsx).`);
    const [r] = await tx<{ id: string }[]>`
      INSERT INTO documentos (empresa_id, entidad, entidad_id, nombre, tipo, tamano, sha256, contenido, descripcion, subido_por, carpeta, anio)
      VALUES (${d.empresaId}, ${d.entidad ?? "expediente"}, ${d.entidadId ?? d.empresaId}, ${nombreSeguro(a.nombre)}, ${tipo}, ${a.bytes.length},
              ${huella(a.bytes)}, ${Buffer.from(a.bytes)}, ${d.descripcion}, ${d.usuarioId}, ${d.carpeta}, ${d.anio}) RETURNING id`;
    ids.push(r.id);
  }
  return ids;
}

export type Elemento = {
  id: string; carpeta: string; titulo: string; detalle: string | null; fecha: string; anio: number | null;
  enlace: string; origen: "subido" | "sistema"; quien: string | null; documentoId: string | null; tipo: string | null;
};

// Todo el expediente de una empresa (corre en conEmpresa). Lo de la empresa propia (sus facturas, cobros y propuestas al
// cliente) se lee con la conexión dueña, fijando la propia, porque esos documentos viven en la contabilidad de la firma.
export async function listarExpediente(tx: Tx, empresaId: string, retirados = false): Promise<Elemento[]> {
  const subidos = await tx<{ id: string; carpeta: string; nombre: string; descripcion: string | null; fecha: string; anio: number | null; quien: string | null; tipo: string }[]>`
    SELECT d.id, d.carpeta, d.nombre, d.descripcion, to_char(d.subido_en AT TIME ZONE 'America/Santo_Domingo', 'YYYY-MM-DD') AS fecha, d.anio,
           u.nombre AS quien, d.tipo
      FROM documentos d LEFT JOIN usuarios u ON u.id = d.subido_por
     WHERE d.entidad = 'expediente' AND d.eliminado = ${retirados} ORDER BY d.subido_en DESC`;
  const lista: Elemento[] = subidos.map((d) => ({
    id: d.id, carpeta: d.carpeta, titulo: d.descripcion || d.nombre, detalle: d.descripcion ? d.nombre : null, fecha: d.fecha, anio: d.anio,
    enlace: `/e/${empresaId}/documentos/${d.id}`, origen: "subido", quien: d.quien, documentoId: d.id, tipo: d.tipo,
  }));
  if (retirados) return lista;

  const base = `/e/${empresaId}`;
  // 01: el logo de la ficha.
  for (const l of await tx<{ id: string; fecha: string }[]>`
      SELECT id, to_char(subido_en, 'YYYY-MM-DD') AS fecha FROM documentos WHERE entidad = 'empresa' AND descripcion = 'logo' AND NOT eliminado`) {
    lista.push({ id: `logo-${l.id}`, carpeta: "01", titulo: "Logo de la empresa", detalle: "De la ficha", fecha: l.fecha, anio: null,
      enlace: `${base}/documentos/${l.id}`, origen: "sistema", quien: null, documentoId: l.id, tipo: null });
  }
  // 04: constancias de declaraciones presentadas y notificaciones de pago (con su PDF).
  for (const c of await tx<{ id: string; formato: string; periodo: string; fecha: string; doc: string | null; en_cero: boolean }[]>`
      SELECT e.id, e.formato, e.periodo, to_char(e.enviado_en, 'YYYY-MM-DD') AS fecha, e.constancia_id AS doc, e.en_cero
        FROM envios_dgii e ORDER BY e.periodo DESC, e.formato`) {
    lista.push({ id: `envio-${c.id}`, carpeta: "04", titulo: `${c.formato} de ${nombrePeriodo(c.periodo)}`,
      detalle: `Presentado${c.en_cero ? " en cero" : ""}${c.doc ? " · con constancia" : ""}`, fecha: c.fecha, anio: Number(c.periodo.slice(0, 4)),
      enlace: c.doc ? `${base}/documentos/${c.doc}` : `${base}/dgii?mes=${c.periodo.slice(0, 4)}-${c.periodo.slice(4)}`, origen: "sistema", quien: null,
      documentoId: c.doc, tipo: null });
  }
  for (const n of await tx<{ id: string; tipo: string; periodo: string; concepto: string | null; fecha: string; doc: string | null }[]>`
      SELECT n.id, n.tipo, n.periodo, n.concepto, to_char(n.creado, 'YYYY-MM-DD') AS fecha,
             (SELECT d.id FROM documentos d WHERE d.entidad = 'notificacion' AND d.entidad_id = n.id AND NOT d.eliminado ORDER BY d.subido_en DESC LIMIT 1) AS doc
        FROM notificaciones_pago n ORDER BY n.periodo DESC`) {
    lista.push({ id: `notif-${n.id}`, carpeta: "04", titulo: `Notificación ${n.tipo.toUpperCase()} de ${nombrePeriodo(n.periodo)}`, detalle: n.concepto,
      fecha: n.fecha, anio: Number(n.periodo.slice(0, 4)), enlace: n.doc ? `${base}/documentos/${n.doc}` : `${base}/notificaciones`, origen: "sistema",
      quien: null, documentoId: n.doc, tipo: null });
  }
  // 05: reportes mensuales aprobados y proyecciones preparadas.
  for (const r of await tx<{ periodo: string; estado: string; fecha: string }[]>`
      SELECT periodo, estado, to_char(aprobado_en, 'YYYY-MM-DD') AS fecha FROM reportes_mensuales WHERE estado IN ('aprobado', 'enviado') ORDER BY periodo DESC`) {
    lista.push({ id: `rep-${r.periodo}`, carpeta: "05", titulo: `Reporte mensual de ${nombrePeriodo(r.periodo)}`, detalle: r.estado === "enviado" ? "Enviado" : "Aprobado",
      fecha: r.fecha, anio: Number(r.periodo.slice(0, 4)), enlace: `${base}/bitacora/reporte?mes=${r.periodo.slice(0, 4)}-${r.periodo.slice(4)}`,
      origen: "sistema", quien: null, documentoId: null, tipo: null });
  }
  for (const p of await tx<{ periodo: string; fecha: string }[]>`
      SELECT periodo, to_char(preparado_en, 'YYYY-MM-DD') AS fecha FROM proyecciones_fiscales ORDER BY periodo DESC`) {
    lista.push({ id: `proy-${p.periodo}`, carpeta: "05", titulo: `Proyección de cierre fiscal a ${nombrePeriodo(p.periodo)}`, detalle: null, fecha: p.fecha,
      anio: Number(p.periodo.slice(0, 4)), enlace: `${base}/dgii/proyeccion?mes=${p.periodo.slice(0, 4)}-${p.periodo.slice(4)}`, origen: "sistema",
      quien: null, documentoId: null, tipo: null });
  }
  lista.push(...(await deLaFirma(empresaId)));
  return lista.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

// 03 y 06: facturas, cobros, propuestas y anticipos que la empresa propia de la firma le hizo a este cliente.
async function deLaFirma(empresaId: string): Promise<Elemento[]> {
  const [f] = await db()<{ propia: string | null }[]>`
    SELECT fi.empresa_propia_id AS propia FROM empresas e JOIN firmas fi ON fi.id = e.firma_id WHERE e.id = ${empresaId}`;
  if (!f?.propia || f.propia === empresaId) return [];
  const propia = f.propia;
  return db().begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${propia}, true)`;
    const [c] = await tx<{ id: string }[]>`SELECT id FROM clientes WHERE empresa_id = ${propia} AND empresa_vinculada_id = ${empresaId}`;
    if (!c) return [];
    const base = `/e/${propia}`;
    const lista: Elemento[] = [];
    const sis = (x: Omit<Elemento, "origen" | "quien" | "documentoId" | "tipo">): Elemento => ({ ...x, origen: "sistema", quien: null, documentoId: null, tipo: null });
    for (const x of await tx<{ id: string; ncf: string; fecha: string; total: string; anulada: boolean; periodo: string | null }[]>`
        SELECT id, ncf, to_char(fecha, 'YYYY-MM-DD') AS fecha, total::text, anulada, periodo FROM facturas
         WHERE empresa_id = ${propia} AND cliente_id = ${c.id} AND estado = 'emitida' ORDER BY fecha DESC`) {
      lista.push(sis({ id: `fac-${x.id}`, carpeta: "03", titulo: `Factura ${x.ncf}${x.periodo ? ` · iguala de ${nombrePeriodo(x.periodo)}` : ""}`,
        detalle: `RD$${Number(x.total).toLocaleString("es-DO", { minimumFractionDigits: 2 })}${x.anulada ? " · anulada" : ""}`, fecha: x.fecha,
        anio: Number(x.fecha.slice(0, 4)), enlace: `${base}/facturas/${x.id}` }));
    }
    for (const x of await tx<{ numero: number; fecha: string; recibido: string; anulado: boolean }[]>`
        SELECT numero, to_char(fecha, 'YYYY-MM-DD') AS fecha, recibido::text, anulado FROM cobros WHERE empresa_id = ${propia} AND cliente_id = ${c.id} ORDER BY fecha DESC`) {
      lista.push(sis({ id: `cob-${x.numero}`, carpeta: "03", titulo: `Recibo de ingreso n.º ${x.numero}`,
        detalle: `RD$${Number(x.recibido).toLocaleString("es-DO", { minimumFractionDigits: 2 })}${x.anulado ? " · anulado" : ""}`, fecha: x.fecha,
        anio: Number(x.fecha.slice(0, 4)), enlace: `${base}/cobros/${x.numero}` }));
    }
    for (const x of await tx<{ id: string; numero: number; fecha: string; estado: string }[]>`
        SELECT id, numero, to_char(fecha, 'YYYY-MM-DD') AS fecha, estado FROM propuestas WHERE empresa_id = ${propia} AND cliente_id = ${c.id} ORDER BY fecha DESC`) {
      lista.push(sis({ id: `pro-${x.id}`, carpeta: "06", titulo: `Propuesta n.º ${x.numero}`, detalle: x.estado, fecha: x.fecha, anio: Number(x.fecha.slice(0, 4)),
        enlace: `${base}/propuestas/${x.id}` }));
    }
    for (const x of await tx<{ id: string; numero: number; fecha: string; monto: string }[]>`
        SELECT id, numero, to_char(fecha, 'YYYY-MM-DD') AS fecha, monto::text FROM anticipos WHERE empresa_id = ${propia} AND cliente_id = ${c.id} ORDER BY fecha DESC`) {
      lista.push(sis({ id: `ant-${x.id}`, carpeta: "03", titulo: `Recibo de anticipo n.º ${x.numero}`, detalle: `RD$${Number(x.monto).toLocaleString("es-DO", { minimumFractionDigits: 2 })}`,
        fecha: x.fecha, anio: Number(x.fecha.slice(0, 4)), enlace: `${base}/exportar/recibo-anticipo?id=${x.id}&formato=pdf` }));
    }
    return lista;
  }) as Promise<Elemento[]>;
}

export async function retirarDelExpediente(tx: Tx, documentoId: string, usuarioId: string, volver = false) {
  const r = await tx`UPDATE documentos SET eliminado = ${!volver}, eliminado_por = ${volver ? null : usuarioId}, eliminado_en = ${volver ? null : new Date()}
                      WHERE id = ${documentoId} AND entidad = 'expediente' AND eliminado = ${volver}`;
  if (!r.count) throw new ErrorExpediente("Ese documento ya no está.");
}
