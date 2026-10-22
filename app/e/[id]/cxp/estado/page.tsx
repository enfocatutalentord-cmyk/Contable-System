import Link from "next/link";
import { BotonImprimir } from "@/app/imprimir";
import { accesoEmpresa } from "@/lib/acceso";
import { comprasPendientesAl, estadoCuentaProveedor } from "@/lib/cxp";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { fechaValida } from "@/lib/reportes";

export default async function EstadoCuentaProveedor({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ proveedor?: string; desde?: string; hasta?: string; moneda?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa } = await accesoEmpresa(id);
  const hoy = hoyISO();
  const hasta = fechaValida(sp.hasta) ? sp.hasta : hoy;
  const desde = fechaValida(sp.desde) ? sp.desde : `${hasta.slice(0, 4)}-01-01`;
  const moneda = sp.moneda === "USD" ? "USD" : "DOP";

  const datos = await conEmpresa(id, async (tx) => {
    const clientes = await tx<{ id: string; nombre: string; rnc: string | null; direccion: string | null; email: string | null }[]>`
      SELECT id, nombre, rnc, direccion, email FROM proveedores ORDER BY nombre`;
    const cliente = clientes.find((c) => c.id === sp.proveedor);
    if (!cliente) return { clientes, cliente: null };
    const estado = await estadoCuentaProveedor(tx, id, cliente.id, moneda, desde, hasta);
    const pendientes = (await comprasPendientesAl(tx, hasta, cliente.id)).filter((p) => p.moneda === moneda);
    const [{ usd }] = await tx<{ usd: boolean }[]>`SELECT EXISTS (SELECT 1 FROM compras WHERE proveedor_id = ${cliente.id} AND moneda = 'USD') AS usd`;
    return { clientes, cliente, estado, pendientes, usd };
  });
  const simbolo = moneda === "USD" ? "US$" : "RD$";

  return (
    <>
      <div className="no-imprimir">
        <h1>Estado de cuenta de proveedor</h1>
        <p className="sub">Compras, notas de crédito y pagos de un proveedor, con lo que se le debe.</p>
        <form className="fila" style={{ marginBottom: 16 }}>
          <label style={{ flex: "1 1 240px" }}>Proveedor
            <select name="proveedor" defaultValue={datos.cliente?.id ?? ""} required>
              <option value="" disabled>Elige…</option>
              {datos.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label>Desde<input type="date" name="desde" defaultValue={desde} /></label>
          <label>Hasta<input type="date" name="hasta" defaultValue={hasta} /></label>
          {datos.cliente && datos.usd && (
            <label>Moneda<select name="moneda" defaultValue={moneda}><option value="DOP">DOP</option><option value="USD">USD</option></select></label>
          )}
          <button>Ver</button>
          {datos.cliente && (
            <>
              <BotonImprimir texto="Imprimir o PDF" />
              <a className="boton" href={`/e/${id}/exportar/estado-cuenta-proveedor?proveedor=${datos.cliente.id}&desde=${desde}&hasta=${hasta}&moneda=${moneda}`}>Descargar Excel</a>
            </>
          )}
        </form>
      </div>
      {datos.cliente && datos.estado && (
        <div className="documento">
          <div className="cabecera">
            <div><h2>{empresa.nombre}</h2>{empresa.rnc && <div>RNC {empresa.rnc}</div>}</div>
            <div style={{ textAlign: "right" }}><h2>Estado de cuenta de proveedor</h2><div>Del {verFecha(desde)} al {verFecha(hasta)} · {moneda}</div></div>
          </div>
          <dl style={{ marginBottom: 16 }}>
            <dt>Proveedor</dt><dd>{datos.cliente.nombre}</dd>
            {datos.cliente.rnc && <><dt>RNC / cédula</dt><dd>{datos.cliente.rnc}</dd></>}
          </dl>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Fecha</th><th>Documento</th><th>Detalle</th><th className="num">Compras</th><th className="num">Pagos y notas</th><th className="num">Saldo</th></tr></thead>
              <tbody>
                <tr className="grupo"><td>{verFecha(desde)}</td><td /><td>Saldo anterior</td><td /><td /><td className="num">{verMonto(datos.estado.inicial)}</td></tr>
                {datos.estado.movimientos.map((m, i) => (
                  <tr key={i}>
                    <td>{verFecha(m.fecha)}</td>
                    <td><Link href={m.enlace}>{m.documento}</Link></td>
                    <td>{m.detalle.replace(/vence (\d{4}-\d{2}-\d{2})/, (_, f) => `vence ${verFecha(f)}`)}</td>
                    <td className="num">{verMonto(m.cargo, true)}</td>
                    <td className="num">{verMonto(m.abono, true)}</td>
                    <td className="num">{verMonto(m.saldo)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={5}>Saldo al {verFecha(hasta)} {simbolo}</td><td className="num">{verMonto(datos.estado.final)}</td></tr></tfoot>
            </table>
          </div>
          {datos.pendientes && datos.pendientes.length > 0 && (
            <>
              <h2>Compras pendientes al {verFecha(hasta)}</h2>
              <div className="tabla-envoltura">
                <table>
                  <thead><tr><th>NCF</th><th>Fecha</th><th>Vence</th><th className="num">Días vencida</th><th className="num">Saldo</th></tr></thead>
                  <tbody>
                    {datos.pendientes.map((p) => (
                      <tr key={p.id}>
                        <td>{p.ncf}</td><td>{verFecha(p.fecha)}</td><td>{verFecha(p.vence)}</td>
                        <td className="num">{p.dias > 0 ? p.dias : ""}</td><td className="num">{verMonto(p.saldo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
