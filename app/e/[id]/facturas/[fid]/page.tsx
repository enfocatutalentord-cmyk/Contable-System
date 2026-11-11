import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { BotonImprimir } from "@/app/imprimir";
import { accesoEmpresa, esUuid, misFirmas } from "@/lib/acceso";
import { EnviarWhatsApp } from "@/app/whatsapp";
import { conEmpresa } from "@/lib/db";
import { verPorcentaje } from "@/lib/fiscal";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { puedeVer } from "@/lib/pestanas";
import { ECF_DE, esEcf, MOTIVOS_608, NOMBRE_NCF, type TipoNcf } from "@/lib/ventas";
import { DocumentosSoporte } from "../../documentos/soporte";
import { HistorialRegistro } from "../../historial/registro";
import { anularComprobante, crearNotaCredito, descartarFactura, emitirBorrador, registrarEcf } from "../../ventas-acciones";
import { crearRecurrente } from "../../igualas-acciones";
import { aplicarAnticipoAccion } from "../../propuestas-acciones";
import { listarAnticipos } from "@/lib/anticipos";
import { FRECUENCIAS } from "@/lib/igualas";
import { correosDe, plantillaCorreo, prepararCorreo } from "@/lib/correo-facturas";
import { anularCobroDeFactura, cobrarFactura } from "../../registro-pagos-acciones";
import { PagoEnDocumento } from "../../pago-en-documento";
import { listarRetenciones } from "@/lib/fiscal";
import { enviarFacturaPorCorreo } from "../../correo-acciones";

type Factura = {
  id: string; estado: "borrador" | "emitida"; tipo_ncf: TipoNcf; ncf: string | null; ncf_vence: string | null; ncf_externo: string | null; fecha: string; vence: string;
  moneda: string; tasa: string; subtotal: string; itbis: string; otros_impuestos: string; total: string; notas: string | null;
  anulada: boolean; motivo_anulacion: string | null; asiento: number | null; asiento_id: string | null; cliente: string; rnc: string | null;
  direccion: string | null; origen_id: string | null; origen_ncf: string | null; creado_por_id: string; creado_por: string | null;
  emitida_por: string | null; emitida_en: Date | null; saldo: string | null; acuerdo_id: string | null;
  ecf_codigo: string | null; ecf_firmada: string | null;
};
type EmisorEcf = { emisor_ecf: boolean; ecf_desde: string | null; ecf_via: string | null; ecf_proveedor: string | null };

const fechaHora = (d: Date | null) => d?.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" }) ?? "";

export default async function VerFactura({ params, searchParams }: {
  params: Promise<{ id: string; fid: string }>;
  searchParams: Promise<{ emitida?: string; guardada?: string; anulada?: string; cobrado?: string; cobro_anulado?: string }>;
}) {
  const { id, fid } = await params;
  const sp = await searchParams;
  if (!esUuid(fid)) notFound();
  const { empresa, permisos, usuario, pestanas, paraClientes } = await accesoEmpresa(id);
  const datos = await conEmpresa(id, async (tx) => {
    const [f] = await tx<Factura[]>`
      SELECT f.id, f.estado, f.tipo_ncf, f.ncf, to_char(f.ncf_vence, 'YYYY-MM-DD') AS ncf_vence, f.ncf_externo, to_char(f.fecha, 'YYYY-MM-DD') AS fecha,
             to_char(f.vence, 'YYYY-MM-DD') AS vence, f.moneda, f.tasa::text, f.subtotal::text, f.itbis::text, f.otros_impuestos::text,
             f.total::text, f.notas, f.anulada, f.motivo_anulacion, a.numero AS asiento, a.id AS asiento_id, c.nombre AS cliente, c.rnc,
             c.direccion, o.id AS origen_id, o.ncf AS origen_ncf, f.creado_por AS creado_por_id, u.nombre AS creado_por,
             ue.nombre AS emitida_por, f.emitida_en, s.saldo::text, f.acuerdo_id,
             f.ecf_codigo, to_char(f.ecf_firmada, 'DD/MM/YYYY HH24:MI') AS ecf_firmada
        FROM facturas f JOIN clientes c ON c.id = f.cliente_id
        LEFT JOIN asientos a ON a.id = f.asiento_id
        LEFT JOIN facturas o ON o.id = f.factura_origen_id
        LEFT JOIN usuarios u ON u.id = f.creado_por
        LEFT JOIN usuarios ue ON ue.id = f.emitida_por
        LEFT JOIN saldos_factura s ON s.factura_id = f.id
       WHERE f.id = ${fid}`;
    if (!f) return null;
    const lineas = await tx<{ descripcion: string; cantidad: string; precio: string; subtotal: string; impuestos: string | null; unidad: string | null }[]>`
      SELECT l.descripcion, l.cantidad::text, l.precio::text, l.subtotal::text,
             (SELECT u.nombre FROM unidades_negocio u WHERE u.id = l.unidad_id) AS unidad,
             (SELECT string_agg(i.nombre || CASE WHEN il.monto > 0 THEN ': ' || to_char(il.monto, 'FM999,999,999,990.00') ELSE '' END, ' · '
                                ORDER BY il.tipo <> 'itbis', i.nombre)
                FROM impuestos_linea_factura il JOIN impuestos i ON i.id = il.impuesto_id WHERE il.linea_id = l.id) AS impuestos
        FROM lineas_factura l WHERE l.factura_id = ${fid} ORDER BY l.orden`;
    const porImpuesto = await tx<{ id: string; nombre: string; tasa: string; monto: string }[]>`
      SELECT i.id, i.nombre, il.tasa::text, sum(il.monto)::text AS monto
        FROM impuestos_linea_factura il JOIN impuestos i ON i.id = il.impuesto_id
       WHERE il.factura_id = ${fid} GROUP BY i.id, i.nombre, il.tasa ORDER BY sum(il.monto) DESC, i.nombre`;
    const movimientos = await tx<{ tipo: string; documento: string; enlace: string; fecha: string; monto: string; numero: number | null; detalle: string | null }[]>`
      SELECT 'Cobro' AS tipo, 'Recibo ' || c.numero AS documento, '/cobros/' || c.numero AS enlace,
             to_char(c.fecha, 'YYYY-MM-DD') AS fecha, a.monto::text AS monto, c.numero,
             concat_ws(' · ', c.forma_pago, CASE WHEN c.retencion_itbis > 0 THEN 'ITBIS retenido ' || c.retencion_itbis END,
                       CASE WHEN c.retencion_isr > 0 THEN 'ISR retenido ' || c.retencion_isr END, c.referencia) AS detalle
        FROM aplicaciones_cobro a JOIN cobros c ON c.id = a.cobro_id WHERE a.factura_id = ${fid} AND NOT c.anulado
      UNION ALL
      SELECT 'Nota de crédito', n.ncf, '/facturas/' || n.id, to_char(n.fecha, 'YYYY-MM-DD'), n.total::text, NULL, NULL
        FROM facturas n WHERE n.factura_origen_id = ${fid} AND n.estado = 'emitida' AND NOT n.anulada
      ORDER BY 4`;
    const retenciones = (await listarRetenciones(tx, hoyISO())).map((r) => ({ id: r.id, nombre: r.nombre }));
    // Anticipos del cliente con saldo (bloque 2c), para aplicarlos a esta factura.
    const [{ cliente_id }] = await tx<{ cliente_id: string }[]>`SELECT cliente_id FROM facturas WHERE id = ${fid}`;
    const anticipos = (await listarAnticipos(tx, cliente_id)).filter((a) => !a.anulado && Number(a.saldo) > 0);
    const [ecf] = await tx<EmisorEcf[]>`
      SELECT emisor_ecf, to_char(ecf_desde, 'YYYY-MM-DD') AS ecf_desde, ecf_via, ecf_proveedor FROM empresas WHERE id = ${id}`;
    return { f, lineas, porImpuesto, movimientos, anticipos, retenciones, ecf };
  });
  if (!datos) notFound();
  const { f, lineas, porImpuesto, movimientos, anticipos, retenciones, ecf } = datos;
  // Cliente sin contabilidad (n.º 9): no hay pantalla de cobros; el cobro se anota aquí.
  const conCobros = puedeVer(pestanas, "/cobros");
  const borrador = f.estado === "borrador";
  const esNota = f.tipo_ncf === "B04" || f.tipo_ncf === "E34";
  const electronica = esEcf(f.tipo_ncf);
  // Entrega E1: la empresa emite e-CF fuera del sistema; el borrador se registra con su e-NCF.
  const dondeEmite = ecf.ecf_via === "gratuito" ? "el Facturador Gratuito de la DGII" : ecf.ecf_proveedor || (ecf.ecf_via === "proveedor" ? "el proveedor" : "el Facturador Gratuito o con el proveedor");
  const ecfVigente = ecf.emisor_ecf && (!ecf.ecf_desde || f.fecha >= ecf.ecf_desde);
  const simbolo = f.moneda === "USD" ? "US$" : "RD$";
  const saldo = Number(f.saldo ?? 0);
  const fueraDeCierre = !empresa.fecha_bloqueo || f.fecha > empresa.fecha_bloqueo;
  const propioConAprobacion = empresa.requiere_aprobacion && f.creado_por_id === usuario.id;
  const titulo = esNota ? `Nota de crédito${electronica ? " electrónica" : ""}` : `Factura de ${NOMBRE_NCF[f.tipo_ncf].toLowerCase()}`;
  // WhatsApp (bloque 3c): las facturas de la empresa propia a sus clientes (igualas y demás servicios).
  const propia = (await misFirmas(usuario.id)).some((x) => x.empresa_propia_id === id);
  const whatsapp = propia && !borrador && !esNota && !f.anulada && puede(permisos, "exportar");
  // Correo (entrega A): toda factura o nota emitida y vigente, de la empresa propia o de un cliente; el historial siempre.
  const conCorreo = !borrador && !paraClientes && puede(permisos, "exportar");
  const correo = conCorreo ? await conEmpresa(id, async (tx) => ({
    preparado: f.anulada ? null : await prepararCorreo(tx, id, f.id, await plantillaCorreo(empresa.firma_id)),
    enviados: await correosDe(tx, f.id),
  })) : null;
  const ultimoNoSalio = correo?.enviados[0]?.estado === "no_salio";

  return (
    <>
      <div className="no-imprimir">
        <p><Link href={`/e/${id}/facturas${borrador ? "?estado=borradores" : ""}`}>← Facturas</Link></p>
        {sp.guardada && <p className="exito">Borrador guardado. No tiene NCF ni asiento hasta que se emita.</p>}
        {sp.emitida && !borrador && <p className="exito">{esNota ? "Nota de crédito emitida" : "Factura emitida"} con NCF {f.ncf}{f.asiento && <> y asiento n.º {f.asiento}</>}.</p>}
        {sp.anulada && <p className="exito">Comprobante anulado. Va en el formato 608 del mes.</p>}
        {sp.cobrado && <p className="exito">Cobro (recibo n.º {sp.cobrado}) registrado: va al 607 y al IT-1 con su fecha, forma y retenciones.</p>}
        {sp.cobro_anulado && <p className="exito">Recibo n.º {sp.cobro_anulado} anulado.</p>}
        {f.anulada && <p className="aviso">Anulado: {MOTIVOS_608[f.motivo_anulacion ?? ""] ?? f.motivo_anulacion}. El asiento también quedó anulado.</p>}
        <div className="entre" style={{ marginBottom: 12 }}>
          <div className="fila">
            {!borrador && <BotonImprimir />}
            {!esNota && !borrador && !f.anulada && saldo > 0 && puede(permisos, "contabilizar") && puedeVer(pestanas, "/cobros") && (
              <Link className="boton primario" href={`/e/${id}/cobros/nuevo?factura=${f.id}`}>Registrar cobro</Link>
            )}
            {f.asiento && puedeVer(pestanas, "/asientos") && <Link className="boton" href={`/e/${id}/asientos/${f.asiento_id}`}>Ver asiento n.º {f.asiento}</Link>}
          </div>
          <span className={`estado estado-${borrador ? "borrador" : f.anulada ? "anulado" : "contabilizado"}`}>
            {borrador ? "Borrador" : f.anulada ? "Anulada" : "Emitida"}
          </span>
        </div>
        {whatsapp && (
          <div className="fila" style={{ marginBottom: 12 }}>
            <EnviarWhatsApp empresaId={id} clave={f.acuerdo_id ? "cobro_iguala" : "envio_factura"} docRef={{ tipo: "factura", id: f.id }} />
            {saldo > 0 && f.vence < hoyISO() && (
              <EnviarWhatsApp empresaId={id} clave="pago_atrasado" docRef={{ tipo: "factura", id: f.id }} etiqueta="Recordar el pago atrasado" />
            )}
          </div>
        )}
        {correo && (correo.preparado || correo.enviados.length > 0) && (
          <details className="tarjeta" style={{ marginBottom: 16 }} open={ultimoNoSalio || undefined}>
            <summary>
              Enviar por correo
              {correo.enviados.length > 0 && <span className="sub"> · {correo.enviados[0].estado === "enviado" ? `enviada el ${fechaHora(correo.enviados[0].en)}` : "el último envío no salió"}</span>}
            </summary>
            {ultimoNoSalio && <p className="aviso" style={{ marginTop: 8 }}>No salió: {correo.enviados[0].error} Revisa y vuelve a enviarla.</p>}
            {correo.preparado && (
              <Formulario accion={enviarFacturaPorCorreo.bind(null, id, f.id)} boton={correo.enviados.length ? "Enviar de nuevo" : "Enviar con el PDF adjunto"}>
                <label>Para (uno o varios, separados por coma)
                  <input name="para" type="text" inputMode="email" defaultValue={correo.preparado.para} required maxLength={600} placeholder="correo@cliente.com" />
                </label>
                {!correo.preparado.para && <p className="sub" style={{ margin: 0 }}>{correo.preparado.cliente} no tiene correo en Clientes: escríbelo aquí (o guárdalo en su ficha para la próxima).</p>}
                <label>Asunto<input name="asunto" defaultValue={correo.preparado.asunto} required maxLength={200} /></label>
                <label>Texto<textarea name="texto" rows={5} defaultValue={correo.preparado.texto} required maxLength={4000} /></label>
                <p className="sub" style={{ margin: 0 }}>
                  {propia
                    ? "Sale con la marca de Empire y el PDF de la factura adjunto."
                    : `Sale a nombre de ${empresa.nombre}, sin la marca de Empire, con el PDF adjunto.`}
                  {correo.preparado.emisor.correo
                    ? ` Si el cliente responde, la respuesta llega a ${correo.preparado.emisor.correo}.`
                    : " La ficha no tiene correo: si el cliente responde, la respuesta llega al correo del sistema. Agrégalo en Ficha de la empresa › Datos generales."}
                  {" "}El texto predeterminado («Correo: envío de factura») se cambia en Contabilidad Empire › Mensajes de cobro.
                </p>
              </Formulario>
            )}
            {correo.enviados.length > 0 && (
              <div className="tabla-envoltura" style={{ marginTop: 12 }}>
                <table>
                  <thead><tr><th>Cuándo</th><th>Para</th><th>Quién</th><th>Estado</th></tr></thead>
                  <tbody>
                    {correo.enviados.map((c) => (
                      <tr key={c.id}>
                        <td>{fechaHora(c.en)}</td><td>{c.para}</td><td>{c.por ?? ""}</td>
                        <td className={c.estado === "no_salio" ? "error" : undefined}>{c.estado === "enviado" ? "Enviado" : `No salió${c.error ? `: ${c.error}` : ""}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        )}
        {borrador && (
          <div className="tarjeta" style={{ marginBottom: 16 }}>
            <div className="fila">
              {puede(permisos, "registrar") && <Link className="boton" href={`/e/${id}/facturas/${fid}/editar`}>Editar</Link>}
              {puede(permisos, "contabilizar") && !propioConAprobacion && fueraDeCierre && (!electronica || f.ncf_externo) && (
                <Formulario accion={emitirBorrador.bind(null, id, fid)} boton={ecfVigente && !f.ncf_externo ? "Emitir con NCF de serie B" : "Emitir factura"} className="fila"><span /></Formulario>
              )}
              {puede(permisos, "registrar") && (
                <Formulario accion={descartarFactura.bind(null, id, fid)} boton="Descartar borrador" className="fila"><span /></Formulario>
              )}
            </div>
            {propioConAprobacion && <p className="sub" style={{ margin: "8px 0 0" }}>Este borrador lo registraste tú: en esta empresa debe emitirlo otra persona.</p>}
            {!fueraDeCierre && <p className="aviso" style={{ margin: "8px 0 0" }}>La fecha cae en un período cerrado: cámbiala para poder emitirla.</p>}
            {ecfVigente && !electronica && !f.ncf_externo && (
              <p className="aviso" style={{ margin: "8px 0 0" }}>
                Esta empresa emite factura electrónica{ecf.ecf_desde ? ` desde el ${verFecha(ecf.ecf_desde)}` : ""}: emítela en {dondeEmite} y regístrala abajo con su e-NCF.
              </p>
            )}
          </div>
        )}
        {borrador && !f.ncf_externo && ECF_DE[f.tipo_ncf] && puede(permisos, "contabilizar") && !propioConAprobacion && fueraDeCierre && (
          <details className="tarjeta" style={{ marginBottom: 16 }} open={ecfVigente || undefined}>
            <summary><strong>Registrar como e-CF emitida</strong> · si la emitiste en {dondeEmite}</summary>
            <p className="sub">
              El sistema no envía nada a la DGII: guarda el e-NCF ({ECF_DE[f.tipo_ncf]}) para el IT-1, los reportes y los estados. La factura no va en el 607.
              Después, adjunta abajo el PDF de la e-CF.
            </p>
            <Formulario accion={registrarEcf.bind(null, id, fid)} boton="Registrar e-CF emitida" className="fila">
              <label style={{ flex: "1 1 200px" }}>e-NCF<input name="encf" required placeholder={`${ECF_DE[f.tipo_ncf]}0000000001`} maxLength={16} style={{ textTransform: "uppercase" }} /></label>
              <label style={{ width: 170 }}>Código de seguridad<input name="ecf_codigo" maxLength={20} placeholder="Como sale en la factura" /></label>
              <label>Fecha y hora de firma<input type="datetime-local" name="ecf_firmada" /></label>
            </Formulario>
          </details>
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
            {f.ncf && electronica ? <>
                <div>e-NCF <strong>{f.ncf}</strong></div>
                {f.ecf_codigo && <div>Código de seguridad {f.ecf_codigo}</div>}
                {f.ecf_firmada && <div>Firmada el {f.ecf_firmada}</div>}
                <div className="sub" style={{ margin: 0 }}>e-CF emitida fuera del sistema</div>
              </>
              : f.ncf ? <><div>NCF <strong>{f.ncf}</strong></div>{f.ncf_vence ? <div>Válido hasta {verFecha(f.ncf_vence)}</div> : <div className="sub" style={{ margin: 0 }}>NCF del talonario del cliente</div>}</>
              : f.ncf_externo ? <div className="sub" style={{ margin: 0 }}>Hecha fuera del sistema: al emitirla conserva el NCF {f.ncf_externo}</div>
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
                  <td>{l.descripcion}{l.unidad && <span className="sub no-imprimir" style={{ margin: 0, display: "block" }}>Unidad: {l.unidad}</span>}</td>
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

      {!conCobros && !esNota && !borrador && !f.anulada && saldo > 0 && puede(permisos, "contabilizar") && (
        <div className="no-imprimir">
          <PagoEnDocumento tipo="cobro" accion={cobrarFactura.bind(null, id, f.id)} saldo={f.saldo ?? "0.00"} moneda={f.moneda} retenciones={retenciones} />
        </div>
      )}
      {!esNota && !borrador && (
        <div className="no-imprimir">
          <h2>Cobros y notas de crédito</h2>
          <div className="tabla-envoltura">
            <table>
              <tbody>
                {movimientos.map((m, i) => (
                  <tr key={i}>
                    <td>{verFecha(m.fecha)}</td>
                    <td>
                      {m.tipo} {conCobros || m.numero === null ? <Link href={`/e/${id}${m.enlace}`}>{m.documento}</Link> : m.documento}
                      {!conCobros && m.detalle && <div className="sub" style={{ margin: 0 }}>{m.detalle}</div>}
                      {!conCobros && m.numero !== null && puede(permisos, "revertir") && (
                        <details><summary className="sub">Anular este cobro</summary>
                          <Formulario accion={anularCobroDeFactura.bind(null, id, f.id, m.numero)} boton="Anular el cobro" className="fila">
                            <input name="motivo" required minLength={3} maxLength={300} placeholder="Motivo" aria-label="Motivo" />
                          </Formulario>
                        </details>
                      )}
                    </td>
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
              <h2>Nota de crédito ({electronica ? "E34" : ecfVigente ? "E34 o B04" : "B04"})</h2>
              <p className="sub">
                Para descuentos, devoluciones o corregir un monto. Rebaja el saldo de esta factura (hasta {simbolo} {verMonto(f.saldo)}) y usa la tasa de impuesto de la factura.
                {electronica ? ` Por ser electrónica, la nota es una E34: emítela en ${dondeEmite} y escribe aquí su e-NCF.`
                  : ecfVigente ? ` Si la emitiste como e-CF en ${dondeEmite}, escribe su e-NCF (E34); si lo dejas vacío, toma un B04 del rango.` : ""}
              </p>
              <Formulario accion={crearNotaCredito.bind(null, id, f.id)} boton={electronica ? "Registrar nota de crédito E34" : "Emitir nota de crédito"} className="fila">
                <label>Fecha<input type="date" name="fecha" defaultValue={hoyISO() < f.fecha ? f.fecha : hoyISO()} min={f.fecha} required /></label>
                <label style={{ width: 160 }}>Monto sin impuestos<input name="subtotal" inputMode="decimal" required /></label>
                <label>Impuesto
                  <select name="impuesto" defaultValue={porImpuesto[0]?.id}>
                    {porImpuesto.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({verPorcentaje(p.tasa)})</option>)}
                  </select>
                </label>
                <label style={{ flex: "1 1 240px" }}>Motivo<input name="motivo" required placeholder="Descuento acordado, devolución…" /></label>
                {(electronica || ecfVigente) && <>
                  <label style={{ flex: "1 1 180px" }}>e-NCF de la nota{!electronica && " (si es E34)"}<input name="encf" required={electronica} placeholder="E340000000001" maxLength={16} style={{ textTransform: "uppercase" }} /></label>
                  <label style={{ width: 160 }}>Código de seguridad<input name="ecf_codigo" maxLength={20} /></label>
                  <label>Fecha y hora de firma<input type="datetime-local" name="ecf_firmada" /></label>
                </>}
              </Formulario>
            </>
          )}
          <h2>Anular comprobante</h2>
          {fueraDeCierre ? (
            <>
              <p className="sub">
                {electronica
                  ? `Una e-CF no se anula con el 608${esNota ? "" : ": ante la DGII se corrige con una nota de crédito E34 (o con la anulación del Facturador o del proveedor)"}. Anúlala aquí solo si se registró por error. `
                  : "El NCF queda anulado (va en el 608) y su asiento también. "}
                {esNota ? "" : "Solo se puede si no tiene cobros ni notas de crédito vigentes."}
              </p>
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

      {!borrador && !esNota && !f.anulada && f.moneda === "DOP" && saldo > 0 && anticipos.length > 0 && puede(permisos, "contabilizar") && (
        <div className="no-imprimir tarjeta" style={{ margin: "16px 0" }}>
          <h2 style={{ marginTop: 0 }}>Aplicar anticipo</h2>
          <p className="sub">El cliente tiene anticipos sin aplicar. Al aplicarlo se rebaja el saldo de esta factura con un cobro desde «Anticipos de clientes».</p>
          <Formulario accion={aplicarAnticipoAccion.bind(null, id, f.id)} boton="Aplicar anticipo" className="fila">
            <label style={{ flex: "2 1 240px" }}>Anticipo
              <select name="anticipo" defaultValue={anticipos[0].id}>
                {anticipos.map((a) => <option key={a.id} value={a.id}>N.º {a.numero} del {verFecha(a.fecha)} · saldo RD${verMonto(a.saldo)}</option>)}
              </select>
            </label>
            <label style={{ width: 150 }}>Monto<input name="monto" inputMode="decimal" defaultValue={Math.min(saldo, Number(anticipos[0].saldo)).toFixed(2)} required /></label>
            <label>Fecha<input type="date" name="fecha" defaultValue={hoyISO() < f.fecha ? f.fecha : hoyISO()} min={f.fecha} required /></label>
          </Formulario>
        </div>
      )}

      {!esNota && f.moneda === "DOP" && puede(permisos, "registrar") && (
        <details className="no-imprimir tarjeta" style={{ margin: "16px 0" }}>
          <summary><strong>Repetir esta factura</strong> · crear una plantilla recurrente</summary>
          <p className="sub">
            La plantilla copia el cliente, las líneas y los impuestos de esta factura y prepara un borrador cada vez que toca
            (o cuando lo pidas, si es «a solicitud»). Se ve en <Link href={`/e/${id}/recurrentes`}>Facturas recurrentes</Link>.
          </p>
          <Formulario accion={crearRecurrente.bind(null, id, f.id)} boton="Crear plantilla" className="fila">
            <label style={{ flex: "2 1 220px" }}>Nombre<input name="nombre" required maxLength={120} placeholder="Ej.: Alquiler mensual del local" /></label>
            <label>Frecuencia
              <select name="frecuencia" defaultValue="mensual">
                {Object.entries(FRECUENCIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Próxima factura<input type="date" name="proxima" defaultValue={hoyISO()} /></label>
            <label>Hasta (opcional)<input type="date" name="hasta" /></label>
          </Formulario>
        </details>
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
