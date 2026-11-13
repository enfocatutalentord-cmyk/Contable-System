import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { db } from "@/lib/db";
import { urlApp } from "@/lib/enlaces";
import { verFecha } from "@/lib/montos";
import { clavesDe } from "@/lib/vendario-firma";
import { ESTADO_CLIENTE, SERVICIOS } from "@/lib/vendario-sobre";
import { marcarReceptora } from "../../vendario-acciones";

export const metadata = { title: "Vendario · Empire Tax’N Legal" };

type Fila = { id: string; nombre: string | null; rnc: string | null; estado: string; servicios: string[]; responsable: string | null; empresa: string | null;
  empresa_id: string | null; al_dia_hasta: string | null; creado_en: Date; vista_en: Date | null; esperando: number; ultimo: string | null };

// Integración con Vendario, parte 1: solicitudes nuevas, clientes activos y dados de baja.
export default async function Vendario({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  const [{ recibe }] = await db()<{ recibe: boolean }[]>`SELECT recibe_vendario AS recibe FROM firmas WHERE id = ${fid}`;
  const filas = await db()<Fila[]>`
    SELECT v.id, coalesce(v.empresa_datos->>'trade_name', v.empresa_datos->>'legal_name') AS nombre, v.rnc, v.estado, v.servicios,
           r.nombre AS responsable, e.nombre AS empresa, v.empresa_id, v.al_dia_hasta, v.creado_en, v.vista_en,
           (SELECT count(*)::int FROM vendario_eventos x WHERE x.vendario_cliente_id = v.id AND x.estado IN ('esperando', 'pendiente')) AS esperando,
           (SELECT s.estado_servicio FROM vendario_envios s WHERE s.vendario_cliente_id = v.id ORDER BY s.creado_en DESC LIMIT 1) AS ultimo
      FROM vendario_clientes v LEFT JOIN usuarios r ON r.id = v.responsable_id LEFT JOIN empresas e ON e.id = v.empresa_id
     WHERE v.firma_id = ${fid} ORDER BY v.creado_en DESC`;
  const solicitudes = filas.filter((f) => f.estado === "solicitud" || f.estado === "necesita_info");
  const activos = filas.filter((f) => f.estado === "aceptada" || f.estado === "suspendida");
  const bajas = filas.filter((f) => f.estado === "finalizada");
  const origen = await urlApp();
  const listo = { v2e: clavesDe(process.env.V2E_SECRET).length > 0, e2v: clavesDe(process.env.E2V_SECRET).length > 0, cron: !!process.env.CRON_SECRET };

  const tabla = (lista: Fila[], vacio: string, solicitud = false) => (
    <div className="tabla-envoltura">
      <table>
        <thead><tr><th>Empresa</th><th>Servicios</th><th>{solicitud ? "Llegó" : "Responsable"}</th><th>{solicitud ? "Estado" : "Al día hasta"}</th><th>Eventos por contabilizar</th></tr></thead>
        <tbody>
          {lista.map((f) => (
            <tr key={f.id}>
              <td><Link href={`/firma/${fid}/vendario/${f.id}`}>{f.nombre ?? "Sin nombre"}</Link>{f.rnc && <span className="sub"> · {f.rnc}</span>}
                {f.empresa && f.empresa_id && <div className="sub">En Empire: <Link href={`/e/${f.empresa_id}`}>{f.empresa}</Link></div>}</td>
              <td>{f.servicios.map((s) => SERVICIOS[s] ?? s).join(", ")}</td>
              <td>{solicitud ? verFecha(f.creado_en.toISOString().slice(0, 10)) : f.responsable ?? "—"}</td>
              <td>{solicitud ? `${ESTADO_CLIENTE[f.estado]}${f.vista_en ? "" : " · sin abrir"}` : f.estado === "suspendida" ? "Suspendido" : f.al_dia_hasta ?? "—"}</td>
              <td>{f.esperando || "—"}</td>
            </tr>
          ))}
          {lista.length === 0 && <tr><td colSpan={5}>{vacio}</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <h1>Vendario</h1>
      <p className="sub">
        Clientes que piden el servicio contable desde Vendario (punto de venta e inventario). Vendario manda su alta, su autorización y cada
        operación; aquí se acepta la solicitud y se le avisa al cliente cada paso. <Link href={`/firma/${fid}/vendario/salud`}>Salud de la integración</Link>
      </p>
      {!recibe && (
        <p className="aviso">Esta firma todavía no recibe los clientes de Vendario. Las altas que lleguen esperan hasta que una firma los reciba.</p>
      )}
      {(!listo.v2e || !listo.e2v || !listo.cron) && (
        <p className="aviso">
          Faltan en Vercel {[!listo.v2e && "V2E_SECRET", !listo.e2v && "E2V_SECRET", !listo.cron && "CRON_SECRET"].filter(Boolean).join(", ")}.
          Los pone quien administra Vercel (Settings › Environment Variables); las dos primeras, con el mismo valor que en Vendario.
        </p>
      )}

      <h2>Solicitudes nuevas ({solicitudes.length})</h2>
      {tabla(solicitudes, "No hay solicitudes nuevas.", true)}
      <h2>Clientes activos ({activos.length})</h2>
      {tabla(activos, "Todavía no hay clientes de Vendario aceptados.")}
      {bajas.length > 0 && (<><h2>Dados de baja ({bajas.length})</h2>{tabla(bajas, "")}</>)}

      {firma.administrador && (
        <div className="tarjeta" style={{ marginTop: 24 }}>
          <h2 style={{ marginTop: 0 }}>Conexión</h2>
          <p className="sub" style={{ marginTop: 0 }}>
            Dirección de Empire para Vendario («Dirección de Empire» en su panel maestro): <code>{origen}</code>. Vendario manda a{" "}
            <code>{origen}/api/vendario/v1/inbox</code>.
          </p>
          <Formulario accion={marcarReceptora.bind(null, fid, !recibe)} boton={recibe ? "Dejar de recibir clientes de Vendario" : "Recibir aquí los clientes de Vendario"} className="fila">
            <span className="sub">{recibe ? "Esta firma recibe los clientes de Vendario." : "Solo una firma de la plataforma los recibe."}</span>
          </Formulario>
        </div>
      )}
    </>
  );
}
