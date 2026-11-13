import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Formulario } from "@/app/formulario";
import { accesoFirma, esUuid, soloCliente } from "@/lib/acceso";
import { db } from "@/lib/db";
import { equipoDe } from "@/lib/firma";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { empresasConRnc, enviarPendientes, registrarVista } from "@/lib/vendario";
import { ESTADO_CLIENTE, ESTADOS, PEDIDOS_SUGERIDOS, SERVICIOS } from "@/lib/vendario-sobre";
import { CUENTAS_NEUTRALES, SUGERIDAS } from "@/lib/vendario-contable";
import { cuentasUsadas, mapeoDe } from "@/lib/vendario-registro";
import { aceptarSolicitud, cambiarEstadoVendario, guardarMapeoVendario, reprocesarVendario } from "../../../vendario-acciones";

export const metadata = { title: "Solicitud de Vendario · Empire Tax’N Legal" };

type Cliente = {
  id: string; org_id: string; rnc: string | null; estado: string; servicios: string[]; fecha_inicio: string | null; historico_desde: string | null;
  historico_hasta: string | null; empresa_datos: Record<string, unknown>; contacto: Record<string, string | null>; autorizacion: Record<string, string | null>;
  empresa_id: string | null; empresa: string | null; responsable_id: string | null; responsable: string | null; vista: string | null; vista_en: Date | null;
  aceptada_en: Date | null; nota: string | null; al_dia_hasta: string | null; historico_totales: { events?: number; totals?: Record<string, { count: number; total: string }> } | null;
  historico_completo_en: Date | null; baja_en: Date | null; baja_motivo: string | null; creado_en: Date;
};
const fechaHora = (d: Date | null) => d?.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" }) ?? "—";
const ENVIO: Record<string, string> = { pendiente: "Por enviar", enviado: "Enviado", fallido: "Falló (se agotaron los intentos)", rechazado: "Vendario lo rechazó" };

// Detalle de una solicitud o cliente de Vendario. Al abrirla por primera vez se le manda a Vendario «vista» con el nombre de quien la abrió.
export default async function SolicitudVendario({ params }: { params: Promise<{ fid: string; vid: string }> }) {
  const { fid, vid } = await params;
  if (!esUuid(vid)) notFound();
  const { usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  if (await registrarVista(fid, vid, usuario.id).catch(() => false)) after(() => enviarPendientes().catch(() => {}));
  const [c] = await db()<Cliente[]>`
    SELECT v.*, to_char(v.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, to_char(v.historico_desde, 'YYYY-MM-DD') AS historico_desde,
           to_char(v.historico_hasta, 'YYYY-MM-DD') AS historico_hasta, e.nombre AS empresa, r.nombre AS responsable, w.nombre AS vista
      FROM vendario_clientes v LEFT JOIN empresas e ON e.id = v.empresa_id LEFT JOIN usuarios r ON r.id = v.responsable_id
      LEFT JOIN usuarios w ON w.id = v.vista_por
     WHERE v.id = ${vid} AND v.firma_id = ${fid}`;
  if (!c) notFound();
  const envios = await db()<{ id: string; estado_servicio: string; estado: string; intentos: number; codigo: number | null; respuesta: string | null;
    creado_en: Date; quien: string | null; nota: string | null; periodo: string | null }[]>`
    SELECT s.id, s.estado_servicio, s.estado, s.intentos, s.codigo, s.respuesta, s.creado_en, u.nombre AS quien,
           s.sobre->'data'->>'note' AS nota, s.sobre->'data'->>'period' AS periodo
      FROM vendario_envios s LEFT JOIN usuarios u ON u.id = s.creado_por WHERE s.vendario_cliente_id = ${vid} ORDER BY s.creado_en DESC LIMIT 30`;
  const eventos = await db()<{ tipo: string; historico: boolean; estado: string; n: number; total: string | null }[]>`
    SELECT tipo, historico, estado, count(*)::int AS n, sum(total)::text AS total FROM vendario_eventos WHERE vendario_cliente_id = ${vid}
     GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`;
  const huecos = await db()<{ desde: string; hasta: string }[]>`
    SELECT (seq + 1)::text AS desde, (siguiente - 1)::text AS hasta FROM (
      SELECT seq, lead(seq) OVER (ORDER BY seq) AS siguiente FROM vendario_eventos WHERE vendario_cliente_id = ${vid} AND seq IS NOT NULL) x
     WHERE siguiente > seq + 1 LIMIT 20`;
  const equipo = await equipoDe(fid);
  // Mapeo de cuentas: las del acuerdo y las que usen sus eventos (cada gasto por categoría).
  const usadas = await cuentasUsadas(vid);
  const m = c.empresa_id ? await mapeoDe(c.empresa_id) : null;
  const porCodigo = new Map((m?.cuentas ?? []).map((x) => [x.codigo, x.id]));
  const neutrales = [...new Set([...Object.keys(CUENTAS_NEUTRALES).filter((k) => !k.startsWith("RETENCION") || usadas.includes(k)), ...usadas])];
  const sinMapear = usadas.filter((k) => !m?.mapeo[k]);
  const mismas = c.empresa_id ? [] : await empresasConRnc(fid, c.rnc);
  const e = c.empresa_datos as Record<string, string | null>;
  const abierta = c.estado !== "finalizada";
  const porAceptar = c.estado === "solicitud" || (c.estado === "necesita_info" && !c.aceptada_en);
  const mesAnterior = (() => { const h = hoyISO(); const m = Number(h.slice(5, 7)); return m === 1 ? `${Number(h.slice(0, 4)) - 1}-12` : `${h.slice(0, 4)}-${String(m - 1).padStart(2, "0")}`; })();
  // Histórico: lo que dijo Vendario contra lo recibido.
  const recibidoHist = new Map<string, { n: number; total: number }>();
  for (const x of eventos.filter((x) => x.historico)) {
    const a = recibidoHist.get(x.tipo) ?? { n: 0, total: 0 };
    recibidoHist.set(x.tipo, { n: a.n + x.n, total: a.total + Number(x.total ?? 0) });
  }
  const totales = c.historico_totales?.totals ?? {};
  const tiposHist = [...new Set([...Object.keys(totales), ...recibidoHist.keys()])].sort();

  return (
    <>
      <p><Link href={`/firma/${fid}/vendario`}>← Vendario</Link></p>
      <h1>{e.trade_name || e.legal_name || "Empresa de Vendario"}</h1>
      <p className="sub">
        {ESTADO_CLIENTE[c.estado]} · llegó el {fechaHora(c.creado_en)}{c.vista && ` · vista por ${c.vista} el ${fechaHora(c.vista_en)}`}
        {c.empresa_id && <> · en Empire: <Link href={`/e/${c.empresa_id}`}>{c.empresa}</Link></>}
        {c.responsable && ` · responsable: ${c.responsable}`}{c.al_dia_hasta && ` · al día hasta ${c.al_dia_hasta}`}
      </p>
      {c.estado === "finalizada" && <p className="aviso">Vendario dio de baja este servicio el {fechaHora(c.baja_en)}{c.baja_motivo && ` (${c.baja_motivo})`}. Lo que llegue después no se contabiliza.</p>}
      {c.nota && <p className="aviso">Última nota enviada al cliente: {c.nota}</p>}

      <div className="fila" style={{ gap: 16, alignItems: "stretch" }}>
        <div className="tarjeta" style={{ flex: "1 1 320px" }}>
          <h2 style={{ marginTop: 0 }}>Empresa</h2>
          <dl>
            <dt>Razón social</dt><dd>{e.legal_name ?? "—"}</dd>
            {e.trade_name && <><dt>Nombre comercial</dt><dd>{e.trade_name}</dd></>}
            <dt>RNC</dt><dd>{c.rnc ?? e.rnc ?? "—"}{e.rnc_status && ` · ${e.rnc_status}`}</dd>
            {e.address && <><dt>Dirección</dt><dd>{e.address}</dd></>}
            {e.phone && <><dt>Teléfono</dt><dd>{e.phone}</dd></>}
            <dt>Contacto</dt><dd>{[c.contacto.name, c.contacto.email, c.contacto.phone].filter(Boolean).join(" · ") || "—"}</dd>
          </dl>
        </div>
        <div className="tarjeta" style={{ flex: "1 1 320px" }}>
          <h2 style={{ marginTop: 0 }}>Servicio pedido</h2>
          <dl>
            <dt>Servicios</dt><dd>{c.servicios.map((s) => SERVICIOS[s] ?? s).join(", ")}</dd>
            <dt>Desde</dt><dd>{c.fecha_inicio ? verFecha(c.fecha_inicio) : "—"}</dd>
            <dt>Histórico</dt><dd>{c.historico_desde ? `del ${verFecha(c.historico_desde)} al ${verFecha(c.historico_hasta ?? c.historico_desde)}` : "—"}</dd>
          </dl>
          <h3>Autorización del dueño</h3>
          <p className="sub" style={{ margin: 0 }}>
            {c.autorizacion.by_name ? <>Autorizó <strong>{c.autorizacion.by_name}</strong>{c.autorizacion.by_email && ` (${c.autorizacion.by_email})`} el{" "}
              {c.autorizacion.at ? fechaHora(new Date(c.autorizacion.at)) : "—"}, con el texto versión {c.autorizacion.text_version ?? "—"}.</>
              : "El alta no trae la autorización."}
          </p>
        </div>
      </div>

      {abierta && porAceptar && (
        <div className="tarjeta" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Aceptar</h2>
          <p className="sub" style={{ marginTop: 0 }}>Vendario le avisa al cliente quién lleva su contabilidad y empieza a mandar el histórico.</p>
          <Formulario accion={aceptarSolicitud.bind(null, fid, c.id)} boton="Aceptar la solicitud" className="fila">
            <label style={{ flex: "1 1 220px" }}>Responsable
              <select name="responsable" defaultValue={usuario.id} required>
                {equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
            <label style={{ flex: "2 1 320px" }}>Empresa en Empire
              <select name="empresa" defaultValue={mismas[0]?.id ?? "nueva"}>
                {mismas.map((m) => <option key={m.id} value={m.id}>Enlazar con {m.nombre} (mismo RNC)</option>)}
                <option value="nueva">Crearla con los datos del alta</option>
              </select>
            </label>
          </Formulario>
        </div>
      )}

      {abierta && (
        <div className="fila" style={{ gap: 16, alignItems: "stretch", marginTop: 16 }}>
          <div className="tarjeta" style={{ flex: "1 1 320px" }}>
            <h2 style={{ marginTop: 0 }}>Pedir información</h2>
            <Formulario accion={cambiarEstadoVendario.bind(null, fid, c.id, "necesita_info")} boton="Enviar a Vendario" className="formulario">
              <label>Nota que verá el cliente<textarea name="nota" required maxLength={500} rows={2} placeholder="Falta el estado de cuenta bancario de octubre." /></label>
              <div className="casillas" style={{ margin: 0 }}>
                {Object.entries(PEDIDOS_SUGERIDOS).map(([k, v]) => <label key={k} className="casilla"><input type="checkbox" name="pedido" value={k} /> {v}</label>)}
              </div>
              <label>Otro (código, separados por coma)<input name="otro" maxLength={200} /></label>
            </Formulario>
          </div>
          {c.empresa_id && (
            <div className="tarjeta" style={{ flex: "1 1 320px" }}>
              <h2 style={{ marginTop: 0 }}>Estado del servicio</h2>
              <Formulario accion={cambiarEstadoVendario.bind(null, fid, c.id, "en_proceso")} boton={`Enviar «${ESTADOS.en_proceso.texto}»`} className="fila">
                <label>Período<input type="month" name="periodo" defaultValue={mesAnterior} required /></label>
              </Formulario>
              <Formulario accion={cambiarEstadoVendario.bind(null, fid, c.id, "al_dia")} boton={`Enviar «${ESTADOS.al_dia.texto}»`} className="fila">
                <label>Período<input type="month" name="periodo" defaultValue={mesAnterior} required /></label>
              </Formulario>
              <Formulario accion={cambiarEstadoVendario.bind(null, fid, c.id, "suspendida")} boton="Suspender el servicio" className="fila">
                <label style={{ flex: "1 1 240px" }}>Nota que verá el cliente<input name="nota" required maxLength={500} /></label>
              </Formulario>
            </div>
          )}
        </div>
      )}

      <h2>Eventos recibidos</h2>
      {huecos.length > 0 && <p className="aviso">Faltan eventos en la secuencia: {huecos.map((h) => (h.desde === h.hasta ? h.desde : `${h.desde} a ${h.hasta}`)).join(", ")}.</p>}
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Evento</th><th>Histórico</th><th>Estado</th><th>Cantidad</th><th>Total</th></tr></thead>
          <tbody>
            {eventos.map((x) => (
              <tr key={`${x.tipo}-${x.historico}-${x.estado}`}>
                <td><code>{x.tipo}</code></td><td>{x.historico ? "Sí" : "—"}</td>
                <td>{{ esperando: "Por contabilizar", contabilizado: "Contabilizado", pendiente: "Pendiente", despues_de_baja: "Después de la baja", descartado: "Descartado" }[x.estado] ?? x.estado}</td>
                <td>{x.n}</td><td>{x.total ? verMonto(x.total) : "—"}</td>
              </tr>
            ))}
            {eventos.length === 0 && <tr><td colSpan={5}>Todavía no ha llegado ningún evento.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="sub">
        <Link href={`/firma/${fid}/vendario/${vid}/eventos`}>Ver los eventos uno por uno, con los pendientes y su motivo</Link>
      </p>
      {eventos.some((x) => x.estado === "pendiente" || x.estado === "esperando") && c.empresa_id && (
        <Formulario accion={reprocesarVendario.bind(null, fid, vid, null)} boton="Reprocesar los pendientes" className="fila"><span /></Formulario>
      )}

      {m && (
        <div className="tarjeta" style={{ marginTop: 16 }} id="mapeo">
          <h2 style={{ marginTop: 0 }}>Cuentas de Vendario → catálogo de {c.empresa}</h2>
          <p className="sub" style={{ marginTop: 0 }}>
            Vendario manda cuentas neutrales; aquí se elige a qué cuenta del catálogo del cliente va cada una. Las evidentes vienen sugeridas
            (en gris): se aplican al guardar. Cada gasto por categoría se elige a mano. Lo que llegue con una cuenta sin mapear queda pendiente.
          </p>
          {sinMapear.length > 0 && <p className="aviso">Sin mapear y usadas en sus eventos: {sinMapear.join(", ")}.</p>}
          <Formulario accion={guardarMapeoVendario.bind(null, fid, vid)} boton="Guardar el mapeo" className="formulario">
            <div className="tabla-envoltura">
              <table>
                <thead><tr><th>Cuenta de Vendario</th><th>Cuenta del catálogo</th></tr></thead>
                <tbody>
                  {neutrales.map((k) => {
                    const sugerida = SUGERIDAS[k] ? porCodigo.get(SUGERIDAS[k]) : undefined;
                    const actual = m.mapeo[k] ?? sugerida ?? "";
                    return (
                      <tr key={k}>
                        <td><code>{k}</code><div className="sub">{CUENTAS_NEUTRALES[k] ?? (k.startsWith("GASTO:") ? `Gasto de la categoría «${k.slice(6)}»` : "Cuenta nueva")}
                          {usadas.includes(k) ? " · usada" : ""}{!m.mapeo[k] && sugerida ? " · sugerida" : ""}</div>
                          <input type="hidden" name="cuenta" value={k} /></td>
                        <td>
                          <select name={`c:${k}`} defaultValue={actual} style={!m.mapeo[k] && sugerida ? { color: "var(--texto-suave, #666)" } : undefined}>
                            <option value="">— Sin mapear —</option>
                            {m.cuentas.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Formulario>
        </div>
      )}

      {(c.historico_totales || recibidoHist.size > 0) && (
        <>
          <h2>Histórico: lo que dijo Vendario y lo recibido</h2>
          {!c.historico_totales && <p className="sub">Vendario todavía no avisa que terminó de mandar el histórico.</p>}
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Evento</th><th>Según Vendario</th><th>Recibidos</th><th>Total según Vendario</th><th>Total recibido</th></tr></thead>
              <tbody>
                {tiposHist.map((t) => {
                  const v = totales[t]; const r = recibidoHist.get(t) ?? { n: 0, total: 0 };
                  const distinto = !!v && (v.count !== r.n || Math.round(Number(v.total) * 100) !== Math.round(r.total * 100));
                  return (
                    <tr key={t} style={distinto ? { color: "var(--peligro)", fontWeight: 600 } : undefined}>
                      <td><code>{t}</code></td><td>{v?.count ?? "—"}</td><td>{r.n}</td><td>{v ? verMonto(v.total) : "—"}</td><td>{verMonto(r.total.toFixed(2))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {c.historico_totales && <p className="sub">Vendario dijo {c.historico_totales.events ?? "—"} eventos ({fechaHora(c.historico_completo_en)}).</p>}
        </>
      )}

      <h2>Lo que se le ha enviado a Vendario</h2>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cuándo</th><th>Estado del servicio</th><th>Detalle</th><th>Quién</th><th>Envío</th></tr></thead>
          <tbody>
            {envios.map((s) => (
              <tr key={s.id}>
                <td>{fechaHora(s.creado_en)}</td><td>{ESTADOS[s.estado_servicio]?.texto ?? s.estado_servicio}</td>
                <td>{[s.periodo, s.nota].filter(Boolean).join(" · ") || "—"}</td><td>{s.quien ?? "Automático"}</td>
                <td>{ENVIO[s.estado]}{s.intentos > 0 && s.estado !== "enviado" && ` · ${s.intentos} intento${s.intentos > 1 ? "s" : ""}`}{s.codigo && s.estado !== "enviado" ? ` · ${s.codigo}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
