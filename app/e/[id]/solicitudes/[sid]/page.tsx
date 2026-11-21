import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { EnviarWhatsApp } from "@/app/whatsapp";
import { accesoEmpresa, esUuid, soloCliente } from "@/lib/acceso";
import { conEmpresa, db } from "@/lib/db";
import { ESTADOS_SOLICITUD, ORIGENES_SOLICITUD, PASOS_SOLICITUD, PRIORIDADES } from "@/lib/formularios";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { precioPara, preciosVigentes } from "@/lib/precios";
import { ESTADOS_REQUISITO, faltan, listarRequisitos, textoRequisitos } from "@/lib/trabajos";
import { cambiarEstadoSolicitud } from "../../solicitudes-acciones";
import { agregarRequisito, cargarRequisitos, facturarTrabajo, guardarPrecioTrabajo, marcarRequisito } from "../../trabajo-acciones";

export const metadata = { title: "Trabajo · Empire Tax & Legal" };

type Trabajo = {
  id: string; origen: string; tipo: string; servicio_id: string | null; servicio: string | null; descripcion: string; para_que: string | null; fecha_requerida: string | null;
  prioridad: string; estado: string; responsable: string | null; creado: Date; precio: string | null; factura_id: string | null; propuesta_numero: number | null; categoria: string | null;
};
const fechaHora = (d: Date | null) => d?.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" }) ?? "";

// El trabajo: la solicitud de un cliente con lo que se le pide (requisitos), su precio y su factura (Prioridad 2.2, P2d).
export default async function TrabajoPantalla({ params }: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = await params;
  if (!esUuid(sid)) notFound();
  const { permisos, empresa, usuario, paraClientes } = await accesoEmpresa(id);
  if (paraClientes) notFound();
  const datos = await conEmpresa(id, async (tx) => {
    const [t] = await tx<Trabajo[]>`
      SELECT s.id, s.origen, s.tipo, s.servicio_id, s.servicio, s.descripcion, s.para_que, to_char(s.fecha_requerida, 'YYYY-MM-DD') AS fecha_requerida, s.prioridad, s.estado,
             u.nombre AS responsable, s.creado, s.precio::text, s.factura_id, s.propuesta_numero, e.categoria
        FROM solicitudes s LEFT JOIN usuarios u ON u.id = s.responsable_id JOIN empresas e ON e.id = s.empresa_id WHERE s.id = ${sid}`;
    return t ? { t, requisitos: await listarRequisitos(tx, sid) } : null;
  });
  if (!datos) notFound();
  const { t, requisitos } = datos;
  const [{ propia }] = await db()<{ propia: string | null }[]>`SELECT empresa_propia_id AS propia FROM firmas WHERE id = ${empresa.firma_id}`;
  const registra = puede(permisos, "registrar");
  const deLaFirma = !(await soloCliente(empresa.firma_id, usuario.id));

  // Precio de la lista para la categoría del cliente, y cómo va la factura si ya hay (se leen de la empresa propia).
  const lista = propia && t.servicio_id ? await conEmpresa(propia, async (tx) => {
    const [s] = await tx<{ precio: string }[]>`SELECT precio::text FROM servicios WHERE id = ${t.servicio_id}`;
    return s ? precioPara(s.precio, (await preciosVigentes(tx, hoyISO())).get(t.servicio_id!), t.categoria) : null;
  }) : null;
  const factura = propia && t.factura_id ? await db().begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${propia}, true)`;
    const [f] = await tx<{ estado: string; ncf: string | null; total: string; saldo: string | null; anulada: boolean }[]>`
      SELECT f.estado, f.ncf, f.total::text, s.saldo::text, f.anulada FROM facturas f LEFT JOIN saldos_factura s ON s.factura_id = f.id WHERE f.id = ${t.factura_id}`;
    return f ?? null;
  }) : null;
  const pendientes = faltan(requisitos);
  const cerrada = ["entregada", "descartada"].includes(t.estado);

  return (
    <>
      <p><Link href={`/e/${id}/solicitudes`}>← Solicitudes y formularios</Link></p>
      <div className="entre">
        <div>
          <h1>{t.servicio ?? (t.tipo === "requerimiento" ? "Requerimiento" : "Trabajo")}</h1>
          <p className="sub">{empresa.nombre} · {ESTADOS_SOLICITUD[t.estado]} · prioridad {PRIORIDADES[t.prioridad].toLowerCase()} · {ORIGENES_SOLICITUD[t.origen]}, {fechaHora(t.creado)}{t.responsable && ` · ${t.responsable}`}</p>
        </div>
      </div>
      <section className="tarjeta" style={{ marginBottom: 16 }}>
        <p style={{ marginTop: 0 }}>{t.descripcion}</p>
        {t.para_que && <p className="sub">Para: {t.para_que}</p>}
        {t.fecha_requerida && <p className="sub">Para cuándo: {verFecha(t.fecha_requerida)}</p>}
        {registra && (PASOS_SOLICITUD[t.estado] ?? []).length > 0 && (
          <div className="fila" style={{ marginTop: 8 }}>
            {PASOS_SOLICITUD[t.estado].filter((e) => e !== "cotizada").map((e) => (
              <Formulario key={e} accion={cambiarEstadoSolicitud.bind(null, id, t.id, e)} boton={ESTADOS_SOLICITUD[e]} className="fila boton-chico"><span /></Formulario>
            ))}
          </div>
        )}
        {pendientes > 0 && !cerrada && <p className="aviso">{pendientes === 1 ? "Falta 1 requisito obligatorio" : `Faltan ${pendientes} requisitos obligatorios`}: sin {pendientes === 1 ? "él" : "ellos"} el trabajo no se puede entregar.</p>}
      </section>

      <section className="tarjeta" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Requisitos</h2>
        {requisitos.length === 0 ? (
          <>
            <p className="sub">Todavía no se le han pedido requisitos a este cliente para este trabajo.</p>
            {registra && t.servicio_id && <Formulario accion={cargarRequisitos.bind(null, id, t.id)} boton="Cargar los requisitos del servicio" className="fila"><span /></Formulario>}
          </>
        ) : (
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Qué se le pide</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {requisitos.map((r) => (
                  <tr key={r.id} style={r.estado === "pendiente" ? undefined : { opacity: 0.7 }}>
                    <td>{r.texto}{!r.obligatorio && <span className="sub"> (opcional)</span>}</td>
                    <td>{ESTADOS_REQUISITO[r.estado]}{r.recibido_en && <div className="sub" style={{ margin: 0 }}>{fechaHora(r.recibido_en)}{r.recibido_por && ` · ${r.recibido_por}`}</div>}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      {registra && (["recibido", "no_aplica", "pendiente"] as const).filter((e) => e !== r.estado).map((e) => (
                        <Formulario key={e} accion={marcarRequisito.bind(null, id, r.id, e)} boton={e === "pendiente" ? "Devolver a pendiente" : e === "recibido" ? "Recibido" : "No aplica"} className="fila boton-chico"><span /></Formulario>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {registra && (
          <Formulario accion={agregarRequisito.bind(null, id, t.id)} boton="Agregar un requisito" className="fila">
            <label style={{ flex: "2 1 280px" }}>Otro requisito para este trabajo<input name="texto" maxLength={300} required /></label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><input type="checkbox" name="opcional" style={{ minHeight: 0 }} /> Es opcional</label>
          </Formulario>
        )}
        {deLaFirma && puede(permisos, "exportar") && textoRequisitos(requisitos) && (
          <p style={{ marginTop: 12 }}><EnviarWhatsApp empresaId={id} clave="requisitos_servicio" extra={{ servicio: t.servicio ?? "su solicitud", requisitos: textoRequisitos(requisitos) }} etiqueta="Pedirle lo que falta por WhatsApp" /></p>
        )}
      </section>

      <section className="tarjeta">
        <h2 style={{ marginTop: 0 }}>Precio y factura</h2>
        {propia === null && <p className="aviso">Sin empresa propia elegida no se puede facturar: elígela en Empresas Empire.</p>}
        {t.propuesta_numero && propia && <p className="sub">Cotizado en la propuesta n.º {t.propuesta_numero}. <Link href={`/e/${propia}/propuestas`}>Ver propuestas</Link></p>}
        {factura ? (
          <p>
            Factura {factura.ncf ?? "en borrador"} · RD${verMonto(factura.total)} · {factura.anulada ? "anulada" : factura.estado === "borrador" ? "borrador por emitir" : factura.saldo !== null && Number(factura.saldo) === 0 ? "pagada" : `por cobrar RD$${verMonto(factura.saldo ?? factura.total)}`}.{" "}
            {propia && <Link href={`/e/${propia}/facturas/${t.factura_id}`}>Abrir la factura</Link>}
          </p>
        ) : (
          <>
            {registra && (
              <Formulario accion={guardarPrecioTrabajo.bind(null, id, t.id)} boton="Guardar precio" className="fila">
                <label>Precio acordado (RD$, sin ITBIS)<input name="precio" inputMode="decimal" defaultValue={t.precio ?? ""} placeholder={lista ? `Lista: ${verMonto(lista.precio)}` : "Escríbelo"} /></label>
              </Formulario>
            )}
            <p className="sub">{t.precio ? `Se facturará a RD$${verMonto(t.precio)}.` : lista ? `Sin precio acordado: se factura el de la lista${t.categoria ? " para su categoría" : ""}, RD$${verMonto(lista.precio)}.` : "Escribe el precio, porque este trabajo no tiene un servicio con precio en la lista."}</p>
            {registra && propia && t.estado !== "descartada" && <Formulario accion={facturarTrabajo.bind(null, id, t.id)} boton="Crear la factura (borrador)" className="fila"><span /></Formulario>}
          </>
        )}
      </section>
    </>
  );
}
