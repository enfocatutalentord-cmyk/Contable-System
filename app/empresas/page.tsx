import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { db } from "@/lib/db";
import { NOMBRE_ROL, type Rol } from "@/lib/permisos";
import { salir } from "../acciones-cuenta";

export const metadata = { title: "Mis empresas · Contable-System" };

export default async function Empresas() {
  const usuario = await exigirUsuario();
  const empresas = await db()<{ id: string; nombre: string; rnc: string | null; rol: Rol }[]>`
    SELECT e.id, e.nombre, e.rnc, m.rol FROM miembros m JOIN empresas e ON e.id = m.empresa_id
     WHERE m.usuario_id = ${usuario.id} ORDER BY e.nombre`;
  return (
    <main className="centro">
      <div style={{ width: "100%", maxWidth: 560 }}>
        <div className="entre">
          <div>
            <h1>Mis empresas</h1>
            <p className="sub">Hola, {usuario.nombre}. <Link href="/cuenta">Mi cuenta</Link></p>
          </div>
          <form action={salir}><button>Salir</button></form>
        </div>
        <div className="tabla-envoltura">
          <table>
            <tbody>
              {empresas.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link href={`/e/${e.id}`}><strong>{e.nombre}</strong></Link>
                    {e.rnc && <div className="sub" style={{ margin: 0 }}>RNC {e.rnc}</div>}
                  </td>
                  <td className="num"><span className="etiqueta-rol">{NOMBRE_ROL[e.rol]}</span></td>
                </tr>
              ))}
              {empresas.length === 0 && (
                <tr><td>Todavía no perteneces a ninguna empresa.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p><Link href="/empresas/nueva" className="boton">+ Nueva empresa</Link></p>
      </div>
    </main>
  );
}
