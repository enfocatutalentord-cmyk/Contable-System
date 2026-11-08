import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { EnviarWhatsApp } from "@/app/whatsapp";
import { accesoEmpresa, soloCliente } from "@/lib/acceso";
import { conEmpresa, db } from "@/lib/db";
import { leerFicha } from "@/lib/ficha";
import { equipoDe } from "@/lib/firma";
import {
  categoriaDe, ESTADOS_FORMULARIO, ESTADOS_SOLICITUD, listarFormularios, listarSolicitudes, MAX_SOCIOS_FORMULARIO, ORIGENES_SOLICITUD, PASOS_SOLICITUD,
  PRIORIDADES, SECCIONES_FICHA, TIPOS_FORMULARIO, totalPorcentaje,
} from "@/lib/formularios";
import { CATEGORIAS } from "@/lib/ficha";
import { hoyISO, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import {
  aceptarFormularioAccion, cambiarEstadoSolicitud, cotizarSolicitud, crearFormulario, descartarFormularioAccion, enlaceParaCopiar, registrarSolicitud,
} from "../solicitudes-acciones";
import { pasarAClienteAccion } from "../cliente-acciones";
import { SolicitudesCliente } from "./cliente";

const ETIQUETAS: Record<string, string> = {
  nombre: "Razón social", nombre_comercial: "Nombre comercial", rnc: "RNC", direccion: "Dirección", telefono: "Teléfono", correo: "Correo",
  tipo_sociedad: "Tipo de sociedad", fecha_constitucion: "Fecha de constitución", municipio: "Municipio", provincia: "Provincia", capital_social: "Capital social",
  ventas_mes: "Ventas al mes", facturas_mes: "Facturas al mes", empleados_mes: "Empleados", tiene_tss: "TSS", emite_ecf: "Factura electrónica",
  sistema_usa: "Sistema que usa", grupo_whatsapp: "Grupo de WhatsApp", n1: "Nombre propuesto 1", n2: "Nombre propuesto 2", n3: "Nombre propuesto 3",
  actividad: "Actividad", notas: "Notas",
};
const POR_SECCION: Record<string, string[]> = {
  empresa: ["nombre", "nombre_comercial", "rnc", "direccion", "telefono", "correo"],
  sociedad: ["tipo_sociedad", "fecha_constitucion", "municipio", "provincia", "capital_social"],
  operaciones: ["ventas_mes", "facturas_mes", "empleados_mes", "tiene_tss", "emite_ecf", "sistema_usa"],
};
const fechaHora = (d: Date | null) => d?.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" }) ?? "";
const valor = (v: unknown) => (v === true ? "Sí" : v === false ? "No" : v === "si" ? "Sí" : v === "no" ? "No" : v === null || v === undefined || v === "" ? "—" : String(v));

// Solicitudes y formularios del cliente (bloque 6a): los formularios en línea que se le envían (Ficha de Registro, Constitución,
// Solicitud de Servicio), su revisión antes de cargarlos, y todo lo que pide el cliente en una sola lista.
export default async function Solicitudes({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ paso_a_cliente?: string }> }) {
  const { id } = await params;
  const { paso_a_cliente } = await searchParams;
  const { empresa, permisos, usuario, paraClientes } = await accesoEmpresa(id);
  // El cliente o el prospecto ve su propia versión: pedir, llenar sus formularios y ver cómo va (bloque 8a).
  if (paraClientes) return <SolicitudesCliente id={id} firmaId={empresa.firma_id} />;
  const datos = await conEmpresa(id, async (tx) => ({
    estado: (await tx<{ estado_cliente: string; alta_app: Date | null }[]>`SELECT estado_cliente, alta_app FROM empresas WHERE id = ${id}`)[0],
    formularios: await listarFormularios(tx),
    solicitudes: await listarSolicitudes(tx),
    ficha: await leerFicha(tx, id, false),
    empresa: (await tx<Record<string, string | null>[]>`SELECT nombre, nombre_comercial, rnc, direccion, telefono, correo FROM empresas WHERE id = ${id}`)[0],
  }));
  const [{ propia }] = await db()<{ propia: string | null }[]>`SELECT empresa_propia_id AS propia FROM firmas WHERE id = ${empresa.firma_id}`;
  const equipo = await equipoDe(empresa.firma_id);
  const deLaFirma = !(await soloCliente(empresa.firma_id, usuario.id));
  const registra = puede(permisos, "registrar");
  const hoy = hoyISO();
  const actual: Record<string, unknown> = { ...datos.ficha.ficha, ...datos.empresa };
  const porRevisar = datos.formularios.filter((f) => f.estado === "recibido");

  return (
    <>
      <h1>Solicitudes y formularios</h1>
      <p className="sub">
        Los formularios en línea que llena {empresa.nombre} desde el celular y todo lo que pide, en un solo lugar. Lo recibido no entra a la ficha hasta
        que alguien de la firma lo acepta.
      </p>
      {paso_a_cliente !== undefined && datos.estado.estado_cliente !== "prospecto" && (
        <p className="exito" role="status">
          Pasó a cliente.{paso_a_cliente !== "0" && " Su usuario ya tiene el rol «Cliente · Con aplicación» y le avisamos por correo."}
        </p>
      )}
      {datos.estado.estado_cliente === "prospecto" && (
        <div className="aviso" style={{ marginBottom: 16 }}>
          <p style={{ marginTop: 0 }}>
            Prospecto{datos.estado.alta_app ? ` que creó su cuenta en la aplicación el ${fechaHora(datos.estado.alta_app)}` : ""}: todavía no tiene contrato.
            Cuando lo firme, pásalo a cliente; su misma cuenta toma el rol «Cliente · Con aplicación» y le avisamos por correo.
          </p>
          {registra && <Formulario accion={pasarAClienteAccion.bind(null, id)} boton="Pasar a cliente" className="fila"><span /></Formulario>}
        </div>
      )}

      {porRevisar.filter((f) => f.tipo === "levantamiento").map((f) => (
        <p key={f.id} className="aviso"><strong>Levantamiento contable por revisar:</strong> recibido el {fechaHora(f.recibido_en)}. <Link href={`/e/${id}/solicitudes/levantamiento/${f.id}`}>Abrir la revisión</Link></p>
      ))}
      {porRevisar.filter((f) => f.tipo !== "levantamiento").map((f) => {
        const r = f.respuestas ?? {};
        const sugerida = f.tipo === "ficha" ? categoriaDe(r) : null;
        const socios = Array.from({ length: MAX_SOCIOS_FORMULARIO }, (_, i) => i).filter((i) => r[`s${i}_nombre`]);
        const contactos = ["principal", "alterno", "representante", "gerente"].filter((c) => r[`c_${c}_nombre`]);
        return (
          <section key={f.id} className="tarjeta revision-formulario" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>Por revisar: {TIPOS_FORMULARIO[f.tipo].nombre}</h2>
            <p className="sub" style={{ marginTop: 0 }}>Recibido el {fechaHora(f.recibido_en)}. Marca lo que quieres cargar; lo que el cliente dejó en blanco no borra lo que ya hay.</p>
            <Formulario accion={aceptarFormularioAccion.bind(null, id, f.id)} boton={f.tipo === "ficha" ? "Cargar lo marcado" : "Aceptar y abrir la empresa nueva"}>
              {(f.tipo === "ficha" ? ["empresa", "sociedad", "operaciones"] : []).map((sec) => (
                <fieldset key={sec}>
                  <legend><label style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><input type="checkbox" name={`sec_${sec}`} defaultChecked style={{ minHeight: 0 }} /> {SECCIONES_FICHA[sec]}</label></legend>
                  <table><thead><tr><th>Dato</th><th>Lo que envió</th><th>Lo que hay hoy</th></tr></thead>
                    <tbody>{POR_SECCION[sec].filter((k) => r[k]).map((k) => (
                      <tr key={k}><td>{ETIQUETAS[k]}</td><td><strong>{valor(r[k])}</strong></td><td className="sub">{valor(actual[k])}</td></tr>
                    ))}{POR_SECCION[sec].every((k) => !r[k]) && <tr><td colSpan={3} className="sub">No llenó esta parte.</td></tr>}</tbody>
                  </table>
                </fieldset>
              ))}
              {f.tipo === "constitucion" && (
                <table><tbody>{["n1", "n2", "n3", "actividad", "direccion", "capital_social", "tiene_tss", "notas"].filter((k) => r[k]).map((k) => (
                  <tr key={k}><td>{ETIQUETAS[k]}</td><td><strong>{valor(r[k])}</strong></td></tr>
                ))}</tbody></table>
              )}
              {socios.length > 0 && (
                <fieldset>
                  <legend>{f.tipo === "ficha" ? <label style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><input type="checkbox" name="sec_socios" defaultChecked style={{ minHeight: 0 }} /> Socios (reemplazan los de la ficha)</label> : "Accionistas"}</legend>
                  <table><thead><tr><th>Nombre</th><th>Cédula</th><th className="num">%</th></tr></thead>
                    <tbody>{socios.map((i) => <tr key={i}><td>{r[`s${i}_nombre`]}</td><td>{r[`s${i}_cedula`] ?? "—"}</td><td className="num">{r[`s${i}_porcentaje`] ?? "—"}</td></tr>)}</tbody>
                    <tfoot><tr><td colSpan={2}>Total</td><td className="num">{totalPorcentaje(r)} %</td></tr></tfoot>
                  </table>
                </fieldset>
              )}
              {contactos.length > 0 && (
                <fieldset>
                  <legend>{f.tipo === "ficha" ? <label style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><input type="checkbox" name="sec_contactos" defaultChecked style={{ minHeight: 0 }} /> Contactos</label> : "Gerente"}</legend>
                  <ul>{contactos.map((c) => <li key={c}><strong>{c}</strong>: {r[`c_${c}_nombre`]}{r[`c_${c}_cedula`] && ` · ${r[`c_${c}_cedula`]}`}{r[`c_${c}_whatsapp`] && ` · ${r[`c_${c}_whatsapp`]}`}{r[`c_${c}_correo`] && ` · ${r[`c_${c}_correo`]}`}</li>)}
                    {r.grupo_whatsapp && <li>Grupo de WhatsApp: {r.grupo_whatsapp}</li>}</ul>
                </fieldset>
              )}
              {f.adjuntos.length > 0 && (
                <fieldset>
                  <legend>{f.tipo === "ficha" ? <label style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><input type="checkbox" name="sec_adjuntos" defaultChecked style={{ minHeight: 0 }} /> Documentos adjuntos (van a «01 Documentos legales»)</label> : "Documentos adjuntos (van a «01 Documentos legales»)"}</legend>
                  <ul>{f.adjuntos.map((d) => <li key={d.id}><a href={`/e/${id}/documentos/${d.id}`} target="_blank" rel="noreferrer">{d.nombre}</a></li>)}</ul>
                </fieldset>
              )}
              {sugerida && <p className="sub">Categoría sugerida por lo que dijo de sus operaciones: <strong>{CATEGORIAS[sugerida]}</strong> (se elige en la ficha, en Relación con la firma).</p>}
            </Formulario>
            {registra && <Formulario accion={descartarFormularioAccion.bind(null, id, f.id)} boton="Descartar" className="fila"><span /></Formulario>}
          </section>
        );
      })}

      <h2>Formularios en línea</h2>
      {registra && (
        <Formulario accion={crearFormulario.bind(null, id)} boton="Preparar formulario" className="fila">
          <label>Formulario<select name="tipo" defaultValue="ficha">{Object.entries(TIPOS_FORMULARIO).map(([k, v]) => <option key={k} value={k}>{v.nombre} ({v.codigo})</option>)}</select></label>
        </Formulario>
      )}
      <div className="tabla-envoltura" style={{ margin: "12px 0 24px" }}>
        <table>
          <thead><tr><th>Formulario</th><th>Preparado</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {datos.formularios.map((f) => (
              <tr key={f.id} style={["aceptado", "descartado"].includes(f.estado) ? { opacity: 0.65 } : undefined}>
                <td>{f.tipo === "levantamiento" && f.estado !== "pendiente" && f.estado !== "descartado" ? <Link href={`/e/${id}/solicitudes/levantamiento/${f.id}`}>{TIPOS_FORMULARIO[f.tipo].nombre}</Link> : TIPOS_FORMULARIO[f.tipo].nombre}</td>
                <td>{fechaHora(f.creado)}{f.creado_por && <div className="sub" style={{ margin: 0 }}>{f.creado_por}</div>}</td>
                <td>{ESTADOS_FORMULARIO[f.estado]}{f.estado === "pendiente" && f.vence && <div className="sub" style={{ margin: 0 }}>enlace hasta el {verFecha(f.vence.toISOString().slice(0, 10))}</div>}
                  {f.revisado_por && <div className="sub" style={{ margin: 0 }}>por {f.revisado_por}</div>}</td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  {f.estado === "pendiente" && deLaFirma && puede(permisos, "exportar") && (
                    <EnviarWhatsApp empresaId={id} clave={TIPOS_FORMULARIO[f.tipo].mensaje} docRef={{ tipo: "formulario", id: f.id }} etiqueta="Enviar por WhatsApp" />
                  )}
                  {f.estado === "pendiente" && registra && <Formulario accion={enlaceParaCopiar.bind(null, id, f.id)} boton="Enlace para copiar" className="fila"><span /></Formulario>}
                  {f.estado === "pendiente" && registra && <Formulario accion={descartarFormularioAccion.bind(null, id, f.id)} boton="Descartar" className="fila"><span /></Formulario>}
                </td>
              </tr>
            ))}
            {datos.formularios.length === 0 && <tr><td colSpan={4}>Todavía no se le ha enviado ningún formulario.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Solicitudes</h2>
      {registra && (
        <details className="tarjeta" style={{ marginBottom: 12 }}>
          <summary><strong>Anotar una solicitud</strong> (llegó por WhatsApp, por escrito o en una llamada)</summary>
          <Formulario accion={registrarSolicitud.bind(null, id)} boton="Anotar" className="fila">
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
      )}
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Solicitud</th><th>Para cuándo</th><th>Prioridad</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {datos.solicitudes.map((s) => {
              const atrasada = s.fecha_requerida && s.fecha_requerida < hoy && !["entregada", "descartada"].includes(s.estado);
              return (
                <tr key={s.id} style={["entregada", "descartada"].includes(s.estado) ? { opacity: 0.65 } : undefined}>
                  <td>
                    <strong>{s.servicio ?? (s.tipo === "requerimiento" ? "Requerimiento" : "Servicio")}</strong>: {s.descripcion}
                    {s.para_que && <div className="sub" style={{ margin: 0 }}>Para: {s.para_que}</div>}
                    <div className="sub" style={{ margin: 0 }}>{ORIGENES_SOLICITUD[s.origen]} · {fechaHora(s.creado)}{s.responsable && ` · ${s.responsable}`}</div>
                  </td>
                  <td style={atrasada ? { color: "var(--peligro)", fontWeight: 600 } : undefined}>{s.fecha_requerida ? verFecha(s.fecha_requerida) : "—"}</td>
                  <td>{PRIORIDADES[s.prioridad]}</td>
                  <td>{ESTADOS_SOLICITUD[s.estado]}{s.propuesta_id && propia && <div><Link href={`/e/${propia}/propuestas/${s.propuesta_id}`}>Propuesta n.º {s.propuesta_numero}</Link></div>}</td>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    {registra && s.estado === "recibida" && s.tipo === "servicio" && <Formulario accion={cotizarSolicitud.bind(null, id, s.id)} boton="Cotizar" className="fila"><span /></Formulario>}
                    {registra && (PASOS_SOLICITUD[s.estado] ?? []).filter((e) => e !== "cotizada").map((e) => (
                      <Formulario key={e} accion={cambiarEstadoSolicitud.bind(null, id, s.id, e)} boton={ESTADOS_SOLICITUD[e]} className="fila boton-chico"><span /></Formulario>
                    ))}
                  </td>
                </tr>
              );
            })}
            {datos.solicitudes.length === 0 && <tr><td colSpan={5}>No hay solicitudes.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
