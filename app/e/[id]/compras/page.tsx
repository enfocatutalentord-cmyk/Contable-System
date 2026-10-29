import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { Descargar } from "@/app/descargar";
import { consultaFiltros, estadoCompra, ESTADOS_COMPRA as ESTADOS, leerFiltrosDocumentos, listarCompras } from "@/lib/listas";
import { verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";

export default async function Compras({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mes?: string; estado?: string; q?: string; descartada?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const filtros = leerFiltrosDocumentos(sp, ESTADOS);
  const { mes, estado, q, hoy } = filtros;
  const filas = await conEmpresa(id, (tx) => listarCompras(tx, filtros));
  const vigentes = filas.filter((f) => f.estado === "registrada" && !f.anulada && f.origen === null && f.moneda === "DOP");

  return (
    <>
      <div className="entre">
        <div>
          <h1>Compras</h1>
          <p className="sub">Facturas de proveedores, gastos y sus notas de crédito. El borrador no tiene asiento; al registrarse se contabiliza.</p>
        </div>
        <div className="acciones">
          {puede(permisos, "exportar") && <Descargar href={`/e/${id}/exportar/compras?${consultaFiltros(filtros)}`} />}
          {puede(permisos, "registrar") && <Link className="boton primario" href={`/e/${id}/compras/nueva`}>+ Nueva compra</Link>}
        </div>
      </div>
      {sp.descartada && <p className="exito">Borrador descartado. Queda constancia en el historial de cambios.</p>}
      <form className="fila" style={{ marginBottom: 12 }}>
        <label>Mes<input type="month" name="mes" defaultValue={mes} /></label>
        <label>Estado
          <select name="estado" defaultValue={estado}>
            {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label style={{ flex: "1 1 220px" }}>Buscar<input name="q" defaultValue={q} placeholder="NCF, proveedor o RNC" /></label>
        <button>Ver</button>
        <Link className="boton" href={`/e/${id}/compras?mes=&estado=pendientes`}>Todas las por pagar</Link>
      </form>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>NCF</th><th>Fecha</th><th>Proveedor</th><th>Vence</th><th className="num">Total</th><th className="num">Saldo</th><th>Estado</th></tr></thead>
          <tbody>
            {filas.map((f) => {
              const esNota = f.origen !== null;
              const borrador = f.estado === "borrador";
              const texto = estadoCompra(f, hoy);
              return (
                <tr key={f.id} className={f.anulada ? "anulado" : borrador ? "borrador" : undefined}>
                  <td><Link href={`/e/${id}/compras/${f.id}`}>{f.ncf ?? `Borrador ${f.tipo_comprobante}`}</Link></td>
                  <td>{verFecha(f.fecha)}</td>
                  <td>{f.proveedor}</td>
                  <td>{esNota ? "" : verFecha(f.vence)}</td>
                  <td className="num">{f.moneda === "USD" && "US$ "}{verMonto(esNota ? -Number(f.total) : f.total)}</td>
                  <td className="num">{esNota || f.anulada || borrador ? "" : verMonto(f.saldo)}</td>
                  <td className={texto === "Vencida" ? "error" : undefined}>{texto}</td>
                </tr>
              );
            })}
            {filas.length === 0 && <tr><td colSpan={7}>No hay compras con esos filtros.</td></tr>}
          </tbody>
          {vigentes.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4}>Compras registradas en pesos ({vigentes.length})</td>
                <td className="num">{verMonto(vigentes.reduce((s, f) => s + Number(f.total), 0))}</td>
                <td className="num">{verMonto(vigentes.reduce((s, f) => s + Number(f.saldo ?? 0), 0))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
