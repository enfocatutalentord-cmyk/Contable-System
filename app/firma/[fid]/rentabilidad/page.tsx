import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoFirma } from "@/lib/acceso";
import { moverMes, nombreMes, verTiempo } from "@/lib/bitacora";
import { db } from "@/lib/db";
import { clientesDeFirma } from "@/lib/firma";
import { aCentavos, hoyISO, verMonto } from "@/lib/montos";
import { cobradoPorHora, leerPeriodo, margen, rentabilidadPorCliente } from "@/lib/rentabilidad";
import { guardarCostoHora } from "../../rentabilidad-acciones";

export const metadata = { title: "Rentabilidad por cliente · Empire Tax & Legal" };

// Rentabilidad por cliente (Prioridad 2.2, P2b): lo cobrado menos el tiempo anotado en la bitácora por el costo de la hora. Solo administradoras.
export default async function Rentabilidad({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ mes?: string; anio?: string }> }) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid);
  const hoy = hoyISO();
  const p = leerPeriodo(sp.mes, sp.anio, hoy);
  const [{ costo_hora }] = await db()<{ costo_hora: string | null }[]>`SELECT costo_hora::text FROM firmas WHERE id = ${fid}`;
  const costoHora = costo_hora === null ? null : aCentavos(costo_hora);
  const clientes = (await clientesDeFirma(fid, usuario.id, true, true)).filter((c) => !c.propia);
  const filas = await rentabilidadPorCliente(firma.empresa_propia_id, clientes, p, costoHora);

  const suma = filas.reduce((a, f) => ({ cobrado: a.cobrado + f.cobrado, minutos: a.minutos + f.minutos, costo: a.costo + (f.costo ?? 0n) }), { cobrado: 0n, minutos: 0, costo: 0n });
  const ganancia = costoHora === null ? null : suma.cobrado - suma.costo;
  const porHora = (cobrado: bigint, minutos: number) => { const h = cobradoPorHora(cobrado, minutos); return h === null ? "—" : verMonto(h); };
  const enlace = (q: string) => `/firma/${fid}/rentabilidad?${q}`;
  const sinTiempoTotal = filas.reduce((a, f) => a + f.sinTiempo, 0);

  return (
    <>
      <h1>Rentabilidad por cliente</h1>
      <p className="sub">
        Lo que Empire cobró de cada cliente en {p.tipo === "mes" ? nombreMes(p.mes) : `el año ${p.anio}`}, menos el tiempo que el equipo anotó en su bitácora
        por el costo de la hora de trabajo. Solo la ven las administradoras de la firma.
      </p>
      <nav className="fila" style={{ marginBottom: 12 }} aria-label="Período">
        <Link className="boton" href={enlace(`mes=${moverMes(p.mes, -1)}`)}>← {nombreMes(moverMes(p.mes, -1))}</Link>
        <Link className={`boton${p.tipo === "mes" ? " primario" : ""}`} href={enlace(`mes=${p.mes}`)}>{nombreMes(p.mes)}</Link>
        <Link className="boton" href={enlace(`mes=${moverMes(p.mes, 1)}`)}>{nombreMes(moverMes(p.mes, 1))} →</Link>
        <Link className={`boton${p.tipo === "anio" ? " primario" : ""}`} href={enlace(`anio=${p.anio}`)}>Todo {p.anio}</Link>
      </nav>

      <section className="tarjeta" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Costo de la hora de trabajo</h2>
        <Formulario accion={guardarCostoHora.bind(null, fid)} boton="Guardar" className="fila">
          <label>RD$ por hora<input name="costo_hora" inputMode="decimal" defaultValue={costo_hora ? verMonto(costo_hora) : ""} placeholder="Ej.: 750.00" style={{ width: 160, textAlign: "right" }} /></label>
        </Formulario>
        <p className="sub" style={{ marginBottom: 0 }}>
          {costoHora === null ? "Escribe cuánto cuesta una hora de trabajo del equipo para ver la ganancia de cada cliente. Mientras tanto se muestran lo cobrado y el tiempo."
            : "Es un solo costo para todo el equipo. Si cambia, los meses ya mirados se recalculan con el valor nuevo."}
        </p>
      </section>

      <div className="cifras">
        <div className="tarjeta cifra"><div className="etiqueta">Cobrado</div><div className="valor">RD${verMonto(suma.cobrado)}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Tiempo anotado</div><div className="valor">{suma.minutos ? verTiempo(suma.minutos) : "—"}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Costo del tiempo</div><div className="valor">{costoHora === null ? "—" : `RD$${verMonto(suma.costo)}`}</div></div>
        <div className="tarjeta cifra">
          <div className="etiqueta">Ganancia</div>
          <div className="valor" style={ganancia !== null && ganancia < 0n ? { color: "var(--peligro)" } : undefined}>{ganancia === null ? "—" : `RD$${verMonto(ganancia)}`}</div>
          {ganancia !== null && margen(suma.cobrado, ganancia) !== null && <div className="sub">{margen(suma.cobrado, ganancia)} % de lo cobrado</div>}
        </div>
      </div>

      {sinTiempoTotal > 0 && (
        <p className="aviso">{sinTiempoTotal === 1 ? "Hay 1 gestión anotada en la bitácora sin tiempo: no cuenta" : `Hay ${sinTiempoTotal} gestiones anotadas en la bitácora sin tiempo: no cuentan`} en el costo, así que la ganancia puede salir más alta de lo real.</p>
      )}

      <div className="tabla-envoltura">
        <table>
          <thead>
            <tr><th>Cliente</th><th className="num">Cobrado</th><th className="num">Tiempo</th><th className="num">Cobrado por hora</th><th className="num">Costo del tiempo</th><th className="num">Ganancia</th><th className="num">Margen</th></tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const m = f.ganancia === null ? null : margen(f.cobrado, f.ganancia);
              return (
                <tr key={f.empresaId}>
                  <td>
                    <Link href={`/e/${f.empresaId}/bitacora?mes=${p.tipo === "mes" ? p.mes : `${p.anio}-${hoy.slice(5, 7)}`}`}>{f.nombre}</Link>
                    {f.cobrado === 0n && <div className="sub" style={{ margin: 0 }}>Sin cobros en el período</div>}
                    {f.minutos === 0 && <div className="sub" style={{ margin: 0 }}>Sin tiempo anotado{f.gestiones ? ` (${f.gestiones === 1 ? "1 gestión" : `${f.gestiones} gestiones`})` : ""}</div>}
                  </td>
                  <td className="num">{verMonto(f.cobrado)}</td>
                  <td className="num">{f.minutos ? verTiempo(f.minutos) : "—"}</td>
                  <td className="num">{porHora(f.cobrado, f.minutos)}</td>
                  <td className="num">{f.costo === null ? "—" : verMonto(f.costo)}</td>
                  <td className="num" style={f.ganancia !== null && f.ganancia < 0n ? { color: "var(--peligro)" } : undefined}>{f.ganancia === null ? "—" : verMonto(f.ganancia)}</td>
                  <td className="num">{m === null ? "—" : `${m} %`}</td>
                </tr>
              );
            })}
            {filas.length === 0 && <tr><td colSpan={7}>No hay cobros ni tiempo anotado en este período.</td></tr>}
          </tbody>
          {filas.length > 0 && (
            <tfoot>
              <tr>
                <th>Total</th><th className="num">{verMonto(suma.cobrado)}</th><th className="num">{suma.minutos ? verTiempo(suma.minutos) : "—"}</th><th className="num">{porHora(suma.cobrado, suma.minutos)}</th>
                <th className="num">{costoHora === null ? "—" : verMonto(suma.costo)}</th><th className="num">{ganancia === null ? "—" : verMonto(ganancia)}</th>
                <th className="num">{ganancia === null || margen(suma.cobrado, ganancia) === null ? "—" : `${margen(suma.cobrado, ganancia)} %`}</th>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="sub">
        Lo cobrado es lo que entró de cada cliente en el período por sus facturas y anticipos (los clientes enlazados con la empresa que factura). El tiempo sale de las
        gestiones de su bitácora con «Tiempo dedicado». Los clientes sin cobros ni tiempo no aparecen.
      </p>
    </>
  );
}
