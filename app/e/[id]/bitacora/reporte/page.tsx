import Link from "next/link";
import { Descargar } from "@/app/descargar";
import { Formulario } from "@/app/formulario";
import { EnviarWhatsApp } from "@/app/whatsapp";
import { accesoEmpresa, soloCliente } from "@/lib/acceso";
import { moverMes, nombreMes } from "@/lib/bitacora";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { armarReporte, type DatosReporte, ESTADOS_REPORTE, huellaReporte } from "@/lib/reporte-mensual";
import { aprobarReporte, guardarNotasReporte, quitarAprobacion, revisarReporte } from "../../reporte-acciones";

type Fila = { id: string; estado: string; notas: string | null; datos: DatosReporte | null; huella: string | null;
  preparado: string | null; preparado_en: Date | null; revisado: string | null; revisado_en: Date | null;
  aprobado: string | null; aprobado_en: Date | null; enviado_en: Date | null };
const fechaHora = (d: Date | null) => d?.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" }) ?? "";

// Reporte mensual al cliente (bloque 4b, Documento maestro, sección 8): se arma solo con lo registrado del mes. La coordinadora lo
// prepara, la socia o la contadora lo revisa, Patricia lo aprueba (queda guardado tal cual) y sale por WhatsApp con su PDF.
export default async function ReporteMensual({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa, permisos, usuario } = await accesoEmpresa(id);
  const hoy = hoyISO();
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes ?? "") ? sp.mes! : moverMes(hoy.slice(0, 7), -1);
  const periodo = mes.replace("-", "");
  const { r, vivo } = await conEmpresa(id, async (tx) => {
    const [r] = await tx<Fila[]>`
      SELECT m.id, m.estado, m.notas, m.datos, m.huella, up.nombre AS preparado, m.preparado_en, ur.nombre AS revisado, m.revisado_en,
             ua.nombre AS aprobado, m.aprobado_en, m.enviado_en
        FROM reportes_mensuales m LEFT JOIN usuarios up ON up.id = m.preparado_por LEFT JOIN usuarios ur ON ur.id = m.revisado_por
        LEFT JOIN usuarios ua ON ua.id = m.aprobado_por
       WHERE m.periodo = ${periodo}`;
    return { r, vivo: await armarReporte(tx, id, periodo, hoy) };
  });
  const estado = r?.estado ?? "borrador";
  const aprobado = estado === "aprobado" || estado === "enviado";
  const d = aprobado && r?.datos ? r.datos : vivo;
  const cambio = aprobado && r?.huella !== huellaReporte(vivo);
  const equipo = !(await soloCliente(empresa.firma_id, usuario.id));

  return (
    <>
      <p><Link href={`/e/${id}/bitacora?mes=${mes}`}>← Bitácora</Link></p>
      <div className="entre">
        <div>
          <h1>Reporte mensual · {nombreMes(mes)}</h1>
          <p className="sub">Lo que la firma hizo por {empresa.nombre} en el mes, con sus impuestos y pendientes. Sale con la factura del mes.</p>
        </div>
        {puede(permisos, "exportar") && <Descargar href={`/e/${id}/exportar/reporte-mensual?mes=${mes}`} />}
      </div>
      <nav className="fila" style={{ marginBottom: 12, alignItems: "center" }} aria-label="Mes">
        <Link className="boton" href={`/e/${id}/bitacora/reporte?mes=${moverMes(mes, -1)}`}>← {nombreMes(moverMes(mes, -1))}</Link>
        <strong style={{ textTransform: "capitalize" }}>{nombreMes(mes)}</strong>
        <Link className="boton" href={`/e/${id}/bitacora/reporte?mes=${moverMes(mes, 1)}`}>{nombreMes(moverMes(mes, 1))} →</Link>
        <span className={`estado estado-${aprobado ? "contabilizado" : "borrador"}`}>{ESTADOS_REPORTE[estado]}</span>
      </nav>

      <div className="tarjeta" style={{ marginBottom: 16 }}>
        <ol className="pasos-reporte">
          <li className={r?.preparado_en ? "hecho" : undefined}>Preparado{r?.preparado && ` por ${r.preparado} el ${fechaHora(r.preparado_en)}`}</li>
          <li className={r?.revisado_en ? "hecho" : undefined}>Revisado{r?.revisado && ` por ${r.revisado} el ${fechaHora(r.revisado_en)}`}</li>
          <li className={r?.aprobado_en ? "hecho" : undefined}>Aprobado{r?.aprobado && ` por ${r.aprobado} el ${fechaHora(r.aprobado_en)}`}</li>
          <li className={r?.enviado_en ? "hecho" : undefined}>Enviado{r?.enviado_en && ` el ${fechaHora(r.enviado_en)}`}</li>
        </ol>
        {cambio && <p className="error">Después de aprobarlo cambió algo del mes. Si corresponde, quita la aprobación y vuelve a aprobarlo.</p>}
        <div className="fila" style={{ alignItems: "flex-start" }}>
          {estado === "borrador" && puede(permisos, "cerrar") && (
            <Formulario accion={revisarReporte.bind(null, id, periodo)} boton="Marcar como revisado" className="fila"><span /></Formulario>
          )}
          {!aprobado && puede(permisos, "empresa") && (
            <Formulario accion={aprobarReporte.bind(null, id, periodo)} boton="Aprobar el reporte" className="fila"><span /></Formulario>
          )}
          {aprobado && r && equipo && puede(permisos, "exportar") && (
            <EnviarWhatsApp empresaId={id} clave="reporte_mensual" docRef={{ tipo: "reporte", id: r.id }} />
          )}
          {aprobado && puede(permisos, "empresa") && (
            <Formulario accion={quitarAprobacion.bind(null, id, periodo)} boton="Quitar la aprobación" className="fila"><span /></Formulario>
          )}
        </div>
        {!aprobado && !puede(permisos, "empresa") && <p className="sub" style={{ marginBottom: 0 }}>Lo aprueba un administrador de la firma (Patricia).</p>}
      </div>

      <section className="tarjeta" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Notas para el cliente</h2>
        {!aprobado && puede(permisos, "registrar") ? (
          <Formulario accion={guardarNotasReporte.bind(null, id, periodo)} boton="Guardar notas">
            <textarea name="notas" defaultValue={r?.notas ?? ""} rows={4} maxLength={3000} aria-label="Notas para el cliente"
              placeholder="Comentarios del mes, recomendaciones o lo que el cliente debe saber" />
          </Formulario>
        ) : <p style={{ margin: 0 }}>{r?.notas || <span className="sub">Sin notas.</span>}</p>}
      </section>

      <Reporte d={d} />
    </>
  );
}

function Reporte({ d }: { d: DatosReporte }) {
  const m = (x: string | null | undefined) => (x ? `RD$${verMonto(x)}` : "");
  return (
    <div className="reporte-mensual">
      <section className="tarjeta">
        <h2>1. Servicios realizados en el mes</h2>
        {d.servicios.length === 0 ? <p className="sub">Sin gestiones anotadas en la bitácora.</p> : (
          <ul>{d.servicios.map((s, i) => <li key={i}><strong>{verFecha(s.fecha)}</strong> · {s.tipo}: {s.descripcion}{s.estado !== "hecha" && <em> ({s.estado.replace("_", " ")})</em>}</li>)}</ul>
        )}
      </section>
      <section className="tarjeta">
        <h2>2. Facturas del mes</h2>
        <table><tbody>
          <tr><td>Facturas de ventas emitidas</td><td className="num">{d.ventas.cantidad}</td><td className="num">{m(d.ventas.total)}</td></tr>
          {d.notas.cantidad > 0 && <tr><td>Notas de crédito</td><td className="num">{d.notas.cantidad}</td><td className="num">−{m(d.notas.total)}</td></tr>}
          <tr><td>Facturas de compras recibidas</td><td className="num">{d.compras.cantidad}</td><td className="num">{m(d.compras.total)}</td></tr>
        </tbody></table>
      </section>
      <section className="tarjeta">
        <h2>3. ITBIS</h2>
        {d.itbis ? (
          <table><tbody>
            <tr><td>ITBIS facturado</td><td className="num">{m(d.itbis.cobrado)}</td></tr>
            <tr><td>ITBIS adelantado (compras)</td><td className="num">{m(d.itbis.deducible)}</td></tr>
            <tr><td><strong>{Number(d.itbis.aPagar) > 0 ? `A pagar antes del ${verFecha(d.itbis.vence)}` : "Saldo a favor"}</strong>
              <div className="sub" style={{ margin: 0 }}>{d.itbis.fuente === "presentado" ? "Según el IT-1 presentado" : "Calculado con lo registrado (el IT-1 aún no se ha presentado)"}</div></td>
              <td className="num"><strong>{m(Number(d.itbis.aPagar) > 0 ? d.itbis.aPagar : d.itbis.saldoFavor)}</strong></td></tr>
          </tbody></table>
        ) : <p className="sub">No declara ITBIS (IT-1) según su perfil fiscal.</p>}
      </section>
      <section className="tarjeta">
        <h2>4. Retenciones e ISR</h2>
        {d.retenciones ? (
          <table><tbody>
            <tr><td>Retenciones de ITBIS · vence {verFecha(d.retenciones.venceItbis)}</td><td className="num">{m(d.retenciones.itbis)}</td></tr>
            <tr><td>Retenciones de ISR (IR-17) · vence {verFecha(d.retenciones.venceIsr)}</td><td className="num">{m(d.retenciones.isr)}</td></tr>
          </tbody></table>
        ) : <p className="sub">Sin retenciones que declarar.</p>}
      </section>
      <section className="tarjeta">
        <h2>5. Declaraciones y notificaciones</h2>
        <table><tbody>
          {d.declaraciones.map((x) => <tr key={x.nombre}><td>{x.nombre}</td><td>{x.estado}{!x.estado.startsWith("Presentada") && ` · vence ${verFecha(x.vence)}`}</td><td className="num">{m(x.monto)}</td></tr>)}
          {d.notificaciones.map((n, i) => <tr key={i}><td>Notificación {n.tipo}{n.concepto && ` · ${n.concepto}`}</td><td>{n.estado} · fecha límite {verFecha(n.fechaLimite)}</td><td className="num">{m(n.monto)}</td></tr>)}
          {d.declaraciones.length + d.notificaciones.length === 0 && <tr><td colSpan={3} className="sub">Sin declaraciones ni notificaciones este mes.</td></tr>}
        </tbody></table>
      </section>
      <section className="tarjeta">
        <h2>6. Pendientes del cliente</h2>
        {d.pendientes.length === 0 ? <p className="sub">Nada pendiente.</p> : <ul>{d.pendientes.map((t, i) => <li key={i}>{t}</li>)}</ul>}
      </section>
      {d.cuenta && (
        <section className="tarjeta">
          <h2>7. Su cuenta con la firma</h2>
          <table><tbody>
            {d.cuenta.facturas.map((f) => <tr key={f.ncf}><td>Factura {f.ncf} · {verFecha(f.fecha)}<div className="sub" style={{ margin: 0 }}>{f.detalle}</div></td><td className="num">{m(f.total)}</td><td className="num">pendiente {m(f.saldo)}</td></tr>)}
            <tr><td><strong>Saldo pendiente</strong></td><td /><td className="num"><strong>{m(d.cuenta.saldo)}</strong></td></tr>
          </tbody></table>
        </section>
      )}
    </div>
  );
}
