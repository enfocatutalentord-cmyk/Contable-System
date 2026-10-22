import { CATALOGO_RD, TIPO_POR_CLASE, nivelDeCodigo } from "./catalogo-rd";
import { db, type Tx } from "./db";

export function rncValido(rnc: string): boolean {
  return /^\d{9}$/.test(rnc) || /^\d{11}$/.test(rnc);
}

export function limpiarRnc(rnc: string | null | undefined): string {
  return (rnc ?? "").replace(/[-\s]/g, "");
}

export type Ficha = {
  nombre: string; nombre_comercial: string | null; tipo_identificacion: "rnc" | "cedula" | "pasaporte"; rnc: string | null;
  actividad_economica: string | null; regimen: string; direccion: string | null; telefono: string | null; correo: string | null;
  mes_cierre: number; inicio_operaciones: string | null; requiere_aprobacion: boolean; activa: boolean;
};

// Lee y valida la ficha de la empresa desde un formulario. Devuelve un mensaje si algo no es válido.
export function leerFicha(fd: FormData): Ficha | string {
  const t = (c: string) => String(fd.get(c) ?? "").trim();
  const tipo = (["rnc", "cedula", "pasaporte"].includes(t("tipo_identificacion")) ? t("tipo_identificacion") : "rnc") as Ficha["tipo_identificacion"];
  const id = tipo === "pasaporte" ? t("rnc").toUpperCase() : limpiarRnc(t("rnc"));
  const mes = Number(t("mes_cierre") || "12");
  const inicio = t("inicio_operaciones");
  const correo = t("correo");
  if (!t("nombre")) return "Escribe la razón social o el nombre de la empresa.";
  if (tipo === "rnc" && id && !/^\d{9}$/.test(id)) return "El RNC debe tener 9 dígitos.";
  if (tipo === "cedula" && id && !/^\d{11}$/.test(id)) return "La cédula debe tener 11 dígitos.";
  if (tipo === "pasaporte" && id && !/^[A-Z0-9]{5,20}$/.test(id)) return "El pasaporte no es válido.";
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return "Elige el mes de cierre fiscal.";
  if (inicio && !/^\d{4}-\d{2}-\d{2}$/.test(inicio)) return "La fecha de inicio no es válida.";
  if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return "El correo no es válido.";
  if (!["ordinario", "rst", "no_lucrativa", "zona_franca", "otro"].includes(t("regimen") || "ordinario")) return "Elige el régimen tributario.";
  return {
    nombre: t("nombre"),
    nombre_comercial: t("nombre_comercial") || null,
    tipo_identificacion: tipo,
    rnc: id || null,
    actividad_economica: t("actividad_economica") || null,
    regimen: t("regimen") || "ordinario",
    direccion: t("direccion") || null,
    telefono: t("telefono") || null,
    correo: correo || null,
    mes_cierre: mes,
    inicio_operaciones: inicio || null,
    requiere_aprobacion: fd.get("requiere_aprobacion") === "on",
    activa: fd.has("activa_presente") ? fd.get("activa") === "on" : true,
  };
}

// Crea la firma contable con sus perfiles base y deja a quien la crea como administrador.
export async function crearFirma(tx: Tx, datos: { nombre: string; rnc: string | null; usuarioId: string }): Promise<string> {
  const [{ id }] = await tx<{ id: string }[]>`INSERT INTO firmas (nombre, rnc) VALUES (${datos.nombre}, ${datos.rnc}) RETURNING id`;
  await tx`SELECT crear_perfiles_firma(${id})`;
  await tx`INSERT INTO miembros_firma (firma_id, usuario_id, administrador) VALUES (${id}, ${datos.usuarioId}, true)`;
  return id;
}

// Crea una empresa cliente dentro de la firma con el catálogo de cuentas dominicano y la configuración tributaria sugerida.
export async function crearEmpresa(datos: { firmaId: string; usuarioId: string; ficha: Ficha }, tx?: Tx): Promise<string> {
  const f = datos.ficha;
  // Con cédula, de entrada se asume persona física; se ajusta en «Perfil fiscal».
  const persona = f.tipo_identificacion === "cedula" ? "fisica" : "juridica";
  const correr = async (t: Tx) => {
    await t`SELECT set_config('app.usuario_id', ${datos.usuarioId}, true)`;
    const [{ id }] = await t<{ id: string }[]>`
      INSERT INTO empresas (firma_id, nombre, nombre_comercial, tipo_identificacion, rnc, actividad_economica, regimen,
                            direccion, telefono, correo, mes_cierre, inicio_operaciones, requiere_aprobacion,
                            tipo_persona, agente_retencion)
      VALUES (${datos.firmaId}, ${f.nombre}, ${f.nombre_comercial}, ${f.tipo_identificacion}, ${f.rnc}, ${f.actividad_economica},
              ${f.regimen}, ${f.direccion}, ${f.telefono}, ${f.correo}, ${f.mes_cierre}, ${f.inicio_operaciones}, ${f.requiere_aprobacion},
              ${persona}, ${persona === "juridica"})
      RETURNING id`;
    await t`SELECT set_config('app.empresa_id', ${id}, true)`;
    await cargarCatalogo(t, id);
    await t`SELECT configurar_cuentas_empresa(${id})`;
    await t`SELECT configurar_tributaria(${id})`;
    await t`INSERT INTO bitacora (empresa_id, usuario_id, accion) VALUES (${id}, ${datos.usuarioId}, 'empresa_creada')`;
    return id;
  };
  return tx ? correr(tx) : (db().begin(correr) as Promise<string>);
}

async function cargarCatalogo(tx: Tx, empresaId: string): Promise<void> {
  const ids = new Map<string, string>();
  for (const [codigo, nombre] of CATALOGO_RD) {
    const padre = codigoPadre(codigo);
    const [{ id }] = await tx<{ id: string }[]>`
      INSERT INTO cuentas (empresa_id, codigo, nombre, tipo, padre_id, nivel, de_detalle)
      VALUES (${empresaId}, ${codigo}, ${nombre}, ${TIPO_POR_CLASE[codigo[0]]},
              ${padre ? ids.get(padre)! : null}, ${nivelDeCodigo(codigo)}, ${codigo.length >= 6})
      RETURNING id`;
    ids.set(codigo, id);
  }
}

export function codigoPadre(codigo: string): string | null {
  if (codigo.length === 1) return null;
  if (codigo.length === 2) return codigo.slice(0, 1);
  return codigo.slice(0, codigo.length - 2);
}
