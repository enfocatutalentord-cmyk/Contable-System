import Link from "next/link";
import { misFirmas } from "@/lib/acceso";
import { exigirUsuario } from "@/lib/auth";
import { conEmpresa, db } from "@/lib/db";
import { verFecha } from "@/lib/montos";
import { REGIMENES } from "@/lib/permisos";
import { salir } from "../acciones-cuenta";

export const metadata = { title: "Panel de la firma · Contable-System" };

type Cliente = {
  id: string; nombre: string; rnc: string | null; regimen: string; activa: boolean; fecha_bloqueo: string | null; perfil: string | null;
};

export default async function Panel({ searchParams }: { searchParams: Promise<{ q?: string; sin_permiso?: string; inactivos?: string }> }) {
  const usuario = await exigirUsuario();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const firmas = await misFirmas(usuario.id);

  const porFirma = await Promise.all(firmas.map(async (f) => {
    // El administrador ve todos los clientes de la firma; el resto, los que tiene asignados.
    const clientes = await db()<Cliente[]>`
      SELECT e.id, e.nombre, e.rnc, e.regimen, e.activa, to_char(e.fecha_bloqueo, 'YYYY-MM-DD') AS fecha_bloqueo, p.nombre AS perfil
        FROM empresas e
        LEFT JOIN miembros m ON m.empresa_id = e.id AND m.usuario_id = ${usuario.id}
        LEFT JOIN perfiles p ON p.id = m.perfil_id
       WHERE e.firma_id = ${f.id} AND (${f.administrador} OR m.usuario_id IS NOT NULL)
       ORDER BY e.activa DESC, e.nombre`;
    const visibles = clientes
      .filter((c) => sp.inactivos === "1" || c.activa)
      .filter((c) => !q || c.nombre.toLowerCase().includes(q) || (c.rnc ?? "").includes(q.replace(/-/g, "")));
    const estados = await Promise.all(visibles.map((c) => conEmpresa(c.id, async (tx) => {
      const [r] = await tx<{ borradores: number; ultimo: string | null; mes: number }[]>`
        SELECT count(*) FILTER (WHERE estado = 'borrador')::int AS borradores,
               to_char(max(fecha) FILTER (WHERE estado = 'contabilizado'), 'YYYY-MM-DD') AS ultimo,
               count(*) FILTER (WHERE estado = 'contabilizado' AND fecha >= date_trunc('month', current_date))::int AS mes
          FROM asientos`;
      return r;
    })));
    return { firma: f, clientes: visibles.map((c, i) => ({ ...c, ...estados[i] })), total: clientes.length };
  }));

  return (
    <div className="contenido" style={{ margin: "0 auto" }}>
      <div className="entre">
        <div>
          <h1>Panel de la firma</h1>
          <p className="sub">Hola, {usuario.nombre}. <Link href="/cuenta">Mi cuenta</Link></p>
        </div>
        <form action={salir}><button>Salir</button></form>
      </div>
      {sp.sin_permiso && <p className="aviso">Esa sección es solo para administradores de la firma.</p>}
      {firmas.length === 0 && <p className="aviso">Tu usuario no pertenece a ninguna firma todavía. Pide a un administrador que te dé acceso.</p>}

      {porFirma.map(({ firma, clientes, total }) => (
        <section key={firma.id} style={{ marginBottom: 36 }}>
          <div className="entre" style={{ alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>{firma.nombre}{firma.rnc && <span className="sub" style={{ fontSize: "0.9rem" }}> · RNC {firma.rnc}</span>}</h2>
            {firma.administrador && (
              <div className="fila">
                <Link className="boton" href={`/firma/${firma.id}/equipo`}>Equipo</Link>
                <Link className="boton" href={`/firma/${firma.id}/perfiles`}>Perfiles y permisos</Link>
                <Link className="boton primario" href={`/empresas/nueva?firma=${firma.id}`}>+ Nuevo cliente</Link>
              </div>
            )}
          </div>
          {total > 6 || q ? (
            <form className="fila" style={{ margin: "12px 0" }}>
              <label style={{ flex: "1 1 260px" }}>Buscar cliente<input name="q" defaultValue={sp.q} placeholder="Nombre o RNC" /></label>
              <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <input type="checkbox" name="inactivos" value="1" defaultChecked={sp.inactivos === "1"} style={{ minHeight: 0 }} /> Incluir inactivos
              </label>
              <button>Buscar</button>
            </form>
          ) : null}
          <div className="tabla-envoltura" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Cliente</th><th>Régimen</th><th className="num">Borradores</th><th className="num">Asientos del mes</th><th>Último asiento</th><th>Cerrado hasta</th><th>Tu acceso</th></tr></thead>
              <tbody>
                {clientes.map((c) => (
                  <tr key={c.id} style={c.activa ? undefined : { opacity: 0.55 }}>
                    <td>
                      <Link href={`/e/${c.id}`}><strong>{c.nombre}</strong></Link>
                      {c.rnc && <div className="sub" style={{ margin: 0 }}>{c.rnc}</div>}
                    </td>
                    <td>{REGIMENES[c.regimen]?.replace(/ \(.*\)/, "") ?? c.regimen}</td>
                    <td className="num">{c.borradores ? <Link href={`/e/${c.id}/asientos?estado=borrador`}>{c.borradores}</Link> : "—"}</td>
                    <td className="num">{c.mes}</td>
                    <td>{c.ultimo ? verFecha(c.ultimo) : "—"}</td>
                    <td>{c.fecha_bloqueo ? verFecha(c.fecha_bloqueo) : "—"}</td>
                    <td><span className="etiqueta-rol">{firma.administrador ? "Administrador" : c.perfil}</span></td>
                  </tr>
                ))}
                {clientes.length === 0 && (
                  <tr><td colSpan={7}>{firma.administrador ? "Todavía no hay clientes. Crea el primero con «+ Nuevo cliente»." : "No tienes clientes asignados."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
