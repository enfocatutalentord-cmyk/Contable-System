"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { bitacora } from "@/lib/asientos";
import { conEmpresa, db, mensajeError, type Tx } from "@/lib/db";
import { inicial, leerDiagnostico, S, serviciosIniciales, type Diagnostico } from "@/lib/diagnostico";
import { estadoInicial } from "@/lib/levantamiento";
import { aCentavos, deCentavos, hoyISO } from "@/lib/montos";
import { CATEGORIAS_PRECIO, preciosVigentes, type CategoriaPrecio } from "@/lib/precios";
import { guardarPropuesta, type DatosPropuesta } from "@/lib/propuestas";
import type { Estado } from "../../acciones-cuenta";

// Entrega 6b.3. La coordinadora prepara el diagnóstico; Patricia (permiso «empresa») lo aprueba y entonces nacen las propuestas.

const volver = (id: string, fid: string) => { revalidatePath(`/e/${id}/solicitudes/levantamiento/${fid}`, "layout"); revalidatePath(`/e/${id}/expediente`); };
type Fila = { estado: string; respuestas: Record<string, string> | null; aprobado_en: Date | null; diagnostico: Diagnostico | null; diagnostico_aprobado_en: Date | null;
  propuesta_servicios_id: string | null; propuesta_iguala_id: string | null; tipo_persona: string | null; categoria: string | null };
const leer = async (tx: Tx, fid: string) => {
  const [f] = await tx<Fila[]>`
    SELECT f.estado, f.respuestas, f.aprobado_en, f.diagnostico, f.diagnostico_aprobado_en, f.propuesta_servicios_id, f.propuesta_iguala_id, e.tipo_persona, e.categoria
      FROM formularios f JOIN empresas e ON e.id = f.empresa_id WHERE f.id = ${fid} AND f.tipo = 'levantamiento' FOR UPDATE OF f`;
  if (!f?.respuestas || f.estado !== "aceptado") throw new Error("Primero acepta el levantamiento.");
  return f as Fila & { respuestas: Record<string, string> };
};
const propiaDe = async (firmaId: string) => (await db()<{ propia: string | null }[]>`SELECT empresa_propia_id AS propia FROM firmas WHERE id = ${firmaId}`)[0]?.propia ?? null;

export async function guardarDiagnostico(empresaId: string, fid: string, _: Estado, fd: FormData): Promise<Estado> {
  const { empresa } = await exigirPermiso(empresaId, "registrar", "/solicitudes");
  if (!esUuid(fid)) return { error: "Ese levantamiento no existe." };
  try {
    const propia = await propiaDe(empresa.firma_id);
    const nombres = new Set(propia ? (await conEmpresa(propia, (tx) => tx<{ nombre: string }[]>`SELECT nombre FROM servicios WHERE activo`)).map((s) => s.nombre) : []);
    await conEmpresa(empresaId, async (tx) => {
      const f = await leer(tx, fid);
      if (f.diagnostico_aprobado_en) throw new Error("Ya está aprobado: quita la aprobación para cambiarlo.");
      const d = leerDiagnostico(fd, f.diagnostico ?? inicial(f.respuestas, f.tipo_persona, f.categoria), nombres);
      await tx`UPDATE formularios SET diagnostico = ${tx.json(d as never)} WHERE id = ${fid}`;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : mensajeError(e) };
  }
  volver(empresaId, fid);
  return { ok: "Diagnóstico guardado." };
}

export async function aprobarDiagnostico(empresaId: string, fid: string): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "empresa", "/solicitudes");
  if (!esUuid(fid)) return { error: "Ese levantamiento no existe." };
  try {
    const propia = await propiaDe(empresa.firma_id);
    if (!propia) return { error: "Primero elige la empresa propia en Empresas Empire." };
    await exigirPermiso(propia, "registrar", "/propuestas");
    const f = await conEmpresa(empresaId, (tx) => leer(tx, fid));
    if (!f.aprobado_en) return { error: "Primero aprueba el estado inicial." };
    if (f.diagnostico_aprobado_en) return { error: "Ya está aprobado." };
    if (!f.diagnostico) return { error: "Primero guarda el diagnóstico." };
    const d = f.diagnostico;
    if (!d.categoria) return { error: "Elige la categoría del cliente." };
    const categoria = d.categoria as CategoriaPrecio;
    if (!CATEGORIAS_PRECIO.includes(categoria)) return { error: "La categoría no es válida." };
    const hoy = hoyISO(), vence = new Date(Date.parse(`${hoy}T00:00:00Z`) + 15 * 86400000).toISOString().slice(0, 10);
    const nombres = serviciosIniciales(d);
    const hecho = await conEmpresa(propia, async (tx) => {
      const [c] = await tx<{ id: string }[]>`SELECT id FROM clientes WHERE empresa_vinculada_id = ${empresaId}`;
      if (!c) throw new Error("Este cliente todavía no está en la facturación de la empresa propia.");
      const servicios = await tx<{ id: string; nombre: string; impuesto_id: string; impuesto_adicional_id: string | null; unidad_id: string | null }[]>`
        SELECT id, nombre, impuesto_id, impuesto_adicional_id, unidad_id FROM servicios WHERE activo AND nombre = ANY (${[...nombres, S.registros]})`;
      const precios = await preciosVigentes(tx, hoy);
      const de = (n: string) => { const s = servicios.find((x) => x.nombre === n); if (!s) throw new Error(`Falta «${n}» en la lista de precios: carga la lista EMP-P01.`); return s; };
      const linea = (n: string, descripcion: string, precio: bigint): DatosPropuesta["lineas"][number] => {
        const s = de(n); return { servicioId: s.id, descripcion, cantidad: 10000n, precioLista: precio, descuento: 0n, impuestoId: s.impuesto_id, adicionalId: s.impuesto_adicional_id, unidadId: s.unidad_id };
      };
      const base = { empresaId: propia, usuarioId: usuario.id, clienteId: c.id, fecha: hoy, validaHasta: vence, requisitos: null, anticipoPct: "0", formaPago: null, entrega: null };
      const lineas = nombres.map((n) => { const p = aCentavos(precios.get(de(n).id)?.[categoria] ?? "0"); return { n, p }; });
      let servicios_id: string | null = null, servicios_num: number | null = null, iguala_id: string | null = null, iguala_num: number | null = null;
      const numero = async (id: string) => (await tx<{ numero: number }[]>`SELECT numero FROM propuestas WHERE id = ${id}`)[0].numero;
      if (lineas.length) {
        servicios_id = await guardarPropuesta(tx, { ...base, propuestaId: f.propuesta_servicios_id, notas: "Servicios iniciales según el informe de diagnóstico.", lineas: lineas.map((l) => linea(l.n, l.n, l.p)) });
        servicios_num = await numero(servicios_id);
      }
      if (d.iguala && aCentavos(d.iguala) > 0n) {
        iguala_id = await guardarPropuesta(tx, { ...base, propuestaId: f.propuesta_iguala_id, notas: "Iguala mensual según el informe de diagnóstico.", lineas: [linea(S.registros, "Iguala mensual", aCentavos(d.iguala))] });
        iguala_num = await numero(iguala_id);
      }
      return { lineas, servicios_id, servicios_num, iguala_id, iguala_num };
    });
    await conEmpresa(empresaId, async (tx) => {
      const e = estadoInicial(f.respuestas);
      const ver = (v: bigint) => (v < 0n ? `-${deCentavos(-v)}` : deCentavos(v));
      const resultado = e.operativa.at(-1)!.monto!;
      const total = hecho.lineas.reduce((t, l) => t + l.p, 0n);
      const economica = { lineas: hecho.lineas.map((l) => ({ descripcion: l.n, precio: deCentavos(l.p) })), iguala: d.iguala && aCentavos(d.iguala) > 0n ? deCentavos(aCentavos(d.iguala)) : null,
        total: deCentavos(total), activos: ver(e.activos), pasivos: ver(e.pasivos), patrimonio: ver(e.patrimonio), resultado: f.respuestas.ventas_mes ? ver(resultado) : null, margen: e.margen };
      await tx`UPDATE formularios SET diagnostico = ${tx.json({ ...d, economica } as never)}, diagnostico_aprobado_por = ${usuario.id}, diagnostico_aprobado_en = now(),
                 propuesta_servicios_id = ${hecho.servicios_id}, propuesta_servicios_numero = ${hecho.servicios_num}, propuesta_iguala_id = ${hecho.iguala_id}, propuesta_iguala_numero = ${hecho.iguala_num}
                WHERE id = ${fid}`;
      await tx`UPDATE empresas SET categoria = ${categoria} WHERE id = ${empresaId}`;
      await bitacora(tx, empresaId, usuario.id, "diagnostico_aprobado", { formulario: fid });
    });
    volver(empresaId, fid);
    revalidatePath(`/e/${propia}/propuestas`);
    return { ok: `Aprobado. ${[hecho.servicios_num && `Propuesta n.º ${hecho.servicios_num} (servicios iniciales)`, hecho.iguala_num && `n.º ${hecho.iguala_num} (iguala)`].filter(Boolean).join(" y ") || "Sin propuestas"} en borrador en Contabilidad Empire.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : mensajeError(e) };
  }
}

export async function quitarAprobacionDiagnostico(empresaId: string, fid: string): Promise<Estado> {
  await exigirPermiso(empresaId, "empresa", "/solicitudes");
  if (!esUuid(fid)) return { error: "Ese levantamiento no existe." };
  try {
    await conEmpresa(empresaId, (tx) => tx`UPDATE formularios SET diagnostico_aprobado_por = NULL, diagnostico_aprobado_en = NULL WHERE id = ${fid} AND tipo = 'levantamiento'`);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  volver(empresaId, fid);
  return { ok: "Aprobación quitada. Al aprobar de nuevo, las propuestas se actualizan." };
}
