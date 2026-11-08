import { Formulario } from "@/app/formulario";
import { accesoFirma } from "@/lib/acceso";
import { db } from "@/lib/db";
import Link from "next/link";
import { SupervisionFirma } from "./supervision";
import { PermisosPersona } from "./permisos-persona";
import { PERMISOS } from "@/lib/permisos";
import { PESTANAS_CLIENTE, PESTANAS_PRIVADAS, PESTANAS_SOLO_PROPIA } from "@/lib/pestanas";
import { agregarPersona, enviarAcceso, guardarAccesos, guardarPermisosPersona, quitarDeFirma, reiniciarDosPasos } from "../../acciones";

export const metadata = { title: "Personas y accesos · Empire Tax’N Legal" };

export default async function Equipo({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid);
  const [personas, empresas, perfiles, accesos] = await Promise.all([
    db()<{ id: string; nombre: string; email: string; administrador: boolean; verificado: boolean; dos_pasos: boolean;
           permisos_clientes: string[] | null; pestanas_clientes: string[] | null; alcance: string; clientes: string[];
           permisos_empire: string[] | null; pestanas_empire: string[] | null; crear_clientes: boolean; plantillas: string[];
           permisos_por: string | null; permisos_en: Date | null }[]>`
      SELECT u.id, u.nombre, u.email, mf.administrador, u.correo_verificado IS NOT NULL AS verificado,
             u.dos_pasos_desde IS NOT NULL AS dos_pasos, mf.permisos_clientes, mf.pestanas_clientes, mf.alcance, mf.clientes::text[] AS clientes,
             mf.permisos_empire, mf.pestanas_empire, mf.crear_clientes, mf.plantillas, mf.permisos_por, mf.permisos_en
        FROM miembros_firma mf JOIN usuarios u ON u.id = mf.usuario_id
       WHERE mf.firma_id = ${fid} ORDER BY mf.administrador DESC, u.nombre`,
    db()<{ id: string; nombre: string }[]>`SELECT id, nombre FROM empresas WHERE firma_id = ${fid} AND activa ORDER BY nombre`,
    db()<{ id: string; nombre: string; para_clientes: boolean; permisos: string[]; pestanas: string[] | null }[]>`
      SELECT id, nombre, para_clientes, permisos, pestanas FROM perfiles WHERE firma_id = ${fid} ORDER BY sistema DESC, nombre`,
    db()<{ usuario_id: string; empresa_id: string; perfil_id: string }[]>`
      SELECT m.usuario_id, m.empresa_id, m.perfil_id FROM miembros m JOIN empresas e ON e.id = m.empresa_id WHERE e.firma_id = ${fid}`,
  ]);
  const acceso = (u: string, e: string) => accesos.find((a) => a.usuario_id === u && a.empresa_id === e)?.perfil_id ?? "";
  // Usuarios de clientes: no administran y todos sus roles son roles para clientes.
  const deCliente = new Set(perfiles.filter((p) => p.para_clientes).map((p) => p.id));
  const esDeCliente = (p: (typeof personas)[number]) => {
    const suyos = accesos.filter((a) => a.usuario_id === p.id);
    return !p.administrador && !p.permisos_clientes && !p.permisos_empire && suyos.length > 0 && suyos.every((a) => deCliente.has(a.perfil_id));
  };
  // Casillas por sección (rediseño R6): las pantallas de un cliente (sin lo que es solo de Empire) y las de Contabilidad Empire.
  const nombreGrupo = (g?: string) => (g === "Cliente elegido" ? "General" : g ?? "General");
  const gruposClientes = PESTANAS_CLIENTE.map((s) => ({ grupo: nombreGrupo(s.grupo), enlaces: s.enlaces.filter(([r]) => !PESTANAS_SOLO_PROPIA.includes(r)) }))
    .filter((g) => g.enlaces.length);
  const gruposEmpire = PESTANAS_CLIENTE.map((s) => ({ grupo: nombreGrupo(s.grupo), enlaces: s.enlaces }));
  const roles = perfiles.filter((p) => !p.para_clientes).map((p) => ({ nombre: p.nombre, permisos: p.permisos, pestanas: p.pestanas }));
  const sinDosPasos = personas.filter((p) => !esDeCliente(p) && !p.dos_pasos);
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

      {!firma.exigir_dos_pasos && sinDosPasos.length > 0 && (
        <p className="aviso">
          {sinDosPasos.length === 1 ? "1 persona del equipo no tiene" : `${sinDosPasos.length} personas del equipo no tienen`} la verificación en dos pasos
          ({sinDosPasos.map((p) => p.nombre).join(", ")}). <Link href={`/firma/${fid}/clientes#datos-firma`}>Exigirla a todo el equipo en Datos de la firma</Link>:
          quien no la tenga la activa al entrar.
        </p>
      )}
      <p className="sub">
        <b>Permisos propios (nuevo):</b> a cada persona del equipo se le marcan sus casillas por sección (Firma y Contabilidad Empire), con qué
        clientes trabaja y si puede crear clientes. Los roles sirven de plantillas que se suman. Quien no tenga permisos propios sigue con su
        rol cliente por cliente.
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
          {titulo === "Equipo de la firma" && !p.administrador && (
            <details style={{ margin: "12px 0" }} open={!!(p.permisos_clientes || p.permisos_empire) || undefined}>
              <summary>
                <strong>Permisos propios</strong>
                {p.permisos_clientes || p.permisos_empire
                  ? <span className="sub"> · {[p.permisos_clientes && `clientes: ${p.alcance === "todos" ? "todos" : p.alcance === "mis_clientes" ? "los suyos" : `${p.clientes.length} elegidos`}`, p.permisos_empire && "Contabilidad Empire", p.crear_clientes && "crea clientes"].filter(Boolean).join(" · ")}{p.permisos_por && ` · por ${p.permisos_por}`}</span>
                  : <span className="sub"> · sin marcar (usa sus roles cliente por cliente)</span>}
              </summary>
              <Formulario accion={guardarPermisosPersona.bind(null, fid, p.id)} boton="Guardar permisos" className="">
                <PermisosPersona nombre={p.nombre.split(" ")[0]} permisos={PERMISOS.map((x) => ({ clave: x.clave, nombre: x.nombre }))} roles={roles}
                  gruposClientes={gruposClientes} gruposEmpire={gruposEmpire} privadas={PESTANAS_PRIVADAS} clientes={empresas}
                  inicial={{
                    clientes: p.permisos_clientes ? { permisos: p.permisos_clientes, pestanas: p.pestanas_clientes ?? [""] } : null,
                    empire: p.permisos_empire ? { permisos: p.permisos_empire, pestanas: p.pestanas_empire ?? [""] } : null,
                    alcance: p.alcance, elegidos: p.clientes, crearClientes: p.crear_clientes, plantillas: p.plantillas,
                  }} />
              </Formulario>
            </details>
          )}
          <Formulario accion={guardarAccesos.bind(null, fid, p.id)} boton="Guardar accesos" className="">
            <label style={{ flexDirection: "row", alignItems: "center", gap: 6, margin: "12px 0" }}>
              <input type="checkbox" name="administrador" defaultChecked={p.administrador} style={{ minHeight: 0 }} /> Administrador de la firma (todos los clientes, todos los permisos)
            </label>
            {empresas.length > 0 && (
              <div className="tabla-envoltura" style={{ marginBottom: 12 }}>
                <table>
                  <thead><tr><th>Cliente</th><th>Rol {p.administrador ? "(no aplica a administradores)" : p.permisos_clientes ? "(solo cuenta fuera del alcance de sus permisos propios)" : ""}</th></tr></thead>
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
      <SupervisionFirma fid={fid} />
    </>
  );
}
