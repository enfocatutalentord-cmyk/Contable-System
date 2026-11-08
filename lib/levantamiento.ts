import { aCentavos, deCentavos, leerMonto, verMonto } from "./montos.ts";

// Entrega 6b.2: el levantamiento contable de Empire. Las preguntas salen del Formulario de Levantamiento (10 secciones) y de la Ficha de
// Levantamiento Inicial, unidos sin repetir; los anexos, de los formularios 1 a 3 y el 4 se armó con las líneas de pasivos del anexo 5
// (respuesta de Patricia del 8-nov). Todo se guarda como texto en `formularios.respuestas`.

export type Pregunta = { k: string; t: string; tipo?: "monto" | "entero" | "fecha" | "largo" | "email" | "tel"; op?: string[]; multi?: boolean };
const SNP = ["Sí", "No", "Parcial"], SN = ["Sí", "No"], SNNA = ["Sí", "No", "N/A"], FDN = ["Físicas", "Digitales", "Ninguna"];

export const SECCIONES_LEV: { titulo: string; preguntas: Pregunta[] }[] = [
  { titulo: "1. Datos generales de la empresa", preguntas: [
    { k: "nombre", t: "Nombre o razón social" }, { k: "rnc", t: "RNC o cédula" }, { k: "nombre_comercial", t: "Nombre comercial" },
    { k: "fecha_constitucion", t: "Fecha de constitución", tipo: "fecha" }, { k: "actividad", t: "Actividad económica principal" },
    { k: "direccion", t: "Dirección física" }, { k: "municipio", t: "Municipio" }, { k: "provincia", t: "Provincia" }, { k: "telefono", t: "Teléfono", tipo: "tel" },
    { k: "correo", t: "Correo electrónico", tipo: "email" }, { k: "contacto", t: "Persona de contacto" }, { k: "cargo", t: "Cargo" },
    { k: "tipo_entidad", t: "Tipo de entidad" }, { k: "sector", t: "Sector" }, { k: "registrada", t: "¿La empresa está registrada formalmente?", op: SN },
  ] },
  { titulo: "2. Situación contable actual", preguntas: [
    { k: "lleva_contabilidad", t: "¿Lleva contabilidad actualmente?", op: SNP }, { k: "tiene_sistema", t: "¿Tiene sistema contable instalado?", op: SN },
    { k: "sistema_usa", t: "¿Cuál sistema? (QuickBooks, Sage, Excel, otro)" }, { k: "al_dia", t: "¿Los registros están al día?", op: ["Sí", "No", "Atrasados"] },
    { k: "ultimo_registro", t: "Período del último registro" }, { k: "ultimo_estado", t: "Último estado financiero" },
    { k: "contador_interno", t: "¿Tiene contador interno?", op: SN }, { k: "contador_externo", t: "¿Tiene contador externo?", op: SN },
    { k: "contador_nombre", t: "Nombre del contador actual (si aplica)" }, { k: "quien_maneja", t: "¿Quién maneja actualmente la contabilidad?" },
    { k: "frecuencia_revisa", t: "¿Con qué frecuencia revisa estados financieros?" }, { k: "observaciones", t: "Observaciones generales", tipo: "largo" },
  ] },
  { titulo: "3. Documentación disponible", preguntas: [
    { k: "doc_ventas", t: "Facturas de ventas (NCF/e-CF)", op: FDN }, { k: "doc_compras", t: "Facturas de compras y gastos", op: FDN },
    { k: "doc_bancos", t: "Estados de cuenta bancarios", op: SNP }, { k: "doc_nomina", t: "Nómina o planilla de empleados", op: SNNA },
    { k: "doc_inventario", t: "Registros de inventario", op: SNNA }, { k: "doc_contratos", t: "Contratos de arrendamiento o préstamos", op: SNNA },
    { k: "doc_dgii", t: "Declaraciones DGII anteriores", op: SNP }, { k: "doc_actas", t: "Actas o minutas corporativas", op: SNNA },
    { k: "doc_entregada", t: "Documentación entregada", op: ["Estatutos", "Acta de constitución", "RNC", "Otros"], multi: true },
    { k: "doc_faltantes", t: "Documentos faltantes o por obtener", tipo: "largo" },
  ] },
  { titulo: "4. Ingresos y ventas", preguntas: [
    { k: "tipo_ingresos", t: "Tipo de ingresos", op: ["Servicios", "Productos", "Mixto"] }, { k: "ncf_frecuencia", t: "Facturación con NCF o e-CF", op: ["Siempre", "A veces", "No"] },
    { k: "emite_ncf", t: "¿Emite comprobantes fiscales?", op: SN }, { k: "tipo_comprobantes", t: "Tipo de comprobantes" },
    { k: "ventas_mes", t: "Promedio mensual de ventas (RD$)", tipo: "monto" }, { k: "clientes_mes", t: "Número aproximado de clientes al mes", tipo: "entero" },
    { k: "facturas_mes", t: "Facturas al mes, compras y ventas (aproximado)", tipo: "entero" },
    { k: "tarjetas", t: "¿Acepta tarjetas o transferencias?", op: ["Sí", "No", "Ambos"] }, { k: "registra_efectivo", t: "¿Registra ventas en efectivo?", op: SNP },
  ] },
  { titulo: "5. Gastos y compras", preguntas: [
    { k: "gastos_mes", t: "Promedio mensual de gastos (RD$)", tipo: "monto" }, { k: "proveedor_principal", t: "Principal proveedor o categoría" },
    { k: "guarda_facturas", t: "¿Guarda facturas de gastos?", op: ["Siempre", "A veces", "No"] }, { k: "gastos_fijos", t: "¿Tiene gastos fijos recurrentes?", op: SN },
    { k: "gastos_detalle", t: "Gastos fijos principales (alquiler, luz, etc.)", tipo: "largo" }, { k: "prestamos", t: "¿Tiene créditos o préstamos activos?", op: SN },
    { k: "prestamo_detalle", t: "Entidad y monto aproximado del préstamo" },
  ] },
  { titulo: "6. Nómina y aspectos laborales", preguntas: [
    { k: "empleados_fijos", t: "Número de empleados fijos", tipo: "entero" }, { k: "empleados_servicio", t: "Número de empleados por servicio", tipo: "entero" },
    { k: "en_tss", t: "¿Están registrados en la TSS?", op: SNP }, { k: "en_mt", t: "¿Está registrada en el Ministerio de Trabajo?", op: SN },
    { k: "nomina_formal", t: "¿Preparan nómina formal?", op: SN }, { k: "regalia", t: "¿Pagan regalía pascual?", op: SNNA },
    { k: "rango_salarial", t: "Rango salarial (RD$)" }, { k: "periodicidad", t: "Periodicidad de pago" },
  ] },
  { titulo: "7. Situación tributaria · DGII", preguntas: [
    { k: "rnc_estado", t: "Estado del RNC", op: ["Activo", "Suspendido", "No registrado"] }, { k: "dgii_al_dia", t: "¿Está al día con la DGII?", op: ["Sí", "No", "Tiene deuda"] },
    { k: "declara_itbis", t: "¿Declara ITBIS mensual?", op: ["Sí", "No", "No aplica"] }, { k: "declara_ir", t: "¿Declara IR-1 o IR-2 anual?", op: SN },
    { k: "fiscalizacion", t: "¿Ha recibido fiscalización de la DGII?", op: SN }, { k: "deudas_tributarias", t: "Deudas, compromisos tributarios o procesos abiertos", tipo: "largo" },
    { k: "ultimo_periodo", t: "Período fiscal más reciente declarado" }, { k: "comprobantes_autorizados", t: "Número de comprobantes autorizados" },
  ] },
  { titulo: "8. Activos y pasivos conocidos", preguntas: [
    { k: "inmuebles", t: "¿Tiene inmuebles o vehículos a nombre de la empresa?", op: SN }, { k: "tiene_cxc", t: "¿Tiene cuentas por cobrar pendientes?", op: SN },
    { k: "cxc_monto", t: "Monto estimado por cobrar (RD$)", tipo: "monto" }, { k: "cxc_antiguedad", t: "Antigüedad promedio por cobrar" },
    { k: "inventario_valorado", t: "¿Tiene inventario valorado?", op: SNNA }, { k: "inventario_valor", t: "Valor estimado de inventario (RD$)", tipo: "monto" },
    { k: "inventario_metodo", t: "Método de valuación" }, { k: "tiene_cxp", t: "¿Tiene cuentas por pagar pendientes?", op: SN },
    { k: "cxp_monto", t: "Monto estimado por pagar (RD$)", tipo: "monto" }, { k: "cxp_antiguedad", t: "Antigüedad promedio por pagar" },
  ] },
  { titulo: "9. Necesidades y objetivos", preguntas: [
    { k: "servicios", t: "Servicios requeridos", multi: true, op: ["Organización contable", "Contabilidad mensual", "Estados financieros", "Fiscal", "Asesoría tributaria", "Preparación de nómina", "Auditoría", "Constitución de empresa", "Asesoría legal", "Otro"] },
    { k: "preocupaciones", t: "Principales preocupaciones", multi: true, op: ["Impuestos", "Organización interna", "Formalización legal", "Auditoría", "Otro"] },
    { k: "comunicacion", t: "Forma preferida de comunicación", op: ["WhatsApp", "Correo", "Llamada"] }, { k: "urgencia", t: "Situación específica o urgencia", tipo: "largo" },
    { k: "metas", t: "Metas a corto plazo (3 a 6 meses)", tipo: "largo" }, { k: "observaciones_adic", t: "Observaciones adicionales", tipo: "largo" },
  ] },
];

export type Columna = { k: string; t: string; tipo?: "monto" | "fecha"; op?: string[] };
export type Anexo = { clave: string; titulo: string; ayuda: string; max: number; suma: string; cols: Columna[] };
const ESTADO_BIEN = ["Bueno", "Regular", "Malo"], FREC = ["Diario", "Semanal", "Mensual", "Trimestral", "Anual"];

export const TIPOS_PASIVO = ["Proveedor", "DGII o impuestos", "TSS", "Préstamo a corto plazo", "Otro corriente", "Préstamo bancario a largo plazo", "Hipoteca o leasing", "Otro a largo plazo"];
export const ANEXOS: Anexo[] = [
  { clave: "nom", titulo: "Anexo 1 · Nómina de personal", ayuda: "Un renglón por empleado.", max: 60, suma: "bruto", cols: [
    { k: "nombre", t: "Nombre completo" }, { k: "cargo", t: "Cargo o función" }, { k: "tipo", t: "Tipo", op: ["Fijo", "Por servicio", "Temporal"] }, { k: "ingreso", t: "Fecha de ingreso", tipo: "fecha" },
    { k: "bruto", t: "Salario bruto (RD$)", tipo: "monto" }, { k: "desc", t: "Descuento TSS/AFP (RD$)", tipo: "monto" }, { k: "neto", t: "Salario neto (RD$)", tipo: "monto" },
  ] },
  { clave: "gf", titulo: "Anexo 2 · Gastos fijos", ayuda: "Los que se repiten siempre: alquiler, luz, internet, seguros. La nómina va solo en el anexo 1.", max: 40, suma: "monto", cols: [
    { k: "concepto", t: "Concepto" }, { k: "detalle", t: "Detalle" }, { k: "frec", t: "Frecuencia", op: FREC }, { k: "monto", t: "Monto mensual (RD$)", tipo: "monto" }, { k: "proveedor", t: "Proveedor o acreedor" },
  ] },
  { clave: "gv", titulo: "Anexo 2 · Gastos variables", ayuda: "Los que cambian según el mes: publicidad, combustible, materiales.", max: 40, suma: "monto", cols: [
    { k: "concepto", t: "Concepto" }, { k: "detalle", t: "Detalle" }, { k: "frec", t: "Frecuencia", op: FREC }, { k: "monto", t: "Monto estimado (RD$)", tipo: "monto" }, { k: "obs", t: "Observaciones" },
  ] },
  { clave: "ac", titulo: "Anexo 3 · Activos corrientes", ayuda: "Efectivo, cuentas por cobrar, inventario y lo que se convierte en dinero en menos de 12 meses.", max: 30, suma: "valor", cols: [
    { k: "tipo", t: "Tipo", op: ["Efectivo", "Cuentas por cobrar", "Inventario", "Inversión", "Otro"] }, { k: "desc", t: "Descripción" }, { k: "donde", t: "Dónde está o banco" },
    { k: "estado", t: "Estado", op: ESTADO_BIEN }, { k: "valor", t: "Valor (RD$)", tipo: "monto" }, { k: "doc", t: "Soporte", op: ["Sí", "No", "Parcial"] },
  ] },
  { clave: "anc", titulo: "Anexo 3 · Activos no corrientes", ayuda: "Equipos, vehículos, inmuebles, marcas y otros bienes de largo plazo.", max: 30, suma: "valor", cols: [
    { k: "tipo", t: "Tipo", op: ["Equipo", "Vehículo", "Inmueble", "Marca", "Mobiliario", "Otro"] }, { k: "desc", t: "Descripción, marca o referencia" }, { k: "uso", t: "Ubicación o uso" },
    { k: "fecha", t: "Fecha de adquisición", tipo: "fecha" }, { k: "estado", t: "Estado", op: ESTADO_BIEN }, { k: "valor", t: "Valor estimado (RD$)", tipo: "monto" },
  ] },
  { clave: "pas", titulo: "Anexo 4 · Pasivos y deudas", ayuda: "Lo que la empresa debe: proveedores, impuestos, TSS y préstamos.", max: 30, suma: "saldo", cols: [
    { k: "tipo", t: "Tipo", op: TIPOS_PASIVO }, { k: "acreedor", t: "Acreedor" }, { k: "saldo", t: "Saldo (RD$)", tipo: "monto" }, { k: "vence", t: "Vencimiento", tipo: "fecha" }, { k: "nota", t: "Nota" },
  ] },
];

export const SIMPLES = ["costos_directos", "acepta_nombre", "acepta_cedula", "acepta"];
export const camposLevantamiento = () => [
  ...SECCIONES_LEV.flatMap((s) => s.preguntas.map((p) => p.k)), ...SIMPLES,
  ...ANEXOS.flatMap((a) => Array.from({ length: a.max }, (_, i) => a.cols.map((c) => `${a.clave}${i}_${c.k}`)).flat()),
];

export class ErrorLevantamiento extends Error {}
const limpio = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 2000) : "");
const montoValido = (v: string) => { const m = leerMonto(v); return m !== null && aCentavos(m) >= 0n; };
const fechaValida = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export type Fila = Record<string, string>;
export const filasDe = (r: Record<string, string>, a: Anexo): Fila[] =>
  Array.from({ length: a.max }, (_, i) => Object.fromEntries(a.cols.map((c) => [c.k, r[`${a.clave}${i}_${c.k}`] ?? ""]).filter(([, v]) => v)) as Fila)
    .filter((f) => Object.keys(f).length > 0);

// Lee lo que envía el cliente: solo campos conocidos, opciones de su lista, montos y fechas válidos.
export function leerLevantamiento(fd: FormData): Record<string, string> {
  const r: Record<string, string> = {};
  for (const s of SECCIONES_LEV) {
    for (const p of s.preguntas) {
      if (p.multi) { const v = fd.getAll(p.k).map(String).filter((x) => p.op!.includes(x)); if (v.length) r[p.k] = v.join(", "); continue; }
      const v = limpio(fd.get(p.k));
      if (!v) continue;
      if (p.op && !p.op.includes(v)) throw new ErrorLevantamiento(`«${p.t}»: elija una de las opciones.`);
      if (p.tipo === "monto" && !montoValido(v)) throw new ErrorLevantamiento(`«${p.t}»: el monto no es válido.`);
      if (p.tipo === "entero" && !/^\d{1,7}$/.test(v)) throw new ErrorLevantamiento(`«${p.t}»: escriba un número entero.`);
      if (p.tipo === "fecha" && !fechaValida(v)) throw new ErrorLevantamiento(`«${p.t}»: la fecha no es válida.`);
      r[p.k] = v;
    }
  }
  if (!r.nombre) throw new ErrorLevantamiento("Escriba el nombre o razón social de la empresa.");
  if (r.rnc && !/^\d{9}$|^\d{11}$/.test(r.rnc.replace(/\D/g, ""))) throw new ErrorLevantamiento("El RNC lleva 9 dígitos (o 11 si es una cédula).");
  const costos = limpio(fd.get("costos_directos"));
  if (costos) { if (!montoValido(costos)) throw new ErrorLevantamiento("«Costos directos»: el monto no es válido."); r.costos_directos = costos; }
  for (const a of ANEXOS) {
    let n = 0;
    for (let i = 0; i < a.max; i++) {
      const vals = a.cols.map((c) => [c, limpio(fd.get(`${a.clave}${i}_${c.k}`))] as const).filter(([, v]) => v);
      if (!vals.length) continue;
      n++;
      for (const [c, v] of vals) {
        if (c.op && !c.op.includes(v)) throw new ErrorLevantamiento(`${a.titulo}, fila ${n}: «${c.t}» no es una opción válida.`);
        if (c.tipo === "monto" && !montoValido(v)) throw new ErrorLevantamiento(`${a.titulo}, fila ${n}: «${c.t}» no es un monto válido.`);
        if (c.tipo === "fecha" && !fechaValida(v)) throw new ErrorLevantamiento(`${a.titulo}, fila ${n}: «${c.t}» no es una fecha válida.`);
        r[`${a.clave}${n - 1}_${c.k}`] = v;
      }
    }
  }
  const nombre = limpio(fd.get("acepta_nombre")), cedula = limpio(fd.get("acepta_cedula")).replace(/\D/g, "");
  if (!nombre || !/^\d{9}$|^\d{11}$/.test(cedula)) throw new ErrorLevantamiento("Para enviarlo, escriba su nombre y su cédula o RNC.");
  if (fd.get("acepta") !== "on") throw new ErrorLevantamiento("Marque que la información es correcta.");
  r.acepta_nombre = nombre; r.acepta_cedula = cedula; r.acepta = "Sí";
  return r;
}

const c = (v: string | undefined) => { const m = leerMonto(v ?? ""); return v && m !== null ? aCentavos(m) : 0n; };
// Patrimonio: lo escribe la firma; utilidades y resultado pueden ser negativos.
const firmado = (v: string | undefined) => (v?.startsWith("-") ? -c(v.slice(1)) : c(v));
export const esNomina = (f: Fila) => /n[oó]mina|salario|sueldo/i.test(`${f.concepto ?? ""} ${f.detalle ?? ""}`);
const anexo = (k: string) => ANEXOS.find((a) => a.clave === k)!;

export type Linea = { concepto: string; monto: bigint | null; ref: string; negrita?: boolean };
export type EstadoInicial = {
  lineas: Linea[]; activos: bigint; pasivos: bigint; patrimonio: bigint; diferencia: bigint; operativa: Linea[]; margen: string | null; avisos: string[];
  sugeridaUtilidades: bigint; saldos: Record<string, string>;
};

// Arma el estado con las líneas del anexo 5; cada monto dice de qué anexo sale.
export function estadoInicial(r: Record<string, string>): EstadoInicial {
  const sumar = (k: string, campo: string, f: (x: Fila) => boolean = () => true) => filasDe(r, anexo(k)).filter(f).reduce((t, x) => t + c(x[campo]), 0n);
  const ac = (...t: string[]) => sumar("ac", "valor", (x) => t.includes(x.tipo));
  const anc = (...t: string[]) => sumar("anc", "valor", (x) => t.includes(x.tipo));
  const pas = (...t: string[]) => sumar("pas", "saldo", (x) => t.includes(x.tipo));
  // Una fila sin tipo cuenta en «Otros», para que no se pierda.
  const sinTipo = (k: string, campo: string) => sumar(k, campo, (x) => !x.tipo);
  const efectivo = ac("Efectivo"), cxc = ac("Cuentas por cobrar"), inventario = ac("Inventario"), otrosAc = ac("Inversión", "Otro") + sinTipo("ac", "valor");
  const equipos = anc("Equipo", "Mobiliario"), vehiculos = anc("Vehículo"), inmuebles = anc("Inmueble"), marcas = anc("Marca"), otrosAnc = anc("Otro") + sinTipo("anc", "valor");
  const proveedores = pas("Proveedor"), dgii = pas("DGII o impuestos"), tss = pas("TSS"), cortos = pas("Préstamo a corto plazo"), otrosPc = pas("Otro corriente") + sinTipo("pas", "saldo");
  const largos = pas("Préstamo bancario a largo plazo"), hipotecas = pas("Hipoteca o leasing"), otrosLp = pas("Otro a largo plazo");
  const subAc = efectivo + cxc + inventario + otrosAc, subAnc = equipos + vehiculos + inmuebles + marcas + otrosAnc, activos = subAc + subAnc;
  const subPc = proveedores + dgii + tss + cortos + otrosPc, subLp = largos + hipotecas + otrosLp, pasivos = subPc + subLp;
  const capital = c(r.pat_capital), utilidades = firmado(r.pat_utilidades), resultado = firmado(r.pat_resultado), patrimonio = capital + utilidades + resultado;
  const a3 = "Anexo 3", a4 = "Anexo 4", firma = "Lo escribe la firma";
  const lineas: Linea[] = [
    { concepto: "ACTIVOS", monto: null, ref: "", negrita: true }, { concepto: "Activos corrientes", monto: null, ref: "", negrita: true },
    { concepto: "Efectivo / Bancos", monto: efectivo, ref: a3 }, { concepto: "Cuentas por cobrar", monto: cxc, ref: a3 }, { concepto: "Inventarios", monto: inventario, ref: a3 },
    { concepto: "Otros activos corrientes", monto: otrosAc, ref: a3 }, { concepto: "Subtotal activos corrientes", monto: subAc, ref: "", negrita: true },
    { concepto: "Activos no corrientes", monto: null, ref: "", negrita: true }, { concepto: "Equipos y maquinaria", monto: equipos, ref: a3 }, { concepto: "Vehículos", monto: vehiculos, ref: a3 },
    { concepto: "Inmuebles / Terrenos", monto: inmuebles, ref: a3 }, { concepto: "Marcas y otros intangibles", monto: marcas, ref: a3 }, { concepto: "Otros activos no corrientes", monto: otrosAnc, ref: a3 },
    { concepto: "Subtotal activos no corrientes", monto: subAnc, ref: "", negrita: true }, { concepto: "TOTAL ACTIVOS", monto: activos, ref: "", negrita: true },
    { concepto: "PASIVOS", monto: null, ref: "", negrita: true }, { concepto: "Pasivos corrientes", monto: null, ref: "", negrita: true },
    { concepto: "Cuentas por pagar proveedores", monto: proveedores, ref: a4 }, { concepto: "DGII / Impuestos por pagar", monto: dgii, ref: a4 }, { concepto: "TSS por pagar", monto: tss, ref: a4 },
    { concepto: "Préstamos a corto plazo", monto: cortos, ref: a4 }, { concepto: "Otros pasivos corrientes", monto: otrosPc, ref: a4 }, { concepto: "Subtotal pasivos corrientes", monto: subPc, ref: "", negrita: true },
    { concepto: "Pasivos a largo plazo", monto: null, ref: "", negrita: true }, { concepto: "Préstamos bancarios a largo plazo", monto: largos, ref: a4 }, { concepto: "Hipotecas / Leasing", monto: hipotecas, ref: a4 },
    { concepto: "Otros pasivos a largo plazo", monto: otrosLp, ref: a4 }, { concepto: "Subtotal pasivos no corrientes", monto: subLp, ref: "", negrita: true }, { concepto: "TOTAL PASIVOS", monto: pasivos, ref: "", negrita: true },
    { concepto: "PATRIMONIO NETO", monto: null, ref: "", negrita: true }, { concepto: "Capital social", monto: capital, ref: firma }, { concepto: "Utilidades retenidas / acumuladas", monto: utilidades, ref: firma },
    { concepto: "Resultado del ejercicio", monto: resultado, ref: firma }, { concepto: "TOTAL PATRIMONIO NETO", monto: patrimonio, ref: "", negrita: true },
    { concepto: "TOTAL PASIVOS + PATRIMONIO", monto: pasivos + patrimonio, ref: "", negrita: true },
  ];
  const fijas = filasDe(r, anexo("gf"));
  const duplicadas = fijas.filter(esNomina);
  const ingresos = c(r.ventas_mes), costos = c(r.costos_directos), gastos = fijas.filter((x) => !esNomina(x)).reduce((t, x) => t + c(x.monto), 0n), nomina = sumar("nom", "bruto");
  const res = ingresos - costos - gastos - nomina;
  const operativa: Linea[] = [
    { concepto: "Total ingresos promedio / mes", monto: ingresos, ref: "Sección 4" }, { concepto: "(-) Total costos directos / mes", monto: costos, ref: "Anexo 2" },
    { concepto: "(-) Total gastos fijos / mes", monto: gastos, ref: "Anexo 2" }, { concepto: "(-) Total nómina / mes", monto: nomina, ref: "Anexo 1" },
    { concepto: "RESULTADO MENSUAL ESTIMADO", monto: res, ref: "", negrita: true },
  ];
  let margen: string | null = null;
  if (ingresos > 0n) { const m = (res * 1000n) / ingresos; margen = `${m < 0n ? "-" : ""}${(m < 0n ? -m : m) / 10n}.${(m < 0n ? -m : m) % 10n} %`; }
  const avisos: string[] = [];
  if (duplicadas.length) avisos.push(`En gastos fijos se escribió la nómina (${duplicadas.map((x) => x.concepto ?? x.detalle).join(", ")}). No se cuenta ahí para no restarla dos veces: la nómina sale del anexo 1.`);
  const variables = sumar("gv", "monto");
  if (variables > 0n) avisos.push(`El resultado mensual no resta los gastos variables estimados (RD$${verMonto(deCentavos(variables))}), porque el anexo 5 no los incluye.`);
  const saldos: Record<string, string> = {};
  const poner = (k: string, v: bigint) => { if (v !== 0n) saldos[k] = deCentavos(v); };
  poner("efectivo", efectivo); poner("cxc", cxc); poner("inventario", inventario); poner("otros_ac", otrosAc); poner("activos_fijos", equipos + vehiculos + inmuebles); poner("otros_anc", marcas + otrosAnc);
  poner("cxp", proveedores); poner("impuestos_pagar", dgii); poner("prestamos_cp", cortos); poner("otros_pc", tss + otrosPc); poner("prestamos_lp", largos + hipotecas + otrosLp);
  poner("capital", capital); poner("acumulados", utilidades + resultado);
  return { lineas, activos, pasivos, patrimonio, diferencia: activos - pasivos - patrimonio, operativa, margen, avisos, sugeridaUtilidades: activos - pasivos - capital - resultado, saldos };
}

// Lee el patrimonio que escribe la firma en la revisión.
export function leerPatrimonio(fd: FormData): Record<string, string> {
  const r: Record<string, string> = {};
  const leer = (k: string, t: string, negativo: boolean) => {
    const v = limpio(fd.get(k));
    if (!v) { r[k] = ""; return; }
    if (v.startsWith("-") && !negativo) throw new ErrorLevantamiento(`«${t}» no puede ser negativo.`);
    if (!montoValido(v.replace(/^-/, ""))) throw new ErrorLevantamiento(`«${t}»: el monto no es válido.`);
    r[k] = v;
  };
  leer("pat_capital", "Capital social", false); leer("pat_utilidades", "Utilidades acumuladas", true); leer("pat_resultado", "Resultado del ejercicio", true);
  return r;
}
