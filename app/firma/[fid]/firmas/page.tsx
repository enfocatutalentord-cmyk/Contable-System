import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { EnviarWhatsApp } from "@/app/whatsapp";
import { accesoFirma, esUuid, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { eventosDe, ESTADOS_FIRMA, estadoVisible, listarSolicitudes, TIPOS_EVENTO, verIdentificacion } from "@/lib/firma-digital";
import { clientesDeFirma } from "@/lib/firma";
import { CARPETAS } from "@/lib/expediente";
import { cancelarSolicitudFirma, enlaceParaCopiarFirma } from "../../firma-digital-acciones";

export const metadata = { title: "Firma digital · Empire Tax & Legal" };

const fecha = (d: Date | string | null) => (d ? new Date(d).toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" }) : "—");
const CLASE: Record<string, string> = { firmada: "cita-realizada", rechazada: "cita-cancelada", cancelada: "cita-cancelada", vencida: "cita-cancelada" };

// Firma digital (Prioridad 3, P3e): los documentos que se mandaron a firmar a los clientes, en qué van y su copia firmada. Es una firma electrónica simple con
// constancia (fecha, hora, dirección de internet y huella del documento), no una firma con certificado.
export default async function FirmaDigital({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ nueva?: string }> }) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound(); // solo el equipo de la firma
  const clientes = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => c.estado_cliente !== "retirado");
  const datos = await Promise.all(clientes.map((c) => conEmpresa(c.id, async (tx) => {
    const lista = (await listarSolicitudes(tx)).slice(0, 60);
    return Promise.all(lista.map(async (s) => ({ c, s, eventos: await eventosDe(tx, s.id) })));
  })));
  const filas = datos.flat().sort((a, b) => +new Date(b.s.creado) - +new Date(a.s.creado));
  const recien = esUuid(sp.nueva ?? "") ? sp.nueva! : null;

  return (
    <>
      <h1>Firma digital</h1>
      <p className="sub">
        Manda un documento en PDF para que el cliente lo firme desde su celular: abre un enlace seguro, lo lee y firma con el dedo. Queda el PDF firmado con una página de constancia
        (hora, dirección de internet y huella del documento) en su expediente. <strong>Es una firma electrónica simple, no una firma digital con certificado</strong> (Ley 126-02):
        tú decides para qué documentos alcanza.
      </p>
      {recien && <p className="exito" role="status" style={{ marginBottom: 16 }}>Solicitud creada. Mándasela al cliente por WhatsApp o copia el enlace (abajo, en su fila).</p>}

      <section className="tarjeta" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Pedir una firma</h2>
        <form method="get" action={`/firma/${fid}/firmas/nueva`} className="fila">
          <label style={{ flex: "2 1 260px" }}>Cliente
            <select name="empresa" required defaultValue="">
              <option value="" disabled>Elige el cliente</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <button className="primario" type="submit">Continuar</button>
        </form>
        <p className="sub" style={{ marginBottom: 0 }}>
          El documento tiene que ser un PDF: uno de su expediente, una propuesta de Empire o uno que subas. Un Word (por ejemplo una carta hecha con una plantilla) se guarda como PDF desde Word primero.
        </p>
      </section>

      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Documento</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            {filas.map(({ c, s, eventos }) => {
              const est = estadoVisible(s);
              const abierta = s.estado === "pendiente" || s.estado === "vista";
              return (
                <tr key={s.id} style={recien === s.id ? { background: "var(--aviso-fondo)" } : undefined}>
                  <td>
                    <strong>{s.titulo}</strong>
                    <div><Link href={`/e/${c.id}/expediente`}>{c.nombre}</Link>{s.firmante && <> · a nombre de {s.firmante}</>}</div>
                    <div className="sub" style={{ margin: 0 }}>Pedida el {fecha(s.creado)}{s.creado_por && ` por ${s.creado_por}`} · se guarda en {CARPETAS[s.carpeta]?.nombre}</div>
                  </td>
                  <td>
                    <span className={`etiqueta-cita ${CLASE[est] ?? "cita-programada"}`}>{ESTADOS_FIRMA[est]}</span>
                    {s.estado === "firmada" && <div className="sub" style={{ margin: "4px 0 0" }}>{s.firmante_nombre} · {verIdentificacion(s.firmante_doc?.length === 11 ? "cedula" : "pasaporte", s.firmante_doc ?? "")}<br />{fecha(s.firmado_en)}{s.firmado_ip && ` · ${s.firmado_ip}`}</div>}
                    {s.estado === "rechazada" && <div className="sub" style={{ margin: "4px 0 0" }}>«{s.rechazo_motivo}»</div>}
                    {abierta && s.vence && <div className="sub" style={{ margin: "4px 0 0" }}>Vence {fecha(s.vence)}</div>}
                    <details style={{ marginTop: 4 }}>
                      <summary className="sub">Historial</summary>
                      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                        {eventos.map((e, i) => <li key={i} className="sub" style={{ margin: 0 }}>{fecha(e.en)} · {TIPOS_EVENTO[e.tipo]}{e.quien && ` (${e.quien})`}{e.detalle && ` · ${e.detalle}`}{e.ip && ` · ${e.ip}`}</li>)}
                      </ul>
                    </details>
                  </td>
                  <td>
                    <div className="fila" style={{ alignItems: "center", gap: 8 }}>
                      {abierta && <EnviarWhatsApp empresaId={c.id} clave="firma_documento" docRef={{ tipo: "firma", id: s.id }} etiqueta={s.tiene_enlace ? "Enviar de nuevo por WhatsApp" : "Enviar por WhatsApp"} />}
                      <a href={`/firma/${fid}/firmas/${c.id}/${s.id}/original`} target="_blank" rel="noopener noreferrer">Original</a>
                      {s.estado === "firmada" && <a href={`/firma/${fid}/firmas/${c.id}/${s.id}/firmado`} target="_blank" rel="noopener noreferrer"><strong>Firmado (PDF)</strong></a>}
                    </div>
                    {abierta && (
                      <div className="fila" style={{ marginTop: 6 }}>
                        <Formulario accion={enlaceParaCopiarFirma.bind(null, c.id, s.id)} boton="Enlace para copiar" className="fila boton-chico"><span /></Formulario>
                        <Formulario accion={cancelarSolicitudFirma.bind(null, c.id, s.id)} boton="Cancelar" className="fila boton-chico"><span /></Formulario>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filas.length === 0 && <tr><td colSpan={3}>Todavía no se ha pedido ninguna firma.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
