import Link from "next/link";
import { accesoFirma } from "@/lib/acceso";
import { actividad, clientesDeFirma } from "@/lib/firma";
import { fechaValida } from "@/lib/reportes";

export const metadata = { title: "Actividad · Empire Tax’N Legal" };

// Todo lo que hacen el equipo y los clientes: facturas, compras, cobros, pagos, asientos, documentos y cierres.
export default async function Actividad({ params, searchParams }: {
  params: Promise<{ fid: string }>;
  searchParams: Promise<{ cliente?: string; desde?: string }>;
}) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  const clientes = await clientesDeFirma(fid, usuario.id, firma.administrador);
  const elegidos = sp.cliente ? clientes.filter((c) => c.id === sp.cliente) : clientes;
  const desde = sp.desde && fechaValida(sp.desde) ? sp.desde : undefined;
  const eventos = await actividad(elegidos, 200, desde);
  const fmt = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });
  return (
    <>
      <h1>Actividad</h1>
      <p className="sub">Lo que hacen tu equipo y tus clientes, lo más nuevo primero. El detalle de cada cambio está en el «Historial de cambios» de cada cliente.</p>
      <form className="fila" style={{ marginBottom: 12 }}>
        <label style={{ flex: "1 1 240px" }}>Cliente
          <select name="cliente" defaultValue={sp.cliente ?? ""}>
            <option value="">Todos</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label>Desde<input type="date" name="desde" defaultValue={desde} /></label>
        <button>Ver</button>
      </form>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué hizo</th><th>Cliente</th></tr></thead>
          <tbody>
            {eventos.map((e, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: "nowrap" }}>{fmt(e.fecha)}</td>
                <td>{e.quien}</td>
                <td>{e.enlace ? <Link href={e.enlace}>{e.texto}</Link> : e.texto}</td>
                <td><Link href={`/e/${e.clienteId}`}>{e.cliente}</Link></td>
              </tr>
            ))}
            {eventos.length === 0 && <tr><td colSpan={4}>No hay movimientos con esos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
