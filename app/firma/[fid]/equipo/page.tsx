import { Formulario } from "@/app/formulario";
import { accesoFirma } from "@/lib/acceso";
import { db } from "@/lib/db";
import { agregarPersona, enviarAcceso, guardarAccesos, quitarDeFirma } from "../../acciones";

export const metadata = { title: "Personas y accesos · Empire Tax’N Legal" };

export default async function Equipo({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid);
  const [personas, empresas, perfiles, accesos] = await Promise.all([
    db()<{ id: string; nombre: string; email: string; administrador: boolean; verificado: boolean }[]>`
      SELECT u.id, u.nombre, u.email, mf.administrador, u.correo_verificado IS NOT NULL AS verificado FROM miembros_firma mf JOIN usuarios u ON u.id = mf.usuario_id
       WHERE mf.firma_id = ${fid} ORDER BY mf.administrador DESC, u.nombre`,
    db()<{ id: string; nombre: string }[]>`SELECT id, nombre FROM empresas WHERE firma_id = ${fid} AND activa ORDER BY nombre`,
    db()<{ id: string; nombre: string }[]>`SELECT id, nombre FROM perfiles WHERE firma_id = ${fid} ORDER BY sistema DESC, nombre`,
    db()<{ usuario_id: string; empresa_id: string; perfil_id: string }[]>`
      SELECT m.usuario_id, m.empresa_id, m.perfil_id FROM miembros m JOIN empresas e ON e.id = m.empresa_id WHERE e.firma_id = ${fid}`,
  ]);
  const acceso = (u: string, e: string) => accesos.find((a) => a.usuario_id === u && a.empresa_id === e)?.perfil_id ?? "";

  return (
    <>
      <h1>Personas y accesos</h1>
      <p className="sub">
        Los administradores de la firma entran a todos los clientes con todos los permisos. Al resto del equipo se le asigna,
        cliente por cliente, el perfil con el que trabaja.
      </p>

      <div className="tarjeta" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Agregar a una persona</h2>
        <p className="sub">Le llega un correo con un enlace para verificar su correo y crear su propia contraseña (vale 72 horas).</p>
        <Formulario accion={agregarPersona.bind(null, fid)} boton="Agregar" className="fila">
          <label style={{ flex: "1 1 220px" }}>Correo<input name="email" type="email" required /></label>
          <label style={{ flex: "1 1 200px" }}>Nombre (si es nueva)<input name="nombre" /></label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <input type="checkbox" name="administrador" style={{ minHeight: 0 }} /> Administrador de la firma
          </label>
        </Formulario>
      </div>

      {personas.map((p) => (
        <div key={p.id} className="tarjeta" style={{ marginBottom: 14 }}>
          <div className="entre">
            <div>
              <strong>{p.nombre}</strong>{p.id === usuario.id && " (tú)"}
              <div className="sub" style={{ margin: 0 }}>
                {p.email} · {p.verificado ? "correo verificado" : <span className="error">correo sin verificar</span>}
              </div>
            </div>
            {p.id !== usuario.id && (
              <div className="fila" style={{ alignItems: "flex-start" }}>
                <Formulario accion={enviarAcceso.bind(null, fid, p.id)} boton={p.verificado ? "Enviar enlace para nueva contraseña" : "Reenviar invitación"} className="fila"><span /></Formulario>
                <Formulario accion={quitarDeFirma.bind(null, fid, p.id)} boton="Quitar de la firma" className="fila"><span /></Formulario>
              </div>
            )}
          </div>
          <Formulario accion={guardarAccesos.bind(null, fid, p.id)} boton="Guardar accesos" className="">
            <label style={{ flexDirection: "row", alignItems: "center", gap: 6, margin: "12px 0" }}>
              <input type="checkbox" name="administrador" defaultChecked={p.administrador} style={{ minHeight: 0 }} /> Administrador de la firma (todos los clientes, todos los permisos)
            </label>
            {empresas.length > 0 && (
              <div className="tabla-envoltura" style={{ marginBottom: 12 }}>
                <table>
                  <thead><tr><th>Cliente</th><th>Perfil {p.administrador && "(no aplica a administradores)"}</th></tr></thead>
                  <tbody>
                    {empresas.map((e) => (
                      <tr key={e.id}>
                        <td>{e.nombre}</td>
                        <td>
                          <select name={`acceso_${e.id}`} defaultValue={acceso(p.id, e.id)} aria-label={`Acceso de ${p.nombre} a ${e.nombre}`}>
                            <option value="">Sin acceso</option>
                            {perfiles.map((pf) => <option key={pf.id} value={pf.id}>{pf.nombre}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Formulario>
        </div>
      ))}
    </>
  );
}
