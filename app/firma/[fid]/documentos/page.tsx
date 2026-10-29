import Link from "next/link";
import { accesoFirma } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { clientesDeFirma } from "@/lib/firma";
import { CATEGORIAS, ESTADOS, listarRecepciones } from "@/lib/recepciones";

export const metadata = { title: "Documentos recibidos · Empire Tax’N Legal" };

const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });

// Bandeja de la firma: lo que han subido todos los clientes y falta procesar, el más antiguo primero.
export default async function DocumentosFirma({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid, false);
  const clientes = await clientesDeFirma(fid, usuario.id, firma.administrador);
  const porCliente = await Promise.all(clientes.map((c) => conEmpresa(c.id, (tx) => listarRecepciones(tx, "pendientes"))));
  const filas = clientes.flatMap((c, i) => porCliente[i].map((r) => ({ ...r, cliente: c }))).sort((a, b) => a.subido_en.getTime() - b.subido_en.getTime());
  return (
    <>
      <h1>Documentos recibidos</h1>
      <p className="sub">Lo que tus clientes han subido y todavía falta procesar, el más antiguo primero. Toca el cliente para procesarlo.</p>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cliente</th><th>Documento</th><th>Qué es</th><th>Subido</th><th>Estado</th><th>Responsable</th></tr></thead>
          <tbody>
            {filas.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/e/${r.cliente.id}/recepcion`}><strong>{r.cliente.nombre}</strong></Link></td>
                <td><a href={`/e/${r.cliente.id}/recepcion/${r.id}`} target="_blank" rel="noopener">{r.nombre}</a>{r.nota && <div className="sub" style={{ margin: 0 }}>«{r.nota}»</div>}</td>
                <td>{CATEGORIAS[r.categoria]}</td>
                <td>{r.quien}<div className="sub" style={{ margin: 0 }}>{fechaHora(r.subido_en)}</div></td>
                <td>{ESTADOS[r.estado]}</td>
                <td>{r.cliente.responsable ?? "—"}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={6}>No hay documentos por procesar.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
