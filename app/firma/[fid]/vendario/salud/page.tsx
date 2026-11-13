import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { db } from "@/lib/db";
import { ESTADOS } from "@/lib/vendario-sobre";
import { reenviarEnvio } from "../../../vendario-acciones";

export const metadata = { title: "Salud de la integración · Empire Tax’N Legal" };

const fechaHora = (d: Date | null) => d?.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" }) ?? "—";

// Salud de la integración con Vendario: últimos mensajes recibidos y enviados, firmas fallidas y envíos fallidos (con «Reenviar»).
export default async function SaludVendario({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  // Lo recibido de los clientes de esta firma, y lo que aún no tiene cliente (esperando a la firma o a su alta).
  const recibidos = await db()<{ id: string; tipo: string; seq: string | null; recibido_en: Date; estado: string; motivo: string | null; cliente: string | null; vid: string | null; evento: string | null }[]>`
    SELECT m.id, m.tipo, m.seq::text, m.recibido_en, m.estado, m.motivo, coalesce(v.empresa_datos->>'trade_name', v.empresa_datos->>'legal_name') AS cliente,
           v.id AS vid, m.sobre->'data'->>'event_type' AS evento
      FROM vendario_mensajes m LEFT JOIN vendario_clientes v ON v.org_id = m.org_id
     WHERE v.firma_id = ${fid} OR v.id IS NULL ORDER BY m.recibido_en DESC LIMIT 50`;
  const envios = await db()<{ id: string; estado_servicio: string; estado: string; intentos: number; codigo: number | null; respuesta: string | null;
    creado_en: Date; proximo_intento: Date; cliente: string | null; vid: string }[]>`
    SELECT s.id, s.estado_servicio, s.estado, s.intentos, s.codigo, s.respuesta, s.creado_en, s.proximo_intento,
           coalesce(v.empresa_datos->>'trade_name', v.empresa_datos->>'legal_name') AS cliente, v.id AS vid
      FROM vendario_envios s JOIN vendario_clientes v ON v.id = s.vendario_cliente_id
     WHERE v.firma_id = ${fid} ORDER BY (s.estado IN ('fallido', 'rechazado')) DESC, s.creado_en DESC LIMIT 50`;
  const rechazos = await db()<{ id: string; recibido_en: Date; codigo: number; motivo: string; ip: string | null }[]>`
    SELECT id::text, recibido_en, codigo, motivo, ip FROM vendario_rechazos ORDER BY recibido_en DESC LIMIT 20`;
  const [r24] = await db()<{ recibidos: number; rechazos: number; pendientes: number; fallidos: number }[]>`
    SELECT (SELECT count(*)::int FROM vendario_mensajes WHERE recibido_en > now() - interval '24 hours') AS recibidos,
           (SELECT count(*)::int FROM vendario_rechazos WHERE recibido_en > now() - interval '24 hours') AS rechazos,
           (SELECT count(*)::int FROM vendario_mensajes WHERE estado IN ('recibido', 'pendiente')) AS pendientes,
           (SELECT count(*)::int FROM vendario_envios s JOIN vendario_clientes v ON v.id = s.vendario_cliente_id WHERE v.firma_id = ${fid} AND s.estado IN ('fallido', 'rechazado')) AS fallidos`;

  return (
    <>
      <p><Link href={`/firma/${fid}/vendario`}>← Vendario</Link></p>
      <h1>Salud de la integración</h1>
      <p className="sub">
        Últimas 24 horas: {r24.recibidos} mensajes recibidos y {r24.rechazos} rechazados al llegar (firma, hora o mensaje inválido). {r24.pendientes} mensajes esperan
        procesarse (se reintenta cada 5 minutos). {r24.fallidos} envíos a Vendario fallidos.
      </p>
      {r24.fallidos > 0 && <p className="aviso">Hay envíos a Vendario que no llegaron: el cliente no ve esos cambios hasta reenviarlos.</p>}

      <h2>Enviados a Vendario</h2>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cuándo</th><th>Cliente</th><th>Estado</th><th>Resultado</th>{firma.administrador && <th />}</tr></thead>
          <tbody>
            {envios.map((s) => (
              <tr key={s.id} style={s.estado === "fallido" || s.estado === "rechazado" ? { color: "var(--peligro)" } : undefined}>
                <td>{fechaHora(s.creado_en)}</td><td><Link href={`/firma/${fid}/vendario/${s.vid}`}>{s.cliente ?? "—"}</Link></td>
                <td>{ESTADOS[s.estado_servicio]?.texto ?? s.estado_servicio}</td>
                <td>
                  {s.estado === "enviado" ? "Enviado" : s.estado === "pendiente" ? `Por enviar${s.intentos ? ` · intento ${s.intentos + 1} el ${fechaHora(s.proximo_intento)}` : ""}`
                    : s.estado === "rechazado" ? "Rechazado por Vendario" : "Falló tras 7 intentos"}
                  {s.estado !== "enviado" && (s.codigo || s.respuesta) && <div className="sub">{s.codigo ? `${s.codigo} · ` : ""}{s.respuesta}</div>}
                </td>
                {firma.administrador && <td>{(s.estado === "fallido" || s.estado === "rechazado") && <Formulario accion={reenviarEnvio.bind(null, fid, s.id)} boton="Reenviar" className="fila"><span /></Formulario>}</td>}
              </tr>
            ))}
            {envios.length === 0 && <tr><td colSpan={firma.administrador ? 5 : 4}>Todavía no se ha enviado nada.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Recibidos de Vendario</h2>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cuándo</th><th>Cliente</th><th>Mensaje</th><th>Seq</th><th>Estado</th></tr></thead>
          <tbody>
            {recibidos.map((m) => (
              <tr key={m.id}>
                <td>{fechaHora(m.recibido_en)}</td>
                <td>{m.vid ? <Link href={`/firma/${fid}/vendario/${m.vid}`}>{m.cliente ?? "—"}</Link> : "Sin cliente todavía"}</td>
                <td><code>{m.tipo}</code>{m.evento && <span className="sub"> · {m.evento}</span>}</td><td>{m.seq ?? "—"}</td>
                <td>{{ recibido: "Por procesar", procesado: "Procesado", pendiente: "Pendiente", error: "Error" }[m.estado]}{m.motivo && <div className="sub">{m.motivo}</div>}</td>
              </tr>
            ))}
            {recibidos.length === 0 && <tr><td colSpan={5}>Todavía no ha llegado nada.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Rechazados al llegar</h2>
      <p className="sub">Firma que no coincide, hora fuera de los 5 minutos o mensaje inválido. No se guarda el contenido.</p>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cuándo</th><th>Respuesta</th><th>Motivo</th><th>Desde</th></tr></thead>
          <tbody>
            {rechazos.map((r) => <tr key={r.id}><td>{fechaHora(r.recibido_en)}</td><td>{r.codigo}</td><td>{r.motivo}</td><td>{r.ip ?? "—"}</td></tr>)}
            {rechazos.length === 0 && <tr><td colSpan={4}>Ninguno.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
