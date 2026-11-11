// Revisión automática de una factura que sube el cliente (bloque 8b; documento «Sistema Empire · Fase 2», sección 3). Solo
// formato y dígito verificador: si el NCF está vencido o fuera del rango autorizado lo dice la DGII, que no se consulta desde aquí.

// RNC (9 dígitos): pesos 7, 9, 8, 6, 5, 4, 3, 2 sobre los 8 primeros; resto de 11 → 0: 2, 1: 1, si no 11 − resto.
export function rncValido(rnc: string): boolean {
  if (!/^\d{9}$/.test(rnc)) return false;
  const pesos = [7, 9, 8, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(rnc[i]), 0);
  const r = suma % 11;
  const dv = r === 0 ? 2 : r === 1 ? 1 : 11 - r;
  return dv === Number(rnc[8]);
}

// Cédula (11 dígitos): pesos 1, 2 alternados sobre los 10 primeros (si el producto pasa de 9 se suman sus cifras); el dígito
// es lo que falta para la siguiente decena.
export function cedulaValida(cedula: string): boolean {
  if (!/^\d{11}$/.test(cedula)) return false;
  let suma = 0;
  for (let i = 0; i < 10; i++) {
    const p = Number(cedula[i]) * (i % 2 === 0 ? 1 : 2);
    suma += p > 9 ? p - 9 : p;
  }
  return (10 - (suma % 10)) % 10 === Number(cedula[10]);
}

export const identificacionValida = (v: string) => (v.length === 9 ? rncValido(v) : cedulaValida(v));

// Tipos de comprobante que puede traer una factura (B y e-CF).
export const TIPOS_NCF: Record<string, string> = {
  B01: "Crédito fiscal", B02: "Consumo", B03: "Nota de débito", B04: "Nota de crédito", B11: "Comprobante de compras", B12: "Registro único de ingresos",
  B13: "Gastos menores", B14: "Regímenes especiales", B15: "Gubernamental", B16: "Exportaciones", B17: "Pagos al exterior",
  E31: "Crédito fiscal electrónica", E32: "Consumo electrónica", E33: "Nota de débito electrónica", E34: "Nota de crédito electrónica",
  E41: "Compras electrónica", E43: "Gastos menores electrónica", E44: "Regímenes especiales electrónica", E45: "Gubernamental electrónica",
  E46: "Exportaciones electrónica", E47: "Pagos al exterior electrónica",
};
// No dan crédito fiscal de ITBIS: consumo, gastos menores y compras a informales.
export const SIN_CREDITO = ["B02", "E32", "B13", "E43", "B11", "E41"];

export function leerNcf(v: string): { ncf: string; tipo: string } | null {
  const ncf = v.toUpperCase().replace(/[\s-]/g, "");
  const m = /^(B\d{2})\d{8}$|^(E\d{2})\d{10}$/.exec(ncf);
  const tipo = m?.[1] ?? m?.[2];
  return tipo && tipo in TIPOS_NCF ? { ncf, tipo } : null;
}

// El QR de la factura electrónica lleva a la consulta del timbre de la DGII con los datos del comprobante en la dirección
// (RNC del emisor y del comprador, e-NCF, fecha de emisión, monto total y código de seguridad). Se lee sin consultar a la DGII.
export type DatosQr = { url: string; rncEmisor: string | null; rncComprador: string | null; ncf: string | null; fecha: string | null; total: string | null; codigo: string | null };

export function leerQr(texto: string): DatosQr | null {
  let u: URL;
  try {
    u = new URL(texto.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)dgii\.gov\.do$/i.test(u.hostname)) return null;
  const p = new Map([...u.searchParams.entries()].map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const fechaTxt = p.get("fechaemision") ?? null;
  const f = fechaTxt?.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  const total = p.get("montototal")?.replace(/,/g, "") ?? null;
  const ncf = p.get("encf") ? leerNcf(p.get("encf")!)?.ncf ?? null : null;
  return {
    url: u.toString().slice(0, 1000),
    rncEmisor: p.get("rncemisor") && /^\d{9}$|^\d{11}$/.test(p.get("rncemisor")!) ? p.get("rncemisor")! : null,
    rncComprador: p.get("rnccomprador") && /^\d{9}$|^\d{11}$/.test(p.get("rnccomprador")!) ? p.get("rnccomprador")! : null,
    ncf,
    fecha: f ? `${f[3]}-${f[2]}-${f[1]}` : null,
    total: total && /^\d+(\.\d{1,2})?$/.test(total) ? total : null,
    codigo: p.get("codigoseguridad") ?? null,
  };
}

export type Marca = { nivel: "aviso" | "error"; texto: string };

// Lo que se revisa al subirla. `rncEmpresa`: el del cliente. En un gasto la contraparte es el proveedor (emisor) y el comprador
// debe ser la empresa; en un ingreso el emisor es la empresa y la contraparte su cliente.
export function revisarFactura(d: {
  tipo: "gasto" | "ingreso"; rncContraparte: string | null; ncf: string | null; subtotal: bigint | null; itbis: bigint | null; total: bigint | null;
  rncEmpresa: string | null; qr: DatosQr | null; repetida: boolean;
}): { marcas: Marca[]; sinCredito: boolean } {
  const marcas: Marca[] = [];
  const tipoNcf = d.ncf ? leerNcf(d.ncf)?.tipo ?? null : null;
  if (d.rncContraparte && !identificacionValida(d.rncContraparte)) {
    marcas.push({ nivel: "aviso", texto: `El ${d.rncContraparte.length === 9 ? "RNC" : "número de cédula"} ${d.rncContraparte} no pasa el dígito verificador: revísalo.` });
  }
  if (d.repetida) marcas.push({ nivel: "error", texto: `El NCF ${d.ncf} de ese ${d.tipo === "gasto" ? "proveedor" : "cliente"} ya se subió o ya está registrado.` });
  if (d.qr && d.rncEmpresa) {
    const deLaEmpresa = d.tipo === "gasto" ? d.qr.rncComprador : d.qr.rncEmisor;
    if (deLaEmpresa && deLaEmpresa !== d.rncEmpresa) {
      marcas.push({ nivel: "error", texto: d.tipo === "gasto" ? `La factura está a nombre de otra empresa (RNC del comprador ${deLaEmpresa}).` : `La factura la emitió otra empresa (RNC ${deLaEmpresa}).` });
    }
  }
  if (d.tipo === "gasto" && d.rncEmpresa && d.rncContraparte === d.rncEmpresa) marcas.push({ nivel: "error", texto: "El RNC del proveedor es el de la propia empresa." });
  if (d.subtotal !== null && d.itbis !== null && d.total !== null && d.subtotal + d.itbis > d.total) {
    marcas.push({ nivel: "aviso", texto: "El subtotal más el ITBIS pasa del total: revisa los montos." });
  }
  if (d.subtotal !== null && d.itbis !== null && d.itbis > 0n && d.subtotal > 0n) {
    const tasa = (d.itbis * 10000n) / d.subtotal; // centésimas de %
    if (tasa < 1700n || tasa > 1900n) marcas.push({ nivel: "aviso", texto: "El ITBIS no es el 18 % del subtotal: puede llevar varias tasas o un error." });
  }
  const sinCredito = !!tipoNcf && SIN_CREDITO.includes(tipoNcf);
  if (sinCredito && d.tipo === "gasto") marcas.push({ nivel: "aviso", texto: `Es ${TIPOS_NCF[tipoNcf!].toLowerCase()} (${tipoNcf}): no da crédito fiscal; el ITBIS va al gasto.` });
  if (d.tipo === "ingreso" && tipoNcf && tipoNcf.startsWith("E")) marcas.push({ nivel: "aviso", texto: "Es una factura electrónica: no va en el 607. Al aprobarla queda registrada como e-CF emitida fuera, con su e-NCF." });
  if (d.tipo === "ingreso" && tipoNcf && !["B01", "B02", "B14", "B15", "B16", "E31", "E32", "E44", "E45", "E46"].includes(tipoNcf)) {
    marcas.push({ nivel: "aviso", texto: `Un ${tipoNcf} no es una factura de venta.` });
  }
  if (!d.ncf) marcas.push({ nivel: "aviso", texto: "Falta el NCF: lo completa Empire al revisarla." });
  return { marcas, sinCredito };
}
