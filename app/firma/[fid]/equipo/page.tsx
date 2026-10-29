import { Formulario } from "@/app/formulario";
import { accesoFirma } from "@/lib/acceso";
import { db } from "@/lib/db";
import { agregarPersona, enviarAcceso, guardarAccesos, quitarDeFirma, reiniciarDosPasos } from "../../acciones";

export const metadata = { title: "Personas y accesos · Empire Tax’N Legal" };

export default async function Equipo({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid);
  const [personas, empresas, perfiles, accesos] = await Promise.all([
    db()<{ id: string; nombre: string; email: string; administrador: boolean; verificado: boolean; dos_pasos: boolean }[]>`
      SELECT u.id, u.nombre, u.email, mf.administrador, u.correo_verificado IS NOT NULL AS verificado,
             u.dos_pasos_desde IS NOT NULL AS dos_pasos FROM miembros_firma mf JOIN usuarios u ON u.id = mf.usuario_id
       WHERE mf.firma_id = ${fid} ORDER BY mf.administrador DESC, u.nombre`,
    db()<{ id: string; nombre: string }[]>`SELECT id, nombre FROM empresas WHERE firma_id = ${fid} AND activa ORDER BY nombre`,
    db()<{ id: string; nombre: string; para_clientes: boolean }[]>`
      SELECT id, nombre, para_clientes FROM perfiles WHERE firma_id = ${fid} ORDER BY sistema DESC, nombre`,
    db()<{ usuario_id: string; empresa_id: string; perfil_id: string }[]>`
      SELECT m.usuario_id, m.empresa_id, m.perfil_id FROM miembros m JOIN empresas e ON e.id = m.empresa_id WHERE e.firma_id = ${fid}`,
  ]);
  const acceso = (u: string, e: string) => accesos.find((a) => a.usuario_id === u && a.empresa_id === e)?.perfil_id ?? "";
  // Usuarios de clientes: no administran y todos sus roles son roles para clientes.
  const deCliente = new Set(perfiles.filter((p) => p.para_clientes).map((p) => p.id));
  const esDeCliente = (p: (typeof personas)[number]) => {
    const suyos = accesos.filter((a) => a.usuario_id === p.id);
    return !p.administrador && suyos.length > 0 && suyos.every((a) => deCliente.has(a.perfil_id));
  };
  const opcionesRol = (
    <>
      <optgroup label="Roles del equipo">{perfiles.filter((p) => !p.para_clientes).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</optgroup>
      <optgroup label="Roles para clientes">{perfiles.filter((p) => p.para_clientes).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</optgroup>
    </>
  );

  return (
    <>
      <h1>Personas y accesos</h1>
      <p className="sub">
        Los administradores de la firma ven todo. A las demás personas se les da, cliente por cliente, un rol: los <b>roles del equipo</b>
        son para la gente de la firma y los <b>roles para clientes</b>, para los usuarios de cada empresa, que solo ven su empresa.
        Qué pestañas ve cada rol se define en «Roles y permisos».
      </p>

      <div className="tarjeta" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Agregar a una persona</h2>
        <p className="sub">Le llega un correo con un enlace para verificar su correo y crear su propia contraseña (vale 72 horas).</p>
        <Formulario accion={agregarPersona.bind(null, fid)} boton="Agregar" className="fila">
          <label style={{ flex: "1 1 220px" }}>Correo<input name="email" type="email" required /></label>
          <label style={{ flex: "1 1 200px" }}>Nombre (si es nueva)<input name="nombre" /></label>
          <label style={{ flex: "1 1 200px" }}>Cliente
            <select name="empresa" defaultValue="">
              <option value="">Ninguno por ahora</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </label>
          <label style={{ flex: "1 1 200px" }}>Rol en ese cliente
            <select name="perfil" defaultValue="">
              <option value="">Elige…</option>
              {opcionesRol}
            </select>
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <input type="checkbox" name="administrador" style={{ minHeight: 0 }} /> Administrador de la firma (ve todo)
          </label>
        </Formulario>
      </div>

      {[["Equipo de la firma", personas.filter((p) => !esDeCliente(p))], ["Usuarios de clientes", personas.filter(esDeCliente)]].map(([titulo, lista]) => (
        <section key={titulo as string}>
          <h2>{titulo as string}</h2>
          {(lista as typeof personas).length === 0 && <p className="sub">Nadie todavía.</p>}
      {(lista as typeof personas).map((p) => (
        <div key={p.id} className="tarjeta" style={{ marginBottom: 14 }}>
          <div className="entre">
            <div>
              <strong>{p.nombre}</strong>{p.id === usuario.id && " (tú)"}
              <div className="sub" style={{ margin: 0 }}>
                {p.email} · {p.verificado ? "correo verificado" : <span className="error">correo sin verificar</span>}
                {" · "}{p.dos_pasos ? "verificación en dos pasos activa" : firma.exigir_dos_pasos ? <span className="error">sin verificación en dos pasos</span> : "sin verificación en dos pasos"}
              </div>
            </div>
            {p.id !== usuario.id && (
              <div className="fila" style={{ alignItems: "flex-start" }}>
                <Formulario accion={enviarAcceso.bind(null, fid, p.id)} boton={p.verificado ? "Enviar enlace para nueva contraseña" : "Reenviar invitación"} className="fila"><span /></Formulario>
                {p.dos_pasos && <Formulario accion={reiniciarDosPasos.bind(null, fid, p.id)} boton="Quitar verificación en dos pasos" className="fila"><span /></Formulario>}
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
                  <thead><tr><th>Cliente</th><th>Rol {p.administrador && "(no aplica a administradores)"}</th></tr></thead>
                  <tbody>
                    {empresas.map((e) => (
                      <tr key={e.id}>
                        <td>{e.nombre}</td>
                        <td>
                          <select name={`acceso_${e.id}`} defaultValue={acceso(p.id, e.id)} aria-label={`Acceso de ${p.nombre} a ${e.nombre}`}>
                            <option value="">Sin acceso</option>
                            {opcionesRol}
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
        </section>
      ))}
    </>
  );
}
