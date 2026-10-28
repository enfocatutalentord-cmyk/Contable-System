import Link from "next/link";
import { accesoFirma } from "@/lib/acceso";
import { actividad, clientesDeFirma, hace, resumenCliente } from "@/lib/firma";
import { verFecha, verMonto } from "@/lib/montos";

export const metadata = { title: "Inicio de la firma · Empire Tax’N Legal" };

// Todo lo de la firma en una sola pantalla: cifras, clientes con lo pendiente y la actividad del equipo y de los clientes
// (como el tablero de clientes de Xero HQ y la lista de clientes de QuickBooks Online Accountant).
export default async function InicioFirma({ params, searchParams }: {
  params: Promise<{ fid: string }>;
  searchParams: Promise<{ bienvenida?: string; sin_permiso?: string }>;
}) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  const clientes = await clientesDeFirma(fid, usuario.id, firma.administrador);
  const [resumenes, eventos] = await Promise.all([Promise.all(clientes.map((c) => resumenCliente(c.id))), actividad(clientes, 12)]);
  const filas = clientes.map((c, i) => ({ ...c, ...resumenes[i] }));
  const suma = (f: (r: (typeof filas)[number]) => bigint | number) => filas.reduce((s, r) => s + BigInt(f(r)), 0n);
  const pendientes = (r: (typeof filas)[number]) => [
    r.borradores && `${r.borradores} asiento${r.borradores > 1 ? "s" : ""} en borrador`,
    r.facturasBorrador && `${r.facturasBorrador} factura${r.facturasBorrador > 1 ? "s" : ""} sin emitir`,
    r.comprasBorrador && `${r.comprasBorrador} compra${r.comprasBorrador > 1 ? "s" : ""} sin registrar`,
    r.documentosSemana && `${r.documentosSemana} documento${r.documentosSemana > 1 ? "s" : ""} nuevo${r.documentosSemana > 1 ? "s" : ""}`,
  ].filter(Boolean) as string[];

  return (
    <>
      {sp.bienvenida && <p className="exito">Listo, tu contraseña quedó guardada. Desde ahora entras con tu correo y esa contraseña.</p>}
      {sp.sin_permiso && <p className="aviso">Esa sección es solo para administradores de la firma.</p>}
      <div className="entre">
        <div>
          <h1>Inicio de la firma</h1>
          <p className="sub">Hola, {usuario.nombre}. Para trabajar en un cliente, elígelo arriba en «Viendo» o toca su nombre.</p>
        </div>
        {firma.administrador && <Link className="boton primario" href={`/firma/${fid}/clientes/nuevo`}>+ Nuevo cliente</Link>}
      </div>

      <div className="cifras">
        <div className="tarjeta cifra"><div className="etiqueta">Clientes activos</div><div className="valor">{clientes.length}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Por cobrar vencido (RD$)</div>
          <div className="valor" style={{ color: suma((r) => r.vencido) > 0n ? "var(--peligro)" : undefined }}>{verMonto(suma((r) => r.vencido))}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Pendiente por procesar</div>
          <div className="valor">{suma((r) => r.borradores + r.facturasBorrador + r.comprasBorrador).toString()}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Documentos subidos esta semana</div><div className="valor">{suma((r) => r.documentosSemana).toString()}</div></div>
      </div>

      <div className="inicio-firma">
        <section>
          <h2>Clientes</h2>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Cliente</th><th>Responsable</th><th>Pendiente</th><th className="num">Por cobrar</th><th className="num">Por pagar</th><th>Cerrado hasta</th></tr></thead>
              <tbody>
                {filas.map((c) => (
                  <tr key={c.id}>
                    <td style={{ minWidth: 170 }}><Link href={`/e/${c.id}`}><strong>{c.nombre}</strong></Link>{c.rnc && <div className="sub" style={{ margin: 0 }}>{c.rnc}</div>}</td>
                    <td>{c.responsable ?? <span className="sub">—</span>}</td>
                    <td>{pendientes(c).length ? pendientes(c).join(" · ") : <span className="sub">Al día</span>}</td>
                    <td className="num">
                      {verMonto(c.porCobrar)}
                      {c.vencido > 0n && <div className="error" style={{ margin: 0, fontSize: "0.8rem" }}>{verMonto(c.vencido)} vencido</div>}
                    </td>
                    <td className="num">{verMonto(c.porPagar)}</td>
                    <td>{c.fecha_bloqueo ? verFecha(c.fecha_bloqueo) : "—"}</td>
                  </tr>
                ))}
                {filas.length === 0 && (
                  <tr><td colSpan={6}>
                    {firma.administrador
                      ? <>Todavía no hay clientes. Crea el primero con <Link href={`/firma/${fid}/clientes/nuevo`}>+ Nuevo cliente</Link>.</>
                      : "Todavía no tienes clientes asignados. Pídele a un administrador de la firma que te asigne en «Personas y accesos»."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <div className="entre" style={{ alignItems: "baseline" }}>
            <h2>Actividad</h2>
            <Link href={`/firma/${fid}/actividad`}>Ver toda</Link>
          </div>
          <ul className="actividad tarjeta">
            {eventos.map((e, i) => (
              <li key={i}>
                <strong>{e.quien}</strong> {e.enlace ? <Link href={e.enlace}>{e.texto}</Link> : e.texto}
                <div className="sub">{e.cliente} · {hace(e.fecha)}</div>
              </li>
            ))}
            {eventos.length === 0 && <li className="sub">Todavía no hay movimientos.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}
