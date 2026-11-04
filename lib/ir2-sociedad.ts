import type { Tx } from "./db";
import type { Aviso } from "./formatos-dgii.ts";
import { aCentavos, leerMonto } from "./montos.ts";

// IR-2 2026, parte 3 (entrega 3): anexos H-1 y H-2, «Identificación del beneficiario final y actualización de datos», con
// las secciones, los campos y los límites de filas del Excel oficial «IR-2, Vers. 2026». No llevan montos: se guardan una
// vez por empresa en «sociedad_ir2» y se reusan cada año. En C y D el formulario titula la participación con «$», pero sus
// instrucciones hablan de porcentaje (20 % o más); aquí se escribe como porcentaje.

export type CampoH = { k: string; texto: string; tipo?: "porcentaje" | "correo" | "fecha" };
export type TablaH = { clave: "B" | "C" | "D" | "E" | "F"; anexo: "H-1" | "H-2"; titulo: string; nota?: string; max: number; requeridos: string[]; campos: CampoH[] };

const ID = { k: "id", texto: "Cédula, pasaporte, RNC o identificación tributaria (del país de residencia fiscal)" };
const BENEFICIARIO: CampoH[] = [
  ID, { k: "nombre", texto: "Nombre" }, { k: "nacionalidad", texto: "Nacionalidad" },
  { k: "domicilio", texto: "Domicilio en su país de residencia fiscal (calle, n.º, sector, estado o provincia, país)" },
  { k: "telefono", texto: "Teléfono" }, { k: "participacion", texto: "Participación accionaria (%)", tipo: "porcentaje" },
];

export const CONTACTO: CampoH[] = [
  { k: "telefono1", texto: "Teléfono 1" }, { k: "telefono2", texto: "Teléfono 2" }, { k: "correo", texto: "Correo electrónico", tipo: "correo" },
  { k: "calle", texto: "Calle" }, { k: "numero", texto: "Número" }, { k: "local", texto: "Ed./apto/local" }, { k: "sector", texto: "Sector" },
  { k: "municipio", texto: "Municipio" }, { k: "provincia", texto: "Provincia" }, { k: "referencia", texto: "Referencia" },
];

export const TABLAS_H: TablaH[] = [
  { clave: "B", anexo: "H-1", titulo: "B. Participación de los accionistas de la sociedad o entidad", max: 15, requeridos: ["id", "nombre"], campos: [
    ID, { k: "nombre", texto: "Nombre o razón social" },
    { k: "domicilio", texto: "Domicilio en su país de residencia fiscal (calle, n.º, ed./apto/local, sector, municipio, provincia)" },
    { k: "participacion", texto: "Participación accionaria (%)", tipo: "porcentaje" }, { k: "cargo", texto: "Cargo en el consejo" },
  ] },
  { clave: "C", anexo: "H-1", titulo: "C. Beneficiario(s) final(es) por control accionario", max: 30, requeridos: ["id", "nombre"], campos: BENEFICIARIO,
    nota: "Las personas físicas con una participación igual o mayor al 20 %, directa o indirecta (en una cadena de titularidad, la persona física final)." },
  { clave: "D", anexo: "H-2", titulo: "D. Beneficiario(s) final(es) por control efectivo", max: 15, requeridos: ["id", "nombre"], campos: BENEFICIARIO,
    nota: "Las personas físicas que, con menos del 20 % o a través de una cadena de control, ejercen el control efectivo de la sociedad." },
  { clave: "E", anexo: "H-2", titulo: "E. Actividad económica", max: 5, requeridos: ["nombre"], campos: [
    { k: "nombre", texto: "Nombre de la actividad económica" }, { k: "descripcion", texto: "Descripción de la actividad económica" },
  ] },
  { clave: "F", anexo: "H-2", titulo: "F. Sucursales", max: 10, requeridos: ["nombre"], campos: [
    { k: "nombre", texto: "Nombre comercial" }, { k: "correo", texto: "Correo electrónico", tipo: "correo" }, { k: "telefono", texto: "Teléfono" },
    { k: "direccion", texto: "Dirección (calle, n.º, ed./apto/local, sector, municipio, provincia)" },
  ] },
];

export type Fila = Record<string, string>;
export type DatosH = { contacto: Fila; B: Fila[]; C: Fila[]; D: Fila[]; E: Fila[]; F: Fila[]; sinCambios: { declaracion: string; fecha: string } };
export const vacios = (): DatosH => ({ contacto: {}, B: [], C: [], D: [], E: [], F: [], sinCambios: { declaracion: "", fecha: "" } });

const MAX_TEXTO = 200;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "").trim().replace(/\s+/g, " ");

function validar(c: CampoH, valor: string, donde: string): string | null {
  if (valor.length > MAX_TEXTO) return `${donde}: «${c.texto}» pasa de ${MAX_TEXTO} caracteres.`;
  if (!valor) return null;
  if (c.tipo === "correo" && !CORREO.test(valor)) return `${donde}: el correo «${valor}» no es válido.`;
  if (c.tipo === "porcentaje") {
    const n = leerMonto(valor.replace(/%$/, ""));
    if (n === null || aCentavos(n) > 10000n) return `${donde}: la participación debe ser un porcentaje de 0 a 100.`;
  }
  return null;
}

// Lo escrito en la pantalla: las filas vacías no se guardan. Devuelve el texto del error si algo no es válido.
export function leerSociedad(fd: FormData): DatosH | string {
  const d = vacios();
  for (const c of CONTACTO) {
    const v = campo(fd, `A_${c.k}`);
    const e = validar(c, v, "Datos de contacto");
    if (e) return e;
    if (v) d.contacto[c.k] = v;
  }
  for (const t of TABLAS_H) {
    for (let r = 0; r < t.max; r++) {
      const fila: Fila = {};
      for (const c of t.campos) {
        const v = campo(fd, `${t.clave}${r}_${c.k}`);
        const e = validar(c, v, `${t.anexo} ${t.clave}, fila ${r + 1}`);
        if (e) return e;
        if (v) fila[c.k] = c.tipo === "porcentaje" ? leerMonto(v.replace(/%$/, ""))! : v;
      }
      if (Object.keys(fila).length) d[t.clave].push(fila);
    }
  }
  d.sinCambios = { declaracion: campo(fd, "S_declaracion").slice(0, 40), fecha: campo(fd, "S_fecha") };
  if (d.sinCambios.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(d.sinCambios.fecha)) return "La fecha de la declaración anterior no es válida.";
  return d;
}

// Personas físicas: cédula dominicana (11 dígitos) o pasaporte; los RNC (9 dígitos) son sociedades.
const soloDigitos = (x: string) => x.replace(/\D/g, "");
const esPersonaFisica = (id: string) => soloDigitos(id).length !== 9;

export function revisarSociedad(d: DatosH): Aviso[] {
  const avisos: Aviso[] = [];
  const sinCambios = !!d.sinCambios.declaracion;
  if (d.sinCambios.declaracion && !d.sinCambios.fecha) avisos.push({ nivel: "error", texto: "Actualización sin cambios: falta la fecha de la declaración que se reitera." });
  for (const t of TABLAS_H) {
    d[t.clave].forEach((f, i) => {
      const faltan = t.requeridos.filter((k) => !f[k]).map((k) => t.campos.find((c) => c.k === k)!.texto.split(" (")[0].toLowerCase());
      if (faltan.length) avisos.push({ nivel: "error", texto: `${t.anexo} ${t.clave}, fila ${i + 1}: falta ${faltan.join(" y ")}.` });
    });
  }
  if (sinCambios) return avisos;
  const c = d.contacto;
  if (!c.telefono1 || !c.correo || !c.calle || !c.municipio || !c.provincia) {
    avisos.push({ nivel: "aviso", texto: "H-1 A: faltan datos de contacto (teléfono, correo o dirección con municipio y provincia)." });
  }
  if (!d.B.length) avisos.push({ nivel: "aviso", texto: "H-1 B: no hay accionistas registrados. Si nada cambió desde la última declaración, llena «Actualización de datos sin cambios»." });
  const suma = d.B.reduce((t, f) => t + (f.participacion ? aCentavos(f.participacion) : 0n), 0n);
  if (d.B.length && suma !== 10000n) avisos.push({ nivel: "aviso", texto: `H-1 B: la participación de los accionistas suma ${(Number(suma) / 100).toFixed(2)} %, no 100 %.` });
  const enC = new Set(d.C.map((f) => soloDigitos(f.id ?? "") || f.id));
  for (const f of d.B) {
    if (f.id && esPersonaFisica(f.id) && f.participacion && aCentavos(f.participacion) >= 2000n && !enC.has(soloDigitos(f.id) || f.id)) {
      avisos.push({ nivel: "aviso", texto: `${f.nombre ?? f.id} tiene ${Number(f.participacion).toFixed(2)} % y parece persona física: debería estar en H-1 C (beneficiarios por control accionario).` });
    }
  }
  for (const f of d.C) {
    if (f.participacion && aCentavos(f.participacion) < 2000n) {
      avisos.push({ nivel: "aviso", texto: `${f.nombre ?? f.id} tiene menos del 20 %: si ejerce el control efectivo va en H-2 D, no en H-1 C.` });
    }
  }
  if (!d.E.length) avisos.push({ nivel: "aviso", texto: "H-2 E: falta la actividad económica." });
  return avisos;
}

// Lo guardado, o lo que se sabe de la ficha del cliente si todavía no se ha guardado nada.
export async function datosSociedad(tx: Tx) {
  const [g] = await tx<{ datos: DatosH; actualizado_en: Date; quien: string | null }[]>`
    SELECT s.datos, s.actualizado_en, u.nombre AS quien FROM sociedad_ir2 s LEFT JOIN usuarios u ON u.id = s.actualizado_por`;
  if (g) return { datos: { ...vacios(), ...g.datos }, guardado: { en: g.actualizado_en, quien: g.quien }, deLaFicha: false };
  const [e] = await tx<{ telefono: string | null; correo: string | null; direccion: string | null; actividad_economica: string | null }[]>`
    SELECT telefono, correo, direccion, actividad_economica FROM empresas WHERE id = empresa_actual()`;
  const d = vacios();
  if (e?.telefono) d.contacto.telefono1 = e.telefono;
  if (e?.correo) d.contacto.correo = e.correo;
  if (e?.direccion) d.contacto.calle = e.direccion;
  if (e?.actividad_economica) d.E.push({ nombre: e.actividad_economica });
  return { datos: d, guardado: null, deLaFicha: true };
}
