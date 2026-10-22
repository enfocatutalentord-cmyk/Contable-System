import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, esUuid } from "@/lib/acceso";
import { esNotaProveedor, nombreComprobante, TIPOS_GASTO } from "@/lib/compras";
import { conEmpresa } from "@/lib/db";
import { verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { anularLaCompra, descartarCompra, registrarBorradorCompra } from "../../compras-acciones";
import { DocumentosSoporte } from "../../documentos/soporte";
import { HistorialRegistro } from "../../historial/registro";

type Compra = {
  id: string; estado: "borrador" | "registrada"; tipo_comprobante: string; ncf: string | null; fecha: string; vence: string; moneda: string;
  tasa: string; tipo_gasto: string; itbis_al_costo: boolean; subtotal: string; itbis: string; otros_impuestos: string; total: string;
  notas: string | null; anulada: boolean; motivo_anulacion: string | null; asiento: number | null; asiento_id: string | null;
  proveedor: string; rnc: string | null; origen_id: string | null; origen_ncf: string | null; creado_por_id: string;
  creado_por: string | null; registrada_por: string | null; registrada_en: Date | null; saldo: string | null;
};

const fechaHora = (d: Date | null) => d?.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" }) ?? "";

export default async function VerCompra({ params, searchParams }: {
  params: Promise<{ id: string; cid: string }>;
  searchParams: Promise<{ registrada?: string; guardada?: string; anulada?: string }>;
}) {
  const { id, cid } = await params;
  const sp = await searchParams;
  if (!esUuid(cid)) notFound();
  const { empresa, permisos, usuario } = await accesoEmpresa(id);
  const datos = await conEmpresa(id, async (tx) => {
    const [c] = await tx<Compra[]>`
      SELECT c.id, c.estado, c.tipo_comprobante, c.ncf, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, to_char(c.vence, 'YYYY-MM-DD') AS vence,
             c.moneda, c.tasa::text, c.tipo_gasto, c.itbis_al_costo, c.subtotal::text, c.itbis::text, c.otros_impuestos::text, c.total::text,
             c.notas, c.anulada, c.motivo_anulacion, a.numero AS asiento, a.id AS asiento_id, p.nombre AS proveedor, p.rnc,
             o.id AS origen_id, o.ncf AS origen_ncf, c.creado_por AS creado_por_id, u.nombre AS creado_por, ur.nombre AS registrada_por,
             c.registrada_en, s.saldo::text
        FROM compras c JOIN proveedores p ON p.id = c.proveedor_id
        LEFT JOIN asientos a ON a.id = c.asiento_id
        LEFT JOIN compras o ON o.id = c.compra_origen_id
        LEFT JOIN usuarios u ON u.id = c.creado_por
        LEFT JOIN usuarios ur ON ur.id = c.registrada_por
        LEFT JOIN saldos_compra s ON s.compra_id = c.id
       WHERE c.id = ${cid}`;
    if (!c) return null;
    const lineas = await tx<{ descripcion: string; clase: string; cuenta: string; cantidad: string; precio: string; subtotal: string; impuestos: string | null }[]>`
      SELECT l.descripcion, l.clase, cu.codigo || ' · ' || cu.nombre AS cuenta, l.cantidad::text, l.precio::text, l.subtotal::text,
             (SELECT string_agg(i.nombre || CASE WHEN il.monto > 0 THEN ': ' || to_char(il.monto, 'FM999,999,999,990.00') ELSE '' END, ' · '
                                ORDER BY il.tipo <> 'itbis', i.nombre)
                FROM impuestos_linea_compra il JOIN impuestos i ON i.id = il.impuesto_id WHERE il.linea_id = l.id) AS impuestos
        FROM lineas_compra l JOIN cuentas cu ON cu.id = l.cuenta_id WHERE l.compra_id = ${cid} ORDER BY l.orden`;
    const movimientos = await tx<{ tipo: string; documento: string; enlace: string; fecha: string; monto: string }[]>`
      SELECT 'Pago' AS tipo, 'Pago ' || p.numero AS documento, '/pagos/' || p.numero AS enlace, to_char(p.fecha, 'YYYY-MM-DD') AS fecha, a.monto::text AS monto
        FROM aplicaciones_pago a JOIN pagos p ON p.id = a.pago_id WHERE a.compra_id = ${cid} AND NOT p.anulado
      UNION ALL
      SELECT 'Nota de crédito', n.ncf, '/compras/' || n.id, to_char(n.fecha, 'YYYY-MM-DD'), n.total::text
        FROM compras n WHERE n.compra_origen_id = ${cid} AND n.estado = 'registrada' AND NOT n.anulada
      ORDER BY 4`;
    return { c, lineas, movimientos };
  });
  if (!datos) notFound();
  const { c, lineas, movimientos } = datos;
  const borrador = c.estado === "borrador";
  const esNota = esNotaProveedor(c.tipo_comprobante);
  const simbolo = c.moneda === "USD" ? "US$" : "RD$";
  const saldo = Number(c.saldo ?? 0);
  const fueraDeCierre = !empresa.fecha_bloqueo || c.fecha > empresa.fecha_bloqueo;
  const propioConAprobacion = empresa.requiere_aprobacion && c.creado_por_id === usuario.id;

  return (
    <>
      <p><Link href={`/e/${id}/compras${borrador ? "?estado=borradores&mes=" : ""}`}>← Compras</Link></p>
      {sp.guardada && <p className="exito">Borrador guardado. No tiene asiento hasta que se registre.</p>}
      {sp.registrada && !borrador && <p className="exito">{esNota ? "Nota de crédito registrada" : "Compra registrada"} con NCF {c.ncf}{c.asiento && <> y asiento n.º {c.asiento}</>}.</p>}
      {sp.anulada && <p className="exito">Compra anulada; su asiento también.</p>}
      {c.anulada && <p className="aviso">Anulada: {c.motivo_anulacion}. El asiento también quedó anulado.</p>}
      <div className="entre" style={{ marginBottom: 12 }}>
        <div>
          <h1>{borrador ? "Borrador de " : ""}{esNota ? "nota de crédito del proveedor" : "compra"} {c.ncf ?? ""}</h1>
          <p className="sub">{c.proveedor}{c.rnc && ` · ${c.rnc}`} · {verFecha(c.fecha)} · {c.tipo_comprobante} {nombreComprobante(c.tipo_comprobante)}</p>
        </div>
        <span className={`estado estado-${borrador ? "borrador" : c.anulada ? "anulado" : "contabilizado"}`}>
          {borrador ? "Borrador" : c.anulada ? "Anulada" : "Registrada"}
        </span>
      </div>
      <div className="fila" style={{ marginBottom: 16 }}>
        {!esNota && !borrador && !c.anulada && saldo > 0 && puede(permisos, "contabilizar") && (
          <Link className="boton primario" href={`/e/${id}/pagos/nuevo?compra=${c.id}`}>Registrar pago</Link>
        )}
        {c.asiento && <Link className="boton" href={`/e/${id}/asientos/${c.asiento_id}`}>Ver asiento n.º {c.asiento}</Link>}
        {borrador && puede(permisos, "registrar") && <Link className="boton" href={`/e/${id}/compras/${cid}/editar`}>Editar</Link>}
        {borrador && puede(permisos, "contabilizar") && !propioConAprobacion && fueraDeCierre && (
          <Formulario accion={registrarBorradorCompra.bind(null, id, cid)} boton={esNota ? "Registrar nota de crédito" : "Registrar compra"} className="fila"><span /></Formulario>
        )}
        {borrador && puede(permisos, "registrar") && (
          <Formulario accion={descartarCompra.bind(null, id, cid)} boton="Descartar borrador" className="fila"><span /></Formulario>
        )}
      </div>
      {borrador && propioConAprobacion && <p className="sub">Este borrador lo registraste tú: en esta empresa debe registrarlo otra persona.</p>}
      {borrador && !fueraDeCierre && <p className="aviso">La fecha cae en un período cerrado: cámbiala para poder registrarla.</p>}

      <dl className="ficha-datos">
        <dt>Comprobante</dt><dd>{c.ncf ?? `Se asigna al registrar (${c.tipo_comprobante})`}</dd>
        {esNota && c.origen_ncf && <><dt>Modifica</dt><dd><Link href={`/e/${id}/compras/${c.origen_id}`}>{c.origen_ncf}</Link></dd></>}
        {!esNota && <><dt>Vence</dt><dd>{verFecha(c.vence)}</dd></>}
        <dt>Tipo de gasto (606)</dt><dd>{c.tipo_gasto} · {TIPOS_GASTO[c.tipo_gasto]}</dd>
        <dt>ITBIS</dt><dd>{c.itbis_al_costo ? "Llevado al costo (sin crédito)" : "Con crédito fiscal (ITBIS pagado en compras)"}</dd>
        <dt>Moneda</dt><dd>{c.moneda}{c.moneda === "USD" && ` (tasa ${Number(c.tasa).toFixed(2)})`}</dd>
      </dl>

      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Descripción</th><th>Tipo</th><th>Cuenta</th><th className="num">Cantidad</th><th className="num">Precio</th><th>Impuestos</th><th className="num">Importe</th></tr></thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td>{l.descripcion}</td>
                <td style={{ textTransform: "capitalize" }}>{l.clase}</td>
                <td>{l.cuenta}</td>
                <td className="num">{Number(l.cantidad).toLocaleString("es-DO", { maximumFractionDigits: 4 })}</td>
                <td className="num">{verMonto(l.precio)}</td>
                <td>{l.impuestos}</td>
                <td className="num">{verMonto(l.subtotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={6}>Subtotal</td><td className="num">{verMonto(c.subtotal)}</td></tr>
            <tr><td colSpan={6}>ITBIS{c.itbis_al_costo && " (al costo)"}</td><td className="num">{verMonto(c.itbis)}</td></tr>
            {Number(c.otros_impuestos) > 0 && <tr><td colSpan={6}>Otros cargos</td><td className="num">{verMonto(c.otros_impuestos)}</td></tr>}
            <tr><td colSpan={6}>Total {simbolo}</td><td className="num">{verMonto(c.total)}</td></tr>
          </tfoot>
        </table>
      </div>
      {c.notas && <p>{c.notas}</p>}

      {!esNota && !borrador && (
        <>
          <h2>Pagos y notas de crédito</h2>
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
                {movimientos.length === 0 && <tr><td>Sin pagos todavía.</td></tr>}
              </tbody>
              {!c.anulada && <tfoot><tr><td colSpan={2}>Saldo pendiente {simbolo}</td><td className="num">{verMonto(c.saldo)}</td></tr></tfoot>}
            </table>
          </div>
        </>
      )}

      {!borrador && !c.anulada && puede(permisos, "revertir") && (
        <>
          {!esNota && saldo > 0 && (
            <>
              <h2>Nota de crédito del proveedor</h2>
              <p className="sub">Si el proveedor te dio un descuento o una devolución con su nota de crédito (B04 o E34), regístrala para rebajar el saldo.</p>
              <Link className="boton" href={`/e/${id}/compras/nueva?origen=${c.id}`}>Registrar nota de crédito del proveedor</Link>
            </>
          )}
          <h2>Anular compra</h2>
          {fueraDeCierre ? (
            <>
              <p className="sub">Para una compra mal registrada. Su asiento también queda anulado. {esNota ? "" : "Solo si no tiene pagos ni notas de crédito vigentes."}</p>
              <Formulario accion={anularLaCompra.bind(null, id, c.id)} boton="Anular compra" className="fila">
                <label style={{ flex: "1 1 320px" }}>Motivo<input name="motivo" required /></label>
              </Formulario>
            </>
          ) : <p className="sub">Esta compra está en un período cerrado y no se puede anular.</p>}
        </>
      )}

      <DocumentosSoporte empresaId={id} entidad="compra" entidadId={cid} retirables={borrador}
        puedeAdjuntar={puede(permisos, "adjuntar") && !c.anulada} />
      <p className="sub" style={{ marginTop: 16 }}>
        Registrada por {c.creado_por ?? "—"}{c.registrada_en && <> · contabilizada por {c.registrada_por} el {fechaHora(c.registrada_en)}</>}
      </p>
      {puede(permisos, "auditoria") && (
        <>
          <h2>Historial de cambios</h2>
          <HistorialRegistro empresaId={id} registroId={cid} />
        </>
      )}
    </>
  );
}
