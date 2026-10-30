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
import { armarFormato, aTxt, FORMATOS, nombreTxt, periodoDe, type Formato } from "@/lib/formatos-dgii";
import { calcularDeclaracion, FORMULARIOS } from "@/lib/declaraciones";
import { esRelleno } from "@/lib/it1";
import { anexoIr6 } from "@/lib/ir17";
import { balanza, libroDiario, libroMayor } from "@/lib/libros";
import {
  estadoCompra, estadoFactura, ESTADOS_COMPRA, ESTADOS_FACTURA, leerFiltrosDocumentos, leerFiltrosPagos,
  listarCobros, listarCompras, listarFacturas, listarPagos,
} from "@/lib/listas";
import { aCentavos, deCentavos, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { fechaValida } from "@/lib/reportes";
import { reporteConciliacion } from "@/lib/reporte-conciliacion";
import { armarEstado, leerFiltrosEstados, TITULOS } from "@/lib/estados-pantalla";
import { porcentaje, variacion } from "@/lib/estados";
import { esUuid } from "@/lib/acceso";
import { leerPeriodo } from "../../periodo";

const SIN_PERIODO = /^(facturas|compras|cobros|pagos|catalogo|dgii-60[678]|it1|ir17|ir6|conciliacion-banco|estado-financiero)$/;
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
    const dgii = /^dgii-(606|607|608)$/.exec(reporte)?.[1] as Formato | undefined;
    if (dgii) {
      const per = periodoDe(sp.periodo ?? "");
      if (!per) return null;
      const a = await conEmpresa(id, (tx) => armarFormato(tx, dgii, per));
      const rnc = empresa.rnc ?? "";
      return [`DGII_F_${dgii}_${rnc}_${per.periodo}`, {
        ...base, titulo: `Formato ${dgii} · ${FORMATOS[dgii]}`, horizontal: true,
        detalle: `Encabezado: RNC o Cédula ${rnc || "(falta en la ficha)"} · Período ${per.periodo} · Cantidad de registros ${a.filas.length}`,
        columnas: a.columnas.map(([, t, tipo], i) => col(`${i + 1}. ${t}`, tipo === "monto", tipo === "monto" ? 14 : Math.max(10, Math.min(28, t.length)))),
        filas: a.filas.map((f) => f.map((v, i) => (a.columnas[i][2] === "monto" ? deCentavos(v as bigint) : (v as string)))),
      }];
    }
    if (reporte === "it1" || reporte === "ir17") {
      const per = periodoDe(sp.periodo ?? "");
      if (!per) return null;
      const formulario = reporte === "it1" ? "IT-1" : "IR-17";
      const def = FORMULARIOS[formulario];
      const r = await conEmpresa(id, (tx) => calcularDeclaracion(tx, formulario, per));
      const val = (k: string) => {
        const x = r.valores[k] ?? 0n;
        return k.endsWith("c") ? String(x / 100n) : deCentavos(x);
      };
      const filas: Celda[][] = [];
      for (const s of def.secciones) {
        const hoja = def.hojas.find(([h]) => h === s.hoja)?.[1] ?? "";
        filas.push([hoja, "", s.titulo, "", "", "", "", ""]);
        for (const f of s.renglones) {
          const cols = f.columnas.filter((c) => !esRelleno(c.clave));
          const fila: Celda[] = [hoja, f.n, f.texto, "", "", "", "", ""];
          if (cols.length === 4) cols.forEach((c, i) => (fila[4 + i] = val(c.clave)));
          else if (cols.length === 3) { fila[3] = val(cols[0].clave); fila[4] = val(cols[1].clave); fila[7] = val(cols[2].clave); }
          else if (cols.length === 2) { fila[3] = val(cols[0].clave); fila[7] = val(cols[1].clave); }
          else if (cols[0].tipo === "porcentaje") fila[3] = val(cols[0].clave);
          else fila[7] = val(cols[0].clave);
          filas.push(fila);
        }
      }
      const ir17 = formulario === "IR-17";
      return [`${formulario}_${empresa.rnc ?? ""}_${per.periodo}`, {
        ...base, titulo: `${def.nombre} (borrador)`, horizontal: true,
        detalle: `Período ${per.periodo} · formulario oficial de la DGII · montos en DOP`,
        columnas: [col("Hoja", false, 14), col("Casilla", false, 8), col("Descripción", false, 60),
          col(ir17 ? "Monto imponible" : "Cantidad, total facturado o %", true), col(ir17 ? "Tasa %" : "Compras locales", true),
          col("Servicios", true), col("Importaciones", true), col("Monto / total", true)],
        filas,
      }];
    }
    if (reporte === "ir6") {
      const per = periodoDe(sp.periodo ?? "");
      if (!per) return null;
      const filas = await conEmpresa(id, (tx) => anexoIr6(tx, per));
      return [`IR-6_${empresa.rnc ?? ""}_${per.periodo}`, {
        ...base, titulo: "IR-6 · Formato para el cálculo mensual de otras retenciones", horizontal: true,
        detalle: `Período ${per.periodo} · anexo del IR-17 · montos en DOP`,
        columnas: [col("Fecha", false, 12), col("Forma de pago", false, 20), col("Beneficiario", false, 30), col("RNC/Cédula o pasaporte", false, 16),
          col("Dirección", false, 26), col("Código concepto", false, 9), col("Monto del pago", true), col("Monto sujeto a retención", true),
          col("Tasa %", true), col("Impuesto retenido", true)],
        filas: filas.map((f) => [verFecha(f.fecha), f.formaPago, f.beneficiario, f.identificacion, f.direccion, f.codigo ?? "",
          deCentavos(f.montoPago), deCentavos(f.sujeto), deCentavos(f.tasa), deCentavos(f.retenido)]),
        totales: ["", "", "", "", "", "Totales", deCentavos(filas.reduce((t, f) => t + f.montoPago, 0n)),
          deCentavos(filas.reduce((t, f) => t + f.sujeto, 0n)), "", deCentavos(filas.reduce((t, f) => t + f.retenido, 0n))],
      }];
    }
    if (reporte === "estado-financiero") {
      const f = leerFiltrosEstados(sp);
      const { estado, firmas } = await conEmpresa(id, (tx) => armarEstado(tx, f));
      const cols = estado.columnas;
      const dos = cols.length === 2, conPct = f.tipo === "resultados" && cols.length === 1;
      const columnas = [col("", false, 46), ...cols.map((c) => col(c.titulo, true)),
        ...(conPct ? [col("% de ingresos", false, 14)] : []), ...(dos ? [col("Variación", true), col("%", false, 10)] : [])];
      const filas: Celda[][] = estado.filas.map((r) => {
        const sangria = r.tipo === "cuenta" ? "   " : "";
        if (r.tipo === "seccion") return [r.texto, ...cols.map(() => ""), ...(conPct ? [""] : []), ...(dos ? ["", ""] : [])];
        const v = dos ? variacion(r.valores) : null;
        return [sangria + r.texto, ...r.valores.map(deCentavos), ...(conPct ? [porcentaje(r.valores[0], estado.base?.[0] ?? 0n)] : []),
          ...(v ? [deCentavos(v.monto), v.pct] : [])];
      });
      const detalle = f.tipo === "resultados" ? `Del ${verFecha(cols[0].desde)} al ${verFecha(cols[0].hasta)}` : `Al ${verFecha(cols[0].hasta)}`;
      return [`${f.tipo === "resultados" ? "estado-de-resultados" : "estado-de-situacion"}-${cols[0].hasta}`, {
        ...base, titulo: TITULOS[f.tipo], detalle: `${detalle} · valores en ${empresa.moneda}`, horizontal: cols.length > 3,
        columnas, filas, negritas: estado.filas.flatMap((r, i) => (r.tipo === "cuenta" ? [] : [i])),
        firmas: [
          { rol: "Preparado por", nombre: firmas.firma_preparado ?? "", detalle: firmas.firma_icpard ? `ICPARD ${firmas.firma_icpard}` : undefined },
          { rol: "Aprobado por", nombre: firmas.firma_aprobado ?? "", detalle: firmas.firma_cargo ?? undefined },
        ],
      }];
    }
    if (reporte === "conciliacion-banco") {
      if (!esUuid(sp.cuenta ?? "") || !/^\d{4}(0[1-9]|1[0-2])$/.test(sp.mes ?? "")) return null;
      const r = await conEmpresa(id, (tx) => reporteConciliacion(tx, sp.cuenta, sp.mes)).catch(() => null);
      if (!r) return null;
      const m = (c: bigint) => deCentavos(c);
      const suma = (xs: { monto: bigint }[]) => xs.reduce((t, x) => t + x.monto, 0n);
      const filas: Celda[][] = [
        ["", `Saldo según el banco al ${verFecha(r.fin)}`, "", "", m(r.saldoBanco)],
        ...r.depositosTransito.map((x) => [verFecha(x.fecha), `(+) Depósito en tránsito: ${x.documento ?? x.concepto} · asiento ${x.numero}`, x.referencia ?? "", m(x.monto), ""] as Celda[]),
        ...r.pagosTransito.map((x) => [verFecha(x.fecha), `(−) Pago en tránsito: ${x.documento ?? x.concepto} · asiento ${x.numero}`, x.referencia ?? "", m(x.monto), ""] as Celda[]),
        ["", "Saldo del banco ajustado", "", "", m(r.bancoAjustado)],
        ["", `Saldo en libros al ${verFecha(r.fin)}`, "", "", m(r.saldoLibros)],
        ...r.bancoNoLibros.map((x) => [verFecha(x.fecha), `(±) En el banco y no en libros: ${x.descripcion} (${x.motivo})`, x.referencia ?? "", m(x.monto), ""] as Celda[]),
        ...(r.apertura.diferencia !== 0n ? [["", `(±) Diferencia al empezar a conciliar el ${verFecha(r.cuenta.fecha_inicial)}`, "", m(-r.apertura.diferencia), ""] as Celda[]] : []),
        ["", "Saldo en libros ajustado", "", "", m(r.librosAjustado)],
      ];
      const estado = r.cierre ? `cerrada el ${new Date(r.cierre.cerrado_en).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo" })}` : "sin cerrar";
      return [`conciliacion-${r.cuenta.nombre.replace(/[^\w-]+/g, "-")}-${r.periodo}`, {
        ...base, titulo: `Conciliación bancaria · ${r.cuenta.nombre} (${r.cuenta.banco})`,
        detalle: `Al ${verFecha(r.fin)} · cuenta ${r.cuenta.codigo} · ${r.cuenta.moneda} · ${estado} · depósitos en tránsito ${m(suma(r.depositosTransito))}, pagos en tránsito ${m(suma(r.pagosTransito))}`,
        columnas: [col("Fecha", false, 12), col("Concepto", false, 60), col("Referencia", false, 14), col("Partida", true), col("Saldo", true)],
        filas,
        totales: r.comparable ? ["", "Diferencia", "", "", m(r.diferencia)] : undefined,
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

  // Archivo de texto para subir en la Oficina Virtual (606, 607 y 608), como el que genera la herramienta de la DGII.
  const txt = /^dgii-(606|607|608)$/.exec(reporte)?.[1] as Formato | undefined;
  if (txt && sp.formato === "txt") {
    const per = periodoDe(sp.periodo ?? "");
    if (!per || !empresa.rnc) return new Response("Falta el período o el RNC de la empresa", { status: 404 });
    const a = await conEmpresa(id, (tx) => armarFormato(tx, txt, per));
    if (a.avisos.some((x) => x.nivel === "error")) return new Response("Corrige primero los errores del formato", { status: 409 });
    await conEmpresa(id, (tx) => bitacora(tx, id, usuario.id, "reporte_descargado", { reporte, formato: "txt" }));
    return new Response(aTxt(a, empresa.rnc, per.periodo), {
      headers: {
        "Content-Type": "text/plain; charset=us-ascii",
        "Content-Disposition": `attachment; filename="${nombreTxt(txt, empresa.rnc, per.periodo)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
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
