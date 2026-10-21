import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { balanza, libroDiario, libroMayor } from "@/lib/libros";
import { deCentavos, verFecha } from "@/lib/montos";
import { leerPeriodo } from "../../periodo";

// Descarga CSV que Excel abre directo (con BOM para que respete los acentos).
export async function GET(req: Request, { params }: { params: Promise<{ id: string; reporte: string }> }) {
  const { id, reporte } = await params;
  const { empresa } = await accesoEmpresa(id);
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams) as Record<string, string>;
  const { desde, hasta } = leerPeriodo(sp);

  const filas: (string | number)[][] = [[empresa.nombre + (empresa.rnc ? ` · RNC ${empresa.rnc}` : "")]];
  let nombre: string;

  if (reporte === "diario") {
    nombre = "libro-diario";
    filas.push([`Libro diario del ${verFecha(desde)} al ${verFecha(hasta)}`], []);
    filas.push(["Fecha", "N.º", "Código", "Cuenta", "Concepto", "Descripción", "Debe", "Haber"]);
    const lineas = await conEmpresa(id, (tx) => libroDiario(tx, desde, hasta));
    for (const l of lineas) filas.push([verFecha(l.fecha), l.numero, l.codigo, l.cuenta, l.concepto, l.descripcion ?? "", l.debe, l.haber]);
  } else if (reporte === "mayor") {
    const mayor = await conEmpresa(id, (tx) => libroMayor(tx, sp.cuenta ?? "", desde, hasta));
    if (!mayor) return new Response("Cuenta no encontrada", { status: 404 });
    nombre = `libro-mayor-${mayor.cuenta.codigo}`;
    filas.push([`Libro mayor ${mayor.cuenta.codigo} ${mayor.cuenta.nombre} del ${verFecha(desde)} al ${verFecha(hasta)}`], []);
    filas.push(["Fecha", "N.º", "Concepto", "Descripción", "Debe", "Haber", "Saldo"]);
    filas.push([verFecha(desde), "", "Saldo inicial", "", "", "", deCentavos(mayor.inicial)]);
    for (const m of mayor.movimientos) filas.push([verFecha(m.fecha), m.numero, m.concepto, m.descripcion ?? "", m.debe, m.haber, deCentavos(m.saldo)]);
  } else if (reporte === "balanza") {
    nombre = "balanza-de-comprobacion";
    const nivel = Math.min(6, Math.max(1, Number(sp.nivel) || 6));
    const { filas: cuentas, totales } = await conEmpresa(id, (tx) => balanza(tx, desde, hasta, nivel, sp.ceros === "1"));
    filas.push([`Balanza de comprobación del ${verFecha(desde)} al ${verFecha(hasta)}`], []);
    filas.push(["Código", "Cuenta", "Saldo inicial deudor", "Saldo inicial acreedor", "Debe", "Haber", "Saldo final deudor", "Saldo final acreedor"]);
    for (const c of cuentas) {
      filas.push([c.codigo, c.nombre, deCentavos(c.inicialDeudor), deCentavos(c.inicialAcreedor), deCentavos(c.debe), deCentavos(c.haber), deCentavos(c.saldoDeudor), deCentavos(c.saldoAcreedor)]);
    }
    filas.push(["", "Totales", ...[totales.inicialDeudor, totales.inicialAcreedor, totales.debe, totales.haber, totales.saldoDeudor, totales.saldoAcreedor].map(deCentavos)]);
  } else {
    return new Response("Reporte no encontrado", { status: 404 });
  }

  const csv = "﻿" + filas.map((f) => f.map(celda).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}-${desde}-a-${hasta}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function celda(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; // evita fórmulas inyectadas en Excel
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
