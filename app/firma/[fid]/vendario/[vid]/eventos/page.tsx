import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoFirma, esUuid, soloCliente } from "@/lib/acceso";
import { db } from "@/lib/db";
import { verFecha, verMonto } from "@/lib/montos";
import { NOMBRE_EVENTO } from "@/lib/vendario-contable";
import { reprocesarVendario } from "../../../../vendario-acciones";

export const metadata = { title: "Eventos de Vendario · Empire Tax’N Legal" };

const ESTADO: Record<string, string> = {
  esperando: "Por contabilizar", contabilizado: "Contabilizado", pendiente: "Pendiente", despues_de_baja: "Después de la baja", descartado: "Descartado",
};

// Eventos recibidos de un cliente de Vendario, por mes: qué se creó con cada uno y, si quedó pendiente, el motivo y «Reprocesar».
export default async function EventosVendario({ params, searchParams }: {
  params: Promise<{ fid: string; vid: string }>; searchParams: Promise<{ mes?: string; estado?: string }>;
}) {
  const { fid, vid } = await params;
  const sp = await searchParams;
  if (!esUuid(vid)) notFound();
  const { usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  const [c] = await db()<{ nombre: string | null; empresa_id: string | null }[]>`
    SELECT coalesce(empresa_datos->>'trade_name', empresa_datos->>'legal_name') AS nombre, empresa_id FROM vendario_clientes WHERE id = ${vid} AND firma_id = ${fid}`;
  if (!c) notFound();
  const meses = await db()<{ mes: string; n: number; pendientes: number }[]>`
    SELECT to_char(fecha, 'YYYY-MM') AS mes, count(*)::int AS n, count(*) FILTER (WHERE estado IN ('pendiente', 'esperando'))::int AS pendientes
      FROM vendario_eventos WHERE vendario_cliente_id = ${vid} AND fecha IS NOT NULL GROUP BY 1 ORDER BY 1 DESC`;
  const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : meses[0]?.mes ?? null;
  const soloPendientes = sp.estado === "pendientes";
  const eventos = await db()<{ id: string; seq: string | null; tipo: string; fecha: string | null; historico: boolean; total: string | null; estado: string; motivo: string | null;
    factura_id: string | null; compra_id: string | null; asiento_id: string | null; ncf: string | null; numero: string | null; asiento: number | null }[]>`
    SELECT x.id, x.seq::text, x.tipo, to_char(x.fecha, 'YYYY-MM-DD') AS fecha, x.historico, x.total::text, x.estado, x.motivo, x.factura_id, x.compra_id,
           x.asiento_id, x.datos->'fiscal'->>'ncf' AS ncf, x.datos->'source'->>'number' AS numero, a.numero AS asiento
      FROM vendario_eventos x LEFT JOIN asientos a ON a.id = x.asiento_id
     WHERE x.vendario_cliente_id = ${vid}
       AND (${soloPendientes} OR ${mes}::text IS NULL OR to_char(x.fecha, 'YYYY-MM') = ${mes})
       AND (NOT ${soloPendientes} OR x.estado IN ('pendiente', 'esperando'))
     ORDER BY x.seq NULLS LAST, x.recibido_en LIMIT 500`;
  const base = `/firma/${fid}/vendario/${vid}/eventos`;
  const e = c.empresa_id ? `/e/${c.empresa_id}` : null;

  return (
    <>
      <p><Link href={`/firma/${fid}/vendario/${vid}`}>← {c.nombre ?? "Cliente de Vendario"}</Link></p>
      <h1>Eventos de Vendario</h1>
      <p className="sub">
        Cada operación que mandó Vendario y lo que se creó en Empire. Lo pendiente no se pierde: se reprocesa solo cada 5 minutos o con el botón.
      </p>
      <div className="fila" style={{ gap: 8, flexWrap: "wrap" }}>
        <Link className={soloPendientes ? "boton primario" : "boton"} href={`${base}?estado=pendientes`}>Solo pendientes ({meses.reduce((s, m) => s + m.pendientes, 0)})</Link>
        {meses.map((m) => (
          <Link key={m.mes} className={!soloPendientes && m.mes === mes ? "boton primario" : "boton"} href={`${base}?mes=${m.mes}`}>
            {m.mes} ({m.n}{m.pendientes ? `, ${m.pendientes} pend.` : ""})
          </Link>
        ))}
      </div>
      <div className="tabla-envoltura" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>Seq</th><th>Fecha</th><th>Evento</th><th>Total</th><th>Estado</th><th>En Empire</th><th /></tr></thead>
          <tbody>
            {eventos.map((x) => (
              <tr key={x.id}>
                <td>{x.seq ?? "—"}</td>
                <td>{x.fecha ? verFecha(x.fecha) : "—"}{x.historico && <div className="sub">histórico</div>}</td>
                <td>{NOMBRE_EVENTO[x.tipo] ?? x.tipo}<div className="sub">{[x.ncf, x.numero].filter(Boolean).join(" · ")}</div></td>
                <td>{x.total ? verMonto(x.total) : "—"}</td>
                <td style={x.estado === "pendiente" ? { color: "var(--peligro)" } : undefined}>{ESTADO[x.estado] ?? x.estado}{x.motivo && <div className="sub">{x.motivo}</div>}</td>
                <td>
                  {e && x.factura_id && <div><Link href={`${e}/facturas/${x.factura_id}`}>Factura</Link></div>}
                  {e && x.compra_id && <div><Link href={`${e}/compras/${x.compra_id}`}>Compra</Link></div>}
                  {e && x.asiento_id && <div><Link href={`${e}/asientos/${x.asiento_id}`}>Asiento {x.asiento ?? ""}</Link></div>}
                </td>
                <td>{(x.estado === "pendiente" || x.estado === "esperando") && c.empresa_id && (
                  <Formulario accion={reprocesarVendario.bind(null, fid, vid, x.id)} boton="Reprocesar" className="fila"><span /></Formulario>
                )}</td>
              </tr>
            ))}
            {eventos.length === 0 && <tr><td colSpan={7}>{soloPendientes ? "No hay pendientes." : "No hay eventos en este mes."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
