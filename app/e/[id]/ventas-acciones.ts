"use server";

import { leerUnidad } from "@/lib/empresa-propia";
import { CATEGORIAS_PRECIO, ErrorPrecio, GRUPOS_SERVICIO, guardarPrecios, leerPrecios, type PreciosEntrada } from "@/lib/precios";
import { conciliarDesdeBanco } from "@/lib/conciliar-documento";
import { TIPOS_INGRESO } from "@/lib/fiscal";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esUuid, exigirPermiso, misFirmas } from "@/lib/acceso";
import { bitacora, ErrorContable } from "@/lib/asientos";
import { conEmpresa, mensajeError } from "@/lib/db";
import { limpiarRnc } from "@/lib/empresas";
import { cargarListaP01 } from "@/lib/lista-p01";
import { aCentavos, hoyISO, leerMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { fechaValida } from "@/lib/reportes";
import {
  anularCobro, anularFactura, CLAVES_CUENTAS, descartarBorradorFactura, emitir, emitirNotaCredito, esTipoFactura, guardarBorradorFactura,
  leerCantidad, leerCodigoEcf, leerTasa, MOTIVOS_608, registrarCobro, registrarEcfEmitida, type LineaEntrada,
} from "@/lib/ventas";
import type { Estado } from "../../acciones-cuenta";

function texto(fd: FormData, campo: string): string {
  return String(fd.get(campo) ?? "").trim();
}

function monto(fd: FormData, campo: string): bigint | null {
  const m = leerMonto(texto(fd, campo));
  return m === null ? null : aCentavos(m);
}

// ───── Clientes ─────

export async function guardarCliente(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/clientes");
  const id = texto(fd, "id");
  const nombre = texto(fd, "nombre");
  const tipoId = texto(fd, "tipo_identificacion");
  const ident = tipoId === "pasaporte" ? texto(fd, "rnc").toUpperCase() : limpiarRnc(texto(fd, "rnc"));
  const dias = Number(texto(fd, "dias_credito") || "0");
  const ncf = texto(fd, "ncf_predeterminado");
  const retenciones = fd.getAll("retenciones").map(String).filter(esUuid);
  if (!nombre) return { error: "Escribe el nombre o razón social." };
  if (ident && tipoId === "rnc" && !/^\d{9}$/.test(ident)) return { error: "El RNC debe tener 9 dígitos." };
  if (ident && tipoId === "cedula" && !/^\d{11}$/.test(ident)) return { error: "La cédula debe tener 11 dígitos." };
  if (ident && tipoId === "pasaporte" && !/^[A-Z0-9]{5,20}$/.test(ident)) return { error: "El pasaporte no es válido." };
  if (ident && !["rnc", "cedula", "pasaporte"].includes(tipoId)) return { error: "Elige el tipo de identificación." };
  if (ncf && !esTipoFactura(ncf)) return { error: "El comprobante habitual no es válido." };
  if (!Number.isInteger(dias) || dias < 0 || dias > 365) return { error: "Los días de crédito van de 0 a 365." };
  const tipoIngreso = texto(fd, "tipo_ingreso") || "01";
  if (!(tipoIngreso in TIPOS_INGRESO)) return { error: "Elige el tipo de ingreso." };
  const categoria = texto(fd, "categoria") || null;
  if (categoria && !(CATEGORIAS_PRECIO as readonly string[]).includes(categoria)) return { error: "Elige una categoría de la lista." };
  const datos: Record<string, unknown> = {
    nombre, rnc: ident || null, tipo_identificacion: ident ? tipoId : null, email: texto(fd, "email") || null,
    telefono: texto(fd, "telefono") || null, direccion: texto(fd, "direccion") || null, dias_credito: dias,
    ncf_predeterminado: ncf || null, tipo_ingreso: tipoIngreso, retenciones, activo: id ? fd.get("activo") === "on" : true, categoria,
  };
  try {
    await conEmpresa(empresaId, async (tx) => {
      if (retenciones.length) {
        const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM retenciones WHERE id = ANY(${retenciones}::uuid[])`;
        if (n !== retenciones.length) throw new ErrorContable("Una de las retenciones no existe");
      }
      if (id) {
        if (!esUuid(id)) throw new ErrorContable("Cliente no válido");
        // La categoría de un cliente enlazado sale de la ficha de su empresa.
        const [v] = await tx<{ enlazado: boolean }[]>`SELECT empresa_vinculada_id IS NOT NULL AS enlazado FROM clientes WHERE id = ${id}`;
        if (v?.enlazado) delete datos.categoria;
        const r = await tx`UPDATE clientes SET ${tx(datos)} WHERE id = ${id}`;
        if (r.count === 0) throw new ErrorContable("El cliente no existe");
      } else {
        await tx`INSERT INTO clientes ${tx({ ...datos, empresa_id: empresaId })}`;
      }
      await bitacora(tx, empresaId, usuario.id, id ? "cliente_editado" : "cliente_creado", { nombre });
    });
  } catch (e) {
    const err = e as { code?: string };
    return { error: err.code === "23505" ? "Ya hay un cliente con esa identificación." : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/clientes`);
  if (id) redirect(`/e/${empresaId}/clientes`);
  return { ok: `Cliente ${nombre} guardado.` };
}

// ───── Productos y servicios ─────

export async function guardarServicio(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/servicios");
  const id = texto(fd, "id");
  const nombre = texto(fd, "nombre");
  const precio = leerMonto(texto(fd, "precio"));
  const impuesto = texto(fd, "impuesto");
  const adicional = texto(fd, "impuesto_adicional") || null;
  const cuenta = texto(fd, "cuenta_ingreso") || null;
  const codigo = texto(fd, "codigo") || null;
  const grupo = texto(fd, "grupo") || null;
  const unidad = leerUnidad(fd.get("unidad"));
  let precios: PreciosEntrada;
  try {
    precios = leerPrecios(fd, hoyISO());
  } catch (e) {
    if (e instanceof ErrorPrecio) return { error: e.message };
    throw e;
  }
  if (!nombre) return { error: "Escribe el nombre." };
  if (codigo && codigo.length > 20) return { error: "El código va hasta 20 caracteres." };
  if (grupo && !(grupo in GRUPOS_SERVICIO)) return { error: "Elige un grupo de la lista." };
  if (unidad === undefined) return { error: "La unidad de negocio no es válida." };
  if (precio === null) return { error: "El precio no es válido." };
  if (!esUuid(impuesto)) return { error: "Elige el ITBIS (o exento)." };
  if ((adicional && !esUuid(adicional)) || (cuenta && !esUuid(cuenta))) return { error: "Datos no válidos." };
  try {
    await conEmpresa(empresaId, async (tx) => {
      const [p] = await tx<{ tipo: string }[]>`SELECT tipo FROM impuestos WHERE id = ${impuesto}`;
      if (!p || !["itbis", "exento"].includes(p.tipo)) throw new ErrorContable("El impuesto principal debe ser ITBIS o exento");
      if (adicional) {
        const [a] = await tx<{ tipo: string }[]>`SELECT tipo FROM impuestos WHERE id = ${adicional}`;
        if (!a || ["itbis", "exento"].includes(a.tipo)) throw new ErrorContable("El cargo adicional no puede ser otro ITBIS");
      }
      if (cuenta) {
        const [c] = await tx<{ tipo: string; de_detalle: boolean }[]>`SELECT tipo, de_detalle FROM cuentas WHERE id = ${cuenta}`;
        if (!c || c.tipo !== "ingreso" || !c.de_detalle) throw new ErrorContable("La cuenta de ingreso debe ser una cuenta de detalle de ingresos");
      }
      const datos = { nombre, precio, impuesto_id: impuesto, impuesto_adicional_id: adicional, cuenta_ingreso_id: cuenta, codigo, grupo, unidad_id: unidad };
      let servicioId = id;
      if (id) {
        if (!esUuid(id)) throw new ErrorContable("Dato no válido");
        const r = await tx`UPDATE servicios SET ${tx({ ...datos, activo: fd.get("activo") === "on" })} WHERE id = ${id}`;
        if (r.count === 0) throw new ErrorContable("El servicio no existe");
      } else {
        [{ id: servicioId }] = await tx<{ id: string }[]>`INSERT INTO servicios ${tx({ ...datos, empresa_id: empresaId })} RETURNING id`;
      }
      await guardarPrecios(tx, empresaId, servicioId, precios);
      await bitacora(tx, empresaId, usuario.id, id ? "servicio_editado" : "servicio_creado", { nombre });
    });
  } catch (e) {
    return { error: (e as { code?: string }).code === "23505" ? "Ya hay un servicio con ese código." : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/servicios`);
  if (id) redirect(`/e/${empresaId}/servicios`);
  return { ok: `${nombre} guardado.` };
}

// Entrega 6b.1: carga la Lista de Precios EMP-P01 en la empresa propia. Los precios los decide Patricia: pide el permiso «empresa».
export async function cargarLista(empresaId: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "empresa", "/servicios");
  if (!(await misFirmas(usuario.id)).some((f) => f.empresa_propia_id === empresaId)) return { error: "La lista de precios de Empire se carga en Contabilidad Empire." };
  try {
    const r = await conEmpresa(empresaId, async (tx) => {
      const res = await cargarListaP01(tx, empresaId, hoyISO());
      await bitacora(tx, empresaId, usuario.id, "lista_precios_cargada", res);
      return res;
    });
    revalidatePath(`/e/${empresaId}/servicios`);
    return { ok: `Lista EMP-P01: ${r.creados} servicios nuevos, ${r.actualizados} con precios puestos al día y ${r.sinCambios} que ya estaban iguales.` };
  } catch (e) {
    return { error: mensajeError(e) };
  }
}

// ───── Facturas ─────

type LineaForm = { servicioId: string; descripcion: string; cantidad: string; precio: string; impuesto: string; adicional: string; unidad?: string };

function leerLineas(fd: FormData): LineaEntrada[] | string {
  let crudas: LineaForm[];
  try {
    crudas = JSON.parse(String(fd.get("lineas") ?? "[]"));
  } catch {
    return "No se pudieron leer las líneas.";
  }
  const lineas: LineaEntrada[] = [];
  for (const [i, l] of crudas.entries()) {
    if (!l.descripcion.trim() && !l.precio) continue;
    const cantidad = leerCantidad(l.cantidad || "1");
    const precio = leerMonto(l.precio);
    if (!l.descripcion.trim()) return `Línea ${i + 1}: escribe la descripción.`;
    if (cantidad === null) return `Línea ${i + 1}: la cantidad no es válida.`;
    if (precio === null) return `Línea ${i + 1}: el precio no es válido.`;
    if (!esUuid(l.impuesto) || (l.adicional && !esUuid(l.adicional)) || (l.servicioId && !esUuid(l.servicioId))) {
      return `Línea ${i + 1}: elige el impuesto.`;
    }
    const unidadId = leerUnidad(l.unidad);
    if (unidadId === undefined) return `Línea ${i + 1}: la unidad de negocio no es válida.`;
    lineas.push({
      servicioId: l.servicioId || null, descripcion: l.descripcion.trim(), cantidad, precio: aCentavos(precio),
      impuestoIds: [l.impuesto, ...(l.adicional ? [l.adicional] : [])], unidadId,
    });
  }
  return lineas;
}

// Guarda la factura como borrador o, con accion=emitir, la guarda y la emite (toma NCF y registra el asiento).
export async function guardarFactura(empresaId: string, facturaId: string | null, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, permisos } = await exigirPermiso(empresaId, "registrar", "/facturas");
  const emitirAhora = texto(fd, "accion") === "emitir";
  if (emitirAhora && !puede(permisos, "contabilizar")) return { error: "Tu perfil no permite emitir; guárdala como borrador." };
  const clienteId = texto(fd, "cliente");
  const tipo = texto(fd, "tipo");
  const fecha = texto(fd, "fecha");
  let vence = texto(fd, "vence");
  const moneda = texto(fd, "moneda") === "USD" ? "USD" : "DOP";
  const tasa = moneda === "DOP" ? 10000n : leerTasa(texto(fd, "tasa"));
  if (!esUuid(clienteId)) return { error: "Elige el cliente." };
  if (!esTipoFactura(tipo)) return { error: "Elige el tipo de comprobante." };
  if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
  if (!fechaValida(vence)) vence = fecha;
  if (tasa === null) return { error: "Escribe la tasa del dólar." };
  const lineas = leerLineas(fd);
  if (typeof lineas === "string") return { error: lineas };
  let id: string;
  let ncf: string | null = null;
  try {
    ({ id, ncf } = await conEmpresa(empresaId, async (tx) => {
      const id = await guardarBorradorFactura(tx, {
        facturaId, empresaId, usuarioId: usuario.id, clienteId, tipo, fecha, vence, moneda, tasa, notas: texto(fd, "notas") || null, lineas,
        tipoIngreso: texto(fd, "tipo_ingreso") || "01",
      });
      return { id, ncf: emitirAhora ? (await emitir(tx, { empresaId, usuarioId: usuario.id, facturaId: id })).ncf : null };
    }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/facturas/${id}?${ncf ? "emitida" : "guardada"}=1`);
}

export async function emitirBorrador(empresaId: string, facturaId: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "contabilizar", "/facturas");
  try {
    await conEmpresa(empresaId, (tx) => emitir(tx, { empresaId, usuarioId: usuario.id, facturaId }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/facturas/${facturaId}?emitida=1`);
}

// Fecha y hora de firma de la e-CF (opcional): «AAAA-MM-DDTHH:MM» del navegador.
function firmaEcf(fd: FormData): string | null | false {
  const v = texto(fd, "ecf_firmada");
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v) && fechaValida(v.slice(0, 10)) ? v.replace("T", " ") : false;
}

// Entrega E1: el borrador se emitió fuera como e-CF (Facturador Gratuito o proveedor): se registra con su e-NCF.
export async function registrarEcf(empresaId: string, facturaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "contabilizar", "/facturas");
  const codigo = leerCodigoEcf(texto(fd, "ecf_codigo"));
  const firmada = firmaEcf(fd);
  if (codigo === false) return { error: "El código de seguridad lleva solo letras y números, como sale en la factura." };
  if (firmada === false) return { error: "La fecha de firma no es válida." };
  try {
    await conEmpresa(empresaId, (tx) => registrarEcfEmitida(tx, { empresaId, usuarioId: usuario.id, facturaId, encf: texto(fd, "encf"), codigo, firmada }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/facturas/${facturaId}?emitida=1`);
}

export async function descartarFactura(empresaId: string, facturaId: string): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/facturas");
  try {
    await conEmpresa(empresaId, async (tx) => {
      await descartarBorradorFactura(tx, facturaId);
      await bitacora(tx, empresaId, usuario.id, "factura_borrador_descartada", { id: facturaId });
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/facturas?descartada=1`);
}

export async function crearNotaCredito(empresaId: string, facturaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "revertir", "/facturas");
  const fecha = texto(fd, "fecha");
  const subtotal = monto(fd, "subtotal");
  const impuestoId = texto(fd, "impuesto");
  const motivo = texto(fd, "motivo");
  if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
  if (subtotal === null || subtotal <= 0n) return { error: "Escribe el monto sin impuestos." };
  if (!esUuid(impuestoId)) return { error: "Elige el impuesto." };
  if (!motivo) return { error: "Escribe el motivo." };
  // Nota emitida fuera como e-CF (E34): su e-NCF, código y fecha de firma.
  const encf = texto(fd, "encf") || null;
  const ecfCodigo = leerCodigoEcf(texto(fd, "ecf_codigo"));
  const ecfFirmada = firmaEcf(fd);
  if (ecfCodigo === false) return { error: "El código de seguridad lleva solo letras y números, como sale en la nota." };
  if (ecfFirmada === false) return { error: "La fecha de firma no es válida." };
  let id: string;
  try {
    id = await conEmpresa(empresaId, (tx) => emitirNotaCredito(tx, {
      empresaId, usuarioId: usuario.id, facturaId, fecha, subtotal, impuestoId, motivo, encf, ecfCodigo, ecfFirmada,
    }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/facturas/${id}?emitida=1`);
}

export async function anularComprobante(empresaId: string, facturaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "revertir", "/facturas");
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

// ───── Cobros ─────

export async function crearCobro(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  // El cobro se contabiliza al guardarse (como compras y pagos): lo hace quien puede contabilizar.
  const { usuario } = await exigirPermiso(empresaId, "contabilizar", "/cobros");
  const clienteId = texto(fd, "cliente");
  const fecha = texto(fd, "fecha");
  const moneda = texto(fd, "moneda") === "USD" ? "USD" : "DOP";
  const tasa = moneda === "DOP" ? 10000n : leerTasa(texto(fd, "tasa"));
  const recibido = monto(fd, "recibido");
  const formaPago = texto(fd, "forma_pago");
  if (!esUuid(clienteId)) return { error: "Elige el cliente." };
  if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
  if (tasa === null) return { error: "Escribe la tasa del dólar del día del cobro." };
  if (recibido === null) return { error: "Revisa los montos." };
  if (!["efectivo", "transferencia", "cheque", "tarjeta", "permuta", "otro"].includes(formaPago)) return { error: "Elige la forma de pago." };
  let aplicaciones: { facturaId: string; monto: bigint }[];
  let retenciones: { retencionId: string; monto: bigint }[];
  try {
    const leer = (campo: string, clave: string) => (JSON.parse(String(fd.get(campo) ?? "[]")) as Record<string, string>[]).map((a) => {
      const m = leerMonto(a.monto);
      if (m === null || !esUuid(a[clave])) throw new Error("monto");
      return { id: a[clave], monto: aCentavos(m) };
    });
    aplicaciones = leer("aplicaciones", "facturaId").map((a) => ({ facturaId: a.id, monto: a.monto }));
    retenciones = leer("retenciones", "retencionId").map((r) => ({ retencionId: r.id, monto: r.monto }));
  } catch {
    return { error: "Uno de los montos no es válido." };
  }
  let numero: number;
  try {
    numero = await conEmpresa(empresaId, (tx) => registrarCobro(tx, {
      empresaId, usuarioId: usuario.id, clienteId, fecha, moneda, tasa, cuentaDestinoId: texto(fd, "cuenta_destino"),
      formaPago, referencia: texto(fd, "referencia") || null, notas: texto(fd, "notas") || null, recibido, retenciones, aplicaciones,
    }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  const banco = await conciliarDesdeBanco(empresaId, texto(fd, "movimiento"), "cobros", numero, usuario.id);
  redirect(banco ?? `/e/${empresaId}/cobros/${numero}?nuevo=1`);
}

export async function anularRecibo(empresaId: string, numero: number, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "revertir", "/cobros");
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

// ───── Configuración de ventas ─────

export async function guardarCuentasEmpresa(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "catalogo", "/configuracion");
  try {
    await conEmpresa(empresaId, async (tx) => {
      for (const clave of CLAVES_CUENTAS) {
        const cuentaId = texto(fd, clave);
        if (!esUuid(cuentaId)) throw new ErrorContable("Elige todas las cuentas");
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
