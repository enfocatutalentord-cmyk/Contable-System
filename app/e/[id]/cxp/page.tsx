import Link from "next/link";
import { Fragment } from "react";
import { accesoEmpresa } from "@/lib/acceso";
import { TRAMOS } from "@/lib/cxc";
import { antiguedadCxp } from "@/lib/cxp";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { fechaValida } from "@/lib/reportes";

export default async function AntiguedadCxp({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ corte?: string; detalle?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa } = await accesoEmpresa(id);
  const corte = fechaValida(sp.corte) ? sp.corte : hoyISO();
  const detalle = sp.detalle === "1";
  const { filas, totales, total } = await conEmpresa(id, (tx) => antiguedadCxp(tx, corte));

  return (
    <>
      <div className="entre">
        <h1>Cuentas por pagar</h1>
        <Link className="boton" href={`/e/${id}/cxp/estado`}>Estado de cuenta →</Link>
      </div>
      <p className="sub">
        {empresa.nombre} · lo que se debe a proveedores al {verFecha(corte)}, según los días vencidos de cada compra.
        Valores en pesos (las compras en dólares a la tasa de la compra).
      </p>
      <form className="fila" style={{ marginBottom: 16 }}>
        <label>Al<input type="date" name="corte" defaultValue={corte} /></label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" name="detalle" value="1" defaultChecked={detalle} style={{ minHeight: 0 }} /> Ver cada compra
        </label>
        <button>Ver</button>
        <a className="boton" href={`/e/${id}/exportar/antiguedad-cxp?corte=${corte}`}>Descargar Excel</a>
        <a className="boton" href={`/e/${id}/exportar/antiguedad-cxp?corte=${corte}&formato=pdf`}>PDF</a>
      </form>
      <div className="cifras">
        {TRAMOS.map((t, i) => (
          <div key={t} className="tarjeta cifra">
            <div className="etiqueta">{t}</div>
            <div className="valor" style={{ color: i >= 3 && totales[i] > 0n ? "var(--peligro)" : undefined }}>{verMonto(totales[i])}</div>
          </div>
        ))}
      </div>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Proveedor</th>{TRAMOS.map((t) => <th key={t} className="num">{t}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>
            {filas.map((f) => (
              <Fragment key={f.proveedorId}>
                <tr className={detalle ? "grupo" : undefined}>
                  <td><Link href={`/e/${id}/cxp/estado?proveedor=${f.proveedorId}&hasta=${corte}`}>{f.proveedor}</Link></td>
                  {f.tramos.map((t, i) => <td key={i} className="num">{verMonto(t, true)}</td>)}
                  <td className="num">{verMonto(f.total)}</td>
                </tr>
                {detalle && f.compras.map((fa) => (
                  <tr key={fa.id}>
                    <td style={{ paddingLeft: 28 }}>
                      <Link href={`/e/${id}/compras/${fa.id}`}>{fa.ncf}</Link>
                      <span className="sub"> · vence {verFecha(fa.vence)}{fa.dias > 0 && ` · ${fa.dias} días vencida`}{fa.moneda === "USD" && ` · US$ ${verMonto(fa.saldo)}`}</span>
                    </td>
                    {TRAMOS.map((_, i) => <td key={i} className="num">{i === (fa.dias <= 0 ? 0 : fa.dias <= 30 ? 1 : fa.dias <= 60 ? 2 : fa.dias <= 90 ? 3 : 4) ? verMonto(fa.saldoPesos) : ""}</td>)}
                    <td />
                  </tr>
                ))}
              </Fragment>
            ))}
            {filas.length === 0 && <tr><td colSpan={7}>No hay cuentas por pagar a esa fecha.</td></tr>}
          </tbody>
          <tfoot>
            <tr><td>Total</td>{totales.map((t, i) => <td key={i} className="num">{verMonto(t)}</td>)}<td className="num">{verMonto(total)}</td></tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
