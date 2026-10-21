"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPermiso } from "@/lib/acceso";
import { cifrarClave } from "@/lib/auth";
import { nivelDeCodigo } from "@/lib/catalogo-rd";
import { conEmpresa, db, mensajeError } from "@/lib/db";
import { aCentavos, leerMonto, verFecha } from "@/lib/montos";
import type { Rol } from "@/lib/permisos";
import { fechaValida } from "@/lib/reportes";
import type { Estado } from "../../acciones-cuenta";

function texto(fd: FormData, campo: string): string {
  return String(fd.get(campo) ?? "").trim();
}

type LineaForm = { cuentaId: string; descripcion: string; debe: string; haber: string };

export async function registrarAsiento(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "registrar");
  const fecha = texto(fd, "fecha");
  const concepto = texto(fd, "concepto");
  const referencia = texto(fd, "referencia") || null;
  if (!fechaValida(fecha)) return { error: "La fecha no es válida." };
  if (!concepto) return { error: "Escribe el concepto del asiento." };

  let crudas: LineaForm[];
  try {
    crudas = JSON.parse(String(fd.get("lineas") ?? "[]"));
  } catch {
    return { error: "No se pudieron leer las líneas." };
  }
  const lineas: { cuentaId: string; descripcion: string | null; debe: string; haber: string }[] = [];
  for (const [i, l] of crudas.entries()) {
    if (!l.cuentaId && !l.debe && !l.haber) continue; // fila vacía
    const debe = leerMonto(l.debe);
    const haber = leerMonto(l.haber);
    if (debe === null || haber === null) return { error: `Línea ${i + 1}: el monto no es válido.` };
    if (!l.cuentaId) return { error: `Línea ${i + 1}: elige la cuenta.` };
    if ((aCentavos(debe) > 0n) === (aCentavos(haber) > 0n)) return { error: `Línea ${i + 1}: pon el monto en el debe o en el haber, no en ambos.` };
    lineas.push({ cuentaId: l.cuentaId, descripcion: l.descripcion?.trim() || null, debe, haber });
  }
  if (lineas.length < 2) return { error: "El asiento necesita al menos dos líneas." };
  const totalDebe = lineas.reduce((s, l) => s + aCentavos(l.debe), 0n);
  const totalHaber = lineas.reduce((s, l) => s + aCentavos(l.haber), 0n);
  if (totalDebe !== totalHaber) return { error: "El asiento no cuadra: el total del debe y del haber deben ser iguales." };

  let numero: number;
  try {
    numero = await conEmpresa(empresaId, async (tx) => {
      // Bloquea la empresa para que dos personas no tomen el mismo número a la vez.
      await tx`SELECT 1 FROM empresas WHERE id = ${empresaId} FOR UPDATE`;
      const [{ siguiente }] = await tx<{ siguiente: number }[]>`
        SELECT COALESCE(max(numero), 0) + 1 AS siguiente FROM asientos`;
      const [{ id }] = await tx<{ id: string }[]>`
        INSERT INTO asientos (empresa_id, numero, fecha, concepto, referencia, creado_por)
        VALUES (${empresaId}, ${siguiente}, ${fecha}, ${concepto}, ${referencia}, ${usuario.id}) RETURNING id`;
      for (const [orden, l] of lineas.entries()) {
        await tx`
          INSERT INTO lineas_asiento (asiento_id, empresa_id, orden, cuenta_id, descripcion, debe, haber)
          VALUES (${id}, ${empresaId}, ${orden + 1}, ${l.cuentaId}, ${l.descripcion}, ${l.debe}, ${l.haber})`;
      }
      await tx`INSERT INTO bitacora (empresa_id, usuario_id, accion, detalle)
               VALUES (${empresaId}, ${usuario.id}, 'asiento_registrado', ${tx.json({ numero: siguiente })})`;
      return siguiente;
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/asientos/${numero}?nuevo=1`);
}

export async function anularAsiento(empresaId: string, numero: number, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "anular");
  const motivo = texto(fd, "motivo");
  if (!motivo) return { error: "Escribe el motivo de la anulación." };
  try {
    await conEmpresa(empresaId, async (tx) => {
      const r = await tx`
        UPDATE asientos SET anulado = true, anulado_por = ${usuario.id}, anulado_en = now(), motivo_anulacion = ${motivo}
         WHERE numero = ${numero} AND NOT anulado`;
      if (r.count === 0) throw Object.assign(new Error("El asiento ya estaba anulado"), { code: "P0001" });
      await tx`INSERT INTO bitacora (empresa_id, usuario_id, accion, detalle)
               VALUES (${empresaId}, ${usuario.id}, 'asiento_anulado', ${tx.json({ numero, motivo })})`;
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/asientos/${numero}?anulado=1`);
}

export async function crearCuenta(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "catalogo");
  const padreId = texto(fd, "padre");
  const sufijo = texto(fd, "sufijo");
  const nombre = texto(fd, "nombre");
  if (!/^\d{2}$/.test(sufijo)) return { error: "El código nuevo son 2 dígitos (por ejemplo 05)." };
  if (!nombre) return { error: "Escribe el nombre de la cuenta." };
  try {
    const codigo = await conEmpresa(empresaId, async (tx) => {
      const [padre] = await tx<{ id: string; codigo: string; tipo: string; de_detalle: boolean }[]>`
        SELECT id, codigo, tipo, de_detalle FROM cuentas WHERE id = ${padreId}`;
      if (!padre) throw Object.assign(new Error("La cuenta madre no existe"), { code: "P0001" });
      const codigo = padre.codigo + sufijo;
      if (codigo.length > 10) throw Object.assign(new Error("No se pueden crear más niveles bajo esa cuenta"), { code: "P0001" });
      if (padre.de_detalle) {
        // Una cuenta de detalle se vuelve de grupo al recibir subcuentas, solo si no tiene movimientos.
        const [{ usada }] = await tx<{ usada: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM lineas_asiento WHERE cuenta_id = ${padre.id}) AS usada`;
        if (usada) throw Object.assign(new Error(`La cuenta ${padre.codigo} ya tiene movimientos; no se le pueden crear subcuentas`), { code: "P0001" });
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
  const { usuario } = await exigirPermiso(empresaId, "catalogo");
  const cuentaId = texto(fd, "cuenta");
  const nombre = texto(fd, "nombre");
  const activa = fd.get("activa") === "on";
  if (!nombre) return { error: "Escribe el nombre de la cuenta." };
  try {
    await conEmpresa(empresaId, async (tx) => {
      const r = await tx`UPDATE cuentas SET nombre = ${nombre}, activa = ${activa} WHERE id = ${cuentaId}`;
      if (r.count === 0) throw Object.assign(new Error("La cuenta no existe"), { code: "P0001" });
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
  const { usuario, empresa } = await exigirPermiso(empresaId, "cerrar");
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

const ROLES: Rol[] = ["dueno", "contador", "auxiliar", "lectura"];

export async function agregarMiembro(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "usuarios");
  const email = texto(fd, "email").toLowerCase();
  const nombre = texto(fd, "nombre");
  const rol = texto(fd, "rol") as Rol;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "El correo no es válido." };
  if (!ROLES.includes(rol)) return { error: "Elige un rol." };
  try {
    const temporal = await db().begin(async (tx) => {
      let [u] = await tx<{ id: string }[]>`SELECT id FROM usuarios WHERE email = ${email}`;
      let clave: string | null = null;
      if (!u) {
        if (!nombre) throw Object.assign(new Error("Esa persona aún no tiene cuenta: escribe también su nombre"), { code: "P0001" });
        clave = crearClaveTemporal();
        [u] = await tx<{ id: string }[]>`
          INSERT INTO usuarios (email, nombre, clave_hash) VALUES (${email}, ${nombre}, ${await cifrarClave(clave)}) RETURNING id`;
      }
      const r = await tx`INSERT INTO miembros (empresa_id, usuario_id, rol) VALUES (${empresaId}, ${u.id}, ${rol}) ON CONFLICT DO NOTHING`;
      if (r.count === 0) throw Object.assign(new Error("Esa persona ya tiene acceso a la empresa"), { code: "P0001" });
      await tx`SELECT set_config('app.empresa_id', ${empresaId}, true)`;
      await tx`INSERT INTO bitacora (empresa_id, usuario_id, accion, detalle)
               VALUES (${empresaId}, ${usuario.id}, 'miembro_agregado', ${tx.json({ email, rol })})`;
      return clave;
    });
    revalidatePath(`/e/${empresaId}/usuarios`);
    return {
      ok: temporal
        ? `Acceso creado. Contraseña temporal para ${email}: ${temporal} (cópiala ahora; no se vuelve a mostrar).`
        : `Acceso dado a ${email}.`,
    };
  } catch (e) {
    return { error: mensajeError(e) };
  }
}

export async function cambiarRol(empresaId: string, _: Estado, fd: FormData): Promise<Estado> {
  const { usuario } = await exigirPermiso(empresaId, "usuarios");
  const miembroId = texto(fd, "usuario");
  const rol = texto(fd, "rol");
  if (rol !== "quitar" && !ROLES.includes(rol as Rol)) return { error: "Elige un rol." };
  try {
    await db().begin(async (tx) => {
      if (rol === "quitar") {
        await tx`DELETE FROM miembros WHERE empresa_id = ${empresaId} AND usuario_id = ${miembroId}`;
      } else {
        await tx`UPDATE miembros SET rol = ${rol} WHERE empresa_id = ${empresaId} AND usuario_id = ${miembroId}`;
      }
      const [{ duenos }] = await tx<{ duenos: number }[]>`
        SELECT count(*)::int AS duenos FROM miembros WHERE empresa_id = ${empresaId} AND rol = 'dueno'`;
      if (duenos === 0) throw Object.assign(new Error("La empresa debe tener al menos un dueño"), { code: "P0001" });
      await tx`SELECT set_config('app.empresa_id', ${empresaId}, true)`;
      await tx`INSERT INTO bitacora (empresa_id, usuario_id, accion, detalle)
               VALUES (${empresaId}, ${usuario.id}, 'rol_cambiado', ${tx.json({ usuario: miembroId, rol })})`;
    });
  } catch (e) {
    return { error: mensajeError(e) };
  }
  revalidatePath(`/e/${empresaId}/usuarios`);
  return { ok: rol === "quitar" ? "Acceso quitado." : "Rol actualizado." };
}

function crearClaveTemporal(): string {
  const letras = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => letras[b % letras.length]).join("");
}
