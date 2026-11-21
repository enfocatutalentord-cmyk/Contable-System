import Link from "next/link";
import { Fragment } from "react";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { FORMAS_COBRO_CARGO, listarCargos } from "@/lib/cargos";
import { listarCuentas } from "@/lib/cuentas";
import { deudaPorCliente, TRAMOS } from "@/lib/cxc";
import { conEmpresa } from "@/lib/db";
import { aCentavos, hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { fechaValida } from "@/lib/reportes";
import { aPesos, tasaDeTexto } from "@/lib/ventas";
import { cobrarCargoAccion } from "../pago-impuesto-acciones";

// Cuentas por cobrar (Prioridad 1.2 del prompt de Patricia, 20-nov-2026): qué debe cada cliente, con sus facturas pendientes, los abonos,
// el saldo y los días de atraso, como el «Aged Receivables» de Xero. Cada cliente abre su estado de cuenta y cada factura su registro.
export default async function CuentasPorCobrar({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ corte?: string; detalle?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa, permisos } = await accesoEmpresa(id);
  const corte = fechaValida(sp.corte) ? sp.corte : hoyISO();
  const detalle = sp.detalle === "1";
  const { deudas, cargos, bancos } = await conEmpresa(id, async (tx) => ({
    deudas: await deudaPorCliente(tx, corte), cargos: await listarCargos(tx),
    bancos: (await listarCuentas(tx)).filter((c) => c.tipo === "activo" && c.de_detalle && c.activa && c.codigo.startsWith("11")),
  }));
  const hoy = hoyISO();
  const porCobrar = cargos.filter((c) => c.estado === "pendiente");
  const suma = (f: (d: (typeof deudas)[number]) => bigint) => deudas.reduce((s, d) => s + f(d), 0n);
  const tramos = TRAMOS.map((_, i) => suma((d) => d.tramos[i]));
  const atraso = (dias: number) => (dias > 0 ? <span style={{ color: dias > 60 ? "var(--peligro)" : undefined }}>{dias} días</span> : <span className="sub">Al día</span>);

  return (
    <>
      <div className="entre">
        <h1>Cuentas por cobrar</h1>
        <div className="fila" style={{ gap: 8 }}>
          <Link className="boton" href={`/e/${id}/cobros/nuevo`}>Aplicar un pago</Link>
          <Link className="boton" href={`/e/${id}/cxc/estado`}>Estado de cuenta →</Link>
        </div>
      </div>
      <p className="sub">
        Lo que debe cada cliente de {empresa.nombre} al {verFecha(corte)}: toda factura a un cliente queda a crédito aquí hasta que se le aplica el pago
        (cada pago da su recibo). Los días de atraso son los de su factura más vieja. Valores en pesos (las facturas en dólares a la tasa de la factura).
      </p>
      <form className="fila" style={{ marginBottom: 16 }}>
        <label>Al<input type="date" name="corte" defaultValue={corte} /></label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" name="detalle" value="1" defaultChecked={detalle} style={{ minHeight: 0 }} /> Ver cada factura
        </label>
        <button>Ver</button>
        {puede(permisos, "exportar") && <a className="boton" href={`/e/${id}/exportar/antiguedad?corte=${corte}`}>Descargar Excel</a>}
      </form>
      <div className="cifras">
        <div className="tarjeta cifra"><div className="etiqueta">Total por cobrar</div><div className="valor">{verMonto(suma((d) => d.saldo))}</div>
          <div className="sub">{deudas.length} cliente{deudas.length === 1 ? "" : "s"}</div></div>
        {TRAMOS.map((t, i) => (
          <div key={t} className="tarjeta cifra">
            <div className="etiqueta">{t}</div>
            <div className="valor" style={{ color: i >= 3 && tramos[i] > 0n ? "var(--peligro)" : undefined }}>{verMonto(tramos[i])}</div>
          </div>
        ))}
      </div>
      <div className="tabla-envoltura">
        <table>
          <thead>
            <tr><th>Cliente</th><th className="num">Facturas pendientes</th><th className="num">Facturado</th><th className="num">Abonos y notas</th>
              <th className="num">Saldo</th><th>Atraso</th></tr>
          </thead>
          <tbody>
            {deudas.map((d) => (
              <Fragment key={d.clienteId}>
                <tr className={detalle ? "grupo" : undefined}>
                  <td><Link href={`/e/${id}/cxc/estado?cliente=${d.clienteId}&hasta=${corte}`}>{d.cliente}</Link></td>
                  <td className="num">{d.facturas}</td>
                  <td className="num">{verMonto(d.facturado)}</td>
                  <td className="num">{verMonto(d.abonado, true)}</td>
                  <td className="num"><strong>{verMonto(d.saldo)}</strong></td>
                  <td>{atraso(d.diasAtraso)}</td>
                </tr>
                {detalle && d.detalle.map((f) => {
                  const total = aPesos(aCentavos(f.total), tasaDeTexto(f.tasa));
                  return (
                    <tr key={f.id}>
                      <td style={{ paddingLeft: 28 }}>
                        <Link href={`/e/${id}/facturas/${f.id}`}>{f.ncf}</Link>
                        <span className="sub"> · del {verFecha(f.fecha)} · vence {verFecha(f.vence)}{f.moneda === "USD" && ` · US$ ${verMonto(f.saldo)}`}</span>
                      </td>
                      <td />
                      <td className="num">{verMonto(total)}</td>
                      <td className="num">{verMonto(total - f.saldoPesos, true)}</td>
                      <td className="num">{verMonto(f.saldoPesos)}</td>
                      <td>{atraso(f.dias)}</td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            {deudas.length === 0 && <tr><td colSpan={6}>Ningún cliente debe nada a esa fecha.</td></tr>}
          </tbody>
          {deudas.length > 0 && (
            <tfoot>
              <tr><td>Total</td><td className="num">{deudas.reduce((s, d) => s + d.facturas, 0)}</td><td className="num">{verMonto(suma((d) => d.facturado))}</td>
                <td className="num">{verMonto(suma((d) => d.abonado))}</td><td className="num">{verMonto(suma((d) => d.saldo))}</td><td /></tr>
            </tfoot>
          )}
        </table>
      </div>

      {cargos.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>Impuestos pagados por cuenta de clientes</h2>
          <p className="sub">
            Impuestos que Empire adelantó por un cliente. No llevan comprobante fiscal: se cobran con un recibo propio. Por cobrar: RD${verMonto(porCobrar.reduce((s, c) => s + aCentavos(c.monto), 0n))}.
          </p>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>N.º</th><th>Cliente</th><th>Concepto</th><th>Fecha</th><th className="num">Monto</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {cargos.map((c) => (
                  <Fragment key={c.id}>
                    <tr style={c.estado === "cobrado" ? { opacity: 0.7 } : undefined}>
                      <td>{c.numero}</td><td>{c.cliente}</td><td>{c.concepto}</td><td>{verFecha(c.fecha)}</td><td className="num">{verMonto(c.monto)}</td>
                      <td>{c.estado === "cobrado" ? <>Cobrado el {verFecha(c.cobrado_en)}{c.cobro_forma ? ` · ${FORMAS_COBRO_CARGO[c.cobro_forma] ?? c.cobro_forma}` : ""}</> : "Por cobrar"}</td>
                      <td className="num">{c.estado === "cobrado" && puede(permisos, "exportar") && <a href={`/e/${id}/exportar/recibo-cargo?id=${c.id}&formato=pdf`}>Recibo PDF</a>}</td>
                    </tr>
                    {c.estado === "pendiente" && puede(permisos, "contabilizar") && (
                      <tr>
                        <td colSpan={7}>
                          <details>
                            <summary>Cobrar el cargo {c.numero}</summary>
                            <Formulario accion={cobrarCargoAccion.bind(null, id, c.id)} boton="Registrar cobro" className="fila">
                              <label>Fecha del cobro<input type="date" name="fecha" defaultValue={hoy} max={hoy} required /></label>
                              <label>Forma
                                <select name="forma" defaultValue="transferencia">{Object.entries(FORMAS_COBRO_CARGO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                              </label>
                              <label style={{ flex: "1 1 220px" }}>Entró a
                                <select name="cuenta_cobro" defaultValue="" required><option value="" disabled>Elige banco o caja</option>{bancos.map((b) => <option key={b.id} value={b.id}>{b.codigo} · {b.nombre}</option>)}</select>
                              </label>
                              <label style={{ flex: "1 1 160px" }}>Referencia<input name="referencia" maxLength={100} /></label>
                            </Formulario>
                          </details>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
