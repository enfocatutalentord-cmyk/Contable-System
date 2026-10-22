import { accesoEmpresa } from "@/lib/acceso";
import { bitacora } from "@/lib/asientos";
import { ACCIONES, describir, historial, nombresHistorial, TABLAS } from "@/lib/auditoria";
import { buscarAsientos, estadoTexto, leerFiltros } from "@/lib/busqueda-asientos";
import { antiguedad, estadoCuenta, TRAMOS } from "@/lib/cxc";
import { conEmpresa } from "@/lib/db";
import { aCsv, aPdf, aXlsx, type Celda, type Columna, type Tabla } from "@/lib/exportar";
import { balanza, libroDiario, libroMayor } from "@/lib/libros";
import { deCentavos, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { fechaValida } from "@/lib/reportes";
import { leerPeriodo } from "../../periodo";

const col = (titulo: string, num = false, ancho?: number): Columna => ({ titulo, num, ancho });

// Reportes descargables en Excel (.xlsx, por defecto), PDF o CSV.
export async function GET(req: Request, { params }: { params: Promise<{ id: string; reporte: string }> }) {
  const { id, reporte } = await params;
  const { empresa, usuario, permisos } = await accesoEmpresa(id);
  if (!puede(permisos, "exportar")) return new Response("Tu perfil no permite descargar reportes", { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams) as Record<string, string>;
  const formato = ["pdf", "csv"].includes(sp.formato) ? sp.formato : "xlsx";
  const { desde, hasta } = leerPeriodo(sp);
  const ahora = new Date().toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" });
  const base = {
    empresa: empresa.nombre + (empresa.rnc ? ` · RNC ${empresa.rnc}` : ""),
    generado: `Generado por ${usuario.nombre} el ${ahora}`,
  };
  const periodo = `Del ${verFecha(desde)} al ${verFecha(hasta)}`;

  const armar = async (): Promise<[string, Tabla] | null> => {
    if (reporte === "diario") {
      const lineas = await conEmpresa(id, (tx) => libroDiario(tx, desde, hasta));
      const td = lineas.reduce((s, l) => s + Number(l.debe), 0);
      const th = lineas.reduce((s, l) => s + Number(l.haber), 0);
      return ["libro-diario", {
        ...base, titulo: "Libro diario", detalle: periodo, horizontal: true,
        columnas: [col("Fecha", false, 12), col("N.º", false, 8), col("Código", false, 10), col("Cuenta", false, 30), col("Concepto", false, 34), col("Descripción", false, 26), col("Debe", true), col("Haber", true)],
        filas: lineas.map((l) => [verFecha(l.fecha), l.numero, l.codigo, l.cuenta, l.concepto, l.descripcion ?? "", l.debe, l.haber]),
        totales: ["", "", "", "", "Totales", "", td.toFixed(2), th.toFixed(2)],
      }];
    }
    if (reporte === "mayor") {
      const mayor = await conEmpresa(id, (tx) => libroMayor(tx, sp.cuenta ?? "", desde, hasta)).catch(() => null);
      if (!mayor) return null;
      return [`libro-mayor-${mayor.cuenta.codigo}`, {
        ...base, titulo: `Libro mayor · ${mayor.cuenta.codigo} ${mayor.cuenta.nombre}`, detalle: periodo,
        columnas: [col("Fecha", false, 12), col("N.º", false, 8), col("Concepto", false, 36), col("Descripción", false, 26), col("Debe", true), col("Haber", true), col("Saldo", true)],
        filas: [
          [verFecha(desde), "", "Saldo inicial", "", "", "", deCentavos(mayor.inicial)],
          ...mayor.movimientos.map((m) => [verFecha(m.fecha), m.numero, m.concepto, m.descripcion ?? "", m.debe, m.haber, deCentavos(m.saldo)] as Celda[]),
        ],
        totales: ["", "", "Saldo final", "", deCentavos(mayor.cuenta.debe), deCentavos(mayor.cuenta.haber), deCentavos(mayor.final)],
      }];
    }
    if (reporte === "balanza") {
      const nivel = Math.min(6, Math.max(1, Number(sp.nivel) || 6));
      const { filas, totales } = await conEmpresa(id, (tx) => balanza(tx, desde, hasta, nivel, sp.ceros === "1"));
      return ["balanza-de-comprobacion", {
        ...base, titulo: "Balanza de comprobación", detalle: `${periodo} · valores en ${empresa.moneda}`, horizontal: true,
        columnas: [col("Código", false, 10), col("Cuenta", false, 34), col("Inicial deudor", true), col("Inicial acreedor", true), col("Debe", true), col("Haber", true), col("Final deudor", true), col("Final acreedor", true)],
        filas: filas.map((c) => [c.codigo, `${"  ".repeat(c.nivel - 1)}${c.nombre}`, deCentavos(c.inicialDeudor), deCentavos(c.inicialAcreedor), deCentavos(c.debe), deCentavos(c.haber), deCentavos(c.saldoDeudor), deCentavos(c.saldoAcreedor)]),
        totales: ["", "Totales", ...[totales.inicialDeudor, totales.inicialAcreedor, totales.debe, totales.haber, totales.saldoDeudor, totales.saldoAcreedor].map(deCentavos)],
      }];
    }
    if (reporte === "asientos") {
      const f = leerFiltros(sp);
      const { filas } = await conEmpresa(id, (tx) => buscarAsientos(tx, f, 10000));
      const detalle = [f.desde && `Desde ${verFecha(f.desde)}`, f.hasta && `hasta ${verFecha(f.hasta)}`, f.estado !== "todos" && `estado: ${f.estado}`, f.q && `texto: «${f.q}»`]
        .filter(Boolean).join(" · ") || "Todos los asientos";
      return ["asientos", {
        ...base, titulo: "Relación de asientos", detalle, horizontal: true,
        columnas: [col("N.º", false, 8), col("Fecha", false, 12), col("Concepto", false, 40), col("Referencia", false, 16), col("Registró", false, 20), col("Estado", false, 14), col("Adjuntos", false, 9), col("Total", true)],
        filas: filas.map((a) => [a.numero ?? "Borrador", verFecha(a.fecha), a.concepto, a.referencia ?? "", a.creado_por ?? "", estadoTexto(a), a.adjuntos, a.total ?? "0"]),
      }];
    }
    if (reporte === "historial") {
      if (!puede(permisos, "auditoria")) return null;
      const nombres = await conEmpresa(id, nombresHistorial);
      const cambios = await conEmpresa(id, (tx) => historial(tx, {
        desde: fechaValida(sp.desde) ? sp.desde : undefined,
        hasta: fechaValida(sp.hasta) ? sp.hasta : undefined,
        usuario: /^[0-9a-f-]{36}$/i.test(sp.usuario ?? "") ? sp.usuario : undefined,
        tabla: TABLAS[sp.tabla ?? ""] ? sp.tabla : undefined,
        accion: sp.accion && sp.accion in ACCIONES ? sp.accion : undefined,
      }, 5000));
      return ["historial-de-cambios", {
        ...base, titulo: "Historial de cambios", detalle: [sp.desde && `Desde ${verFecha(sp.desde)}`, sp.hasta && `hasta ${verFecha(sp.hasta)}`].filter(Boolean).join(" ") || "Todo el historial", horizontal: true,
        columnas: [col("Fecha y hora", false, 20), col("Usuario", false, 20), col("Acción", false, 24), col("Detalle", false, 70)],
        filas: cambios.map((c) => [c.fecha.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" }), c.usuario ?? "Sistema",
          `${ACCIONES[c.accion]} ${(TABLAS[c.tabla] ?? c.tabla).toLowerCase()}`, describir(c, nombres).join(" · ")]),
      }];
    }
    if (reporte === "antiguedad") {
      const corte = fechaValida(sp.corte) ? sp.corte : hasta;
      const { filas: clientes, totales, total } = await conEmpresa(id, (tx) => antiguedad(tx, corte));
      const filas: Celda[][] = [];
      for (const c of clientes) for (const f of c.facturas) {
        const t = f.dias <= 0 ? 0 : f.dias <= 30 ? 1 : f.dias <= 60 ? 2 : f.dias <= 90 ? 3 : 4;
        filas.push([c.cliente, f.ncf, verFecha(f.vence), Math.max(0, f.dias), ...TRAMOS.map((_, i) => (i === t ? deCentavos(f.saldoPesos) : "")), deCentavos(f.saldoPesos)]);
      }
      return [`antiguedad-de-saldos-${corte}`, {
        ...base, titulo: "Antigüedad de saldos (DOP)", detalle: `Al ${verFecha(corte)}`, horizontal: true,
        columnas: [col("Cliente", false, 28), col("NCF", false, 14), col("Vence", false, 12), col("Días vencida", false, 10), ...TRAMOS.map((x) => col(x, true)), col("Total", true)],
        filas, totales: ["Total", "", "", "", ...totales.map(deCentavos), deCentavos(total)],
      }];
    }
    if (reporte === "estado-cuenta") {
      const moneda = sp.moneda === "USD" ? "USD" : "DOP";
      const datos = await conEmpresa(id, async (tx) => {
        const [c] = await tx<{ id: string; nombre: string; rnc: string | null }[]>`SELECT id, nombre, rnc FROM clientes WHERE id = ${sp.cliente ?? null}::uuid`;
        return c ? { c, e: await estadoCuenta(tx, id, c.id, moneda, desde, hasta) } : null;
      }).catch(() => null);
      if (!datos) return null;
      return ["estado-de-cuenta", {
        ...base, titulo: `Estado de cuenta · ${datos.c.nombre}${datos.c.rnc ? ` (RNC ${datos.c.rnc})` : ""}`, detalle: `${periodo} · ${moneda}`,
        columnas: [col("Fecha", false, 12), col("Documento", false, 16), col("Detalle", false, 40), col("Cargos", true), col("Abonos", true), col("Saldo", true)],
        filas: [[verFecha(desde), "", "Saldo anterior", "", "", deCentavos(datos.e.inicial)],
          ...datos.e.movimientos.map((m) => [verFecha(m.fecha), m.documento, m.detalle, deCentavos(m.cargo), deCentavos(m.abono), deCentavos(m.saldo)] as Celda[])],
      }];
    }
    return null;
  };

  const armado = await armar();
  if (!armado) return new Response("Reporte no encontrado", { status: 404 });
  const [nombre, tabla] = armado;
  await conEmpresa(id, (tx) => bitacora(tx, id, usuario.id, "reporte_descargado", { reporte, formato }));
  const archivo = `${nombre}-${desde}-a-${hasta}`;
  const cabeceras = (tipo: string, ext: string) => ({
    "Content-Type": tipo,
    "Content-Disposition": `attachment; filename="${archivo}.${ext}"`,
    "Cache-Control": "private, no-store",
  });
  if (formato === "pdf") return new Response(new Uint8Array(await aPdf(tabla)), { headers: cabeceras("application/pdf", "pdf") });
  if (formato === "csv") return new Response(aCsv(tabla), { headers: cabeceras("text/csv; charset=utf-8", "csv") });
  return new Response(new Uint8Array(await aXlsx(tabla)), {
    headers: cabeceras("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"),
  });
}
