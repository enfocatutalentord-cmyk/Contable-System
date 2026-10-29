"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { bitacora, ErrorContable } from "@/lib/asientos";
import { conEmpresa, mensajeError } from "@/lib/db";
import { CLAVES_OBLIGACION, CODIGOS_606, COMPROBANTES, digitosSecuencia, leerPorcentaje, porcentajeTexto, TIPOS_IMPUESTO } from "@/lib/fiscal";
import { fechaValida } from "@/lib/reportes";
import type { Estado } from "../../acciones-cuenta";

function texto(fd: FormData, campo: string): string {
  return String(fd.get(campo) ?? "").trim();
}

function duplicado(e: unknown, que: string): string {
  return e && typeof e === "object" && "code" in e && (e as { code: string }).code === "23505"
    ? `Ya hay ${que} con ese nombre y la misma fecha de inicio de vigencia`
    : mensajeError(e);
}

// Vigencia opcional: sin «desde» vale desde siempre; sin «hasta», sin límite.
function leerVigencia(fd: FormData): { desde: string; hasta: string | null } | string {
  const desde = texto(fd, "vigente_desde") || "2000-01-01";
  const hasta = texto(fd, "vigente_hasta") || null;
  if (!fechaValida(desde) || (hasta && !fechaValida(hasta))) return "Las fechas de vigencia no son válidas.";
  if (hasta && hasta < desde) return "La vigencia termina antes de empezar.";
  return { desde, hasta };
}

// ───── Perfil fiscal y obligaciones ─────

export async function guardarPerfilFiscal(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  await exigirPermiso(empresaId, "impuestos", "/fiscal");
  const tipoPersona = texto(fd, "tipo_persona") === "fisica" ? "fisica" : "juridica";
  const emisor = fd.get("emisor_ecf") === "on";
  const ecfDesde = emisor ? texto(fd, "ecf_desde") || null : null;
  if (ecfDesde && !fechaValida(ecfDesde)) return { error: "La fecha de inicio de facturación electrónica no es válida." };
  try {
    await conEmpresa(empresaId, (tx) => tx`
      UPDATE empresas SET tipo_persona = ${tipoPersona}, contribuye_itbis = ${fd.get("contribuye_itbis") === "on"},
             agente_retencion = ${fd.get("agente_retencion") === "on"}, emisor_ecf = ${emisor}, ecf_desde = ${ecfDesde}
       WHERE id = ${empresaId}`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/fiscal`);
  return { ok: "Perfil fiscal guardado. Revisa abajo las obligaciones sugeridas." };
}

export async function guardarObligaciones(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  await exigirPermiso(empresaId, "impuestos", "/fiscal");
  try {
    await conEmpresa(empresaId, async (tx) => {
      for (const clave of CLAVES_OBLIGACION) {
        const activa = fd.get(`ob_${clave}`) === "on";
        await tx`
          INSERT INTO obligaciones_empresa (empresa_id, clave, activa) VALUES (${empresaId}, ${clave}, ${activa})
          ON CONFLICT (empresa_id, clave) DO UPDATE SET activa = EXCLUDED.activa
          WHERE obligaciones_empresa.activa IS DISTINCT FROM EXCLUDED.activa`;
      }
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/fiscal`);
  return { ok: "Obligaciones guardadas." };
}

// ───── Impuestos ─────

export async function guardarImpuesto(empresaId: string, impuestoId: string | null, _: Estado, fd: FormData): Promise<Estado> {
  await exigirPermiso(empresaId, "impuestos", "/fiscal/impuestos");
  const nombre = texto(fd, "nombre");
  const tipo = texto(fd, "tipo");
  const tasa = tipo === "exento" ? 0n : leerPorcentaje(texto(fd, "tasa"));
  const vigencia = leerVigencia(fd);
  const ventas = texto(fd, "cuenta_ventas") || null;
  const compras = texto(fd, "cuenta_compras") || null;
  if (!nombre) return { error: "Ponle un nombre al impuesto (por ejemplo, «ITBIS 18 %»)." };
  if (!(tipo in TIPOS_IMPUESTO)) return { error: "Elige el tipo de impuesto." };
  if (tasa === null) return { error: "La tasa debe ser un porcentaje entre 0 y 100, con hasta 4 decimales." };
  if (typeof vigencia === "string") return { error: vigencia };
  if (tasa > 0n && (!ventas || !compras)) return { error: "Elige las cuentas de ventas y de compras: el impuesto tiene tasa." };
  if ([ventas, compras].some((c) => c && !esUuid(c))) return { error: "Cuenta no válida." };
  const datos = {
    nombre, tipo, tasa: porcentajeTexto(tasa), cuenta_ventas_id: tasa > 0n ? ventas : null, cuenta_compras_id: tasa > 0n ? compras : null,
    vigente_desde: vigencia.desde, vigente_hasta: vigencia.hasta, activo: impuestoId ? fd.get("activo") === "on" : true,
    nota: texto(fd, "nota") || null,
  };
  try {
    await conEmpresa(empresaId, async (tx) => {
      if (impuestoId) {
        if (!esUuid(impuestoId)) throw new ErrorContable("Impuesto no válido");
        const r = await tx`UPDATE impuestos SET ${tx(datos)} WHERE id = ${impuestoId}`;
        if (r.count === 0) throw new ErrorContable("Ese impuesto no existe");
      } else {
        await tx`INSERT INTO impuestos ${tx({ ...datos, empresa_id: empresaId })}`;
      }
    });
  } catch (e) {
    return { error: duplicado(e, "un impuesto") };
  }
  revalidatePath(`/e/${empresaId}/fiscal`, "layout");
  if (impuestoId) redirect(`/e/${empresaId}/fiscal/impuestos?guardado=1`);
  return { ok: `Impuesto «${nombre}» agregado.` };
}

// ───── Retenciones ─────

export async function guardarRetencion(empresaId: string, retencionId: string | null, _: Estado, fd: FormData): Promise<Estado> {
  await exigirPermiso(empresaId, "impuestos", "/fiscal/retenciones");
  const nombre = texto(fd, "nombre");
  const impuesto = texto(fd, "impuesto");
  const tasa = leerPorcentaje(texto(fd, "tasa"));
  const vigencia = leerVigencia(fd);
  const porTerceros = texto(fd, "cuenta_por_terceros");
  const aTerceros = texto(fd, "cuenta_a_terceros");
  const codigo = impuesto === "isr" && texto(fd, "codigo_606") ? Number(texto(fd, "codigo_606")) : null;
  const ir17 = impuesto === "isr" && texto(fd, "codigo_ir17") ? Number(texto(fd, "codigo_ir17")) : null;
  if (!nombre) return { error: "Ponle un nombre a la retención (por ejemplo, «ISR honorarios 15 %»)." };
  if (impuesto !== "itbis" && impuesto !== "isr") return { error: "Elige si la retención es de ITBIS o de ISR." };
  if (!tasa || tasa === 0n) return { error: "La tasa debe ser un porcentaje mayor que 0 y hasta 100." };
  if (typeof vigencia === "string") return { error: vigencia };
  if (!esUuid(porTerceros) || !esUuid(aTerceros)) return { error: "Elige las dos cuentas de la retención." };
  if (codigo !== null && !(codigo in CODIGOS_606)) return { error: "El tipo de retención para el 606 no es válido." };
  if (ir17 !== null && !(Number.isInteger(ir17) && ir17 >= 1 && ir17 <= 24)) return { error: "El concepto del IR-17 no es válido." };
  const datos = {
    nombre, impuesto, tasa: porcentajeTexto(tasa), cuenta_por_terceros_id: porTerceros, cuenta_a_terceros_id: aTerceros, codigo_606: codigo, codigo_ir17: ir17,
    vigente_desde: vigencia.desde, vigente_hasta: vigencia.hasta, activo: retencionId ? fd.get("activo") === "on" : true,
    nota: texto(fd, "nota") || null,
  };
  try {
    await conEmpresa(empresaId, async (tx) => {
      if (retencionId) {
        if (!esUuid(retencionId)) throw new ErrorContable("Retención no válida");
        const r = await tx`UPDATE retenciones SET ${tx(datos)} WHERE id = ${retencionId}`;
        if (r.count === 0) throw new ErrorContable("Esa retención no existe");
      } else {
        await tx`INSERT INTO retenciones ${tx({ ...datos, empresa_id: empresaId })}`;
      }
    });
  } catch (e) {
    return { error: duplicado(e, "una retención") };
  }
  revalidatePath(`/e/${empresaId}/fiscal`, "layout");
  if (retencionId) redirect(`/e/${empresaId}/fiscal/retenciones?guardado=1`);
  return { ok: `Retención «${nombre}» agregada.` };
}

// ───── Comprobantes (rangos autorizados por la DGII) ─────

export async function agregarSecuencia(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "impuestos", "/comprobantes");
  const tipo = texto(fd, "tipo");
  const desde = Number(texto(fd, "desde"));
  const hasta = Number(texto(fd, "hasta"));
  const vence = texto(fd, "vence");
  if (!(tipo in COMPROBANTES)) return { error: "Elige el tipo de comprobante." };
  const maximo = 10 ** digitosSecuencia(tipo) - 1;
  if (!Number.isSafeInteger(desde) || !Number.isSafeInteger(hasta) || desde < 1 || hasta > maximo || desde > hasta) {
    return { error: `El rango no es válido (del 1 al ${maximo.toLocaleString("en-US")}, y «desde» no puede pasar de «hasta»).` };
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
  const { usuario } = await exigirPermiso(empresaId, "impuestos", "/comprobantes");
  const id = texto(fd, "id");
  if (!esUuid(id)) return { error: "Rango no válido." };
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
