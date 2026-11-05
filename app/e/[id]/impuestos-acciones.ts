"use server";

import { revalidatePath } from "next/cache";
import { esUuid, exigirPermiso } from "@/lib/acceso";
import { conEmpresa, mensajeError } from "@/lib/db";
import { estadoDelMes, finDeMes, revisarCompra } from "@/lib/impuestos-mes";
import { nombrePeriodo } from "@/lib/igualas";
import { hoyISO } from "@/lib/montos";
import type { Estado } from "../../acciones-cuenta";

// Bloque 4, entrega 4a: revisión de compras y cierre del mes de un cliente.

// Revisar una compra (permiso «contabilizar», el mismo que registrarla) o pedir que se corrija con una nota.
export async function revisarCompraAccion(empresaId: string, compraId: string, estado: "revisada" | "corregir", _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "contabilizar", "/compras");
  if (!esUuid(compraId) || !["revisada", "corregir"].includes(estado)) return { error: "Datos no válidos." };
  const nota = String(fd.get("nota") ?? "").trim().slice(0, 500) || null;
  try {
    await conEmpresa(empresaId, (tx) => revisarCompra(tx, { empresaId, compraId, usuarioId: usuario.id, estado, nota }));
  } catch (e) {
    return { error: e instanceof Error && !("code" in e) ? `${e.message}.` : mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/compras/${compraId}`);
  return { ok: estado === "revisada" ? "Compra marcada como revisada." : "Quedó anotado qué hay que corregir." };
}

// Cerrar el mes del cliente: solo cuando todo lo que declara está presentado (o en cero). Bloquea el período hasta el fin de mes
// (como el cierre de mes de siempre) y lo deja en su bitácora.
export async function cerrarMesCliente(empresaId: string, periodo: string): Promise<Estado> {
  const { usuario, empresa } = await exigirPermiso(empresaId, "cerrar");
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(periodo)) return { error: "Período no válido." };
  const fin = finDeMes(periodo);
  try {
    await conEmpresa(empresaId, async (tx) => {
      const e = await estadoDelMes(tx, periodo, hoyISO());
      if (e.cerrado) throw new Error("Ese mes ya está cerrado");
      if (!e.listo) throw new Error("Faltan declaraciones por presentar");
      await tx`UPDATE empresas SET fecha_bloqueo = ${fin} WHERE id = ${empresaId}`;
      await tx`INSERT INTO bitacora (empresa_id, usuario_id, accion, detalle)
               VALUES (${empresaId}, ${usuario.id}, 'periodo_cerrado', ${tx.json({ antes: empresa.fecha_bloqueo, despues: fin, impuestos: periodo })})`;
      await tx`INSERT INTO gestiones (empresa_id, tipo, descripcion, responsable_id, estado, creado_por)
               VALUES (${empresaId}, 'declaracion', ${`Mes de ${nombrePeriodo(periodo)} cerrado: declaraciones presentadas y período bloqueado`},
                       ${usuario.id}, 'hecha', ${usuario.id})`;
    });
  } catch (e) {
    return { error: e instanceof Error && !("code" in e) ? `${e.message}.` : mensajeError(e) };
  }
  revalidatePath(`/firma/${empresa.firma_id}/impuestos`);
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: `Mes de ${nombrePeriodo(periodo)} cerrado.` };
}
