"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPermiso } from "@/lib/acceso";
import { bitacora, ErrorContable } from "@/lib/asientos";
import { conEmpresa, mensajeError } from "@/lib/db";
import { limpiarRnc, rncValido } from "@/lib/empresas";
import { aCentavos, leerMonto } from "@/lib/montos";
import { fechaValida } from "@/lib/reportes";
import {
  anularCobro, anularFactura, emitirFactura, emitirNotaCredito, leerCantidad, leerTasa, MOTIVOS_608,
  registrarCobro, type LineaVenta, type TipoNcf,
} from "@/lib/ventas";
import type { Estado } from "../../acciones-cuenta";

function texto(fd: FormData, campo: string): string {
  return String(fd.get(campo) ?? "").trim();
}

function monto(fd: FormData, campo: string): bigint | null {
  const m = leerMonto(texto(fd, campo));
  return m === null ? null : aCentavos(m);
}

export async function guardarCliente(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar");
  const id = texto(fd, "id");
  const nombre = texto(fd, "nombre");
  const rnc = limpiarRnc(texto(fd, "rnc"));
  const dias = Number(texto(fd, "dias_credito") || "0");
  if (!nombre) return { error: "Escribe el nombre o razón social." };
  if (rnc && !rncValido(rnc)) return { error: "El RNC debe tener 9 dígitos (o 11 si es cédula)." };
  if (!Number.isInteger(dias) || dias < 0 || dias > 365) return { error: "Los días de crédito van de 0 a 365." };
  const datos = {
    nombre, rnc: rnc || null, email: texto(fd, "email") || null, telefono: texto(fd, "telefono") || null,
    direccion: texto(fd, "direccion") || null, dias, activo: id ? fd.get("activo") === "on" : true,
  };
  try {
    await conEmpresa(empresaId, async (tx) => {
      if (id) {
        const r = await tx`
          UPDATE clientes SET nombre = ${datos.nombre}, rnc = ${datos.rnc}, email = ${datos.email}, telefono = ${datos.telefono},
                 direccion = ${datos.direccion}, dias_credito = ${datos.dias}, activo = ${datos.activo}
           WHERE id = ${id}`;
        if (r.count === 0) throw new ErrorContable("El cliente no existe");
      } else {
        await tx`
          INSERT INTO clientes (empresa_id, nombre, rnc, email, telefono, direccion, dias_credito)
          VALUES (${empresaId}, ${datos.nombre}, ${datos.rnc}, ${datos.email}, ${datos.telefono}, ${datos.direccion}, ${datos.dias})`;
      }
      await bitacora(tx, empresaId, usuario.id, id ? "cliente_editado" : "cliente_creado", { nombre });
    });
  } catch (e) {
    const err = e as { code?: string };
    return { error: err.code === "23505" ? "Ya hay un cliente con ese RNC." : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/clientes`);
  if (id) redirect(`/e/${empresaId}/clientes`);
  return { ok: `Cliente ${nombre} guardado.` };
}

export async function guardarServicio(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar");
  const id = texto(fd, "id");
  const nombre = texto(fd, "nombre");
  const precio = leerMonto(texto(fd, "precio"));
  const tasa = Number(texto(fd, "tasa_itbis"));
  const cuenta = texto(fd, "cuenta_ingreso") || null;
  if (!nombre) return { error: "Escribe el nombre del servicio." };
  if (precio === null) return { error: "El precio no es válido." };
  if (![0, 16, 18].includes(tasa)) return { error: "El ITBIS debe ser 18 %, 16 % o exento." };
  try {
    await conEmpresa(empresaId, async (tx) => {
      if (cuenta) {
        const [c] = await tx<{ tipo: string; de_detalle: boolean }[]>`SELECT tipo, de_detalle FROM cuentas WHERE id = ${cuenta}`;
        if (!c || c.tipo !== "ingreso" || !c.de_detalle) throw new ErrorContable("La cuenta de ingreso debe ser una cuenta de detalle de ingresos");
      }
      if (id) {
        await tx`UPDATE servicios SET nombre = ${nombre}, precio = ${precio}, tasa_itbis = ${tasa}, cuenta_ingreso_id = ${cuenta},
                        activo = ${fd.get("activo") === "on"} WHERE id = ${id}`;
      } else {
        await tx`INSERT INTO servicios (empresa_id, nombre, precio, tasa_itbis, cuenta_ingreso_id)
                 VALUES (${empresaId}, ${nombre}, ${precio}, ${tasa}, ${cuenta})`;
      }
      await bitacora(tx, empresaId, usuario.id, id ? "servicio_editado" : "servicio_creado", { nombre });
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/servicios`);
  if (id) redirect(`/e/${empresaId}/servicios`);
  return { ok: `Servicio ${nombre} guardado.` };
}

export async function agregarSecuencia(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "catalogo");
  const tipo = texto(fd, "tipo") as TipoNcf;
  const desde = Number(texto(fd, "desde"));
  const hasta = Number(texto(fd, "hasta"));
  const vence = texto(fd, "vence");
  if (!["B01", "B02", "B14", "B15", "B04"].includes(tipo)) return { error: "Elige el tipo de comprobante." };
  if (!Number.isInteger(desde) || !Number.isInteger(hasta) || desde < 1 || hasta > 99999999 || desde > hasta) {
    return { error: "El rango no es válido (del 1 al 99,999,999, y «desde» no puede pasar de «hasta»)." };
  }
  if (!fechaValida(vence)) return { error: "Pon la fecha de vencimiento que indica la DGII." };
  try {
    await conEmpresa(empresaId, async (tx) => {
      const [choque] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM secuencias_ncf WHERE tipo = ${tipo} AND desde <= ${hasta} AND hasta >= ${desde}`;
      if (choque.n > 0) throw new ErrorContable("Ese rango se cruza con otro ya registrado del mismo tipo");
      const [{ usado }] = await tx<{ usado: number }[]>`
        SELECT count(*)::int AS usado FROM facturas WHERE tipo_ncf = ${tipo} AND substr(ncf, 4)::bigint BETWEEN ${desde} AND ${hasta}`;
      if (usado > 0) throw new ErrorContable("Ya hay comprobantes emitidos dentro de ese rango");
      await tx`INSERT INTO secuencias_ncf (empresa_id, tipo, desde, hasta, siguiente, vence)
               VALUES (${empresaId}, ${tipo}, ${desde}, ${hasta}, ${desde}, ${vence})`;
      await bitacora(tx, empresaId, usuario.id, "secuencia_agregada", { tipo, desde, hasta, vence });
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/comprobantes`);
  return { ok: `Rango ${tipo} agregado.` };
}

export async function desactivarSecuencia(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "catalogo");
  const id = texto(fd, "id");
  try {
    await conEmpresa(empresaId, async (tx) => {
      await tx`UPDATE secuencias_ncf SET activa = false WHERE id = ${id}`;
      await bitacora(tx, empresaId, usuario.id, "secuencia_desactivada", { id });
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/comprobantes`);
  return { ok: "Rango desactivado." };
}

type LineaForm = { servicioId: string; descripcion: string; cantidad: string; precio: string; tasa: string };

export async function crearFactura(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar");
  const clienteId = texto(fd, "cliente");
  const tipo = texto(fd, "tipo") as Exclude<TipoNcf, "B04">;
  const fecha = texto(fd, "fecha");
  let vence = texto(fd, "vence");
  const moneda = texto(fd, "moneda") === "USD" ? "USD" : "DOP";
  const tasa = moneda === "DOP" ? 10000n : leerTasa(texto(fd, "tasa"));
  if (!clienteId) return { error: "Elige el cliente." };
  if (!["B01", "B02", "B14", "B15"].includes(tipo)) return { error: "Elige el tipo de comprobante." };
  if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
  if (!fechaValida(vence)) vence = fecha;
  if (vence < fecha) return { error: "El vencimiento no puede ser antes de la fecha de la factura." };
  if (tasa === null) return { error: "Escribe la tasa del dólar." };

  let crudas: LineaForm[];
  try {
    crudas = JSON.parse(String(fd.get("lineas") ?? "[]"));
  } catch {
    return { error: "No se pudieron leer las líneas." };
  }
  const lineas: LineaVenta[] = [];
  for (const [i, l] of crudas.entries()) {
    if (!l.descripcion.trim() && !l.precio) continue;
    const cantidad = leerCantidad(l.cantidad || "1");
    const precio = leerMonto(l.precio);
    const tasaItbis = Number(l.tasa);
    if (!l.descripcion.trim()) return { error: `Línea ${i + 1}: escribe la descripción.` };
    if (cantidad === null) return { error: `Línea ${i + 1}: la cantidad no es válida.` };
    if (precio === null) return { error: `Línea ${i + 1}: el precio no es válido.` };
    if (![0, 16, 18].includes(tasaItbis)) return { error: `Línea ${i + 1}: el ITBIS no es válido.` };
    lineas.push({
      servicioId: l.servicioId || null, descripcion: l.descripcion.trim(), cantidad, precio: aCentavos(precio),
      tasa: tasaItbis, cuentaIngresoId: "", // la cuenta sale del servicio o de la configuración, nunca del navegador
    });
  }
  let id: string;
  try {
    id = await conEmpresa(empresaId, async (tx) => {
      // Cada línea usa la cuenta de su servicio, o la de ingresos por servicios de la configuración.
      const [{ cuenta_id: porDefecto }] = await tx<{ cuenta_id: string }[]>`
        SELECT cuenta_id FROM cuentas_empresa WHERE clave = 'ingreso_servicios'`;
      for (const l of lineas) {
        if (!l.cuentaIngresoId) {
          const [s] = l.servicioId
            ? await tx<{ cuenta_ingreso_id: string | null }[]>`SELECT cuenta_ingreso_id FROM servicios WHERE id = ${l.servicioId}`
            : [];
          l.cuentaIngresoId = s?.cuenta_ingreso_id ?? porDefecto;
        }
      }
      return emitirFactura(tx, {
        empresaId, usuarioId: usuario.id, clienteId, tipo, fecha, vence, moneda, tasa, notas: texto(fd, "notas") || null, lineas,
      });
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/facturas/${id}?nueva=1`);
}

export async function crearNotaCredito(empresaId: string, facturaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "anular");
  const fecha = texto(fd, "fecha");
  const subtotal = monto(fd, "subtotal");
  const tasaItbis = Number(texto(fd, "tasa_itbis"));
  const motivo = texto(fd, "motivo");
  if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
  if (subtotal === null || subtotal <= 0n) return { error: "Escribe el monto sin ITBIS." };
  if (![0, 16, 18].includes(tasaItbis)) return { error: "El ITBIS no es válido." };
  if (!motivo) return { error: "Escribe el motivo." };
  let id: string;
  try {
    id = await conEmpresa(empresaId, (tx) => emitirNotaCredito(tx, { empresaId, usuarioId: usuario.id, facturaId, fecha, subtotal, tasaItbis, motivo }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/facturas/${id}?nueva=1`);
}

export async function anularComprobante(empresaId: string, facturaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "anular");
  const motivo = texto(fd, "motivo");
  if (!MOTIVOS_608[motivo]) return { error: "Elige el motivo de anulación." };
  try {
    await conEmpresa(empresaId, (tx) => anularFactura(tx, { empresaId, usuarioId: usuario.id, facturaId, motivo }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/facturas/${facturaId}?anulada=1`);
}

export async function crearCobro(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar");
  const clienteId = texto(fd, "cliente");
  const fecha = texto(fd, "fecha");
  const moneda = texto(fd, "moneda") === "USD" ? "USD" : "DOP";
  const tasa = moneda === "DOP" ? 10000n : leerTasa(texto(fd, "tasa"));
  const recibido = monto(fd, "recibido");
  const retencionItbis = monto(fd, "retencion_itbis");
  const retencionIsr = monto(fd, "retencion_isr");
  const formaPago = texto(fd, "forma_pago");
  if (!clienteId) return { error: "Elige el cliente." };
  if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
  if (tasa === null) return { error: "Escribe la tasa del dólar del día del cobro." };
  if (recibido === null || retencionItbis === null || retencionIsr === null) return { error: "Revisa los montos." };
  if (!["efectivo", "transferencia", "cheque", "tarjeta", "otro"].includes(formaPago)) return { error: "Elige la forma de pago." };
  let crudas: { facturaId: string; monto: string }[];
  try {
    crudas = JSON.parse(String(fd.get("aplicaciones") ?? "[]"));
  } catch {
    return { error: "No se pudieron leer las facturas." };
  }
  const aplicaciones: { facturaId: string; monto: bigint }[] = [];
  for (const a of crudas) {
    const m = leerMonto(a.monto);
    if (m === null) return { error: "Uno de los montos aplicados no es válido." };
    aplicaciones.push({ facturaId: a.facturaId, monto: aCentavos(m) });
  }
  let numero: number;
  try {
    numero = await conEmpresa(empresaId, (tx) => registrarCobro(tx, {
      empresaId, usuarioId: usuario.id, clienteId, fecha, moneda, tasa, cuentaDestinoId: texto(fd, "cuenta_destino"),
      formaPago, referencia: texto(fd, "referencia") || null, notas: texto(fd, "notas") || null,
      recibido, retencionItbis, retencionIsr, aplicaciones,
    }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/cobros/${numero}?nuevo=1`);
}

export async function anularRecibo(empresaId: string, numero: number, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "anular");
  const motivo = texto(fd, "motivo");
  if (!motivo) return { error: "Escribe el motivo." };
  try {
    await conEmpresa(empresaId, (tx) => anularCobro(tx, { empresaId, usuarioId: usuario.id, numero, motivo }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/cobros/${numero}?anulado=1`);
}

const CLAVES = ["cxc", "itbis_por_pagar", "ingreso_servicios", "devoluciones_ventas", "itbis_retenido_terceros",
  "isr_retenido_terceros", "ganancia_cambiaria", "perdida_cambiaria"];

export async function guardarCuentasEmpresa(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "catalogo");
  try {
    await conEmpresa(empresaId, async (tx) => {
      for (const clave of CLAVES) {
        const cuentaId = texto(fd, clave);
        if (!cuentaId) throw new ErrorContable("Elige todas las cuentas");
        const [c] = await tx<{ de_detalle: boolean }[]>`SELECT de_detalle FROM cuentas WHERE id = ${cuentaId}`;
        if (!c?.de_detalle) throw new ErrorContable("Todas deben ser cuentas de detalle");
        await tx`INSERT INTO cuentas_empresa (empresa_id, clave, cuenta_id) VALUES (${empresaId}, ${clave}, ${cuentaId})
                 ON CONFLICT (empresa_id, clave) DO UPDATE SET cuenta_id = EXCLUDED.cuenta_id`;
      }
      await bitacora(tx, empresaId, usuario.id, "configuracion_cuentas", {});
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/configuracion`);
  return { ok: "Configuración guardada." };
}

