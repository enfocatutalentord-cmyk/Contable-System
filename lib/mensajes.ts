// Bloque 3, entrega 3c: mensajes predeterminados de WhatsApp (Documento maestro, sección 10). Lo de aquí no toca la base:
// llenar los campos entre corchetes, revisar lo que falta y armar el enlace de WhatsApp (envío con clic, sin costo).

// Campos que el sistema sabe llenar; lo demás queda entre corchetes para escribirlo a mano antes de enviar.
export const CAMPOS = [
  "nombre", "empresa", "mes", "monto", "enlace", "servicio", "número", "concepto", "declaración", "período", "fecha límite",
  "cantidad", "tipo", "años", "documento",
] as const;
// Mensajes de cobro (rediseño R2, n.º 6): se ven y se editan en Contabilidad Empire; los demás, en la Firma.
export const CLAVES_COBRO = ["cobro_iguala", "envio_factura", "pago_atrasado", "pago_recibido", "cuenta_bancaria", "correo_factura"];
export const esDeCobro = (clave: string) => CLAVES_COBRO.includes(clave);
export type Datos = Partial<Record<(typeof CAMPOS)[number], string>>;

const CORCHETES = /\[([^\]\n]{1,40})\]/g;

// Cambia cada [campo] que tenga dato; los que no, se quedan como están.
export function llenar(texto: string, datos: Datos): string {
  return texto.replace(CORCHETES, (todo, campo: string) => {
    const v = (datos as Record<string, string | undefined>)[campo.trim().toLowerCase()];
    return v && v.trim() ? v.trim() : todo;
  });
}

// Lo que todavía está entre corchetes (para avisar antes de enviar).
export function faltantes(texto: string): string[] {
  return [...new Set([...texto.matchAll(CORCHETES)].map((m) => m[1].trim()))];
}

// Número para wa.me: solo dígitos con el código del país. En RD (809, 829, 849) se le pone el 1 delante.
export function telefonoWa(tel: string | null | undefined): string | null {
  if (!tel) return null;
  let d = tel.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && /^8[024]9/.test(d)) d = `1${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

// Enlace de WhatsApp: con número abre ese chat; sin número, WhatsApp pide elegir el chat o el grupo.
export const urlWhatsApp = (texto: string, telefono?: string | null) =>
  `https://wa.me/${telefono ?? ""}?text=${encodeURIComponent(texto)}`;

// Cómo se ve un teléfono guardado (809-555-1234), para que la coordinadora sepa a quién le escribe.
export function verTelefono(wa: string): string {
  const d = wa.startsWith("1") && wa.length === 11 ? wa.slice(1) : wa;
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : `+${wa}`;
}

// Un deshacer vale el mismo día del envío (24 horas).
export const HORAS_DESHACER = 24;
