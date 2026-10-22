import type { Tx } from "./db";
import { verMonto } from "./montos";

export type Cambio = {
  id: number; tabla: string; registro_id: string | null; padre_id: string | null; accion: "insert" | "update" | "delete";
  antes: Record<string, unknown> | null; despues: Record<string, unknown> | null; fecha: Date; usuario: string | null;
};

export const TABLAS: Record<string, string> = {
  asientos: "Asiento", lineas_asiento: "Línea de asiento", cuentas: "Cuenta", empresas: "Empresa", miembros: "Acceso",
  documentos: "Documento", cuentas_empresa: "Configuración de cuentas", clientes: "Cliente", servicios: "Servicio",
  secuencias_ncf: "Rango de NCF", facturas: "Comprobante", lineas_factura: "Línea de comprobante", cobros: "Cobro",
  aplicaciones_cobro: "Aplicación de cobro", impuestos: "Impuesto", retenciones: "Retención", obligaciones_empresa: "Obligación fiscal",
};

export const ACCIONES = { insert: "Creó", update: "Modificó", delete: "Eliminó" } as const;

const CAMPOS: Record<string, string> = {
  estado: "Estado", fecha: "Fecha", concepto: "Concepto", referencia: "Referencia", numero: "Número", debe: "Debe", haber: "Haber",
  descripcion: "Descripción", cuenta_id: "Cuenta", nombre: "Nombre", codigo: "Código", activa: "Activa", de_detalle: "De detalle",
  fecha_bloqueo: "Cerrado hasta", rnc: "RNC", regimen: "Régimen", actividad_economica: "Actividad", direccion: "Dirección",
  telefono: "Teléfono", correo: "Correo", mes_cierre: "Mes de cierre", requiere_aprobacion: "Requiere aprobación",
  nombre_comercial: "Nombre comercial", perfil_id: "Perfil", eliminado: "Eliminado", motivo_anulacion: "Motivo de anulación",
  tipo_identificacion: "Tipo de identificación", inicio_operaciones: "Inicio de operaciones", total: "Total", anulada: "Anulada",
  origen: "Origen", nombre_comercial_firma: "Firma", administrador: "Administrador",
  tasa: "Tasa", impuesto: "Impuesto", activo: "Activo", nota: "Nota", vigente_desde: "Vigente desde", vigente_hasta: "Vigente hasta",
  cuenta_ventas_id: "Cuenta en ventas", cuenta_compras_id: "Cuenta en compras", cuenta_por_terceros_id: "Cuenta cuando nos retienen",
  cuenta_a_terceros_id: "Cuenta cuando retenemos", codigo_606: "Tipo en el 606", clave: "Obligación", tipo_persona: "Tipo de contribuyente",
  contribuye_itbis: "Contribuyente de ITBIS", agente_retencion: "Agente de retención", emisor_ecf: "Emisor e-CF", ecf_desde: "e-CF desde",
};

// Campos técnicos que no aportan al leer el historial.
const RUIDO = new Set(["id", "empresa_id", "creado", "creado_por", "modificado_por", "modificado_en", "aprobado_por", "aprobado_en",
  "anulado", "anulado_por", "anulado_en", "orden", "asiento_id", "sha256", "subido_por", "subido_en", "eliminado_por", "eliminado_en",
  "firma_id", "creada", "padre_id", "nivel", "tipo", "revierte_a", "usuario_id"]);

export type Nombres = Record<string, string>;

const MONTOS = new Set(["debe", "haber", "total", "subtotal", "itbis", "monto", "recibido", "precio"]);

function valor(v: unknown, nombres: Nombres = {}, campo = ""): string {
  if (v === null || v === undefined || v === "") return "—";
  if (MONTOS.has(campo) && (typeof v === "number" || typeof v === "string") && !Number.isNaN(Number(v))) return verMonto(String(v));
  if (typeof v === "string" && nombres[v]) return nombres[v];
  if (typeof v === "boolean") return v ? "sí" : "no";
  return String(v);
}

// Lista legible de lo que cambió: «Concepto: antes → después».
export function describir(c: Cambio, nombres: Nombres = {}): string[] {
  const a = c.antes ?? {};
  const d = c.despues ?? {};
  if (c.accion === "update") {
    const cambios = Object.keys(d)
      .filter((k) => !RUIDO.has(k) && JSON.stringify(a[k]) !== JSON.stringify(d[k]))
      .map((k) => `${CAMPOS[k] ?? k}: ${valor(a[k], nombres, k)} → ${valor(d[k], nombres, k)}`);
    return cambios.length ? cambios : ["Guardado sin cambios de contenido"];
  }
  const fila = c.accion === "insert" ? d : a;
  return Object.keys(fila)
    .filter((k) => !RUIDO.has(k) && fila[k] !== null && fila[k] !== "" && fila[k] !== false && !(k.match(/^(debe|haber)$/) && Number(fila[k]) === 0))
    .slice(0, 6)
    .map((k) => `${CAMPOS[k] ?? k}: ${valor(fila[k], nombres, k)}`);
}

export type Filtros = { desde?: string; hasta?: string; usuario?: string; tabla?: string; accion?: string; registro?: string };

export async function historial(tx: Tx, f: Filtros, limite = 200): Promise<Cambio[]> {
  return tx<Cambio[]>`
    SELECT h.id, h.tabla, h.registro_id, h.padre_id, h.accion, h.antes, h.despues, h.fecha, u.nombre AS usuario
      FROM auditoria h LEFT JOIN usuarios u ON u.id = h.usuario_id
     WHERE (${f.desde ?? null}::date IS NULL OR h.fecha >= ${f.desde ?? null}::date)
       AND (${f.hasta ?? null}::date IS NULL OR h.fecha < ${f.hasta ?? null}::date + 1)
       AND (${f.usuario ?? null}::uuid IS NULL OR h.usuario_id = ${f.usuario ?? null}::uuid)
       AND (${f.tabla ?? null}::text IS NULL OR h.tabla = ${f.tabla ?? null})
       AND (${f.accion ?? null}::text IS NULL OR h.accion = ${f.accion ?? null})
       AND (${f.registro ?? null}::text IS NULL OR h.registro_id = ${f.registro ?? null} OR h.padre_id = ${f.registro ?? null})
     ORDER BY h.fecha DESC, h.id DESC
     LIMIT ${limite}`;
}

// Nombres legibles de cuentas y perfiles de la empresa, para el historial.
export async function nombresHistorial(tx: Tx): Promise<Nombres> {
  const filas = await tx<{ id: string; nombre: string }[]>`
    SELECT id::text, codigo || ' · ' || nombre AS nombre FROM cuentas
    UNION ALL SELECT id::text, nombre FROM perfiles`;
  return Object.fromEntries(filas.map((f) => [f.id, f.nombre]));
}
