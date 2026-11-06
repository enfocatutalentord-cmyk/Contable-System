import Link from "next/link";
import { accesoFirma } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { clientesDeFirma } from "@/lib/firma";
import { FORMAS_SUBIDA, listarSubidas } from "@/lib/facturas-subidas";
import { verMonto } from "@/lib/montos";

export const metadata = { title: "Facturas por revisar · Empire Tax’N Legal" };

const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });

// Facturas que subieron los clientes por la aplicación y esperan revisión, de todos los clientes, la más antigua primero (bloque 8b).
export default async function FacturasPorRevisar({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid, false);
  const clientes = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => c.activa);
  const porCliente = await Promise.all(clientes.map((c) => conEmpresa(c.id, (tx) => listarSubidas(tx, "recibida"))));
  const filas = clientes.flatMap((c, i) => porCliente[i].map((f) => ({ ...f, cliente: c }))).sort((a, b) => a.subido_en.getTime() - b.subido_en.getTime());
  return (
    <>
      <h1>Facturas por revisar</h1>
      <p className="sub">Las facturas de gastos y de ventas que los clientes subieron desde la aplicación y faltan por revisar, la más antigua primero.</p>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cliente</th><th>N.º</th><th>Qué</th><th>NCF</th><th className="num">Total</th><th>Subida</th><th>Avisos</th><th>Responsable</th></tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id}>
                <td><Link href={`/e/${f.cliente.id}/facturas-subidas`}><strong>{f.cliente.nombre}</strong></Link></td>
                <td>{f.numero}</td>
                <td>{f.tipo === "gasto" ? "Gasto" : "Venta"} · {FORMAS_SUBIDA[f.forma]}</td>
                <td>{f.ncf ?? "—"}</td>
                <td className="num">{f.total ? verMonto(f.total) : "—"}</td>
                <td>{fechaHora(f.subido_en)}</td>
                <td>{f.marcas.filter((m) => m.nivel === "error").length > 0 ? <span className="error">{f.marcas.filter((m) => m.nivel === "error").length} con error</span> : f.marcas.length || "—"}</td>
                <td>{f.cliente.responsable ?? "—"}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={8}>No hay facturas por revisar.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
