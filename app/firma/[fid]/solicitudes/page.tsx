import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { SelectorClienteRapido } from "@/app/selector-cliente-rapido";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { clientesDeFirma, equipoDe } from "@/lib/firma";
import { ESTADOS_SOLICITUD, listarSolicitudes, ORIGENES_SOLICITUD, PRIORIDADES, TIPOS_FORMULARIO } from "@/lib/formularios";
import { hoyISO, verFecha } from "@/lib/montos";
import { crearSolicitudAccion, iniciarLevantamientoAccion } from "../../cliente-rapido-acciones";

export const metadata = { title: "Solicitudes · Empire Tax & Legal" };

// Solicitudes abiertas y formularios por revisar de todos los clientes (bloque 6a): lo más urgente arriba.
export default async function SolicitudesDeLaFirma({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  const hoy = hoyISO();
  const clientes = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => !c.propia);
  const datos = await Promise.all(clientes.map((c) => conEmpresa(c.id, async (tx) => ({
    c,
    solicitudes: await listarSolicitudes(tx, true),
    formularios: await tx<{ id: string; tipo: string; recibido_en: Date }[]>`SELECT id, tipo, recibido_en FROM formularios WHERE estado = 'recibido' ORDER BY recibido_en`,
  }))));
  const equipo = await equipoDe(fid);
  const listaClientes = clientes.map((c) => ({ id: c.id, nombre: c.nombre }));
  const solicitudes = datos.flatMap((d) => d.solicitudes.map((s) => ({ c: d.c, s })));
  const formularios = datos.flatMap((d) => d.formularios.map((f) => ({ c: d.c, f })));

  return (
    <>
      <h1>Solicitudes</h1>
      <p className="sub">Lo que piden los clientes y los formularios que mandaron y esperan revisión. Al aceptarlos, sus datos entran a la ficha.</p>
      <details className="tarjeta" style={{ marginBottom: 12 }}>
        <summary><strong>+ Nueva solicitud</strong> (llegó por WhatsApp, por escrito o en una llamada)</summary>
        <Formulario accion={crearSolicitudAccion.bind(null, fid)} boton="Anotar la solicitud" className="fila">
          <SelectorClienteRapido clientes={listaClientes} crearClientes={firma.crear_clientes} />
          <label>Llegó por<select name="origen" defaultValue="whatsapp">{Object.entries(ORIGENES_SOLICITUD).filter(([k]) => k !== "formulario" && k !== "app").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Tipo<select name="tipo" defaultValue="servicio"><option value="servicio">Servicio para cotizar</option><option value="requerimiento">Requerimiento (carta, certificación…)</option></select></label>
          <label style={{ flex: "1 1 220px" }}>Servicio<input name="servicio" maxLength={200} placeholder="Ej.: Carta de ingresos" /></label>
          <label style={{ flex: "1 1 100%" }}>Qué pide<input name="descripcion" required maxLength={2000} /></label>
          <label style={{ flex: "1 1 220px" }}>Para qué<input name="para_que" maxLength={1000} /></label>
          <label>Para cuándo<input type="date" name="fecha_requerida" /></label>
          <label>Prioridad<select name="prioridad" defaultValue="media">{Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Responsable<select name="responsable" defaultValue={usuario.id}><option value="">—</option>{equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
        </Formulario>
      </details>
      <details className="tarjeta" style={{ marginBottom: 16 }}>
        <summary><strong>+ Nuevo levantamiento contable</strong> (para una propuesta o para empezar a trabajar con el cliente)</summary>
        <p className="sub">Elige el cliente o créalo aquí. Sigues a su pantalla para mandarle el enlace del formulario por WhatsApp.</p>
        <Formulario accion={iniciarLevantamientoAccion.bind(null, fid)} boton="Crear el levantamiento" className="fila">
          <SelectorClienteRapido clientes={listaClientes} crearClientes={firma.crear_clientes} />
          <label>Levantamiento<select name="modo" defaultValue="completo"><option value="completo">Completo (con anexos y estado inicial)</option><option value="simple">Simple (datos, ingresos, nómina y necesidades)</option></select></label>
        </Formulario>
        <p className="sub">Si el cliente es nuevo queda como prospecto hasta que lo pases a cliente.</p>
      </details>
      {formularios.length > 0 && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Formularios por revisar ({formularios.length})</h2>
          <ul>{formularios.map(({ c, f }) => (
            <li key={f.id}><Link href={`/e/${c.id}/solicitudes`}>{c.nombre}: {TIPOS_FORMULARIO[f.tipo].nombre}</Link> · recibido el {f.recibido_en.toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo" })}</li>
          ))}</ul>
        </div>
      )}
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cliente</th><th>Solicitud</th><th>Para cuándo</th><th>Prioridad</th><th>Estado</th><th>Responsable</th></tr></thead>
          <tbody>
            {solicitudes.map(({ c, s }) => (
              <tr key={s.id}>
                <td><Link href={`/e/${c.id}/solicitudes`}>{c.nombre}</Link></td>
                <td>{s.servicio && <strong>{s.servicio}: </strong>}{s.descripcion}<div className="sub" style={{ margin: 0 }}>{ORIGENES_SOLICITUD[s.origen]}</div></td>
                <td style={s.fecha_requerida && s.fecha_requerida < hoy ? { color: "var(--peligro)", fontWeight: 600 } : undefined}>{s.fecha_requerida ? verFecha(s.fecha_requerida) : "—"}</td>
                <td>{PRIORIDADES[s.prioridad]}</td>
                <td>{ESTADOS_SOLICITUD[s.estado]}</td>
                <td>{s.responsable ?? "—"}</td>
              </tr>
            ))}
            {solicitudes.length === 0 && <tr><td colSpan={6}>No hay solicitudes abiertas.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
