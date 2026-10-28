import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { db } from "@/lib/db";
import { PERMISOS, puede } from "@/lib/permisos";
import { asignarAcceso } from "../acciones";

export default async function Usuarios({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { permisos, empresa, usuario, adminFirma } = await accesoEmpresa(id);
  const [admins, miembros, perfiles, equipo] = await Promise.all([
    db()<{ id: string; nombre: string; email: string }[]>`
      SELECT u.id, u.nombre, u.email FROM miembros_firma mf JOIN usuarios u ON u.id = mf.usuario_id
       WHERE mf.firma_id = ${empresa.firma_id} AND mf.administrador ORDER BY u.nombre`,
    db()<{ id: string; nombre: string; email: string; perfil_id: string; perfil: string }[]>`
      SELECT u.id, u.nombre, u.email, p.id AS perfil_id, p.nombre AS perfil
        FROM miembros m JOIN usuarios u ON u.id = m.usuario_id JOIN perfiles p ON p.id = m.perfil_id
        JOIN miembros_firma mf ON mf.firma_id = ${empresa.firma_id} AND mf.usuario_id = u.id AND NOT mf.administrador
       WHERE m.empresa_id = ${id} ORDER BY u.nombre`,
    db()<{ id: string; nombre: string; permisos: string[] }[]>`SELECT id, nombre, permisos FROM perfiles WHERE firma_id = ${empresa.firma_id} ORDER BY sistema DESC, nombre`,
    db()<{ id: string; nombre: string }[]>`
      SELECT u.id, u.nombre FROM miembros_firma mf JOIN usuarios u ON u.id = mf.usuario_id
       WHERE mf.firma_id = ${empresa.firma_id} AND NOT mf.administrador
         AND NOT EXISTS (SELECT 1 FROM miembros m WHERE m.empresa_id = ${id} AND m.usuario_id = u.id) ORDER BY u.nombre`,
  ]);
  const administra = puede(permisos, "usuarios");
  const selectorPerfil = (actual = "") => (
    <select name="perfil" defaultValue={actual}>
      <option value="">{actual ? "Quitar acceso" : "Elige el perfil…"}</option>
      {perfiles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
    </select>
  );

  return (
    <>
      <h1>Usuarios y permisos</h1>
      <p className="sub">
        Quién trabaja en este cliente y con qué perfil.
        {adminFirma && <> Los perfiles se ajustan en <Link href={`/firma/${empresa.firma_id}/perfiles`}>Perfiles y permisos</Link> de la firma.</>}
      </p>
      <div className="tabla-envoltura" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>Persona</th><th>Correo</th><th>Acceso</th></tr></thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id}><td>{a.nombre}{a.id === usuario.id && " (tú)"}</td><td>{a.email}</td><td>Administrador de la firma (todos los permisos)</td></tr>
            ))}
            {miembros.map((m) => (
              <tr key={m.id}>
                <td>{m.nombre}{m.id === usuario.id && " (tú)"}</td>
                <td>{m.email}</td>
                <td>
                  {administra ? (
                    <Formulario accion={asignarAcceso.bind(null, id)} boton="Cambiar" className="fila">
                      <input type="hidden" name="usuario" value={m.id} />
                      {selectorPerfil(m.perfil_id)}
                    </Formulario>
                  ) : m.perfil}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {administra && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Dar acceso a este cliente</h2>
          {equipo.length > 0 && (
            <Formulario accion={asignarAcceso.bind(null, id)} boton="Dar acceso" className="fila">
              <label style={{ flex: "1 1 220px" }}>Persona del equipo
                <select name="usuario" required defaultValue="">
                  <option value="" disabled>Elige…</option>
                  {equipo.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </label>
              <label>Perfil{selectorPerfil()}</label>
            </Formulario>
          )}
          <p className="sub" style={{ marginTop: 16 }}>¿Alguien nuevo? Se suma al equipo de la firma con acceso solo a este cliente. Si no tiene cuenta, le llega un correo para verificarlo y crear su contraseña.</p>
          <Formulario accion={asignarAcceso.bind(null, id)} boton="Agregar y dar acceso" className="fila">
            <label style={{ flex: "1 1 220px" }}>Correo<input name="email" type="email" required /></label>
            <label style={{ flex: "1 1 200px" }}>Nombre (si es nueva)<input name="nombre" /></label>
            <label>Perfil{selectorPerfil()}</label>
          </Formulario>
        </div>
      )}
      <h2>Qué permite cada perfil</h2>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Permiso</th>{perfiles.map((p) => <th key={p.id} className="num">{p.nombre}</th>)}</tr></thead>
          <tbody>
            {PERMISOS.map((pm) => (
              <tr key={pm.clave}>
                <td>{pm.nombre}</td>
                {perfiles.map((p) => <td key={p.id} className="num">{p.permisos.includes(pm.clave) ? "✓" : ""}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
