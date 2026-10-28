import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoFirma } from "@/lib/acceso";
import { db } from "@/lib/db";
import { clientesDeFirma } from "@/lib/firma";
import { verFecha } from "@/lib/montos";
import { asignarResponsable, guardarFirma } from "../../acciones";

export const metadata = { title: "Clientes de la firma · Empire Tax’N Legal" };

export default async function Clientes({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid);
  const [clientes, equipo] = await Promise.all([
    clientesDeFirma(fid, usuario.id, true, true),
    db()<{ id: string; nombre: string }[]>`
      SELECT u.id, u.nombre FROM miembros_firma mf JOIN usuarios u ON u.id = mf.usuario_id WHERE mf.firma_id = ${fid} ORDER BY u.nombre`,
  ]);
  return (
    <>
      <div className="entre">
        <div>
          <h1>Clientes de la firma</h1>
          <p className="sub">Las empresas que lleva la firma. El responsable es la persona del equipo que se ocupa de cada una.</p>
        </div>
        <Link className="boton primario" href={`/firma/${fid}/clientes/nuevo`}>+ Nuevo cliente</Link>
      </div>
      <div className="tabla-envoltura" style={{ marginBottom: 24 }}>
        <table>
          <thead><tr><th>Cliente</th><th>Responsable</th><th>Cerrado hasta</th><th>Estado</th></tr></thead>
          <tbody>
            {clientes.map((c) => (
              <tr key={c.id} style={c.activa ? undefined : { opacity: 0.6 }}>
                <td>
                  <Link href={`/e/${c.id}`}><strong>{c.nombre}</strong></Link>
                  <div className="sub" style={{ margin: 0 }}>{c.rnc ?? "Sin RNC"} · <Link href={`/e/${c.id}/empresa`}>Ficha</Link></div>
                </td>
                <td>
                  <Formulario accion={asignarResponsable.bind(null, fid, c.id)} boton="Guardar" className="fila">
                    <select name="responsable" defaultValue={c.responsable_id ?? ""} aria-label={`Responsable de ${c.nombre}`}>
                      <option value="">Sin responsable</option>
                      {equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </Formulario>
                </td>
                <td>{c.fecha_bloqueo ? verFecha(c.fecha_bloqueo) : "—"}</td>
                <td>{c.activa ? "Activo" : "Inactivo"}</td>
              </tr>
            ))}
            {clientes.length === 0 && <tr><td colSpan={4}>Todavía no hay clientes.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="tarjeta" style={{ maxWidth: 640 }}>
        <h2 style={{ marginTop: 0 }}>Datos de la firma</h2>
        <p className="sub">El nombre sale arriba en todas las pantallas y en los correos de acceso.</p>
        <Formulario accion={guardarFirma.bind(null, fid)} boton="Guardar datos de la firma" className="fila">
          <label style={{ flex: "2 1 260px" }}>Nombre<input name="nombre" defaultValue={firma.nombre} required /></label>
          <label style={{ flex: "1 1 160px" }}>RNC<input name="rnc" defaultValue={firma.rnc ?? ""} inputMode="numeric" /></label>
        </Formulario>
      </div>
    </>
  );
}
