import Link from "next/link";
import { accesoFirma } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { clientesDeFirma } from "@/lib/firma";
import { ESTADOS_SUBIDA, FORMAS_SUBIDA, listarSubidas } from "@/lib/facturas-subidas";
import { verMonto } from "@/lib/montos";

export const metadata = { title: "Facturas del cliente · Empire Tax’N Legal" };

const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });
const FILTROS: Record<string, string> = { recibida: "Por revisar", aprobada: "Aprobadas", rechazada: "Rechazadas", desestimada: "Desestimadas", todas: "Todas" };

// Facturas del cliente (bloque 8b; rediseño R4): las que suben los clientes por la aplicación y las que carga la oficina, de todos los
// clientes o de uno, la más antigua primero. Se revisan y aprueban en la pantalla del cliente (pasan a borrador de compra o de venta).
export default async function FacturasDelCliente({ params, searchParams }: {
  params: Promise<{ fid: string }>; searchParams: Promise<{ cliente?: string; estado?: string }>;
}) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  const todos = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => c.activa && !c.propia);
  const uno = todos.find((c) => c.id === sp.cliente) ?? null;
  const estado = sp.estado && sp.estado in FILTROS ? sp.estado : "recibida";
  const clientes = uno ? [uno] : todos;
  const porCliente = await Promise.all(clientes.map((c) => conEmpresa(c.id, (tx) => listarSubidas(tx, estado === "todas" ? null : estado))));
  const filas = clientes.flatMap((c, i) => porCliente[i].map((f) => ({ ...f, cliente: c }))).sort((a, b) => a.subido_en.getTime() - b.subido_en.getTime());
  const enlace = (extra: Record<string, string>) => `/firma/${fid}/facturas-subidas?${new URLSearchParams({ ...(uno ? { cliente: uno.id } : {}), estado, ...extra })}`;
  return (
    <>
      <div className="entre">
        <div>
          <h1>Facturas del cliente</h1>
          <p className="sub">
            Las facturas de gastos y de ventas que los clientes suben desde la aplicación y las que carga la oficina. Se revisan solas al
            subirlas (RNC, NCF, repetidas, crédito fiscal); al aprobarlas pasan a borrador de compra o de venta para el 606 y el 607.
          </p>
        </div>
        {uno && <Link className="boton primario" href={`/e/${uno.id}/facturas-subidas`}>Cargar o revisar las de {uno.nombre}</Link>}
      </div>
      <form className="fila" style={{ marginBottom: 12 }} aria-label="Elegir cliente">
        <label style={{ flex: "2 1 240px" }}>Cliente
          <select name="cliente" defaultValue={uno?.id ?? ""}>
            <option value="">Todos los clientes</option>
            {todos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <input type="hidden" name="estado" value={estado} />
        <button>Ver</button>
      </form>
      <nav className="fila" style={{ gap: 8, marginBottom: 12 }}>
        {Object.entries(FILTROS).map(([k, t]) => <Link key={k} className={`boton${k === estado ? " primario" : ""}`} href={enlace({ estado: k })}>{t}</Link>)}
      </nav>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cliente</th><th>N.º</th><th>Qué</th><th>NCF</th><th className="num">Total</th><th>Subida</th><th>Estado</th><th>Avisos</th><th>Responsable</th></tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id}>
                <td><Link href={`/e/${f.cliente.id}/facturas-subidas?estado=${estado}`}><strong>{f.cliente.nombre}</strong></Link></td>
                <td>{f.numero}</td>
                <td>{f.tipo === "gasto" ? "Gasto" : "Venta"} · {FORMAS_SUBIDA[f.forma]}</td>
                <td>{f.ncf ?? "—"}</td>
                <td className="num">{f.total ? verMonto(f.total) : "—"}</td>
                <td>{fechaHora(f.subido_en)}</td>
                <td>{ESTADOS_SUBIDA[f.estado]}</td>
                <td>{f.marcas.filter((m) => m.nivel === "error").length > 0 ? <span className="error">{f.marcas.filter((m) => m.nivel === "error").length} con error</span> : f.marcas.length || "—"}</td>
                <td>{f.cliente.responsable ?? "—"}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={9}>No hay facturas en «{FILTROS[estado]}»{uno ? ` de ${uno.nombre}` : ""}.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
