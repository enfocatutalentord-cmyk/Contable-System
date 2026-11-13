"use server";

// Integración con Vendario, parte 1: lo que hace el equipo de la firma con las solicitudes y los clientes de Vendario.
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { accesoFirma, esUuid, soloCliente } from "@/lib/acceso";
import { equipoDe } from "@/lib/firma";
import { aceptar, cambiarEstado, enviarPendientes, ErrorVendario, marcarFirmaReceptora, reenviar } from "@/lib/vendario";
import { contabilizarEvento, contabilizarPendientes, guardarMapeo } from "@/lib/vendario-registro";
import { db, mensajeError } from "@/lib/db";
import { type EstadoServicio } from "@/lib/vendario-sobre";
import type { Estado } from "../acciones-cuenta";

async function equipo(firmaId: string, soloAdministrador = false) {
  const { usuario, firma } = await accesoFirma(firmaId, soloAdministrador);
  if (await soloCliente(firmaId, usuario.id)) throw new Error("Solo para el equipo de la firma");
  return { usuario, firma };
}

const mensaje = (e: unknown) => (e instanceof ErrorVendario ? e.message : (console.error("vendario", e), "No se pudo guardar. Inténtalo de nuevo."));
const enviar = () => after(() => enviarPendientes().catch((e) => console.error("vendario enviar", (e as Error).message)));
const revalidar = (firmaId: string) => revalidatePath(`/firma/${firmaId}/vendario`, "layout");

export async function aceptarSolicitud(firmaId: string, clienteId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await equipo(firmaId);
  const responsableId = String(fd.get("responsable") ?? "");
  const empresa = String(fd.get("empresa") ?? "nueva");
  if (!esUuid(clienteId)) return { error: "La solicitud no existe." };
  if (!(await equipoDe(firmaId)).some((p) => p.id === responsableId)) return { error: "Elige el responsable entre el equipo de la firma." };
  if (empresa !== "nueva" && !esUuid(empresa)) return { error: "Elige la empresa." };
  try {
    await aceptar({ firmaId, clienteId, usuarioId: usuario.id, responsableId, empresaId: empresa === "nueva" ? null : empresa });
  } catch (e) {
    return { error: mensaje(e) };
  }
  enviar();
  after(() => contabilizarPendientes({ clienteId }).then(() => {}).catch((e) => console.error("vendario contabilizar", (e as Error).message)));
  revalidar(firmaId);
  return { ok: "Aceptada. Vendario le avisa al cliente y empieza a mandar su histórico. Revisa el mapeo de cuentas." };
}

export async function cambiarEstadoVendario(firmaId: string, clienteId: string, estado: EstadoServicio, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await equipo(firmaId);
  if (!esUuid(clienteId)) return { error: "La solicitud no existe." };
  const pedidos = [...fd.getAll("pedido").map(String), ...String(fd.get("otro") ?? "").split(",").map((s) => s.trim())].filter(Boolean);
  try {
    await cambiarEstado({ firmaId, clienteId, usuarioId: usuario.id, estado, periodo: String(fd.get("periodo") ?? "") || null,
      nota: String(fd.get("nota") ?? ""), pedidos });
  } catch (e) {
    return { error: mensaje(e) };
  }
  enviar();
  revalidar(firmaId);
  return { ok: "Enviado a Vendario: el cliente lo ve en Mi contabilidad." };
}

export async function marcarReceptora(firmaId: string, recibe: boolean): Promise<Estado> {
  await equipo(firmaId, true);
  try {
    await marcarFirmaReceptora(firmaId, recibe);
  } catch (e) {
    return { error: mensaje(e) };
  }
  enviar();
  revalidar(firmaId);
  return { ok: recibe ? "Esta firma recibe los clientes de Vendario." : "Esta firma ya no recibe clientes de Vendario." };
}

export async function reenviarEnvio(firmaId: string, envioId: string): Promise<Estado> {
  await equipo(firmaId, true);
  if (!esUuid(envioId)) return { error: "El envío no existe." };
  try {
    await reenviar(firmaId, envioId);
  } catch (e) {
    return { error: mensaje(e) };
  }
  enviar();
  revalidar(firmaId);
  return { ok: "Se vuelve a enviar." };
}

async function clienteDeFirma(firmaId: string, clienteId: string) {
  if (!esUuid(clienteId)) return null;
  const [c] = await db()<{ id: string; empresa_id: string | null }[]>`SELECT id, empresa_id FROM vendario_clientes WHERE id = ${clienteId} AND firma_id = ${firmaId}`;
  return c ?? null;
}

// Mapeo de las cuentas neutrales de Vendario a las del catálogo del cliente; después se reprocesa lo pendiente.
export async function guardarMapeoVendario(firmaId: string, clienteId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await equipo(firmaId);
  const c = await clienteDeFirma(firmaId, clienteId);
  if (!c?.empresa_id) return { error: "Primero acepta la solicitud." };
  const pares = fd.getAll("cuenta").map(String).map((k) => [k, String(fd.get(`c:${k}`) ?? "") || null] as [string, string | null])
    .filter(([k, v]) => k && (!v || esUuid(v)));
  try {
    await guardarMapeo(c.empresa_id, usuario.id, pares);
  } catch (e) {
    return { error: mensajeError(e) };
  }
  const n = await contabilizarPendientes({ clienteId });
  revalidar(firmaId);
  return { ok: `Mapeo guardado.${n ? ` Se reprocesaron ${n} eventos pendientes.` : ""}` };
}

export async function reprocesarVendario(firmaId: string, clienteId: string, eventoId: string | null): Promise<Estado> {
  await equipo(firmaId);
  const c = await clienteDeFirma(firmaId, clienteId);
  if (!c) return { error: "El cliente no existe." };
  if (eventoId) {
    if (!esUuid(eventoId)) return { error: "El evento no existe." };
    const [x] = await db()`SELECT 1 FROM vendario_eventos WHERE id = ${eventoId} AND vendario_cliente_id = ${clienteId}`;
    if (!x) return { error: "El evento no existe." };
    const r = await contabilizarEvento(eventoId);
    revalidar(firmaId);
    return r.estado === "contabilizado" ? { ok: "Contabilizado." } : { error: r.motivo ?? "Sigue pendiente." };
  }
  const n = await contabilizarPendientes({ clienteId });
  revalidar(firmaId);
  return { ok: n ? `Se reprocesaron ${n} eventos.` : "No había eventos pendientes." };
}
