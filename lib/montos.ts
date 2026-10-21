// Montos como texto con 2 decimales (lo que guarda numeric(18,2)), sin pasar por floats al sumar.

export function leerMonto(valor: string | null | undefined): string | null {
  const limpio = (valor ?? "").replace(/[,\s]/g, "").replace(/^RD\$/i, "");
  if (limpio === "") return "0.00";
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const [entero, dec = ""] = limpio.split(".");
  return `${BigInt(entero)}.${dec.padEnd(2, "0")}`;
}

export function aCentavos(monto: string): bigint {
  const negativo = monto.startsWith("-");
  const [entero, dec = "0"] = monto.replace("-", "").split(".");
  const c = BigInt(entero) * 100n + BigInt(dec.padEnd(2, "0").slice(0, 2));
  return negativo ? -c : c;
}

export function deCentavos(c: bigint): string {
  const negativo = c < 0n;
  const abs = negativo ? -c : c;
  return `${negativo ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

const formato = new Intl.NumberFormat("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function verMonto(monto: string | number | bigint | null | undefined, vacioSiCero = false): string {
  if (monto === null || monto === undefined) return "";
  const texto = typeof monto === "bigint" ? deCentavos(monto) : String(monto);
  const n = Number(texto);
  if (vacioSiCero && n === 0) return "";
  return formato.format(n);
}

export function verFecha(fecha: string | Date | null | undefined): string {
  if (!fecha) return "";
  const iso = typeof fecha === "string" ? fecha.slice(0, 10) : fecha.toISOString().slice(0, 10);
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

export function hoyISO(): string {
  return new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10); // hora de RD (UTC-4)
}
