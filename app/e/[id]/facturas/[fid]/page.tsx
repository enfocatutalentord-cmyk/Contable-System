import { exigirModulo } from "@/lib/modulos";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { BotonImprimir } from "@/app/imprimir";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { MOTIVOS_608, NOMBRE_NCF, type TipoNcf } from "@/lib/ventas";
import { anularComprobante, crearNotaCredito } from "../../ventas-acciones";

type Factura = {
  id: string; tipo_ncf: TipoNcf; ncf: string; ncf_vence: string; fecha: string; vence: string; moneda: string; tasa: string;
  subtotal: string; itbis: string; total: string; notas: string | null; anulada: boolean; motivo_anulacion: string | null;
  asiento: number | null; asiento_id: string | null; cliente: string; rnc: string | null; direccion: string | null; email: string | null;
  origen_id: string | null; origen_ncf: string | null; creado_por: string | null; saldo: string | null;
};

export default async function VerFactura({ params, searchParams }: {
  params: Promise<{ id: string; fid: string }>;
  searchParams: Promise<{ nueva?: string; anulada?: string }>;
}) {
  exigirModulo("ventas");
  const { id, fid } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(fid)) notFound();
  const { empresa, permisos } = await accesoEmpresa(id);
  const datos = await conEmpresa(id, async (tx) => {
    const [f] = await tx<Factura[]>`
      SELECT f.id, f.tipo_ncf, f.ncf, to_char(f.ncf_vence, 'YYYY-MM-DD') AS ncf_vence, to_char(f.fecha, 'YYYY-MM-DD') AS fecha,
             to_char(f.vence, 'YYYY-MM-DD') AS vence, f.moneda, f.tasa::text, f.subtotal::text, f.itbis::text, f.total::text,
             f.notas, f.anulada, f.motivo_anulacion, a.numero AS asiento, a.id AS asiento_id, c.nombre AS cliente, c.rnc, c.direccion, c.email,
             o.id AS origen_id, o.ncf AS origen_ncf, u.nombre AS creado_por, s.saldo::text
        FROM facturas f JOIN clientes c ON c.id = f.cliente_id
        LEFT JOIN asientos a ON a.id = f.asiento_id
        LEFT JOIN facturas o ON o.id = f.factura_origen_id
        LEFT JOIN usuarios u ON u.id = f.creado_por
        LEFT JOIN saldos_factura s ON s.factura_id = f.id
       WHERE f.id = ${fid}`;
    if (!f) return null;
    const lineas = await tx<{ descripcion: string; cantidad: string; precio: string; tasa_itbis: string; subtotal: string; itbis: string }[]>`
      SELECT descripcion, cantidad::text, precio::text, tasa_itbis::text, subtotal::text, itbis::text
        FROM lineas_factura WHERE factura_id = ${fid} ORDER BY orden`;
    const movimientos = await tx<{ tipo: string; documento: string; enlace: string; fecha: string; monto: string }[]>`
      SELECT 'Cobro' AS tipo, 'Recibo ' || c.numero AS documento, '/cobros/' || c.numero AS enlace,
             to_char(c.fecha, 'YYYY-MM-DD') AS fecha, a.monto::text AS monto
        FROM aplicaciones_cobro a JOIN cobros c ON c.id = a.cobro_id WHERE a.factura_id = ${fid} AND NOT c.anulado
      UNION ALL
      SELECT 'Nota de crédito', n.ncf, '/facturas/' || n.id, to_char(n.fecha, 'YYYY-MM-DD'), n.total::text
        FROM facturas n WHERE n.factura_origen_id = ${fid} AND NOT n.anulada
      ORDER BY 4`;
    return { f, lineas, movimientos };
  });
  if (!datos) notFound();
  const { f, lineas, movimientos } = datos;
  const esNota = f.tipo_ncf === "B04";
  const simbolo = f.moneda === "USD" ? "US$" : "RD$";
  const saldo = Number(f.saldo ?? 0);
  const fueraDeCierre = !empresa.fecha_bloqueo || f.fecha > empresa.fecha_bloqueo;

  return (
    <>
      <div className="no-imprimir">
        <p><Link href={`/e/${id}/facturas`}>← Facturas</Link></p>
        {sp.nueva && <p className="exito">{esNota ? "Nota de crédito emitida" : "Factura emitida"} con NCF {f.ncf}{f.asiento && <> y asiento n.º {f.asiento}</>}.</p>}
        {sp.anulada && <p className="exito">Comprobante anulado. Va en el formato 608 del mes.</p>}
        {f.anulada && <p className="aviso">Anulado: {MOTIVOS_608[f.motivo_anulacion ?? ""] ?? f.motivo_anulacion}. El asiento también quedó anulado.</p>}
        <div className="fila" style={{ marginBottom: 16 }}>
          <BotonImprimir />
          {!esNota && !f.anulada && saldo > 0 && puede(permisos, "registrar") && (
            <Link className="boton primario" href={`/e/${id}/cobros/nuevo?factura=${f.id}`}>Registrar cobro</Link>
          )}
          {f.asiento && <Link className="boton" href={`/e/${id}/asientos/${f.asiento_id}`}>Ver asiento n.º {f.asiento}</Link>}
        </div>
      </div>

      <div className="documento">
        <div className="cabecera">
          <div>
            <h2>{empresa.nombre}</h2>
            {empresa.rnc && <div>RNC {empresa.rnc}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <h2>{esNota ? "Nota de crédito" : `Factura de ${NOMBRE_NCF[f.tipo_ncf].toLowerCase()}`}{f.anulada && " (ANULADA)"}</h2>
            <div>NCF <strong>{f.ncf}</strong></div>
            <div>Válido hasta {verFecha(f.ncf_vence)}</div>
          </div>
        </div>
        <div className="cabecera">
          <dl>
            <dt>Cliente</dt><dd>{f.cliente}</dd>
            {f.rnc && <><dt>RNC / cédula</dt><dd>{f.rnc}</dd></>}
            {f.direccion && <><dt>Dirección</dt><dd>{f.direccion}</dd></>}
          </dl>
          <dl>
            <dt>Fecha</dt><dd>{verFecha(f.fecha)}</dd>
            {!esNota && <><dt>Vence</dt><dd>{verFecha(f.vence)}</dd></>}
            {esNota && f.origen_ncf && <><dt>NCF modificado</dt><dd><Link href={`/e/${id}/facturas/${f.origen_id}`}>{f.origen_ncf}</Link></dd></>}
            <dt>Moneda</dt><dd>{f.moneda}{f.moneda === "USD" && ` (tasa ${Number(f.tasa).toFixed(2)})`}</dd>
          </dl>
        </div>
        <div className="tabla-envoltura">
          <table>
            <thead><tr><th>Descripción</th><th className="num">Cantidad</th><th className="num">Precio</th><th className="num">ITBIS</th><th className="num">Importe</th></tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td>{l.descripcion}</td>
                  <td className="num">{Number(l.cantidad).toLocaleString("es-DO", { maximumFractionDigits: 4 })}</td>
                  <td className="num">{verMonto(l.precio)}</td>
                  <td className="num">{Number(l.tasa_itbis) ? `${verMonto(l.itbis)} (${Number(l.tasa_itbis)} %)` : "Exento"}</td>
                  <td className="num">{verMonto(l.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={4}>Subtotal</td><td className="num">{verMonto(f.subtotal)}</td></tr>
              <tr><td colSpan={4}>ITBIS</td><td className="num">{verMonto(f.itbis)}</td></tr>
              <tr><td colSpan={4}>Total {simbolo}</td><td className="num">{verMonto(f.total)}</td></tr>
            </tfoot>
          </table>
        </div>
        {f.notas && <p>{f.notas}</p>}
      </div>

      {!esNota && (
        <div className="no-imprimir">
          <h2>Cobros y notas de crédito</h2>
          <div className="tabla-envoltura">
            <table>
              <tbody>
                {movimientos.map((m, i) => (
                  <tr key={i}>
                    <td>{verFecha(m.fecha)}</td>
                    <td>{m.tipo} <Link href={`/e/${id}${m.enlace}`}>{m.documento}</Link></td>
                    <td className="num">{verMonto(m.monto)}</td>
                  </tr>
                ))}
                {movimientos.length === 0 && <tr><td>Sin cobros todavía.</td></tr>}
              </tbody>
              {!f.anulada && <tfoot><tr><td colSpan={2}>Saldo pendiente {simbolo}</td><td className="num">{verMonto(f.saldo)}</td></tr></tfoot>}
            </table>
          </div>
        </div>
      )}

      {!f.anulada && puede(permisos, "revertir") && (
        <div className="no-imprimir">
          {!esNota && saldo > 0 && (
            <>
              <h2>Nota de crédito (B04)</h2>
              <p className="sub">Para descuentos, devoluciones o corregir un monto. Rebaja el saldo de esta factura (hasta {simbolo} {verMonto(f.saldo)}).</p>
              <Formulario accion={crearNotaCredito.bind(null, id, f.id)} boton="Emitir nota de crédito" className="fila">
                <label>Fecha<input type="date" name="fecha" defaultValue={hoyISO() < f.fecha ? f.fecha : hoyISO()} min={f.fecha} required /></label>
                <label style={{ width: 150 }}>Monto sin ITBIS<input name="subtotal" inputMode="decimal" required /></label>
                <label>ITBIS
                  <select name="tasa_itbis" defaultValue="18"><option value="18">18 %</option><option value="16">16 %</option><option value="0">Exento</option></select>
                </label>
                <label style={{ flex: "1 1 240px" }}>Motivo<input name="motivo" required placeholder="Descuento acordado, devolución…" /></label>
              </Formulario>
            </>
          )}
          <h2>Anular comprobante</h2>
          {fueraDeCierre ? (
            <>
              <p className="sub">El NCF queda anulado (va en el 608) y su asiento también. {esNota ? "" : "Solo se puede si no tiene cobros ni notas de crédito vigentes."}</p>
              <Formulario accion={anularComprobante.bind(null, id, f.id)} boton="Anular comprobante" className="fila">
                <label style={{ flex: "1 1 300px" }}>Motivo (608)
                  <select name="motivo" defaultValue="04">
                    {Object.entries(MOTIVOS_608).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
                  </select>
                </label>
              </Formulario>
            </>
          ) : <p className="sub">Este comprobante está en un período cerrado y no se puede anular.</p>}
        </div>
      )}
      <p className="sub no-imprimir" style={{ marginTop: 16 }}>Emitido por {f.creado_por ?? "—"}.</p>
    </>
  );
}
