import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { BotonImprimir } from "@/app/imprimir";
import { accesoEmpresa, esUuid } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { verPorcentaje } from "@/lib/fiscal";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { puedeVer } from "@/lib/pestanas";
import { MOTIVOS_608, NOMBRE_NCF, type TipoNcf } from "@/lib/ventas";
import { DocumentosSoporte } from "../../documentos/soporte";
import { HistorialRegistro } from "../../historial/registro";
import { anularComprobante, crearNotaCredito, descartarFactura, emitirBorrador } from "../../ventas-acciones";

type Factura = {
  id: string; estado: "borrador" | "emitida"; tipo_ncf: TipoNcf; ncf: string | null; ncf_vence: string | null; fecha: string; vence: string;
  moneda: string; tasa: string; subtotal: string; itbis: string; otros_impuestos: string; total: string; notas: string | null;
  anulada: boolean; motivo_anulacion: string | null; asiento: number | null; asiento_id: string | null; cliente: string; rnc: string | null;
  direccion: string | null; origen_id: string | null; origen_ncf: string | null; creado_por_id: string; creado_por: string | null;
  emitida_por: string | null; emitida_en: Date | null; saldo: string | null;
};

const fechaHora = (d: Date | null) => d?.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" }) ?? "";

export default async function VerFactura({ params, searchParams }: {
  params: Promise<{ id: string; fid: string }>;
  searchParams: Promise<{ emitida?: string; guardada?: string; anulada?: string }>;
}) {
  const { id, fid } = await params;
  const sp = await searchParams;
  if (!esUuid(fid)) notFound();
  const { empresa, permisos, usuario, pestanas } = await accesoEmpresa(id);
  const datos = await conEmpresa(id, async (tx) => {
    const [f] = await tx<Factura[]>`
      SELECT f.id, f.estado, f.tipo_ncf, f.ncf, to_char(f.ncf_vence, 'YYYY-MM-DD') AS ncf_vence, to_char(f.fecha, 'YYYY-MM-DD') AS fecha,
             to_char(f.vence, 'YYYY-MM-DD') AS vence, f.moneda, f.tasa::text, f.subtotal::text, f.itbis::text, f.otros_impuestos::text,
             f.total::text, f.notas, f.anulada, f.motivo_anulacion, a.numero AS asiento, a.id AS asiento_id, c.nombre AS cliente, c.rnc,
             c.direccion, o.id AS origen_id, o.ncf AS origen_ncf, f.creado_por AS creado_por_id, u.nombre AS creado_por,
             ue.nombre AS emitida_por, f.emitida_en, s.saldo::text
        FROM facturas f JOIN clientes c ON c.id = f.cliente_id
        LEFT JOIN asientos a ON a.id = f.asiento_id
        LEFT JOIN facturas o ON o.id = f.factura_origen_id
        LEFT JOIN usuarios u ON u.id = f.creado_por
        LEFT JOIN usuarios ue ON ue.id = f.emitida_por
        LEFT JOIN saldos_factura s ON s.factura_id = f.id
       WHERE f.id = ${fid}`;
    if (!f) return null;
    const lineas = await tx<{ descripcion: string; cantidad: string; precio: string; subtotal: string; impuestos: string | null }[]>`
      SELECT l.descripcion, l.cantidad::text, l.precio::text, l.subtotal::text,
             (SELECT string_agg(i.nombre || CASE WHEN il.monto > 0 THEN ': ' || to_char(il.monto, 'FM999,999,999,990.00') ELSE '' END, ' · '
                                ORDER BY il.tipo <> 'itbis', i.nombre)
                FROM impuestos_linea_factura il JOIN impuestos i ON i.id = il.impuesto_id WHERE il.linea_id = l.id) AS impuestos
        FROM lineas_factura l WHERE l.factura_id = ${fid} ORDER BY l.orden`;
    const porImpuesto = await tx<{ id: string; nombre: string; tasa: string; monto: string }[]>`
      SELECT i.id, i.nombre, il.tasa::text, sum(il.monto)::text AS monto
        FROM impuestos_linea_factura il JOIN impuestos i ON i.id = il.impuesto_id
       WHERE il.factura_id = ${fid} GROUP BY i.id, i.nombre, il.tasa ORDER BY sum(il.monto) DESC, i.nombre`;
    const movimientos = await tx<{ tipo: string; documento: string; enlace: string; fecha: string; monto: string }[]>`
      SELECT 'Cobro' AS tipo, 'Recibo ' || c.numero AS documento, '/cobros/' || c.numero AS enlace,
             to_char(c.fecha, 'YYYY-MM-DD') AS fecha, a.monto::text AS monto
        FROM aplicaciones_cobro a JOIN cobros c ON c.id = a.cobro_id WHERE a.factura_id = ${fid} AND NOT c.anulado
      UNION ALL
      SELECT 'Nota de crédito', n.ncf, '/facturas/' || n.id, to_char(n.fecha, 'YYYY-MM-DD'), n.total::text
        FROM facturas n WHERE n.factura_origen_id = ${fid} AND n.estado = 'emitida' AND NOT n.anulada
      ORDER BY 4`;
    return { f, lineas, porImpuesto, movimientos };
  });
  if (!datos) notFound();
  const { f, lineas, porImpuesto, movimientos } = datos;
  const borrador = f.estado === "borrador";
  const esNota = f.tipo_ncf === "B04";
  const simbolo = f.moneda === "USD" ? "US$" : "RD$";
  const saldo = Number(f.saldo ?? 0);
  const fueraDeCierre = !empresa.fecha_bloqueo || f.fecha > empresa.fecha_bloqueo;
  const propioConAprobacion = empresa.requiere_aprobacion && f.creado_por_id === usuario.id;
  const titulo = esNota ? "Nota de crédito" : `Factura de ${NOMBRE_NCF[f.tipo_ncf].toLowerCase()}`;

  return (
    <>
      <div className="no-imprimir">
        <p><Link href={`/e/${id}/facturas${borrador ? "?estado=borradores" : ""}`}>← Facturas</Link></p>
        {sp.guardada && <p className="exito">Borrador guardado. No tiene NCF ni asiento hasta que se emita.</p>}
        {sp.emitida && !borrador && <p className="exito">{esNota ? "Nota de crédito emitida" : "Factura emitida"} con NCF {f.ncf}{f.asiento && <> y asiento n.º {f.asiento}</>}.</p>}
        {sp.anulada && <p className="exito">Comprobante anulado. Va en el formato 608 del mes.</p>}
        {f.anulada && <p className="aviso">Anulado: {MOTIVOS_608[f.motivo_anulacion ?? ""] ?? f.motivo_anulacion}. El asiento también quedó anulado.</p>}
        <div className="entre" style={{ marginBottom: 12 }}>
          <div className="fila">
            {!borrador && <BotonImprimir />}
            {!esNota && !borrador && !f.anulada && saldo > 0 && puede(permisos, "contabilizar") && puedeVer(pestanas, "/cobros") && (
              <Link className="boton primario" href={`/e/${id}/cobros/nuevo?factura=${f.id}`}>Registrar cobro</Link>
            )}
            {f.asiento && <Link className="boton" href={`/e/${id}/asientos/${f.asiento_id}`}>Ver asiento n.º {f.asiento}</Link>}
          </div>
          <span className={`estado estado-${borrador ? "borrador" : f.anulada ? "anulado" : "contabilizado"}`}>
            {borrador ? "Borrador" : f.anulada ? "Anulada" : "Emitida"}
          </span>
        </div>
        {borrador && (
          <div className="tarjeta" style={{ marginBottom: 16 }}>
            <div className="fila">
              {puede(permisos, "registrar") && <Link className="boton" href={`/e/${id}/facturas/${fid}/editar`}>Editar</Link>}
              {puede(permisos, "contabilizar") && !propioConAprobacion && fueraDeCierre && (
                <Formulario accion={emitirBorrador.bind(null, id, fid)} boton="Emitir factura" className="fila"><span /></Formulario>
              )}
              {puede(permisos, "registrar") && (
                <Formulario accion={descartarFactura.bind(null, id, fid)} boton="Descartar borrador" className="fila"><span /></Formulario>
              )}
            </div>
            {propioConAprobacion && <p className="sub" style={{ margin: "8px 0 0" }}>Este borrador lo registraste tú: en esta empresa debe emitirlo otra persona.</p>}
            {!fueraDeCierre && <p className="aviso" style={{ margin: "8px 0 0" }}>La fecha cae en un período cerrado: cámbiala para poder emitirla.</p>}
          </div>
        )}
      </div>

      <div className="documento">
        <div className="cabecera">
          <div>
            <h2>{empresa.nombre}</h2>
            {empresa.rnc && <div>RNC {empresa.rnc}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <h2>{borrador ? `Borrador · ${titulo.toLowerCase()}` : titulo}{f.anulada && " (ANULADA)"}</h2>
            {f.ncf ? <><div>NCF <strong>{f.ncf}</strong></div><div>Válido hasta {verFecha(f.ncf_vence)}</div></>
              : <div className="sub" style={{ margin: 0 }}>Sin NCF: se asigna al emitir ({f.tipo_ncf})</div>}
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
            <thead><tr><th>Descripción</th><th className="num">Cantidad</th><th className="num">Precio</th><th>Impuestos</th><th className="num">Importe</th></tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td>{l.descripcion}</td>
                  <td className="num">{Number(l.cantidad).toLocaleString("es-DO", { maximumFractionDigits: 4 })}</td>
                  <td className="num">{verMonto(l.precio)}</td>
                  <td>{l.impuestos}</td>
                  <td className="num">{verMonto(l.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={4}>Subtotal</td><td className="num">{verMonto(f.subtotal)}</td></tr>
              {porImpuesto.filter((p) => Number(p.monto) > 0).map((p) => (
                <tr key={p.id}><td colSpan={4}>{p.nombre}</td><td className="num">{verMonto(p.monto)}</td></tr>
              ))}
              <tr><td colSpan={4}>Total {simbolo}</td><td className="num">{verMonto(f.total)}</td></tr>
            </tfoot>
          </table>
        </div>
        {f.notas && <p>{f.notas}</p>}
      </div>

      {!esNota && !borrador && (
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

      {!borrador && !f.anulada && puede(permisos, "revertir") && (
        <div className="no-imprimir">
          {!esNota && saldo > 0 && (
            <>
              <h2>Nota de crédito (B04)</h2>
              <p className="sub">Para descuentos, devoluciones o corregir un monto. Rebaja el saldo de esta factura (hasta {simbolo} {verMonto(f.saldo)}) y usa la tasa de impuesto de la factura.</p>
              <Formulario accion={crearNotaCredito.bind(null, id, f.id)} boton="Emitir nota de crédito" className="fila">
                <label>Fecha<input type="date" name="fecha" defaultValue={hoyISO() < f.fecha ? f.fecha : hoyISO()} min={f.fecha} required /></label>
                <label style={{ width: 160 }}>Monto sin impuestos<input name="subtotal" inputMode="decimal" required /></label>
                <label>Impuesto
                  <select name="impuesto" defaultValue={porImpuesto[0]?.id}>
                    {porImpuesto.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({verPorcentaje(p.tasa)})</option>)}
                  </select>
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

      <div className="no-imprimir">
        <DocumentosSoporte empresaId={id} entidad="factura" entidadId={fid} retirables={borrador}
          puedeAdjuntar={puede(permisos, "adjuntar") && !f.anulada} />
        <p className="sub" style={{ marginTop: 16 }}>
          Registrada por {f.creado_por ?? "—"}{f.emitida_en && <> · emitida por {f.emitida_por} el {fechaHora(f.emitida_en)}</>}
        </p>
        {puede(permisos, "auditoria") && (
          <>
            <h2>Historial de cambios</h2>
            <HistorialRegistro empresaId={id} registroId={fid} />
          </>
        )}
      </div>
    </>
  );
}
