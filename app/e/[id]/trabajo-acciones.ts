"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { conEmpresa, db, mensajeError } from "@/lib/db";
import { cargoDelCliente, conCargo } from "@/lib/cargo-aplicacion";
import { aCentavos, deCentavos, hoyISO } from "@/lib/montos";
import { precioPara, preciosVigentes } from "@/lib/precios";
import { ErrorTrabajo, leerPrecioTrabajo, leerRequisito, requisitosDeServicio } from "@/lib/trabajos";
import { guardarBorradorFactura, type TipoFactura } from "@/lib/ventas";
import type { Estado } from "../../acciones-cuenta";

// Prioridad 2.2 (P2d): el trabajo (la solicitud) con sus requisitos, su precio y su factura.

const error = (e: unknown): Estado => ({ error: e instanceof ErrorTrabajo ? e.message : mensajeError(e) });
const volver = (id: string, sid?: string) => { revalidatePath(`/e/${id}/solicitudes`, "layout"); if (sid) revalidatePath(`/e/${id}/solicitudes/${sid}`); };
const propiaDe = async (firmaId: string) => (await db()<{ propia: string | null }[]>`SELECT empresa_propia_id AS propia FROM firmas WHERE id = ${firmaId}`)[0]?.propia ?? null;

// Requisitos del servicio → este trabajo. Se copian una sola vez; después se cambian aquí sin tocar los del servicio.
export async function cargarRequisitos(empresaId: string, sid: string, _: Estado): Promise<Estado> {
  const { empresa } = await exigirPermiso(empresaId, "registrar", "/solicitudes");
  if (!esUuid(sid)) return { error: "Ese trabajo no existe." };
  try {
    const [s] = await conEmpresa(empresaId, (tx) => tx<{ servicio_id: string | null; n: number }[]>`
      SELECT servicio_id, (SELECT count(*)::int FROM requisitos_solicitud r WHERE r.solicitud_id = s.id) AS n FROM solicitudes s WHERE s.id = ${sid}`);
    if (!s) return { error: "Ese trabajo no existe." };
    if (s.n > 0) return { error: "Este trabajo ya tiene sus requisitos." };
    if (!s.servicio_id) return { error: "Este trabajo no tiene un servicio de la lista de precios: agrega los requisitos a mano." };
    const propia = await propiaDe(empresa.firma_id);
    if (!propia) return { error: "Primero marca la empresa propia de la firma (Empresas Empire)." };
    const lista = await conEmpresa(propia, (tx) => requisitosDeServicio(tx, s.servicio_id!));
    if (!lista.length) return { error: "Ese servicio todavía no tiene requisitos: escríbelos en Productos y servicios de Contabilidad Empire." };
    await conEmpresa(empresaId, async (tx) => {
      for (const [i, r] of lista.entries()) {
        await tx`INSERT INTO requisitos_solicitud (empresa_id, solicitud_id, texto, obligatorio, orden) VALUES (${empresaId}, ${sid}, ${r.texto}, ${r.obligatorio}, ${i})`;
      }
    });
  } catch (e) {
    return error(e);
  }
  volver(empresaId, sid);
  return { ok: "Requisitos cargados." };
}

export async function agregarRequisito(empresaId: string, sid: string, _: Estado, fd: FormData): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/solicitudes");
  if (!esUuid(sid)) return { error: "Ese trabajo no existe." };
  try {
    const d = leerRequisito(fd);
    await conEmpresa(empresaId, async (tx) => {
      const [s] = await tx`SELECT 1 FROM solicitudes WHERE id = ${sid}`;
      if (!s) throw new ErrorTrabajo("Ese trabajo no existe.");
      await tx`INSERT INTO requisitos_solicitud (empresa_id, solicitud_id, texto, obligatorio, orden)
               VALUES (${empresaId}, ${sid}, ${d.texto}, ${d.obligatorio}, COALESCE((SELECT max(orden) + 1 FROM requisitos_solicitud WHERE solicitud_id = ${sid}), 0))`;
    });
  } catch (e) {
    return error(e);
  }
  volver(empresaId, sid);
  return { ok: "Requisito agregado." };
}

// Marcar lo que llegó (o que no aplica); con una nota opcional. «Pendiente» lo devuelve.
export async function marcarRequisito(empresaId: string, rid: string, estado: string, _: Estado): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/solicitudes");
  if (!esUuid(rid) || !["pendiente", "recibido", "no_aplica"].includes(estado)) return { error: "Datos no válidos." };
  let sid: string | null = null;
  try {
    sid = await conEmpresa(empresaId, async (tx) => {
      const [r] = await tx<{ solicitud_id: string }[]>`
        UPDATE requisitos_solicitud SET estado = ${estado}, recibido_en = ${estado === "pendiente" ? null : new Date()}, recibido_por = ${estado === "pendiente" ? null : usuario.id}
         WHERE id = ${rid} RETURNING solicitud_id`;
      if (!r) throw new ErrorTrabajo("Ese requisito no existe.");
      return r.solicitud_id;
    });
  } catch (e) {
    return error(e);
  }
  volver(empresaId, sid ?? undefined);
  return { ok: "Listo." };
}

export async function guardarPrecioTrabajo(empresaId: string, sid: string, _: Estado, fd: FormData): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/solicitudes");
  if (!esUuid(sid)) return { error: "Ese trabajo no existe." };
  try {
    const precio = leerPrecioTrabajo(fd);
    await conEmpresa(empresaId, async (tx) => {
      const [s] = await tx<{ factura_id: string | null }[]>`SELECT factura_id FROM solicitudes WHERE id = ${sid} FOR UPDATE`;
      if (!s) throw new ErrorTrabajo("Ese trabajo no existe.");
      if (s.factura_id) throw new ErrorTrabajo("Ya tiene factura: el precio se cambia en la factura.");
      await tx`UPDATE solicitudes SET precio = ${precio} WHERE id = ${sid}`;
    });
  } catch (e) {
    return error(e);
  }
  volver(empresaId, sid);
  return { ok: precio_ok(fd) };
}
const precio_ok = (fd: FormData) => (String(fd.get("precio") ?? "").trim() ? "Precio guardado." : "Sin precio acordado: se usará el de la lista.");

// «Facturar»: un borrador de factura en la empresa propia, con el servicio del trabajo al precio acordado o al de la lista según la categoría
// del cliente. El trabajo queda ligado a la factura (que se emite y se cobra en Contabilidad Empire).
export async function facturarTrabajo(empresaId: string, sid: string, _: Estado): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "registrar", "/solicitudes");
  if (!esUuid(sid)) return { error: "Ese trabajo no existe." };
  const propia = await propiaDe(empresa.firma_id);
  if (!propia) return { error: "Primero marca la empresa propia de la firma (Empresas Empire)." };
  await exigirPermiso(propia, "registrar", "/facturas");
  try {
    const [s] = await conEmpresa(empresaId, (tx) => tx<{ estado: string; servicio_id: string | null; servicio: string | null; descripcion: string; precio: string | null; factura_id: string | null }[]>`
      SELECT estado, servicio_id, servicio, descripcion, precio::text, factura_id FROM solicitudes WHERE id = ${sid}`);
    if (!s) return { error: "Ese trabajo no existe." };
    if (s.factura_id) return { error: "Este trabajo ya tiene factura." };
    if (s.estado === "descartada") return { error: "Un trabajo descartado no se factura." };
    const hoy = hoyISO();
    const { facturaId, precio } = await conEmpresa(propia, async (tx) => {
      const [c] = await tx<{ id: string; categoria: string | null; activo: boolean; rnc: string | null; ncf_predeterminado: TipoFactura | null; dias_credito: number; tipo_ingreso: string }[]>`
        SELECT id, categoria, activo, rnc, ncf_predeterminado, dias_credito, tipo_ingreso FROM clientes WHERE empresa_vinculada_id = ${empresaId}`;
      if (!c) throw new ErrorTrabajo("Este cliente todavía no está en la facturación de la empresa propia.");
      const [sv] = s.servicio_id ? await tx<{ id: string; nombre: string; precio: string; impuesto_id: string | null; impuesto_adicional_id: string | null; unidad_id: string | null }[]>`
        SELECT id, nombre, precio::text, impuesto_id, impuesto_adicional_id, unidad_id FROM servicios WHERE id = ${s.servicio_id}` : [];
      const [itbis] = await tx<{ id: string }[]>`SELECT id FROM impuestos WHERE tipo = 'itbis' AND activo ORDER BY tasa DESC LIMIT 1`;
      const impuestoId = sv?.impuesto_id ?? itbis?.id;
      if (!impuestoId) throw new ErrorTrabajo("La empresa propia no tiene configurado el ITBIS.");
      const deLista = s.precio === null && !!sv; // el precio de la lista lleva el cargo por la aplicación si el cliente la usa; el acordado se respeta tal cual
      const base = s.precio ?? (sv ? precioPara(sv.precio, (await preciosVigentes(tx, hoy)).get(sv.id), c.categoria).precio : "0.00");
      if (aCentavos(base) <= 0n) throw new ErrorTrabajo("Escribe el precio del trabajo: el servicio no tiene precio en la lista.");
      const cargo = deLista ? await cargoDelCliente(tx, c.id) : null;
      const precio = cargo ? deCentavos(conCargo(aCentavos(base), cargo)) : base;
      const vence = new Date(Date.parse(`${hoy}T00:00:00Z`) + c.dias_credito * 86400000).toISOString().slice(0, 10);
      const facturaId = await guardarBorradorFactura(tx, {
        empresaId: propia, usuarioId: usuario.id, clienteId: c.id, tipo: c.ncf_predeterminado ?? (c.rnc ? "B01" : "B02"), fecha: hoy, vence, moneda: "DOP", tasa: 10000n,
        notas: `Trabajo: ${s.descripcion}`.slice(0, 500), tipoIngreso: c.tipo_ingreso, cargoAppPct: cargo,
        lineas: [{ servicioId: sv?.id ?? null, cantidad: 10000n, precio: aCentavos(precio), unidadId: sv?.unidad_id ?? null,
          impuestoIds: [impuestoId, ...(sv?.impuesto_adicional_id ? [sv.impuesto_adicional_id] : [])], descripcion: sv?.nombre ?? s.servicio ?? s.descripcion.slice(0, 200) }],
      });
      return { facturaId, precio };
    });
    await conEmpresa(empresaId, (tx) => tx`UPDATE solicitudes SET factura_id = ${facturaId}, facturado_en = now(), precio = COALESCE(precio, ${precio}) WHERE id = ${sid}`);
    revalidatePath(`/e/${propia}/facturas`);
  } catch (e) {
    return error(e);
  }
  volver(empresaId, sid);
  return { ok: "Borrador de factura creado en Contabilidad Empire: revísalo y emítelo." };
}

// ───── Requisitos de cada servicio (en la lista de precios de la empresa propia) ─────
export async function agregarRequisitoServicio(empresaId: string, servicioId: string, _: Estado, fd: FormData): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/servicios");
  if (!esUuid(servicioId)) return { error: "Ese servicio no existe." };
  try {
    const d = leerRequisito(fd);
    await conEmpresa(empresaId, async (tx) => {
      const [s] = await tx`SELECT 1 FROM servicios WHERE id = ${servicioId}`;
      if (!s) throw new ErrorTrabajo("Ese servicio no existe.");
      await tx`INSERT INTO requisitos_servicio (empresa_id, servicio_id, texto, obligatorio, orden)
               VALUES (${empresaId}, ${servicioId}, ${d.texto}, ${d.obligatorio}, COALESCE((SELECT max(orden) + 1 FROM requisitos_servicio WHERE servicio_id = ${servicioId}), 0))`;
    });
  } catch (e) {
    return error(e);
  }
  revalidatePath(`/e/${empresaId}/servicios`);
  return { ok: "Requisito agregado al servicio. Los trabajos nuevos lo traen." };
}

export async function quitarRequisitoServicio(empresaId: string, rid: string, _: Estado): Promise<Estado> {
  await exigirPermiso(empresaId, "registrar", "/servicios");
  if (!esUuid(rid)) return { error: "Ese requisito no existe." };
  try {
    await conEmpresa(empresaId, (tx) => tx`UPDATE requisitos_servicio SET activo = false WHERE id = ${rid}`);
  } catch (e) {
    return error(e);
  }
  revalidatePath(`/e/${empresaId}/servicios`);
  return { ok: "Quitado." };
}
