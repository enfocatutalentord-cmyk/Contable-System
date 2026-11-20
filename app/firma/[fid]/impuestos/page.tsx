import Link from "next/link";
import { Descargar } from "@/app/descargar";
import { Formulario } from "@/app/formulario";
import { AbrirEnPanel } from "@/app/panel-formulario";
import { marcarEnviado } from "@/app/e/[id]/dgii-acciones";
import { notFound } from "next/navigation";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { moverMes, nombreMes } from "@/lib/bitacora";
import { clientesDeFirma, impuestosDeFirma } from "@/lib/firma";
import { MENSUALES, type EstadoDeclaracion } from "@/lib/impuestos-mes";
import { aCentavos, deCentavos, hoyISO, verFecha, verMonto } from "@/lib/montos";

export const metadata = { title: "Impuestos del mes · Empire Tax & Legal" };

const TEXTO: Record<EstadoDeclaracion, string> = { presentada: "Presentada", en_cero: "En cero", pendiente: "Pendiente", vencida: "Vencida" };
const FILTROS: Record<string, string> = { todos: "Todos", pendientes: "Con pendientes", listos: "Al día" };

// Impuestos del mes (bloque 4a, Fase 2, sección 5): un tablero con todos los clientes y el estado de cada declaración que le
// toca según su perfil fiscal, sus compras por revisar y lo que paga. Sin «Cerrar el mes» (Prioridad 1.3: a los clientes no se les lleva
// contabilidad) y cada formulario se abre en un panel encima del tablero. Como el «Tax manager» de Xero, la
// presentación se marca a mano: la DGII no le avisa al sistema.
export default async function ImpuestosDelMes({ params, searchParams }: {
  params: Promise<{ fid: string }>; searchParams: Promise<{ mes?: string; ver?: string; mios?: string }>;
}) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound(); // solo el equipo de la firma
  const hoy = hoyISO();
  const anterior = moverMes(hoy.slice(0, 7), -1); // en noviembre se declara octubre
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes ?? "") ? sp.mes! : anterior;
  const periodo = mes.replace("-", "");
  const ver = sp.ver && sp.ver in FILTROS ? sp.ver : "todos";
  const mios = sp.mios === "1";
  const clientes = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => c.activa && !c.propia && c.estado_cliente !== "prospecto" && (!mios || c.responsable_id === usuario.id));
  const todas = await impuestosDeFirma(clientes, periodo, hoy);
  const filas = todas.filter((f) =>
    ver === "pendientes" ? !f.listo : ver === "listos" ? f.listo : true);
  const enlace = (extra: Record<string, string>) =>
    `/firma/${fid}/impuestos?${new URLSearchParams({ mes, ver, ...(mios ? { mios: "1" } : {}), ...extra })}`;
  const cuenta = {
    listos: todas.filter((f) => f.listo).length,
    vencidas: todas.reduce((s, f) => s + f.declaraciones.filter((d) => d.estado === "vencida").length, 0),
    sinRevisar: todas.reduce((s, f) => s + f.compras - f.revisadas, 0),
  };
  const aPagar = deCentavos(todas.reduce((s, f) => s + aCentavos(f.aPagar), 0n));

  return (
    <>
      <div className="entre">
        <div>
          <h1>Impuestos del mes</h1>
          <p className="sub">
            Lo que declara cada cliente en {nombreMes(mes)} según su perfil fiscal: revisar las compras, preparar y presentar cada
            formulario (con su constancia y monto a pagar). Toca la casilla de un cliente y su formulario se abre aquí mismo.
          </p>
        </div>
        <Descargar href={`/firma/${fid}/impuestos/exportar?mes=${mes}`} />
      </div>
      <nav className="fila" style={{ marginBottom: 12, alignItems: "center" }} aria-label="Mes">
        <Link className="boton" href={enlace({ mes: moverMes(mes, -1) })}>← {nombreMes(moverMes(mes, -1))}</Link>
        <strong style={{ textTransform: "capitalize" }}>{nombreMes(mes)}</strong>
        <Link className="boton" href={enlace({ mes: moverMes(mes, 1) })}>{nombreMes(moverMes(mes, 1))} →</Link>
        {Object.entries(FILTROS).map(([k, v]) => <Link key={k} className={`boton${ver === k ? " primario" : ""}`} href={enlace({ ver: k })}>{v}</Link>)}
        <Link className="boton" href={`/firma/${fid}/impuestos?${new URLSearchParams({ mes, ver, ...(mios ? {} : { mios: "1" }) })}`}>{mios ? "Todos los responsables" : "Solo mis clientes"}</Link>
      </nav>
      <div className="cifras" style={{ marginBottom: 16 }}>
        <div className="tarjeta cifra"><div className="etiqueta">Clientes al día</div><div className="valor">{cuenta.listos} de {todas.length}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Declaraciones vencidas</div><div className="valor" style={cuenta.vencidas ? { color: "var(--peligro)" } : undefined}>{cuenta.vencidas}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Compras sin revisar</div><div className="valor">{cuenta.sinRevisar}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">A pagar por los clientes</div><div className="valor">RD${verMonto(aPagar)}</div></div>
      </div>
      <div className="tabla-envoltura">
        <table className="tabla-impuestos">
          <thead>
            <tr>
              <th>Cliente</th>{MENSUALES.map((m) => <th key={m.formato}>{m.formato}</th>)}<th>Compras</th><th className="num">A pagar</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const c = f.cliente;
              const base = `/e/${c.id}`;
              return (
                <tr key={c.id}>
                  <td>
                    <strong>{c.nombre}</strong>
                    {f.sugeridas && <div className="sub" style={{ margin: 0 }}><Link href={`${base}/fiscal`}>Obligaciones sugeridas: confírmalas</Link></div>}
                    <div className="sub" style={{ margin: 0 }}>{c.responsable ?? "Sin responsable"}{f.documentos > 0 && <> · <Link href={`${base}/recepcion`}>{f.documentos} documento{f.documentos > 1 ? "s" : ""} sin procesar</Link></>}</div>
                  </td>
                  {MENSUALES.map((m) => {
                    const d = f.declaraciones.find((x) => x.formato === m.formato);
                    if (!d) return <td key={m.formato} className="sub" title="No la tiene confirmada en su perfil fiscal">—</td>;
                    const listo = d.estado === "presentada" || d.estado === "en_cero";
                    return (
                      <td key={m.formato} className={`declaracion-${d.estado}`}>
                        <AbrirEnPanel href={`${base}${m.ruta}?mes=${mes}&desde=impuestos${m.ruta === "/dgii" ? `#f${m.formato}` : ""}`}
                          titulo={`${m.formato} de ${c.nombre} · ${nombreMes(mes)}`}>{TEXTO[d.estado]}</AbrirEnPanel>
                        {!listo && <div className="sub" style={{ margin: 0 }}>vence {verFecha(d.vence)}</div>}
                        {d.monto && <div className="sub" style={{ margin: 0 }}>RD${verMonto(d.monto)}</div>}
                        {!listo && ["606", "607", "608"].includes(m.formato) && (
                          <Formulario accion={marcarEnviado.bind(null, c.id, m.formato, periodo)} boton="En cero" className="fila boton-chico">
                            <input type="hidden" name="en_cero" value="1" />
                          </Formulario>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    {f.compras === 0 ? <span className="sub">Ninguna</span> : (
                      <Link href={`${base}/facturas-subidas?estado=todas`}>{f.revisadas} de {f.compras} revisadas</Link>
                    )}
                    {f.corregir > 0 && <div className="error" style={{ margin: 0 }}>{f.corregir} por corregir</div>}
                  </td>
                  <td className="num">{f.aPagar !== "0.00" ? verMonto(f.aPagar) : ""}</td>
                </tr>
              );
            })}
            {filas.length === 0 && <tr><td colSpan={MENSUALES.length + 3}>No hay clientes con ese filtro.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="sub">
        «En cero» marca el formato como enviado sin operaciones (solo si no tiene registros). Al presentar el IT-1 o el IR-17 con monto a
        pagar se crea su notificación de pago para enviarla por WhatsApp.
      </p>
    </>
  );
}
