import Link from "next/link";
import { nombreMes } from "@/lib/bitacora";
import { conEmpresa } from "@/lib/db";
import { contadorMes } from "@/lib/facturas-subidas";
import { periodoDe } from "@/lib/igualas";
import { estadoDelMes } from "@/lib/impuestos-mes";
import { aCentavos, verFecha, verMonto } from "@/lib/montos";
import { cuentaConFirma } from "@/lib/reporte-mensual";

const ESTADO: Record<string, string> = { presentada: "Presentada", en_cero: "En cero", pendiente: "Pendiente", vencida: "Vencida" };
const mesAnterior = (periodo: string) => {
  const t = Number(periodo.slice(0, 4)) * 12 + Number(periodo.slice(4)) - 2;
  return `${Math.floor(t / 12)}${String((t % 12) + 1).padStart(2, "0")}`;
};

// Resumen del cliente (rediseño R3, n.º 15 de la Lista de rediseños): el trabajo del mes, no cifras contables. Facturas subidas y por
// revisar, impuestos del mes y su estado, trámites abiertos, pendientes de la bitácora y si la iguala con Empire está al día.
export async function ResumenTrabajo({ id, nombre, hoy, ve }: { id: string; nombre: string; hoy: string; ve: (r: string) => boolean }) {
  const mes = hoy.slice(0, 7);
  const periodoImpuestos = mesAnterior(periodoDe(hoy)); // se declara el mes anterior
  const base = `/e/${id}`;
  const d = await conEmpresa(id, async (tx) => {
    const [t] = await tx<{ abiertos: number; vencidos: number; proximo: string | null }[]>`
      SELECT count(*)::int AS abiertos, count(*) FILTER (WHERE plazo < ${hoy})::int AS vencidos, to_char(min(plazo), 'YYYY-MM-DD') AS proximo
        FROM tramites WHERE estado = 'abierto'`;
    const [g] = await tx<{ pendientes: number; atrasadas: number }[]>`
      SELECT count(*) FILTER (WHERE estado <> 'hecha')::int AS pendientes,
             count(*) FILTER (WHERE estado <> 'hecha' AND entrega IS NOT NULL AND entrega < ${hoy})::int AS atrasadas FROM gestiones`;
    const [r] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM recepciones WHERE estado IN ('nuevo', 'en_proceso')`;
    return { facturas: await contadorMes(tx, mes), impuestos: await estadoDelMes(tx, periodoImpuestos, hoy), tramites: t, gestiones: g, documentos: r.n };
  });
  const cuenta = await cuentaConFirma(id, periodoDe(hoy), hoy);
  const vencidas = cuenta?.facturas.filter((f) => f.fecha < hoy && aCentavos(f.saldo) > 0n) ?? [];
  const tarjeta = (href: string | null, etiqueta: string, valor: React.ReactNode, sub?: React.ReactNode, alerta = false) => {
    const cuerpo = <><div className="etiqueta">{etiqueta}</div><div className="valor" style={alerta ? { color: "var(--peligro)" } : undefined}>{valor}</div>{sub && <div className="sub" style={{ margin: 0 }}>{sub}</div>}</>;
    return href ? <Link href={href} className="tarjeta cifra" style={{ color: "inherit", textDecoration: "none" }}>{cuerpo}</Link> : <div className="tarjeta cifra">{cuerpo}</div>;
  };
  const decl = d.impuestos.declaraciones;
  const faltan = decl.filter((x) => x.estado === "pendiente" || x.estado === "vencida");

  return (
    <>
      <h1>Resumen del cliente</h1>
      <p className="sub">{nombre} · el trabajo de {nombreMes(mes)} al {verFecha(hoy)}</p>
      <div className="cifras">
        {tarjeta(ve("/facturas-subidas") ? `${base}/facturas-subidas` : null, `Facturas subidas en ${nombreMes(mes)}`, d.facturas.gastos + d.facturas.ingresos,
          `${d.facturas.revision} por revisar · ${d.facturas.gastos} de gastos · ${d.facturas.ingresos} de ventas`, d.facturas.revision > 0)}
        {tarjeta(ve("/recepcion") ? `${base}/recepcion` : null, "Documentos por procesar", d.documentos)}
        {tarjeta(ve("/dgii") ? `${base}/dgii` : null, `Impuestos de ${nombreMes(`${periodoImpuestos.slice(0, 4)}-${periodoImpuestos.slice(4)}`)}`,
          decl.length ? `${decl.length - faltan.length} de ${decl.length}` : "—",
          decl.length ? (faltan.length ? `${faltan.length} por presentar${faltan.some((x) => x.estado === "vencida") ? ", alguna vencida" : ""}` : "Todo presentado") : "Sin declaraciones confirmadas en el perfil fiscal",
          faltan.some((x) => x.estado === "vencida"))}
        {tarjeta(ve("/expediente") ? `${base}/expediente` : null, "Trámites abiertos", d.tramites.abiertos,
          d.tramites.vencidos ? `${d.tramites.vencidos} con el plazo vencido` : d.tramites.proximo ? `El próximo vence el ${verFecha(d.tramites.proximo)}` : undefined, d.tramites.vencidos > 0)}
        {tarjeta(ve("/bitacora") ? `${base}/bitacora` : null, "Pendientes de la bitácora", d.gestiones.pendientes,
          d.gestiones.atrasadas ? `${d.gestiones.atrasadas} atrasada${d.gestiones.atrasadas > 1 ? "s" : ""}` : undefined, d.gestiones.atrasadas > 0)}
        {cuenta && tarjeta(null, "Iguala y cuenta con Empire", aCentavos(cuenta.saldo) > 0n ? `RD$${verMonto(cuenta.saldo)}` : "Al día",
          vencidas.length ? `${vencidas.length} factura${vencidas.length > 1 ? "s" : ""} vencida${vencidas.length > 1 ? "s" : ""}` : aCentavos(cuenta.saldo) > 0n ? "Pendiente, sin vencer" : undefined,
          vencidas.length > 0)}
      </div>

      {decl.length > 0 && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Declaraciones del mes</h2>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Formulario</th><th>Vence</th><th>Estado</th><th className="num">A pagar</th></tr></thead>
              <tbody>
                {decl.map((x) => (
                  <tr key={x.formato}>
                    <td>{ve("/dgii") ? <Link href={`${base}${x.ruta}`}>{x.nombre}</Link> : x.nombre}</td>
                    <td>{verFecha(x.vence)}</td>
                    <td className={x.estado === "vencida" ? "error" : undefined}>{ESTADO[x.estado]}</td>
                    <td className="num">{x.monto ? verMonto(x.monto) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.impuestos.sugeridas && <p className="sub" style={{ margin: "8px 0 0" }}>Son las que sugiere su perfil fiscal: confírmalas en Perfil fiscal.</p>}
        </div>
      )}

      <div className="fila">
        {ve("/facturas-subidas") && <Link className="boton primario" href={`${base}/facturas-subidas`}>Revisar sus facturas</Link>}
        {ve("/facturas") && <Link className="boton" href={`${base}/facturas/nueva`}>+ Nueva factura</Link>}
        {ve("/compras") && <Link className="boton" href={`${base}/compras/nueva`}>+ Nueva compra</Link>}
        {ve("/bitacora") && <Link className="boton" href={`${base}/bitacora`}>Bitácora</Link>}
      </div>
    </>
  );
}
