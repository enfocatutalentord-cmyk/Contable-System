import Link from "next/link";
import { accesoEmpresa, accesoFirma, soloCliente } from "@/lib/acceso";
import { listarAprobaciones } from "@/lib/aprobaciones";
import { conEmpresa, db } from "@/lib/db";
import { puede } from "@/lib/permisos";
import { actividad, alertasDeFirma, clientesDeFirma, hace, resumenCliente } from "@/lib/firma";
import { hoyISO } from "@/lib/montos";
import { avisosNormasDeFirma } from "@/lib/normas";
import { estadoPadron } from "@/lib/padron-db";
import { esDuenaPlataforma } from "@/lib/plataforma";

export const metadata = { title: "Inicio de la firma · Empire Tax & Legal" };

// Todo lo de la firma en una sola pantalla: cifras, clientes con lo pendiente y la actividad del equipo y de los clientes
// (como el tablero de clientes de Xero HQ y la lista de clientes de QuickBooks Online Accountant).
export default async function InicioFirma({ params, searchParams }: {
  params: Promise<{ fid: string }>;
  searchParams: Promise<{ bienvenida?: string; sin_permiso?: string }>;
}) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  const clientes = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => !c.propia);
  const [resumenes, eventos, alertas, normas] = await Promise.all([Promise.all(clientes.map((c) => resumenCliente(c.id))), actividad(clientes, 12), alertasDeFirma(clientes, hoyISO()),
    avisosNormasDeFirma(fid, hoyISO(), usuario.id, firma.administrador)]);
  const filas = clientes.map((c, i) => ({ ...c, ...resumenes[i] }));
  // Lo que espera el visto bueno de esta persona (Prioridad 2.1): en cualquier empresa donde pueda aprobar, sin contar lo que ella preparó.
  const porAprobar = (await Promise.all((await clientesDeFirma(fid, usuario.id, firma.administrador)).map(async (c) => {
    if (!puede((await accesoEmpresa(c.id)).permisos, "aprobar")) return 0;
    return (await conEmpresa(c.id, (tx) => listarAprobaciones(tx, ["pendiente"]))).filter((a) => a.solicitadoPorId !== usuario.id).length;
  }))).reduce((a, b) => a + b, 0);
  // Solicitudes nuevas de Vendario (aviso al equipo contable, acuerdo §11).
  const [vendario] = await soloCliente(fid, usuario.id) ? [{ n: 0 }] : await db()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM vendario_clientes WHERE firma_id = ${fid} AND estado = 'solicitud'`;
  // Padrón de la DGII (P2c.3): solo la dueña de la plataforma lo carga, y es a ella a quien se le recuerda cada mes.
  const padron = await esDuenaPlataforma(usuario.email) ? await estadoPadron() : null;
  const suma = (f: (r: (typeof filas)[number]) => bigint | number) => filas.reduce((s, r) => s + BigInt(f(r)), 0n);
  // El trabajo pendiente de cada cliente (Prioridad 1.3): sin saldos, asientos, cierres ni bancos, que a los clientes no se les llevan.
  const pendientes = (r: (typeof filas)[number]) => [
    r.facturasPorRevisar && `${r.facturasPorRevisar} factura${r.facturasPorRevisar > 1 ? "s" : ""} por revisar`,
    r.pendientesDeRegistrar && `${r.pendientesDeRegistrar} factura${r.pendientesDeRegistrar > 1 ? "s" : ""} aprobada${r.pendientesDeRegistrar > 1 ? "s" : ""} sin registrar`,
    r.documentosPorProcesar && `${r.documentosPorProcesar} documento${r.documentosPorProcesar > 1 ? "s" : ""} por procesar`,
    r.tramitesPorVencer && `${r.tramitesPorVencer} trámite${r.tramitesPorVencer > 1 ? "s" : ""} por vencer`,
    r.solicitudesAbiertas && `${r.solicitudesAbiertas} solicitud${r.solicitudesAbiertas > 1 ? "es" : ""} abierta${r.solicitudesAbiertas > 1 ? "s" : ""}`,
    r.notificaciones && `${r.notificaciones} notificaci${r.notificaciones > 1 ? "ones" : "ón"} de pago por enviar`,
    r.notificacionesPorVencer && `${r.notificacionesPorVencer} notificaci${r.notificacionesPorVencer > 1 ? "ones" : "ón"} sin pagar por vencer`,
    r.gestionesVencidas && `${r.gestionesVencidas} gesti${r.gestionesVencidas > 1 ? "ones" : "ón"} de la bitácora atrasada${r.gestionesVencidas > 1 ? "s" : ""}`,
  ].filter(Boolean) as string[];

  return (
    <>
      {sp.bienvenida && <p className="exito">Listo, tu contraseña quedó guardada. Desde ahora entras con tu correo y esa contraseña.</p>}
      {sp.sin_permiso && <p className="aviso">Esa sección es solo para administradores de la firma.</p>}
      {firma.administrador && !firma.rnc && (
        <p className="aviso">
          Faltan el nombre y el RNC de la firma (salen en los correos, los reportes y las facturas de Empire).{" "}
          <Link href={`/firma/${fid}/clientes#datos-firma`}>Completarlos en Empresas Empire › Datos de la firma</Link>.
        </p>
      )}
      {vendario.n > 0 && (
        <p className="aviso">
          {vendario.n === 1 ? "Hay 1 solicitud nueva" : `Hay ${vendario.n} solicitudes nuevas`} desde Vendario.{" "}
          <Link href={`/firma/${fid}/vendario`}>Verlas</Link>
        </p>
      )}
      {padron && (padron.dias === null || padron.dias > 40) && (
        <p className="aviso">
          {padron.dias === null ? "El padrón de la DGII todavía no está cargado: al escribir un RNC, el sistema no puede completar el nombre." : `El padrón de la DGII se cargó hace ${padron.dias} días.`}{" "}
          <Link href="/plataforma/padron">Cargar el archivo de este mes</Link>
        </p>
      )}
      <div className="entre">
        <div>
          <h1>Inicio de la firma</h1>
          <p className="sub">Hola, {usuario.nombre}. Para trabajar en un cliente, elígelo arriba en «Viendo» o toca su nombre.</p>
        </div>
        {firma.crear_clientes && <Link className="boton primario" href={`/firma/${fid}/clientes/nuevo`}>+ Nuevo cliente</Link>}
      </div>

      <div className="cifras">
        <div className="tarjeta cifra"><div className="etiqueta">Clientes activos</div><div className="valor">{clientes.length}</div></div>
        <a className="tarjeta cifra" href={`/firma/${fid}/aprobaciones`} style={{ color: "inherit", textDecoration: "none" }}>
          <div className="etiqueta">Por aprobar</div><div className="valor" style={porAprobar ? { color: "var(--dorado)" } : undefined}>{porAprobar}</div>
        </a>
        <a className="tarjeta cifra" href={`/firma/${fid}/facturas-subidas`} style={{ color: "inherit", textDecoration: "none" }}>
          <div className="etiqueta">Facturas por revisar</div><div className="valor">{suma((r) => r.facturasPorRevisar + r.pendientesDeRegistrar).toString()}</div>
        </a>
        <a className="tarjeta cifra" href={`/firma/${fid}/documentos`} style={{ color: "inherit", textDecoration: "none" }}>
          <div className="etiqueta">Documentos por procesar</div><div className="valor">{suma((r) => r.documentosPorProcesar).toString()}</div>
        </a>
        <a className="tarjeta cifra" href={`/firma/${fid}/tramites`} style={{ color: "inherit", textDecoration: "none" }}>
          <div className="etiqueta">Trámites por vencer</div><div className="valor">{suma((r) => r.tramitesPorVencer).toString()}</div>
        </a>
        <a className="tarjeta cifra" href={`/firma/${fid}/solicitudes`} style={{ color: "inherit", textDecoration: "none" }}>
          <div className="etiqueta">Solicitudes abiertas</div><div className="valor">{suma((r) => r.solicitudesAbiertas).toString()}</div>
        </a>
      </div>

      {normas.length > 0 && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <div className="entre">
            <h2 style={{ margin: 0 }}>Normas y tasas</h2>
            <Link href={`/firma/${fid}/normas`}>Abrir</Link>
          </div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {normas.map((a, i) => <li key={i} style={a.nivel === "urgente" ? { color: "var(--peligro)" } : undefined}><Link href={a.enlace}>{a.texto}</Link></li>)}
          </ul>
        </div>
      )}
      {alertas.length > 0 && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <div className="entre">
            <h2 style={{ margin: 0 }}>Alertas</h2>
            <Link href={`/firma/${fid}/alertas`}>Ver las {alertas.length}</Link>
          </div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {alertas.slice(0, 6).map((a, i) => (
              <li key={i} style={a.nivel === "urgente" ? { color: "var(--peligro)" } : undefined}>
                <strong>{a.cliente.nombre}:</strong> <Link href={a.enlace}>{a.texto}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="inicio-firma">
        <section>
          <h2>Clientes</h2>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Cliente</th><th>Responsable</th><th>Trabajo pendiente</th></tr></thead>
              <tbody>
                {filas.map((c) => (
                  <tr key={c.id}>
                    <td style={{ minWidth: 170 }}><Link href={`/e/${c.id}`}><strong>{c.nombre}</strong></Link>{c.rnc && <div className="sub" style={{ margin: 0 }}>{c.rnc}</div>}</td>
                    <td>{c.responsable ?? <span className="sub">—</span>}</td>
                    <td>{pendientes(c).length ? pendientes(c).join(" · ") : <span className="sub">Al día</span>}</td>
                  </tr>
                ))}
                {filas.length === 0 && (
                  <tr><td colSpan={3}>
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
