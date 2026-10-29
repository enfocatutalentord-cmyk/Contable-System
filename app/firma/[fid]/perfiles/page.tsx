import { Fragment } from "react";
import { Formulario } from "@/app/formulario";
import { accesoFirma } from "@/lib/acceso";
import { db } from "@/lib/db";
import { PERMISOS } from "@/lib/permisos";
import { PESTANAS_CLIENTE, TODAS_LAS_PESTANAS } from "@/lib/pestanas";
import { eliminarPerfil, guardarPerfil } from "../../acciones";

export const metadata = { title: "Roles y permisos · Empire Tax’N Legal" };

type Perfil = { id: string; nombre: string; permisos: string[]; pestanas: string[] | null; para_clientes: boolean; sistema: boolean; usos: number };

// Cada rol dice qué pestañas ve la persona y qué puede hacer en ellas (como los roles personalizados de QuickBooks Online).
export default async function Perfiles({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  await accesoFirma(fid);
  const perfiles = await db()<Perfil[]>`
    SELECT p.id, p.nombre, p.permisos, p.pestanas, p.para_clientes, p.sistema, (SELECT count(*)::int FROM miembros m WHERE m.perfil_id = p.id) AS usos
      FROM perfiles p WHERE p.firma_id = ${fid} ORDER BY p.para_clientes, p.sistema DESC, p.nombre`;
  const esAdmin = (p: Perfil) => p.sistema && p.nombre === "Administrador";
  const ve = (p: Perfil, r: string) => esAdmin(p) || !p.pestanas || p.pestanas.includes(r);

  const casillasPestanas = (p?: Perfil) => (
    <fieldset className="pestanas-rol">
      <legend>Pestañas que ve</legend>
      {PESTANAS_CLIENTE.map((s) => (
        <div key={s.grupo} className="grupo-pestanas">
          <strong>{s.grupo}</strong>
          {s.enlaces.map(([r, nombre]) => (
            <label key={r} className="casilla">
              <input type="checkbox" name="pestanas" value={r} defaultChecked={p ? ve(p, r) : r === ""} disabled={p && esAdmin(p)} /> {nombre}
            </label>
          ))}
        </div>
      ))}
    </fieldset>
  );
  const casillasPermisos = (activos: string[], fijo = false) => (
    <fieldset className="pestanas-rol">
      <legend>Qué puede hacer</legend>
      <div className="casillas">
        {PERMISOS.map((p) => (
          <label key={p.clave} className="casilla">
            <input type="checkbox" name="permisos" value={p.clave} defaultChecked={activos.includes(p.clave)} disabled={fijo || p.clave === "ver"} />
            {p.nombre}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <>
      <h1>Roles y permisos</h1>
      <p className="sub">
        Cada rol dice <b>qué pestañas ve</b> la persona y <b>qué puede hacer</b>. Los roles del equipo son para la gente de la firma;
        los roles para clientes, para los usuarios de cada empresa cliente, que solo ven su empresa. Los administradores de la firma lo ven todo.
        Asigna los roles en «Personas y accesos».
      </p>

      <h2>Resumen: qué pestañas ve cada rol</h2>
      <div className="tabla-envoltura" style={{ marginBottom: 24 }}>
        <table className="matriz-roles">
          <thead>
            <tr><th>Pestaña</th>{perfiles.map((p) => <th key={p.id} className="num">{p.nombre}{p.para_clientes && <div className="sub" style={{ margin: 0 }}>cliente</div>}</th>)}</tr>
          </thead>
          <tbody>
            {PESTANAS_CLIENTE.map((s) => (
              <Fragment key={s.grupo}>
                <tr className="grupo"><td colSpan={perfiles.length + 1}>{s.grupo}</td></tr>
                {s.enlaces.map(([r, nombre]) => (
                  <tr key={s.grupo + r}>
                    <td>{nombre}</td>
                    {perfiles.map((p) => <td key={p.id} className="num">{ve(p, r) ? "✓" : <span className="sub">—</span>}</td>)}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {perfiles.map((p) => {
        const admin = esAdmin(p);
        return (
          <div key={p.id} className="tarjeta" style={{ marginBottom: 14 }}>
            <div className="entre">
              <h2 style={{ margin: 0 }}>{p.nombre}</h2>
              <span className="sub">{p.para_clientes ? "Rol para clientes" : "Rol del equipo"} · {p.sistema ? "base" : "propio"} · asignado {p.usos} {p.usos === 1 ? "vez" : "veces"}</span>
            </div>
            <Formulario accion={guardarPerfil.bind(null, fid)} boton="Guardar rol" className="">
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="nombre" value={p.nombre} />
              {!admin && (
                <label className="casilla"><input type="checkbox" name="para_clientes" defaultChecked={p.para_clientes} /> Rol para usuarios de las empresas cliente (solo ven su empresa)</label>
              )}
              <div className="rol-columnas">
                {casillasPestanas(p)}
                {casillasPermisos(p.permisos, admin)}
              </div>
              {admin && <p className="sub">El rol Administrador siempre ve todas las pestañas y tiene todos los permisos.</p>}
            </Formulario>
            {!p.sistema && p.usos === 0 && (
              <Formulario accion={eliminarPerfil.bind(null, fid, p.id)} boton="Eliminar rol" className="fila"><span /></Formulario>
            )}
          </div>
        );
      })}
      <div className="tarjeta">
        <h2 style={{ marginTop: 0 }}>Nuevo rol</h2>
        <Formulario accion={guardarPerfil.bind(null, fid)} boton="Crear rol" className="">
          <label style={{ maxWidth: 360 }}>Nombre<input name="nombre" required placeholder="Ej.: Supervisora de cuentas" /></label>
          <label className="casilla"><input type="checkbox" name="para_clientes" /> Rol para usuarios de las empresas cliente (solo ven su empresa)</label>
          <div className="rol-columnas">
            {casillasPestanas()}
            {casillasPermisos(["ver"])}
          </div>
        </Formulario>
      </div>
      <p className="sub" style={{ marginTop: 12 }}>Hay {TODAS_LAS_PESTANAS.length} pestañas por cliente.</p>
    </>
  );
}
