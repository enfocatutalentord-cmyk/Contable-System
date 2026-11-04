import Link from "next/link";
import { exigirDuena } from "@/lib/acceso";
import { firmasPlataforma } from "@/lib/plataforma";
import { verFecha } from "@/lib/montos";

export const metadata = { title: "Consola de la plataforma · Empire Tax’N Legal" };

const fecha = (d: Date | null) => (d ? verFecha(d.toISOString().slice(0, 10)) : "—");

// Consola de la plataforma: todas las firmas con conteos (sin montos ni datos de sus clientes).
export default async function Consola() {
  await exigirDuena();
  const firmas = await firmasPlataforma();
  const suspendidas = firmas.filter((f) => f.suspendida_en).length;
  return (
    <main className="contenido">
      <p className="sub" style={{ marginBottom: 4 }}><Link href="/empresas">← Volver al sistema</Link> · <Link href="/plataforma/registro">Registro de la consola</Link></p>
      <h1>Consola de la plataforma</h1>
      <p className="sub">
        {firmas.length} firma{firmas.length === 1 ? "" : "s"}{suspendidas ? ` · ${suspendidas} suspendida${suspendidas === 1 ? "" : "s"}` : ""}.
        Aquí solo se ven conteos; los datos de cada firma son suyos.
      </p>
      <div className="tabla-envoltura">
        <table>
          <thead>
            <tr><th>Firma</th><th>RNC</th><th>Alta</th><th className="num">Clientes</th><th className="num">Personas</th><th>Última entrada</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {firmas.map((f) => (
              <tr key={f.id}>
                <td><Link href={`/plataforma/${f.id}`}>{f.nombre}</Link></td>
                <td>{f.rnc ?? "—"}</td>
                <td>{fecha(f.creada)}</td>
                <td className="num">{f.clientes}</td>
                <td className="num">{f.personas}</td>
                <td>{fecha(f.ultima_entrada)}</td>
                <td>{f.suspendida_en ? <span className="error">Suspendida</span> : "Activa"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
