import type { Tx } from "./db";
import { aCentavos, deCentavos, leerMonto } from "./montos.ts";

// Bloque 1, entrega 1a: ficha única del cliente (Documento maestro «Sistema Empire», sección 5). De aquí saldrán solos los
// datos de facturas, documentos, mensajes y alertas. Las claves de DGII y TSS nunca se guardan: solo quién las custodia.

export const CATEGORIAS: Record<string, string> = { pequena: "Pequeña", mediana: "Mediana", grande: "Grande", emprendedor: "Emprendedor" };
export const TIPOS_CLIENTE: Record<string, string> = { iguala: "Fijo con iguala", por_trabajo: "Por trabajo", esporadico: "Esporádico o nuevo" };
export const ESTADOS_CLIENTE: Record<string, string> = { activo: "Activo", en_cero: "En cero", sin_operaciones: "Sin operaciones", retirado: "Retirado" };
export const MODALIDADES: Record<string, string> = {
  aplicacion: "1 · Con la aplicación de Empire", sistema_propio: "2 · Con sistema propio y contabilidad de Empire", independiente: "3 · Con sistema independiente",
};
export const ROLES_CONTACTO: [string, string][] = [
  ["principal", "Contacto principal"], ["alterno", "Contacto alterno"], ["representante", "Representante legal"], ["gerente", "Gerente"],
];

// Categoría por la regla de dos de tres criterios (tabla del Documento maestro, sección 4): ventas al mes, facturas al mes
// (compras + ventas) y empleados. Emprendedor se marca a mano. Sin dos criterios que coincidan, no se sugiere nada.
const LIMITES = { ventas: [50_000_000n, 200_000_000n], facturas: [50, 200], empleados: [5, 20] }; // ventas en centavos
const nivel = (x: bigint | number, [a, b]: (bigint | number)[]) => (x <= a ? "pequena" : x <= b ? "mediana" : "grande");
export function categoriaSugerida(o: { ventas: bigint | null; facturas: number | null; empleados: number | null }): string | null {
  const votos = [
    o.ventas === null ? null : nivel(o.ventas, LIMITES.ventas),
    o.facturas === null ? null : nivel(o.facturas, LIMITES.facturas),
    o.empleados === null ? null : nivel(o.empleados, LIMITES.empleados),
  ].filter((v): v is string => v !== null);
  for (const c of ["pequena", "mediana", "grande"]) if (votos.filter((v) => v === c).length >= 2) return c;
  return null;
}

const MAX = 200;
const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim().replace(/\s+/g, " ").slice(0, MAX) || null;
const fecha = (v: string | null, que: string) => {
  if (v === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new ErrorFicha(`${que}: la fecha no es válida.`);
  return v;
};
const entero = (v: string | null, que: string, max = 1_000_000) => {
  if (v === null) return null;
  const n = Number(v.replace(/[,\s]/g, ""));
  if (!Number.isInteger(n) || n < 0 || n > max) throw new ErrorFicha(`${que}: escribe un número entero.`);
  return n;
};
const monto = (v: string | null, que: string) => {
  if (v === null) return null;
  const m = leerMonto(v);
  if (m === null) throw new ErrorFicha(`${que}: el monto no es válido.`);
  return m;
};
const correo = (v: string | null, que: string) => {
  if (v !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new ErrorFicha(`${que}: el correo no es válido.`);
  return v;
};
// Cédula dominicana: 11 dígitos, con o sin guiones. Se guarda como 000-0000000-0. Un pasaporte o identificación extranjera
// (con letras) se acepta tal cual.
export function cedula(v: string | null, que: string): string | null {
  if (v === null) return null;
  if (/[a-z]/i.test(v)) return v.toUpperCase();
  const d = v.replace(/\D/g, "");
  if (d.length !== 11) throw new ErrorFicha(`${que}: la cédula debe tener 11 dígitos.`);
  return `${d.slice(0, 3)}-${d.slice(3, 10)}-${d.slice(10)}`;
}
const opcion = (v: string | null, opciones: Record<string, string>, que: string) => {
  if (v === null) return null;
  if (!(v in opciones)) throw new ErrorFicha(`${que}: opción no válida.`);
  return v;
};
const siNo = (v: string | null) => (v === "si" ? true : v === "no" ? false : null);

export class ErrorFicha extends Error {}

export function leerSociedad(fd: FormData) {
  return {
    tipo_sociedad: txt(fd, "tipo_sociedad"), fecha_constitucion: fecha(txt(fd, "fecha_constitucion"), "Fecha de constitución"),
    municipio: txt(fd, "municipio"), provincia: txt(fd, "provincia"), capital_social: monto(txt(fd, "capital_social"), "Capital social"),
    // Bloque 3b: para las alertas (60 días antes; la asamblea, 30 días antes).
    vence_registro_mercantil: fecha(txt(fd, "vence_registro_mercantil"), "Vence el registro mercantil"),
    vence_nombre_comercial: fecha(txt(fd, "vence_nombre_comercial"), "Vence el nombre comercial"),
    fecha_asamblea: fecha(txt(fd, "fecha_asamblea"), "Próxima asamblea ordinaria"),
  };
}

export function leerOperaciones(fd: FormData) {
  return {
    ventas_mes: monto(txt(fd, "ventas_mes"), "Ventas al mes"), facturas_mes: entero(txt(fd, "facturas_mes"), "Facturas al mes"),
    empleados_mes: entero(txt(fd, "empleados_mes"), "Empleados"), tiene_tss: siNo(txt(fd, "tiene_tss")), emite_ecf: siNo(txt(fd, "emite_ecf")),
    sistema_usa: txt(fd, "sistema_usa"),
  };
}

export function leerRelacion(fd: FormData) {
  const dia = entero(txt(fd, "dia_facturacion"), "Día de facturación", 31);
  if (dia === 0) throw new ErrorFicha("Día de facturación: de 1 a 31.");
  return {
    categoria: opcion(txt(fd, "categoria"), CATEGORIAS, "Categoría"), tipo_cliente: opcion(txt(fd, "tipo_cliente"), TIPOS_CLIENTE, "Tipo de cliente"),
    fecha_inicio_contrato: fecha(txt(fd, "fecha_inicio_contrato"), "Inicio del contrato"), dia_facturacion: dia,
    estado_cliente: opcion(txt(fd, "estado_cliente"), ESTADOS_CLIENTE, "Estado") ?? "activo",
    ficha_firmada: fecha(txt(fd, "ficha_firmada"), "Ficha de registro firmada"), hoja_firmada: fecha(txt(fd, "hoja_firmada"), "Hoja de acuerdo firmada"),
    contrato_firmado: fecha(txt(fd, "contrato_firmado"), "Contrato firmado"), modalidad: opcion(txt(fd, "modalidad"), MODALIDADES, "Modalidad"),
    custodio_accesos: txt(fd, "custodio_accesos"),
  };
}

// Filas de una tabla (socios, empleados): «s0_nombre», «s1_nombre»…; las vacías no se guardan.
function filas<T>(fd: FormData, prefijo: string, max: number, leer: (g: (k: string) => string | null, n: number) => T | null): T[] {
  const r: T[] = [];
  for (let i = 0; i < max; i++) {
    const x = leer((k) => txt(fd, `${prefijo}${i}_${k}`), i + 1);
    if (x) r.push(x);
  }
  return r;
}

export const MAX_SOCIOS = 30;
export function leerSocios(fd: FormData) {
  const socios = filas(fd, "s", MAX_SOCIOS, (g, n) => {
    if (![g("nombre"), g("cedula"), g("telefono"), g("porcentaje")].some(Boolean)) return null;
    const nombre = g("nombre");
    if (!nombre) throw new ErrorFicha(`Socio ${n}: falta el nombre.`);
    const p = monto(g("porcentaje")?.replace(/%$/, "") ?? null, `Socio ${n}, % de cuotas`);
    if (p !== null && aCentavos(p) > 10000n) throw new ErrorFicha(`Socio ${n}: el % no puede pasar de 100.`);
    return { nombre, cedula: cedula(g("cedula"), `Socio ${n}`), telefono: g("telefono"), porcentaje: p };
  });
  const suma = socios.reduce((t, s) => t + (s.porcentaje ? aCentavos(s.porcentaje) : 0n), 0n);
  if (socios.length && suma !== 10000n) throw new ErrorFicha(`Las cuotas de los socios suman ${deCentavos(suma)} %; deben sumar 100 %.`);
  return socios;
}

export function leerContactos(fd: FormData) {
  const contactos = ROLES_CONTACTO.flatMap(([rol, que]) => {
    const g = (k: string) => txt(fd, `c_${rol}_${k}`);
    if (![g("nombre"), g("cedula"), g("cargo"), g("telefono"), g("whatsapp"), g("correo"), g("nacimiento")].some(Boolean)) return [];
    const nombre = g("nombre");
    if (!nombre) throw new ErrorFicha(`${que}: falta el nombre.`);
    return [{ rol, nombre, cedula: cedula(g("cedula"), que), cargo: g("cargo"), telefono: g("telefono"), whatsapp: g("whatsapp"),
      correo: correo(g("correo"), que), nacimiento: fecha(g("nacimiento"), `${que}, fecha de nacimiento`) }];
  });
  return { contactos, grupo_whatsapp: txt(fd, "grupo_whatsapp") };
}

export const MAX_EMPLEADOS = 300;
export function leerEmpleados(fd: FormData) {
  return filas(fd, "p", MAX_EMPLEADOS, (g, n) => {
    if (![g("nombre"), g("cedula"), g("cargo"), g("fecha_ingreso"), g("sueldo")].some(Boolean)) return null;
    const nombre = g("nombre");
    if (!nombre) throw new ErrorFicha(`Empleado ${n}: falta el nombre.`);
    return { nombre, cedula: cedula(g("cedula"), `Empleado ${n}`), cargo: g("cargo"), fecha_ingreso: fecha(g("fecha_ingreso"), `Empleado ${n}`),
      sueldo: monto(g("sueldo"), `Empleado ${n}, sueldo`) };
  });
}

// ───── Lectura ─────

export type Ficha = Record<string, string | number | boolean | null> & { capital_social: string | null; ventas_mes: string | null };
export type Socio = { nombre: string; cedula: string | null; telefono: string | null; porcentaje: string | null };
export type Contacto = { rol: string; nombre: string; cedula: string | null; cargo: string | null; telefono: string | null; whatsapp: string | null; correo: string | null; nacimiento: string | null };
export type Empleado = { nombre: string; cedula: string | null; cargo: string | null; fecha_ingreso: string | null; sueldo: string | null };

export async function leerFicha(tx: Tx, empresaId: string, conEmpleados: boolean) {
  const [f] = await tx<Ficha[]>`
    SELECT tipo_sociedad, to_char(fecha_constitucion, 'YYYY-MM-DD') AS fecha_constitucion, municipio, provincia, capital_social::text,
           grupo_whatsapp, ventas_mes::text, facturas_mes, empleados_mes, tiene_tss, emite_ecf, sistema_usa, categoria, tipo_cliente,
           to_char(fecha_inicio_contrato, 'YYYY-MM-DD') AS fecha_inicio_contrato, dia_facturacion, estado_cliente,
           to_char(ficha_firmada, 'YYYY-MM-DD') AS ficha_firmada, to_char(hoja_firmada, 'YYYY-MM-DD') AS hoja_firmada,
           to_char(contrato_firmado, 'YYYY-MM-DD') AS contrato_firmado, modalidad, custodio_accesos,
           to_char(vence_registro_mercantil, 'YYYY-MM-DD') AS vence_registro_mercantil, to_char(vence_nombre_comercial, 'YYYY-MM-DD') AS vence_nombre_comercial,
           to_char(fecha_asamblea, 'YYYY-MM-DD') AS fecha_asamblea
      FROM empresas WHERE id = ${empresaId}`;
  const socios = await tx<Socio[]>`SELECT nombre, cedula, telefono, porcentaje::text FROM socios_empresa ORDER BY orden`;
  const contactos = await tx<Contacto[]>`
    SELECT rol, nombre, cedula, cargo, telefono, whatsapp, correo, to_char(nacimiento, 'YYYY-MM-DD') AS nacimiento FROM contactos_empresa`;
  const empleados = conEmpleados
    ? await tx<Empleado[]>`SELECT nombre, cedula, cargo, to_char(fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso, sueldo::text FROM empleados_empresa ORDER BY orden`
    : [];
  const sugerida = categoriaSugerida({
    ventas: f.ventas_mes === null ? null : aCentavos(f.ventas_mes), facturas: f.facturas_mes as number | null, empleados: f.empleados_mes as number | null,
  });
  const formalizado = !!(f.ficha_firmada && f.hoja_firmada && f.contrato_firmado);
  return { ficha: f, socios, contactos, empleados, sugerida, formalizado };
}

// ───── Guardado (las tablas se reemplazan completas: cada cambio queda en el historial) ─────

export async function guardarSocios(tx: Tx, empresaId: string, socios: ReturnType<typeof leerSocios>) {
  await tx`DELETE FROM socios_empresa`;
  for (const [i, s] of socios.entries()) {
    await tx`INSERT INTO socios_empresa (empresa_id, orden, nombre, cedula, telefono, porcentaje)
             VALUES (${empresaId}, ${i}, ${s.nombre}, ${s.cedula}, ${s.telefono}, ${s.porcentaje})`;
  }
}

export async function guardarContactos(tx: Tx, empresaId: string, c: ReturnType<typeof leerContactos>) {
  await tx`DELETE FROM contactos_empresa`;
  for (const x of c.contactos) {
    await tx`INSERT INTO contactos_empresa (empresa_id, rol, nombre, cedula, cargo, telefono, whatsapp, correo, nacimiento)
             VALUES (${empresaId}, ${x.rol}, ${x.nombre}, ${x.cedula}, ${x.cargo}, ${x.telefono}, ${x.whatsapp}, ${x.correo}, ${x.nacimiento})`;
  }
  await tx`UPDATE empresas SET grupo_whatsapp = ${c.grupo_whatsapp} WHERE id = ${empresaId}`;
}

export async function guardarEmpleados(tx: Tx, empresaId: string, empleados: ReturnType<typeof leerEmpleados>) {
  await tx`DELETE FROM empleados_empresa`;
  for (const [i, e] of empleados.entries()) {
    await tx`INSERT INTO empleados_empresa (empresa_id, orden, nombre, cedula, cargo, fecha_ingreso, sueldo)
             VALUES (${empresaId}, ${i}, ${e.nombre}, ${e.cedula}, ${e.cargo}, ${e.fecha_ingreso}, ${e.sueldo})`;
  }
}
