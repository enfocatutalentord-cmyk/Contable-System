"use server";

import { revalidatePath } from "next/cache";
import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { cancelarCita, crearCita, leerCita, leerMovimiento, moverCita, realizarCita } from "@/lib/agenda";
import { clienteDeFormulario } from "@/lib/cliente-rapido";
import { conEmpresa, mensajeError } from "@/lib/db";
import { equipoDe } from "@/lib/firma";
import { hoyISO } from "@/lib/montos";
import type { Estado } from "../acciones-cuenta";

// Prioridad 3 · P3c: agenda de citas con clientes y prospectos. Quien tiene «registrar» en el cliente puede crear, mover, cancelar y marcar
// realizadas sus citas. Una cita con alguien que todavía no es cliente crea su ficha como prospecto.

function listo(firmaId: string, empresaId: string) {
  revalidatePath(`/firma/${firmaId}/agenda`);
  revalidatePath(`/e/${empresaId}/empresa`);
  revalidatePath(`/firma/${firmaId}`);
}

export async function crearCitaAccion(firmaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await accesoFirma(firmaId, false);
  if (await soloCliente(firmaId, usuario.id)) return { error: "La agenda es del equipo de la firma." };
  let empresaId: string;
  try {
    const datos = leerCita(fd, hoyISO()); // primero la cita: si algo está mal, no se crea ningún cliente
    const equipo = new Set((await equipoDe(firmaId)).map((p) => p.id));
    if (datos.asistentes.some((a) => !equipo.has(a))) return { error: "Los asistentes tienen que ser del equipo de la firma." };
    empresaId = (await clienteDeFormulario(firmaId, fd, { prospecto: true })).id;
    const { usuario: u } = await exigirPermiso(empresaId, "registrar");
    await conEmpresa(empresaId, (tx) => crearCita(tx, { empresaId, usuarioId: u.id, ...datos }));
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // redirecciones de permisos
    return { error: mensajeError(e) };
  }
  listo(firmaId, empresaId);
  return { ok: "Cita guardada." };
}

async function deLaCita(empresaId: string, citaId: string) {
  if (!esUuid(empresaId) || !esUuid(citaId)) throw new Error("Esa cita no existe.");
  return exigirPermiso(empresaId, "registrar");
}

export async function moverCitaAccion(empresaId: string, citaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, empresa } = await deLaCita(empresaId, citaId);
  try {
    const { fecha, hora } = leerMovimiento(fd, hoyISO());
    await conEmpresa(empresaId, (tx) => moverCita(tx, { citaId, usuarioId: usuario.id, fecha, hora }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  listo(empresa.firma_id, empresaId);
  return { ok: "Cita movida. Falta enviarle el recordatorio con la fecha nueva." };
}

export async function cancelarCitaAccion(empresaId: string, citaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, empresa } = await deLaCita(empresaId, citaId);
  try {
    await conEmpresa(empresaId, (tx) => cancelarCita(tx, { citaId, usuarioId: usuario.id, motivo: String(fd.get("motivo") ?? "") }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  listo(empresa.firma_id, empresaId);
  return { ok: "Cita cancelada." };
}

export async function realizarCitaAccion(empresaId: string, citaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario, empresa } = await deLaCita(empresaId, citaId);
  try {
    await conEmpresa(empresaId, (tx) => realizarCita(tx, { citaId, usuarioId: usuario.id, resultado: String(fd.get("resultado") ?? "") }));
  } catch (e) {
    return { error: mensajeError(e) };
  }
  listo(empresa.firma_id, empresaId);
  return { ok: "Cita marcada como realizada." };
}
