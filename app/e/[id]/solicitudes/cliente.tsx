import { Formulario } from "@/app/formulario";
import { conEmpresa, db } from "@/lib/db";
import { ESTADOS_FORMULARIO, ESTADOS_SOLICITUD, listarFormularios, listarSolicitudes, PRIORIDADES, serviciosDeLaFirma, TIPOS_FORMULARIO } from "@/lib/formularios";
import { hoyISO, verFecha } from "@/lib/montos";
import { GRUPOS_SERVICIO } from "@/lib/precios";
import { llenarFormulario, pedirServicio } from "../cliente-acciones";

// «Mis solicitudes» del cliente o del prospecto en la aplicación (bloque 8a): pedir un servicio o un requerimiento, llenar sus
// formularios y ver cómo va cada cosa. Lo que pide entra a la misma lista que ve el equipo (origen «Aplicación»).
export async function SolicitudesCliente({ id, firmaId }: { id: string; firmaId: string }) {
  const [{ propia }] = await db()<{ propia: string | null }[]>`SELECT empresa_propia_id AS propia FROM firmas WHERE id = ${firmaId}`;
  const [datos, servicios] = await Promise.all([
    conEmpresa(id, async (tx) => ({
      solicitudes: await listarSolicitudes(tx),
      formularios: await listarFormularios(tx),
      estado: (await tx<{ estado_cliente: string }[]>`SELECT estado_cliente FROM empresas WHERE id = ${id}`)[0].estado_cliente,
    })),
    serviciosDeLaFirma(propia),
  ]);
  const grupos = [...new Set(servicios.map((s) => s.grupo ?? ""))];
  const ultimo = (tipo: string) => datos.formularios.find((f) => f.tipo === tipo);

  return (
    <>
      <h1>Mis solicitudes</h1>
      {datos.estado === "prospecto" && (
        <p className="aviso">Tu cuenta está como prospecto: puedes pedir servicios, llenar tus formularios y subir tus documentos. Cuando firmes el contrato,
          esta misma cuenta pasa a cliente y verás tu pantalla de inicio con lo de cada mes.</p>
      )}
      <div className="tarjeta" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Pedir algo a Empire</h2>
        <Formulario accion={pedirServicio.bind(null, id)} boton="Enviar solicitud">
          <label>¿Qué es?
            <select name="tipo" defaultValue="servicio">
              <option value="servicio">Un servicio (contabilidad, impuestos, legal…)</option>
              <option value="requerimiento">Un documento (carta, certificación, estados financieros…)</option>
            </select>
          </label>
          {servicios.length > 0 && (
            <label>Servicio (opcional)
              <select name="servicio_id" defaultValue="">
                <option value="">No sé cuál: lo describo abajo</option>
                {grupos.map((g) => (
                  <optgroup key={g} label={GRUPOS_SERVICIO[g] ?? (g || "Otros")}>
                    {servicios.filter((s) => (s.grupo ?? "") === g).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
          <label>¿Qué necesitas?<textarea name="descripcion" required maxLength={2000} rows={3} /></label>
          <label>¿Para qué? (opcional)<input name="para_que" maxLength={1000} placeholder="Ej.: para el banco" /></label>
          <div className="fila">
            <label>¿Para cuándo? (opcional)<input type="date" name="fecha_requerida" min={hoyISO()} /></label>
            <label>Prioridad
              <select name="prioridad" defaultValue="media">{Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
          </div>
        </Formulario>
      </div>

      <div className="tarjeta" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Mis formularios</h2>
        <div className="fila">
          {(["ficha", "constitucion"] as const).map((t) => {
            const f = ultimo(t);
            return (
              <div key={t} style={{ flex: "1 1 240px" }}>
                <strong>{TIPOS_FORMULARIO[t].nombre}</strong>
                <p className="sub" style={{ margin: "4px 0 8px" }}>
                  {t === "ficha" ? "Los datos de tu empresa, socios y contactos." : "Si vas a formar una empresa nueva."}
                  {f && <> Estado: {ESTADOS_FORMULARIO[f.estado]}.</>}
                </p>
                {(!f || f.estado === "pendiente" || f.estado === "descartado") && (
                  <Formulario accion={llenarFormulario.bind(null, id, t)} boton={f?.estado === "pendiente" ? "Seguir llenándolo" : "Llenarlo"} className="fila"><span /></Formulario>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <h2>Lo que he pedido</h2>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Fecha</th><th>Qué</th><th>Para cuándo</th><th>Estado</th></tr></thead>
          <tbody>
            {datos.solicitudes.map((s) => (
              <tr key={s.id}>
                <td>{verFecha(s.creado.toISOString().slice(0, 10))}</td>
                <td>{s.servicio ? <><strong>{s.servicio}</strong><br /></> : null}{s.descripcion}</td>
                <td>{s.fecha_requerida ? verFecha(s.fecha_requerida) : "—"}</td>
                <td>{ESTADOS_SOLICITUD[s.estado]}</td>
              </tr>
            ))}
            {datos.solicitudes.length === 0 && <tr><td colSpan={4}>Todavía no has pedido nada.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
