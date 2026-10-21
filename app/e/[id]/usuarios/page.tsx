import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { NOMBRE_ROL, puede, type Rol } from "@/lib/permisos";
import { agregarMiembro, cambiarRol } from "../acciones";

const DESCRIPCION: Record<Rol, string> = {
  dueno: "Todo, incluido dar acceso a otras personas y reabrir períodos cerrados.",
  contador: "Registra y anula asientos, maneja el catálogo y cierra períodos.",
  auxiliar: "Registra asientos y consulta los libros.",
  lectura: "Solo consulta los libros y reportes.",
};

export default async function Usuarios({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { rol, usuario } = await accesoEmpresa(id);
  const miembros = await conEmpresa(id, (tx) => tx<{ id: string; nombre: string; email: string; rol: Rol }[]>`
    SELECT u.id, u.nombre, u.email, m.rol FROM miembros m JOIN usuarios u ON u.id = m.usuario_id ORDER BY u.nombre`);
  const administra = puede(rol, "usuarios");

  return (
    <>
      <h1>Usuarios y roles</h1>
      <p className="sub">Quién tiene acceso a esta empresa y qué puede hacer.</p>
      <div className="tabla-envoltura" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th></tr></thead>
          <tbody>
            {miembros.map((m) => (
              <tr key={m.id}>
                <td>{m.nombre}{m.id === usuario.id && " (tú)"}</td>
                <td>{m.email}</td>
                <td>
                  {administra ? (
                    <Formulario accion={cambiarRol.bind(null, id)} boton="Cambiar" className="fila">
                      <input type="hidden" name="usuario" value={m.id} />
                      <select name="rol" defaultValue={m.rol} aria-label={`Rol de ${m.nombre}`}>
                        {(Object.keys(NOMBRE_ROL) as Rol[]).map((r) => <option key={r} value={r}>{NOMBRE_ROL[r]}</option>)}
                        <option value="quitar">Quitar acceso</option>
                      </select>
                    </Formulario>
                  ) : NOMBRE_ROL[m.rol]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {administra && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Dar acceso</h2>
          <p className="sub">Si la persona todavía no tiene cuenta, se le crea con una contraseña temporal que verás una sola vez.</p>
          <Formulario accion={agregarMiembro.bind(null, id)} boton="Dar acceso" className="fila">
            <label style={{ flex: "1 1 220px" }}>Correo<input name="email" type="email" required /></label>
            <label style={{ flex: "1 1 200px" }}>Nombre (si es nueva)<input name="nombre" /></label>
            <label>Rol
              <select name="rol" defaultValue="auxiliar">
                {(Object.keys(NOMBRE_ROL) as Rol[]).map((r) => <option key={r} value={r}>{NOMBRE_ROL[r]}</option>)}
              </select>
            </label>
          </Formulario>
        </div>
      )}
      <h2>Qué puede hacer cada rol</h2>
      <div className="tabla-envoltura">
        <table>
          <tbody>
            {(Object.keys(DESCRIPCION) as Rol[]).map((r) => (
              <tr key={r}><td style={{ whiteSpace: "nowrap" }}><strong>{NOMBRE_ROL[r]}</strong></td><td>{DESCRIPCION[r]}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
