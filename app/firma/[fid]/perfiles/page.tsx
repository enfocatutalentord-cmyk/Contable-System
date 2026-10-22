import { Formulario } from "@/app/formulario";
import { accesoFirma } from "@/lib/acceso";
import { db } from "@/lib/db";
import { PERMISOS } from "@/lib/permisos";
import { eliminarPerfil, guardarPerfil } from "../../acciones";
import { EncabezadoFirma } from "../../encabezado";

export const metadata = { title: "Perfiles y permisos · Contable-System" };

export default async function Perfiles({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma } = await accesoFirma(fid);
  const perfiles = await db()<{ id: string; nombre: string; permisos: string[]; sistema: boolean; usos: number }[]>`
    SELECT p.id, p.nombre, p.permisos, p.sistema, (SELECT count(*)::int FROM miembros m WHERE m.perfil_id = p.id) AS usos
      FROM perfiles p WHERE p.firma_id = ${fid} ORDER BY p.sistema DESC, p.nombre`;

  const casillas = (activos: string[], fijo = false) => (
    <div className="casillas">
      {PERMISOS.map((p) => (
        <label key={p.clave} className="casilla">
          <input type="checkbox" name="permisos" value={p.clave} defaultChecked={activos.includes(p.clave)} disabled={fijo || p.clave === "ver"} />
          {p.nombre}
        </label>
      ))}
    </div>
  );

  return (
    <main className="contenido" style={{ margin: "0 auto" }}>
      <EncabezadoFirma firma={firma} actual="perfiles" />
      <p className="sub">Cada perfil es un conjunto de permisos. Al dar acceso a un cliente, eliges el perfil de la persona.</p>
      {perfiles.map((p) => {
        const admin = p.sistema && p.nombre === "Administrador";
        return (
          <div key={p.id} className="tarjeta" style={{ marginBottom: 14 }}>
            <div className="entre">
              <h2 style={{ margin: 0 }}>{p.nombre}</h2>
              <span className="sub">{p.sistema ? "Perfil base" : "Perfil propio"} · asignado {p.usos} {p.usos === 1 ? "vez" : "veces"}</span>
            </div>
            <Formulario accion={guardarPerfil.bind(null, fid)} boton="Guardar permisos" className="">
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="nombre" value={p.nombre} />
              {casillas(p.permisos, admin)}
              {admin && <p className="sub">El perfil Administrador siempre tiene todos los permisos.</p>}
            </Formulario>
            {!p.sistema && p.usos === 0 && (
              <Formulario accion={eliminarPerfil.bind(null, fid, p.id)} boton="Eliminar perfil" className="fila"><span /></Formulario>
            )}
          </div>
        );
      })}
      <div className="tarjeta">
        <h2 style={{ marginTop: 0 }}>Nuevo perfil</h2>
        <Formulario accion={guardarPerfil.bind(null, fid)} boton="Crear perfil" className="">
          <label style={{ maxWidth: 360 }}>Nombre<input name="nombre" required placeholder="Ej.: Supervisor de cuentas" /></label>
          {casillas(["ver"])}
        </Formulario>
      </div>
    </main>
  );
}
