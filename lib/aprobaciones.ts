import { ErrorContable } from "./asientos.ts";
import type { Tx } from "./db.ts";
import { registrarCompra } from "./compras.ts";
import { emitir } from "./ventas.ts";

// Prioridad 2.1 (P2a): lo que hace una persona con un permiso «con aprobación» queda pendiente hasta que alguien con el permiso «aprobar»
// lo apruebe (y entonces se ejecuta de verdad) o lo devuelva con lo que hay que corregir. Mientras tanto no sale al cliente ni entra a la
// contabilidad. Cada trabajo guarda su historial y cuántas veces se devolvió. Esta entrega cubre los borradores: facturas y compras.

export type TipoAprobacion = "factura" | "compra" | "accion";
export const TIPOS_APROBACION: Record<TipoAprobacion, string> = { factura: "Factura o nota", compra: "Compra o gasto", accion: "Acción" };
export type EstadoAprobacion = "pendiente" | "devuelta" | "aprobada" | "cancelada";

export type Aprobacion = {
  id: string; empresaId: string; tipo: TipoAprobacion; referenciaId: string; titulo: string; detalle: string | null; estado: EstadoAprobacion;
  vecesDevuelta: number; motivo: string | null; solicitadoPor: string; solicitadoPorId: string; solicitadoEn: Date; resueltoPor: string | null; resueltoEn: Date | null;
};

type Fila = {
  id: string; empresa_id: string; tipo: TipoAprobacion; referencia_id: string; titulo: string; detalle: string | null; estado: EstadoAprobacion;
  veces_devuelta: number; motivo_devolucion: string | null; solicitado_por: string; solicitante: string; solicitado_en: Date; resolutor: string | null; resuelto_en: Date | null;
};
const aAprobacion = (f: Fila): Aprobacion => ({
  id: f.id, empresaId: f.empresa_id, tipo: f.tipo, referenciaId: f.referencia_id, titulo: f.titulo, detalle: f.detalle, estado: f.estado, vecesDevuelta: f.veces_devuelta,
  motivo: f.motivo_devolucion, solicitadoPor: f.solicitante, solicitadoPorId: f.solicitado_por, solicitadoEn: f.solicitado_en, resueltoPor: f.resolutor, resueltoEn: f.resuelto_en,
});

// La aprobación de un trabajo (si la tiene).
export async function aprobacionDe(tx: Tx, tipo: TipoAprobacion, referenciaId: string): Promise<Aprobacion | null> {
  const [f] = await tx<Fila[]>`
    SELECT a.id, a.empresa_id, a.tipo, a.referencia_id, a.titulo, a.detalle, a.estado, a.veces_devuelta, a.motivo_devolucion, a.solicitado_por,
           s.nombre AS solicitante, a.solicitado_en, r.nombre AS resolutor, a.resuelto_en
      FROM aprobaciones a JOIN usuarios s ON s.id = a.solicitado_por LEFT JOIN usuarios r ON r.id = a.resuelto_por
     WHERE a.tipo = ${tipo} AND a.referencia_id = ${referenciaId}`;
  return f ? aAprobacion(f) : null;
}

// Un borrador que espera aprobación no se edita ni se descarta: primero hay que devolverlo.
export async function exigirSinAprobacionPendiente(tx: Tx, tipo: TipoAprobacion, referenciaId: string) {
  const [x] = await tx`SELECT 1 FROM aprobaciones WHERE tipo = ${tipo} AND referencia_id = ${referenciaId} AND estado = 'pendiente'`;
  if (x) throw new ErrorContable("Está esperando aprobación: no se puede cambiar hasta que lo aprueben o lo devuelvan.");
}

// Pide la aprobación (o la vuelve a pedir si se devolvió). Devuelve la aprobación.
export async function solicitarAprobacion(tx: Tx, d: {
  empresaId: string; usuarioId: string; tipo: TipoAprobacion; referenciaId: string; titulo: string; detalle?: string | null;
}): Promise<string> {
  const previa = await aprobacionDe(tx, d.tipo, d.referenciaId);
  if (previa?.estado === "pendiente") throw new ErrorContable("Ya está esperando aprobación.");
  if (previa?.estado === "aprobada") throw new ErrorContable("Ya fue aprobado.");
  if (previa) {
    await tx`UPDATE aprobaciones SET estado = 'pendiente', titulo = ${d.titulo}, detalle = ${d.detalle ?? null}, solicitado_por = ${d.usuarioId}, solicitado_en = now(),
                                     motivo_devolucion = NULL, resuelto_por = NULL, resuelto_en = NULL WHERE id = ${previa.id}`;
    await tx`INSERT INTO aprobaciones_eventos (empresa_id, aprobacion_id, evento, usuario_id) VALUES (${d.empresaId}, ${previa.id}, 'reenviada', ${d.usuarioId})`;
    return previa.id;
  }
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO aprobaciones (empresa_id, tipo, referencia_id, titulo, detalle, solicitado_por)
    VALUES (${d.empresaId}, ${d.tipo}, ${d.referenciaId}, ${d.titulo}, ${d.detalle ?? null}, ${d.usuarioId}) RETURNING id`;
  await tx`INSERT INTO aprobaciones_eventos (empresa_id, aprobacion_id, evento, usuario_id) VALUES (${d.empresaId}, ${id}, 'solicitada', ${d.usuarioId})`;
  return id;
}

async function pendiente(tx: Tx, id: string): Promise<Aprobacion> {
  const [f] = await tx<Fila[]>`
    SELECT a.id, a.empresa_id, a.tipo, a.referencia_id, a.titulo, a.detalle, a.estado, a.veces_devuelta, a.motivo_devolucion, a.solicitado_por,
           s.nombre AS solicitante, a.solicitado_en, r.nombre AS resolutor, a.resuelto_en
      FROM aprobaciones a JOIN usuarios s ON s.id = a.solicitado_por LEFT JOIN usuarios r ON r.id = a.resuelto_por WHERE a.id = ${id} FOR UPDATE OF a`;
  if (!f) throw new ErrorContable("La solicitud no existe.");
  if (f.estado !== "pendiente") throw new ErrorContable("Esa solicitud ya no está pendiente.");
  return aAprobacion(f);
}

// Aprobar: la persona que lo pidió nunca aprueba lo suyo. Al aprobar se hace de verdad (se emite o se registra).
export async function aprobar(tx: Tx, d: { empresaId: string; usuarioId: string; id: string }) {
  const a = await pendiente(tx, d.id);
  if (a.solicitadoPorId === d.usuarioId) throw new ErrorContable("Quien lo preparó no puede aprobarlo: tiene que hacerlo otra persona.");
  if (a.tipo === "accion") throw new ErrorContable("Esta solicitud se aprueba desde la bandeja Por aprobar.");
  if (a.tipo === "factura") await emitir(tx, { empresaId: d.empresaId, usuarioId: d.usuarioId, facturaId: a.referenciaId });
  else await registrarCompra(tx, { empresaId: d.empresaId, usuarioId: d.usuarioId, compraId: a.referenciaId });
  await tx`UPDATE aprobaciones SET estado = 'aprobada', resuelto_por = ${d.usuarioId}, resuelto_en = now() WHERE id = ${d.id}`;
  await tx`INSERT INTO aprobaciones_eventos (empresa_id, aprobacion_id, evento, usuario_id) VALUES (${d.empresaId}, ${d.id}, 'aprobada', ${d.usuarioId})`;
}

// Devolver: se escribe qué hay que corregir. El borrador sigue siendo borrador y se puede editar y volver a enviar.
export async function devolver(tx: Tx, d: { empresaId: string; usuarioId: string; id: string; motivo: string }) {
  const motivo = d.motivo.trim();
  if (motivo.length < 3) throw new ErrorContable("Escribe qué hay que corregir.");
  const a = await pendiente(tx, d.id);
  if (a.solicitadoPorId === d.usuarioId) throw new ErrorContable("Quien lo preparó no lo devuelve: puede editarlo o descartarlo.");
  await tx`UPDATE aprobaciones SET estado = 'devuelta', veces_devuelta = veces_devuelta + 1, motivo_devolucion = ${motivo.slice(0, 1000)},
                                   resuelto_por = ${d.usuarioId}, resuelto_en = now() WHERE id = ${d.id}`;
  await tx`INSERT INTO aprobaciones_eventos (empresa_id, aprobacion_id, evento, usuario_id, nota) VALUES (${d.empresaId}, ${d.id}, 'devuelta', ${d.usuarioId}, ${motivo.slice(0, 1000)})`;
}

export const listarAprobaciones = (tx: Tx, estados: EstadoAprobacion[]) => tx<Fila[]>`
  SELECT a.id, a.empresa_id, a.tipo, a.referencia_id, a.titulo, a.detalle, a.estado, a.veces_devuelta, a.motivo_devolucion, a.solicitado_por,
         s.nombre AS solicitante, a.solicitado_en, r.nombre AS resolutor, a.resuelto_en
    FROM aprobaciones a JOIN usuarios s ON s.id = a.solicitado_por LEFT JOIN usuarios r ON r.id = a.resuelto_por
   WHERE a.estado = ANY(${estados}) ORDER BY a.solicitado_en`.then((f) => f.map(aAprobacion));

export type EventoAprobacion = { evento: string; quien: string; nota: string | null; cuando: Date };
export const historialDe = (tx: Tx, id: string) => tx<EventoAprobacion[]>`
  SELECT e.evento, u.nombre AS quien, e.nota, e.creado AS cuando FROM aprobaciones_eventos e JOIN usuarios u ON u.id = e.usuario_id
   WHERE e.aprobacion_id = ${id} ORDER BY e.creado`;

export const EVENTOS: Record<string, string> = { solicitada: "Pidió la aprobación", reenviada: "Lo volvió a enviar", devuelta: "Lo devolvió", aprobada: "Lo aprobó", cancelada: "Lo descartó" };

// El título de lo que se pide aprobar, con lo que el aprobador necesita ver de un vistazo.
export async function tituloDe(tx: Tx, tipo: TipoAprobacion, id: string): Promise<{ titulo: string; detalle: string }> {
  if (tipo === "factura") {
    const [f] = await tx<{ tipo_ncf: string; total: string; moneda: string; cliente: string; fecha: string }[]>`
      SELECT f.tipo_ncf, f.total::text, f.moneda, c.nombre AS cliente, to_char(f.fecha, 'YYYY-MM-DD') AS fecha FROM facturas f JOIN clientes c ON c.id = f.cliente_id WHERE f.id = ${id}`;
    if (!f) throw new ErrorContable("El comprobante no existe");
    return { titulo: `Emitir ${f.tipo_ncf} a ${f.cliente}`, detalle: `${f.moneda} ${f.total} · fecha ${f.fecha}` };
  }
  const [c] = await tx<{ tipo_comprobante: string; total: string; moneda: string; proveedor: string; fecha: string }[]>`
    SELECT c.tipo_comprobante, c.total::text, c.moneda, p.nombre AS proveedor, to_char(c.fecha, 'YYYY-MM-DD') AS fecha FROM compras c JOIN proveedores p ON p.id = c.proveedor_id WHERE c.id = ${id}`;
  if (!c) throw new ErrorContable("La compra no existe");
  return { titulo: `Registrar ${c.tipo_comprobante} de ${c.proveedor}`, detalle: `${c.moneda} ${c.total} · fecha ${c.fecha}` };
}

// Si alguien con el permiso completo emite o registra directo un borrador que estaba esperando aprobación, la solicitud queda aprobada por él.
export async function cerrarSiPendiente(tx: Tx, d: { empresaId: string; usuarioId: string; tipo: TipoAprobacion; referenciaId: string }) {
  const r = await tx<{ id: string }[]>`
    UPDATE aprobaciones SET estado = 'aprobada', resuelto_por = ${d.usuarioId}, resuelto_en = now()
     WHERE tipo = ${d.tipo} AND referencia_id = ${d.referenciaId} AND estado IN ('pendiente', 'devuelta') RETURNING id`;
  for (const x of r) {
    await tx`INSERT INTO aprobaciones_eventos (empresa_id, aprobacion_id, evento, usuario_id, nota) VALUES (${d.empresaId}, ${x.id}, 'aprobada', ${d.usuarioId}, 'Lo emitió o registró directamente quien tiene el permiso completo')`;
  }
}

// ───── Acciones con sus datos guardados ─────
// Lo que una persona hace con un permiso «con aprobación» (registrar una salida, anular, cerrar, presentar una declaración, revisar el
// reporte…) se guarda tal cual —el nombre de la acción, sus datos y los campos del formulario— y se ejecuta cuando alguien con «aprobar»
// lo aprueba. Si el formulario lleva un archivo no se puede guardar así.

export type PayloadAccion = { accion: string; args: string[]; campos: [string, string][] };

export function capturarCampos(fd: FormData | undefined): [string, string][] {
  const campos: [string, string][] = [];
  for (const [k, v] of fd?.entries() ?? []) {
    if (typeof v !== "string") {
      if (v.size > 0) throw new ErrorContable("Este paso lleva un archivo y no se puede dejar para aprobación: pídele a quien aprueba que lo haga.");
      continue;
    }
    if (!k.startsWith("$ACTION")) campos.push([k, v]);
  }
  return campos;
}

export function formularioDe(campos: [string, string][]): FormData {
  const fd = new FormData();
  for (const [k, v] of campos) fd.append(k, v);
  return fd;
}

export async function pedirAccion(tx: Tx, d: {
  empresaId: string; usuarioId: string; accion: string; args: string[]; fd?: FormData; titulo: string; detalle?: string | null;
}): Promise<string> {
  const payload: PayloadAccion = { accion: d.accion, args: d.args, campos: capturarCampos(d.fd) };
  const [{ id }] = await tx<{ id: string }[]>`
    INSERT INTO aprobaciones (empresa_id, tipo, referencia_id, titulo, detalle, solicitado_por, payload)
    VALUES (${d.empresaId}, 'accion', gen_random_uuid(), ${d.titulo}, ${d.detalle ?? null}, ${d.usuarioId}, ${tx.json(payload as never)}) RETURNING id`;
  await tx`INSERT INTO aprobaciones_eventos (empresa_id, aprobacion_id, evento, usuario_id) VALUES (${d.empresaId}, ${id}, 'solicitada', ${d.usuarioId})`;
  return id;
}

// Reclama la solicitud para ejecutarla (nadie más la ejecuta a la vez) y devuelve lo que hay que hacer.
export async function reclamarAccion(tx: Tx, d: { empresaId: string; usuarioId: string; id: string }): Promise<{ aprobacion: Aprobacion; payload: PayloadAccion }> {
  const a = await pendiente(tx, d.id);
  if (a.tipo !== "accion") throw new ErrorContable("Esa solicitud es de un borrador: se aprueba desde su pantalla.");
  if (a.solicitadoPorId === d.usuarioId) throw new ErrorContable("Quien lo preparó no puede aprobarlo: tiene que hacerlo otra persona.");
  const [{ payload }] = await tx<{ payload: PayloadAccion }[]>`SELECT payload FROM aprobaciones WHERE id = ${d.id}`;
  await tx`UPDATE aprobaciones SET estado = 'aprobada', resuelto_por = ${d.usuarioId}, resuelto_en = now() WHERE id = ${d.id}`;
  return { aprobacion: a, payload };
}

// Si al ejecutarla falló, vuelve a quedar pendiente.
export const liberarAccion = (tx: Tx, id: string) =>
  tx`UPDATE aprobaciones SET estado = 'pendiente', resuelto_por = NULL, resuelto_en = NULL WHERE id = ${id} AND estado = 'aprobada'`;

export const registrarAprobada = (tx: Tx, d: { empresaId: string; usuarioId: string; id: string }) =>
  tx`INSERT INTO aprobaciones_eventos (empresa_id, aprobacion_id, evento, usuario_id) VALUES (${d.empresaId}, ${d.id}, 'aprobada', ${d.usuarioId})`;

// Quien lo pidió puede descartar lo que le devolvieron.
export async function cancelarAccion(tx: Tx, d: { empresaId: string; usuarioId: string; id: string }) {
  const r = await tx`UPDATE aprobaciones SET estado = 'cancelada', resuelto_por = ${d.usuarioId}, resuelto_en = now()
                      WHERE id = ${d.id} AND tipo = 'accion' AND estado IN ('devuelta', 'pendiente') AND solicitado_por = ${d.usuarioId} RETURNING id`;
  if (!r.length) throw new ErrorContable("Solo quien lo pidió puede descartarlo, y solo mientras no se apruebe.");
  await tx`INSERT INTO aprobaciones_eventos (empresa_id, aprobacion_id, evento, usuario_id) VALUES (${d.empresaId}, ${d.id}, 'cancelada', ${d.usuarioId})`;
}
