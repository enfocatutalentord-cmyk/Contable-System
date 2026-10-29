import { accesoEmpresa } from "@/lib/acceso";
import { bitacora } from "@/lib/asientos";
import { ACCIONES, describir, historial, nombresHistorial, TABLAS } from "@/lib/auditoria";
import { buscarAsientos, estadoTexto, leerFiltros } from "@/lib/busqueda-asientos";
import { antiguedad, estadoCuenta, TRAMOS } from "@/lib/cxc";
import { antiguedadCxp, estadoCuentaProveedor } from "@/lib/cxp";
import { conEmpresa } from "@/lib/db";
import { aCsv, aPdf, aXlsx, type Celda, type Columna, type Tabla } from "@/lib/exportar";
import { FORMAS_PAGO } from "@/lib/compras";
import { listarCuentas } from "@/lib/cuentas";
import { balanza, libroDiario, libroMayor } from "@/lib/libros";
import {
  estadoCompra, estadoFactura, ESTADOS_COMPRA, ESTADOS_FACTURA, leerFiltrosDocumentos, leerFiltrosPagos,
  listarCobros, listarCompras, listarFacturas, listarPagos,
} from "@/lib/listas";
import { aCentavos, deCentavos, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { fechaValida } from "@/lib/reportes";
import { leerPeriodo } from "../../periodo";

const SIN_PERIODO = /^(facturas|compras|cobros|pagos|catalogo)$/;
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
    if (reporte === "antiguedad-cxp") {
      const corte = fechaValida(sp.corte) ? sp.corte : hasta;
      const { filas: proveedores, totales, total } = await conEmpresa(id, (tx) => antiguedadCxp(tx, corte));
      const filas: Celda[][] = [];
      for (const p of proveedores) for (const c of p.compras) {
        const t = c.dias <= 0 ? 0 : c.dias <= 30 ? 1 : c.dias <= 60 ? 2 : c.dias <= 90 ? 3 : 4;
        filas.push([p.proveedor, c.ncf, verFecha(c.vence), Math.max(0, c.dias), ...TRAMOS.map((_, i) => (i === t ? deCentavos(c.saldoPesos) : "")), deCentavos(c.saldoPesos)]);
      }
      return [`antiguedad-cuentas-por-pagar-${corte}`, {
        ...base, titulo: "Antigüedad de cuentas por pagar (DOP)", detalle: `Al ${verFecha(corte)}`, horizontal: true,
        columnas: [col("Proveedor", false, 28), col("NCF", false, 14), col("Vence", false, 12), col("Días vencida", false, 10), ...TRAMOS.map((x) => col(x, true)), col("Total", true)],
        filas, totales: ["Total", "", "", "", ...totales.map(deCentavos), deCentavos(total)],
      }];
    }
    if (reporte === "estado-cuenta-proveedor") {
      const moneda = sp.moneda === "USD" ? "USD" : "DOP";
      const datos = await conEmpresa(id, async (tx) => {
        const [p] = await tx<{ id: string; nombre: string; rnc: string | null }[]>`SELECT id, nombre, rnc FROM proveedores WHERE id = ${sp.proveedor ?? null}::uuid`;
        return p ? { p, e: await estadoCuentaProveedor(tx, id, p.id, moneda, desde, hasta) } : null;
      }).catch(() => null);
      if (!datos) return null;
      return ["estado-de-cuenta-proveedor", {
        ...base, titulo: `Estado de cuenta · ${datos.p.nombre}${datos.p.rnc ? ` (RNC ${datos.p.rnc})` : ""}`, detalle: `${periodo} · ${moneda}`,
        columnas: [col("Fecha", false, 12), col("Documento", false, 16), col("Detalle", false, 40), col("Compras", true), col("Pagos y notas", true), col("Saldo", true)],
        filas: [[verFecha(desde), "", "Saldo anterior", "", "", deCentavos(datos.e.inicial)],
          ...datos.e.movimientos.map((m) => [verFecha(m.fecha), m.documento, m.detalle, deCentavos(m.cargo), deCentavos(m.abono), deCentavos(m.saldo)] as Celda[])],
      }];
    }
    if (reporte === "facturas" || reporte === "compras") {
      const ventas = reporte === "facturas";
      const estados = ventas ? ESTADOS_FACTURA : ESTADOS_COMPRA;
      const f = leerFiltrosDocumentos(sp, estados);
      const lista = ventas
        ? (await conEmpresa(id, (tx) => listarFacturas(tx, f))).map((d) => ({ ...d, tipo: d.tipo_ncf, nombre: d.cliente, nota: d.tipo_ncf === "B04", texto: estadoFactura(d, f.hoy) }))
        : (await conEmpresa(id, (tx) => listarCompras(tx, f))).map((d) => ({ ...d, tipo: d.tipo_comprobante, nombre: d.proveedor, nota: d.origen !== null, texto: estadoCompra(d, f.hoy) }));
      const filas: Celda[][] = [];
      const t = [0n, 0n, 0n, 0n, 0n];
      for (const d of lista) {
        const vigente = d.estado !== "borrador" && !d.anulada;
        const montos = [d.subtotal, d.itbis, d.otros, d.total].map((m) => (d.nota ? -aCentavos(m) : aCentavos(m)));
        const saldo = vigente && !d.nota ? aCentavos(d.saldo ?? "0") : 0n;
        if (vigente && d.moneda === "DOP") { montos.forEach((m, i) => (t[i] += m)); t[4] += saldo; }
        filas.push([d.ncf ?? `Borrador ${d.tipo}`, verFecha(d.fecha), d.nombre, d.rnc ?? "", d.nota ? "" : verFecha(d.vence), d.moneda,
          ...montos.map(deCentavos), vigente && !d.nota ? deCentavos(saldo) : "", d.texto]);
      }
      const detalle = [f.mes ? `Mes ${f.mes.slice(5)}/${f.mes.slice(0, 4)}` : "Todos los meses", f.estado !== "todas" && estados[f.estado], f.q && `búsqueda: «${f.q}»`]
        .filter(Boolean).join(" · ");
      return [`${reporte}-${f.mes || "todos-los-meses"}`, {
        ...base, titulo: ventas ? "Facturas y notas de crédito" : "Compras y gastos", detalle: `${detalle} · totales de lo vigente en DOP`, horizontal: true,
        columnas: [col("NCF", false, 16), col("Fecha", false, 12), col(ventas ? "Cliente" : "Proveedor", false, 30), col("RNC/Cédula", false, 14),
          col("Vence", false, 12), col("Moneda", false, 8), col("Subtotal", true), col("ITBIS", true), col("Otros impuestos", true), col("Total", true), col("Saldo", true), col("Estado", false, 16)],
        filas, totales: ["Totales", "", "", "", "", "DOP", ...t.map(deCentavos), ""],
      }];
    }
    if (reporte === "cobros" || reporte === "pagos") {
      const ventas = reporte === "cobros";
      const f = leerFiltrosPagos(sp);
      const lista = ventas
        ? (await conEmpresa(id, (tx) => listarCobros(tx, f))).map((p) => ({ ...p, nombre: p.cliente, monto: p.recibido, documentos: p.facturas, forma: p.forma_pago.charAt(0).toUpperCase() + p.forma_pago.slice(1) }))
        : (await conEmpresa(id, (tx) => listarPagos(tx, f))).map((p) => ({ ...p, nombre: p.proveedor, monto: p.pagado, documentos: p.compras, forma: FORMAS_PAGO[p.forma_pago] ?? p.forma_pago }));
      let monto = 0n, retenido = 0n;
      const filas = lista.map((p): Celda[] => {
        if (!p.anulado && p.moneda === "DOP") { monto += aCentavos(p.monto); retenido += aCentavos(p.retenciones); }
        return [p.numero, verFecha(p.fecha), p.nombre, p.documentos ?? "", p.forma, p.referencia ?? "", p.moneda, p.monto, p.retenciones, p.anulado ? "Anulado" : "Vigente"];
      });
      return [`${reporte}-${f.mes}`, {
        ...base, titulo: ventas ? "Cobros (recibos de ingreso)" : "Pagos a proveedores",
        detalle: `Mes ${f.mes.slice(5)}/${f.mes.slice(0, 4)}${f.q ? ` · búsqueda: «${f.q}»` : ""} · totales de lo vigente en DOP`, horizontal: true,
        columnas: [col(ventas ? "Recibo" : "Pago", false, 8), col("Fecha", false, 12), col(ventas ? "Cliente" : "Proveedor", false, 30),
          col(ventas ? "Facturas" : "Compras", false, 26), col("Forma de pago", false, 18), col("Referencia", false, 16), col("Moneda", false, 8),
          col(ventas ? "Recibido" : "Pagado", true), col(ventas ? "Retenciones" : "Retenido", true), col("Estado", false, 10)],
        filas, totales: ["Totales", "", "", "", "", "", "DOP", deCentavos(monto), deCentavos(retenido), ""],
      }];
    }
    if (reporte === "catalogo") {
      const cuentas = await conEmpresa(id, listarCuentas);
      const tipos: Record<string, string> = { activo: "Activo", pasivo: "Pasivo", patrimonio: "Patrimonio", ingreso: "Ingreso", costo: "Costo", gasto: "Gasto" };
      return ["catalogo-de-cuentas", {
        ...base, titulo: "Catálogo de cuentas", detalle: `${cuentas.length} cuentas`,
        columnas: [col("Código", false, 12), col("Cuenta", false, 46), col("Tipo", false, 12), col("Nivel", false, 7), col("Uso", false, 10), col("Estado", false, 10)],
        filas: cuentas.map((c) => [c.codigo, `${"  ".repeat(c.nivel - 1)}${c.nombre}`, tipos[c.tipo] ?? c.tipo, c.nivel, c.de_detalle ? "Detalle" : "Grupo", c.activa ? "Activa" : "Inactiva"]),
      }];
    }
    return null;
  };

  const armado = await armar();
  if (!armado) return new Response("Reporte no encontrado", { status: 404 });
  const [nombre, tabla] = armado;
  await conEmpresa(id, (tx) => bitacora(tx, id, usuario.id, "reporte_descargado", { reporte, formato }));
  // Las listas y el catálogo llevan su propio mes (o ninguno) en el nombre; los reportes, el período.
  const archivo = SIN_PERIODO.test(reporte) ? nombre : `${nombre}-${desde}-a-${hasta}`;
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
