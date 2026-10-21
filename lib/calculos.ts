// Cálculos de ventas sin dependencias: cantidades x10000, montos en centavos, tasas x10000.

// Cantidades con hasta 4 decimales; montos en centavos.
export function leerCantidad(v: string): bigint | null {
  const s = v.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  const [e, d = ""] = s.split(".");
  const n = BigInt(e) * 10000n + BigInt(d.padEnd(4, "0"));
  return n > 0n ? n : null;
}

export function cantidadTexto(c: bigint): string {
  return `${c / 10000n}.${(c % 10000n).toString().padStart(4, "0")}`;
}

export function redondearDiv(a: bigint, b: bigint): bigint {
  return (2n * a + b) / (2n * b); // a, b >= 0
}

export function calcularLinea(cantidad: bigint, precioCent: bigint, tasa: number) {
  const subtotal = redondearDiv(cantidad * precioCent, 10000n);
  const itbis = redondearDiv(subtotal * BigInt(tasa), 100n);
  return { subtotal, itbis };
}

// Tasa con 4 decimales -> entero x10000.
export function leerTasa(v: string): bigint | null {
  const s = v.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  const [e, d = ""] = s.split(".");
  const n = BigInt(e) * 10000n + BigInt(d.padEnd(4, "0"));
  return n > 0n ? n : null;
}

export function aPesos(centavos: bigint, tasa4: bigint): bigint {
  return redondearDiv(centavos * tasa4, 10000n);
}

export function tasaTexto(t: bigint): string {
  return `${t / 10000n}.${(t % 10000n).toString().padStart(4, "0")}`;
}

export function tasaDeTexto(t: string): bigint {
  return leerTasa(t) ?? 10000n;
}

