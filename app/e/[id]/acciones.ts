"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import {
  actualizarBorrador, bitacora, contabilizarAsiento, ErrorContable, insertarAsiento, revertirAsiento, type LineaAsiento,
} from "@/lib/asientos";
import { nivelDeCodigo } from "@/lib/catalogo-rd";
import { conEmpresa, conUsuario, mensajeError, type Tx } from "@/lib/db";
import { huella, nombreSeguro, TAMANO_MAXIMO, tipoPorContenido } from "@/lib/documentos";
import { leerFicha } from "@/lib/empresas";
import { crearEnlace, enviarEnlace } from "@/lib/enlaces";
import { asegurarUsuario, avisoEnlace } from "@/lib/equipo";
import { aCentavos, leerMonto, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { fechaValida } from "@/lib/reportes";
import type { Estado } from "../../acciones-cuenta";

function texto(fd: FormData, campo: string): string {
  return String(fd.get(campo) ?? "").trim();
}

export type EstadoAsiento = Estado & { duplicado?: string };
type LineaForm = { cuentaId: string; descripcion: string; debe: string; haber: string };

function leerLineas(fd: FormData): LineaAsiento[] | string {
  let crudas: LineaForm[];
  try {
    crudas = JSON.parse(String(fd.get("lineas") ?? "[]"));
  } catch {
    return "No se pudieron leer las líneas.";
  }
  const lineas: LineaAsiento[] = [];
  for (const [i, l] of crudas.entries()) {
    if (!l.cuentaId && !l.debe && !l.haber) continue; // fila vacía
    const debe = leerMonto(l.debe);
    const haber = leerMonto(l.haber);
    if (debe === null || haber === null) return `Línea ${i + 1}: el monto no es válido.`;
    if (!l.cuentaId) return `Línea ${i + 1}: elige la cuenta.`;
    if ((aCentavos(debe) > 0n) && (aCentavos(haber) > 0n)) return `Línea ${i + 1}: pon el monto en el debe o en el haber, no en ambos.`;
    lineas.push({ cuentaId: l.cuentaId, descripcion: l.descripcion?.trim() || null, debe: aCentavos(debe), haber: aCentavos(haber) });
  }
  return lineas;
}

// Aviso de duplicado: otro asiento vigente con la misma referencia, o con igual fecha, concepto y total.
async function buscarDuplicado(tx: Tx, d: { id: string | null; fecha: string; concepto: string; referencia: string | null; total: bigint }) {
  const [r] = await tx<{ numero: number | null; fecha: string; estado: string }[]>`
    SELECT a.numero, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.estado
      FROM asientos a
     WHERE a.estado <> 'anulado' AND (${d.id}::uuid IS NULL OR a.id <> ${d.id}::uuid) AND a.revierte_a IS NULL
       AND NOT EXISTS (SELECT 1 FROM asientos r WHERE r.revierte_a = a.id)
       AND ((${d.referencia}::text IS NOT NULL AND a.referencia = ${d.referencia}) OR (a.fecha = ${d.fecha} AND a.concepto = ${d.concepto}))
       AND (SELECT sum(debe) FROM lineas_asiento WHERE asiento_id = a.id) = ${verMontoPlano(d.total)}::numeric
     LIMIT 1`;
  return r ? `Ya existe ${r.estado === "borrador" ? "un borrador" : `el asiento n.º ${r.numero}`} del ${verFecha(r.fecha)} con la misma ${d.referencia ? "referencia" : "fecha y concepto"} y el mismo total.` : null;
}

function verMontoPlano(c: bigint): string {
  return `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`;
}

// Guardar (nuevo o borrador existente) como borrador o directamente contabilizado.
export async function guardarAsiento(empresaId: string, asientoId: string | null, _: EstadoAsiento, fd: FormData): Promise<EstadoAsiento> {
  const { usuario, permisos, empresa } = await exigirPermiso(empresaId, "registrar", "/asientos");
  const contabilizar = fd.get("accion") === "contabilizar";
  const fecha = texto(fd, "fecha");
  const concepto = texto(fd, "concepto");
  const referencia = texto(fd, "referencia") || null;
  if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
  if (!concepto) return { error: "Escribe el concepto del asiento." };
  const lineas = leerLineas(fd);
  if (typeof lineas === "string") return { error: lineas };
  if (lineas.length === 0) return { error: "Agrega al menos una línea." };
  const totalDebe = lineas.reduce((s, l) => s + l.debe, 0n);
  const totalHaber = lineas.reduce((s, l) => s + l.haber, 0n);
  if (contabilizar) {
    if (!puede(permisos, "contabilizar")) return { error: "Tu perfil no permite contabilizar; guárdalo como borrador para que lo aprueben." };
    if (empresa.requiere_aprobacion) return { error: "En esta empresa los asientos requieren aprobación: guárdalo como borrador y que otra persona lo contabilice." };
    if (lineas.length < 2) return { error: "Para contabilizar, el asiento necesita al menos dos líneas." };
    if (totalDebe !== totalHaber) return { error: "No se puede contabilizar: el total del debe y del haber deben ser iguales. Puedes guardarlo como borrador." };
  }

  let id: string;
  try {
    id = await conEmpresa(empresaId, async (tx) => {
      if (fd.get("confirmar_duplicado") !== "on") {
        const dup = await buscarDuplicado(tx, { id: asientoId, fecha, concepto, referencia, total: totalDebe });
        if (dup) throw Object.assign(new ErrorContable(dup), { duplicado: true });
      }
      let aid = asientoId;
      if (aid) {
        await actualizarBorrador(tx, { empresaId, asientoId: aid, usuarioId: usuario.id, fecha, concepto, referencia, lineas });
        if (contabilizar) await contabilizarAsiento(tx, empresaId, aid, usuario.id);
      } else {
        aid = (await insertarAsiento(tx, {
          empresaId, usuarioId: usuario.id, fecha, concepto, referencia, origen: "manual", juntar: false, lineas, contabilizar,
        })).id;
      }
      await bitacora(tx, empresaId, usuario.id, contabilizar ? "asiento_contabilizado" : "asiento_borrador", { asiento: aid });
      return aid;
    });
  } catch (e) {
    if ((e as { duplicado?: boolean }).duplicado) return { error: (e as Error).message, duplicado: (e as Error).message };
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/asientos/${id}?${contabilizar ? "contabilizado" : "guardado"}=1`);
}

// Aprobar un borrador. Si la empresa exige aprobación, debe hacerlo otra persona.
export async function contabilizarBorrador(empresaId: string, asientoId: string, _: Estado): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "contabilizar", "/asientos");
  try {
    await conEmpresa(empresaId, async (tx) => {
      const [a] = await tx<{ creado_por: string }[]>`SELECT creado_por FROM asientos WHERE id = ${asientoId}`;
      if (!a) throw new ErrorContable("El asiento no existe");
      if (empresa.requiere_aprobacion && a.creado_por === usuario.id) {
        throw new ErrorContable("En esta empresa otra persona debe aprobar los asientos que tú registras");
      }
      await contabilizarAsiento(tx, empresaId, asientoId, usuario.id);
      await bitacora(tx, empresaId, usuario.id, "asiento_contabilizado", { asiento: asientoId });
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/asientos/${asientoId}?contabilizado=1`);
}

export async function descartarBorrador(empresaId: string, asientoId: string, _: Estado): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar", "/asientos");
  try {
    await conEmpresa(empresaId, async (tx) => {
      const r = await tx`DELETE FROM asientos WHERE id = ${asientoId} AND estado = 'borrador'`;
      if (r.count === 0) throw new ErrorContable("Solo se descartan borradores");
      await tx`UPDATE documentos SET eliminado = true, eliminado_por = ${usuario.id}, eliminado_en = now()
               WHERE entidad = 'asiento' AND entidad_id = ${asientoId} AND NOT eliminado`;
      await bitacora(tx, empresaId, usuario.id, "borrador_descartado", { asiento: asientoId });
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/asientos?descartado=1`);
}

export async function revertir(empresaId: string, asientoId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "revertir", "/asientos");
  const fecha = texto(fd, "fecha");
  const motivo = texto(fd, "motivo");
  if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
  if (!motivo) return { error: "Escribe el motivo de la reversión." };
  let id: string;
  try {
    id = await conEmpresa(empresaId, async (tx) => {
      const r = await revertirAsiento(tx, { empresaId, asientoId, usuarioId: usuario.id, fecha, motivo });
      await bitacora(tx, empresaId, usuario.id, "asiento_revertido", { asiento: asientoId, reversion: r.id, motivo });
      return r.id;
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/asientos/${id}?revertido=1`);
}

// ───── Documentos adjuntos ─────

// Dónde vive cada tipo de documento que acepta adjuntos (tabla y ruta de su página).
const ENTIDADES = {
  asiento: { tabla: "asientos", ruta: "asientos", nombre: "El asiento" },
  factura: { tabla: "facturas", ruta: "facturas", nombre: "La factura" },
  cobro: { tabla: "cobros", ruta: "cobros", nombre: "El cobro" },
  compra: { tabla: "compras", ruta: "compras", nombre: "La compra" },
  pago: { tabla: "pagos", ruta: "pagos", nombre: "El pago" },
} as const;

export async function adjuntarDocumento(empresaId: string, entidad: keyof typeof ENTIDADES, entidadId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "adjuntar");
  const archivo = fd.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) return { error: "Elige el archivo." };
  if (archivo.size > TAMANO_MAXIMO) return { error: "El archivo pasa de 4 MB. Comprímelo o divídelo." };
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const tipo = tipoPorContenido(bytes);
  if (!tipo) return { error: "Solo se aceptan PDF, JPG y PNG." };
  try {
    await conEmpresa(empresaId, async (tx) => {
      const e = ENTIDADES[entidad];
      if (!e || !esUuid(entidadId)) throw new ErrorContable("Documento no válido");
      const [a] = await tx`SELECT 1 FROM ${tx(e.tabla)} WHERE id = ${entidadId}`;
      if (!a) throw new ErrorContable(`${e.nombre} no existe`);
      await tx`
        INSERT INTO documentos (empresa_id, entidad, entidad_id, nombre, tipo, tamano, sha256, contenido, descripcion, subido_por)
        VALUES (${empresaId}, ${entidad}, ${entidadId}, ${nombreSeguro(archivo.name)}, ${tipo}, ${bytes.length}, ${huella(bytes)},
                ${Buffer.from(bytes)}, ${texto(fd, "descripcion") || null}, ${usuario.id})`;
    });
  } catch (e) {
    const err = e as { code?: string };
    return { error: err.code === "23505" ? "Ese mismo archivo ya está adjunto." : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: "Documento adjuntado." };
}

// El soporte de algo contabilizado o emitido no se retira; el de un borrador sí (queda registro).
export async function retirarDocumento(empresaId: string, documentoId: string, _: Estado): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "adjuntar");
  try {
    await conEmpresa(empresaId, async (tx) => {
      const [d] = await tx<{ entidad_id: string; borrador: boolean }[]>`
        SELECT d.entidad_id,
               COALESCE((SELECT a.estado = 'borrador' FROM asientos a WHERE d.entidad = 'asiento' AND a.id = d.entidad_id),
                        (SELECT f.estado = 'borrador' FROM facturas f WHERE d.entidad = 'factura' AND f.id = d.entidad_id),
                        (SELECT c.estado = 'borrador' FROM compras c WHERE d.entidad = 'compra' AND c.id = d.entidad_id), false) AS borrador
          FROM documentos d WHERE d.id = ${documentoId} AND NOT d.eliminado`;
      if (!d) throw new ErrorContable("El documento no existe");
      if (!d.borrador) throw new ErrorContable("El soporte de algo ya contabilizado o emitido no se retira");
      await tx`UPDATE documentos SET eliminado = true, eliminado_por = ${usuario.id}, eliminado_en = now() WHERE id = ${documentoId}`;
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: "Documento retirado." };
}

// ───── Ficha de la empresa ─────

export async function actualizarFicha(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "empresa", "/empresa");
  const f = leerFicha(fd);
  if (typeof f === "string") return { error: f };
  try {
    await conEmpresa(empresaId, (tx) => tx`
      UPDATE empresas SET nombre = ${f.nombre}, nombre_comercial = ${f.nombre_comercial}, tipo_identificacion = ${f.tipo_identificacion},
             rnc = ${f.rnc}, actividad_economica = ${f.actividad_economica}, regimen = ${f.regimen}, direccion = ${f.direccion},
             telefono = ${f.telefono}, correo = ${f.correo}, mes_cierre = ${f.mes_cierre}, inicio_operaciones = ${f.inicio_operaciones},
             requiere_aprobacion = ${f.requiere_aprobacion}, activa = ${f.activa}
       WHERE id = ${empresaId}`);
    void usuario;
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: "Ficha actualizada." };
}

// ───── Acceso a esta empresa ─────

export async function asignarAcceso(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "usuarios", "/usuarios");
  const email = texto(fd, "email").toLowerCase();
  const nombre = texto(fd, "nombre");
  const personaId = texto(fd, "usuario");
  const perfil = texto(fd, "perfil");
  try {
    const invitado = await conUsuario(usuario.id, async (tx) => {
      let id = personaId;
      let enlace: { nombre: string; url: string } | null = null;
      if (!id) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErrorContable("El correo no es válido");
        const u = await asegurarUsuario(tx, email, nombre);
        id = u.id;
        if (u.nuevo) enlace = { nombre: u.nombre, url: await crearEnlace(tx, u.id, "invitacion", usuario.id) };
        await tx`INSERT INTO miembros_firma (firma_id, usuario_id) VALUES (${empresa.firma_id}, ${id}) ON CONFLICT DO NOTHING`;
      }
      if (!esUuid(id)) throw new ErrorContable("Persona no válida");
      const [mf] = await tx<{ administrador: boolean }[]>`SELECT administrador FROM miembros_firma WHERE firma_id = ${empresa.firma_id} AND usuario_id = ${id}`;
      if (!mf) throw new ErrorContable("Esa persona no es parte de la firma");
      if (mf.administrador) throw new ErrorContable("Los administradores de la firma ya tienen acceso total");
      if (!perfil) {
        await tx`DELETE FROM miembros WHERE empresa_id = ${empresaId} AND usuario_id = ${id}`;
      } else {
        const [p] = await tx`SELECT 1 FROM perfiles WHERE id = ${perfil} AND firma_id = ${empresa.firma_id}`;
        if (!p) throw new ErrorContable("Elige un perfil");
        await tx`INSERT INTO miembros (empresa_id, usuario_id, perfil_id) VALUES (${empresaId}, ${id}, ${perfil})
                 ON CONFLICT (empresa_id, usuario_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id`;
      }
      return enlace;
    });
    revalidatePath(`/e/${empresaId}/usuarios`);
    if (invitado) {
      const enviado = await enviarEnlace({ para: email, nombre: invitado.nombre, url: invitado.url, tipo: "invitacion", firma: empresa.firma, quien: usuario.nombre });
      return { ok: `Acceso creado. ${avisoEnlace(email, enviado, invitado.url)}` };
    }
    return { ok: perfil ? "Acceso guardado." : "Acceso quitado." };
  } catch (e) {
    return { error: mensajeError(e) };
  }
}

// ───── Catálogo y cierres ─────

export async function crearCuenta(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "catalogo", "/catalogo");
  const padreId = texto(fd, "padre");
  const sufijo = texto(fd, "sufijo");
  const nombre = texto(fd, "nombre");
  if (!/^\d{2}$/.test(sufijo)) return { error: "El código nuevo son 2 dígitos (por ejemplo 05)." };
  if (!nombre) return { error: "Escribe el nombre de la cuenta." };
  try {
    const codigo = await conEmpresa(empresaId, async (tx) => {
      const [padre] = await tx<{ id: string; codigo: string; tipo: string; de_detalle: boolean }[]>`
        SELECT id, codigo, tipo, de_detalle FROM cuentas WHERE id = ${padreId}`;
      if (!padre) throw new ErrorContable("La cuenta madre no existe");
      const codigo = padre.codigo + sufijo;
      if (codigo.length > 10) throw new ErrorContable("No se pueden crear más niveles bajo esa cuenta");
      if (padre.de_detalle) {
        // Una cuenta de detalle se vuelve de grupo al recibir subcuentas, solo si no tiene movimientos.
        const [{ usada }] = await tx<{ usada: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM lineas_asiento WHERE cuenta_id = ${padre.id}) AS usada`;
        if (usada) throw new ErrorContable(`La cuenta ${padre.codigo} ya tiene movimientos; no se le pueden crear subcuentas`);
        await tx`UPDATE cuentas SET de_detalle = false WHERE id = ${padre.id}`;
      }
      await tx`
        INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
        VALUES (${empresaId}, ${codigo}, ${nombre}, ${padre.tipo}, ${padre.id}, ${nivelDeCodigo(codigo)}, true)`;
      await tx`INSERT INTO bitacora (empresa_id, usuario_id, accion, detalle)
               VALUES (${empresaId}, ${usuario.id}, 'cuenta_creada', ${tx.json({ codigo, nombre })})`;
      return codigo;
    });
    revalidatePath(`/e/${empresaId}/catalogo`);
    return { ok: `Cuenta ${codigo} creada.` };
  } catch (e) {
    return { error: mensajeError(e) };
  }
}

export async function editarCuenta(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "catalogo", "/catalogo");
  const cuentaId = texto(fd, "cuenta");
  const nombre = texto(fd, "nombre");
  const activa = fd.get("activa") === "on";
  if (!nombre) return { error: "Escribe el nombre de la cuenta." };
  try {
    await conEmpresa(empresaId, async (tx) => {
      const r = await tx`UPDATE cuentas SET nombre = ${nombre}, activa = ${activa} WHERE id = ${cuentaId}`;
      if (r.count === 0) throw new ErrorContable("La cuenta no existe");
      await tx`INSERT INTO bitacora (empresa_id, usuario_id, accion, detalle)
               VALUES (${empresaId}, ${usuario.id}, 'cuenta_editada', ${tx.json({ cuentaId, nombre, activa })})`;
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/catalogo`);
  return { ok: "Cuenta actualizada." };
}

export async function fijarBloqueo(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "cerrar", "/cierres");
  const nueva = texto(fd, "fecha") || null;
  if (nueva && !fechaValida(nueva)) return { error: "La fecha no es válida." };
  const actual = empresa.fecha_bloqueo;
  const reabre = actual && (!nueva || nueva < actual);
  if (reabre) await exigirPermiso(empresaId, "reabrir"); // solo el dueño puede reabrir un período cerrado
  try {
    await conEmpresa(empresaId, async (tx) => {
      await tx`UPDATE empresas SET fecha_bloqueo = ${nueva} WHERE id = ${empresaId}`;
      await tx`INSERT INTO bitacora (empresa_id, usuario_id, accion, detalle)
               VALUES (${empresaId}, ${usuario.id}, ${reabre ? "periodo_reabierto" : "periodo_cerrado"},
                       ${tx.json({ antes: actual, despues: nueva })})`;
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: nueva ? `Período cerrado hasta el ${verFecha(nueva)}.` : "Se quitó la fecha de bloqueo." };
}

