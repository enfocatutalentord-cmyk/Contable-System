import Link from "next/link";
import { exigirDuena } from "@/lib/acceso";
import { ACCIONES, registroPlataforma } from "@/lib/plataforma";

export const metadata = { title: "Registro · Consola de la plataforma" };

const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" });

// Registro de la consola: cada detalle abierto, suspensión y reactivación (las últimas 500). No se cambia ni se borra.
export default async function Registro() {
  await exigirDuena();
  const registro = await registroPlataforma();
  return (
    <main className="contenido">
      <p className="sub" style={{ marginBottom: 4 }}><Link href="/plataforma">← Consola de la plataforma</Link></p>
      <h1>Registro de la consola</h1>
      <p className="sub">Cada vez que se abre el detalle de una firma, se suspende o se reactiva. Este registro no se puede cambiar ni borrar.</p>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Firma</th><th>Motivo</th></tr></thead>
          <tbody>
            {registro.map((r) => (
              <tr key={r.id}>
                <td>{fechaHora(r.en)}</td><td>{r.usuario_nombre}</td><td>{ACCIONES[r.accion] ?? r.accion}</td>
                <td>{r.firma_id ? <Link href={`/plataforma/${r.firma_id}`}>{r.firma_nombre}</Link> : r.firma_nombre}</td><td>{r.motivo ?? ""}</td>
              </tr>
            ))}
            {!registro.length && <tr><td colSpan={5} className="sub">Todavía no hay nada registrado.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
