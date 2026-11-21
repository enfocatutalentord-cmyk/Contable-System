import Link from "next/link";
import { notFound } from "next/navigation";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { HILO_GENERAL, hiloDeCliente, hilosDe, leerHilo, mensajesDe, titulosDeTrabajos, existeTrabajo } from "@/lib/chat";
import { clientesDeFirma } from "@/lib/firma";
import { Actualizar, Escribir } from "./piezas";

export const metadata = { title: "Chat del equipo · Empire Tax & Legal" };

const cuando = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" });
const corto = (t: string, n = 70) => (t.length > n ? `${t.slice(0, n).trimEnd()}…` : t).replace(/\s*\n\s*/g, " ");

// Chat interno del equipo (Prioridad 2.2, P2b): una conversación general, una por cliente y una por trabajo. Sin correos ni WhatsApp: el aviso
// es el número que sale en el menú. Cada persona ve las conversaciones de los clientes que ve.
export default async function Chat({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ hilo?: string }> }) {
  const { fid } = await params;
  const { hilo: pedido } = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  const clientes = await clientesDeFirma(fid, usuario.id, firma.administrador, true);
  const nombres = new Map(clientes.map((c) => [c.id, c.nombre]));

  const abierto = leerHilo(pedido) ?? HILO_GENERAL;
  const veCliente = !abierto.empresaId || nombres.has(abierto.empresaId);
  if (!veCliente) notFound();
  if (abierto.solicitudId && !(await existeTrabajo(abierto.empresaId!, abierto.solicitudId))) notFound();

  const hilos = await hilosDe(fid, usuario.id, [...nombres.keys()]);
  const trabajos = hilos.filter((h) => h.solicitud_id && h.empresa_id).map((h) => ({ empresaId: h.empresa_id!, solicitudId: h.solicitud_id! }));
  if (abierto.solicitudId && !trabajos.some((t) => t.solicitudId === abierto.solicitudId)) trabajos.push({ empresaId: abierto.empresaId!, solicitudId: abierto.solicitudId });
  const titulosTrabajo = await titulosDeTrabajos(trabajos);

  const tituloDe = (h: { clave: string; empresa_id: string | null; solicitud_id: string | null }) =>
    h.clave === "general" ? "Todo el equipo"
      : h.solicitud_id ? `Trabajo: ${titulosTrabajo.get(h.solicitud_id) ?? "—"} · ${nombres.get(h.empresa_id!) ?? "cliente"}`
        : nombres.get(h.empresa_id!) ?? "Cliente";
  const resumenDe = (clave: string) => hilos.find((h) => h.clave === clave);
  const mensajes = await mensajesDe(fid, abierto.clave);
  const sinLeerAbierto = resumenDe(abierto.clave)?.sin_leer ?? 0;
  const titulo = tituloDe({ clave: abierto.clave, empresa_id: abierto.empresaId, solicitud_id: abierto.solicitudId });
  // Los que ya conversan (general primero) y, para empezar con otro cliente, la lista completa.
  const conMensajes = hilos.filter((h) => h.clave !== "general");
  const sinConversar = clientes.filter((c) => !hilos.some((h) => h.clave === hiloDeCliente(c.id).clave));
  const total = hilos.reduce((a, h) => a + h.sin_leer, 0);

  const fila = (clave: string, tit: string, h?: (typeof hilos)[number]) => (
    <Link key={clave} href={`/firma/${fid}/chat?hilo=${encodeURIComponent(clave)}`} className="chat-hilo" aria-current={abierto.clave === clave ? "page" : undefined}>
      <span className="chat-hilo-titulo">{tit}{!!h?.sin_leer && <span className="chat-contador" aria-label={`${h.sin_leer} sin leer`}>{h.sin_leer}</span>}</span>
      {h && <span className="chat-hilo-ultimo">{h.ultimo_autor}: {corto(h.ultimo_texto)}</span>}
    </Link>
  );
  const general = resumenDe("general");

  return (
    <>
      <h1>Chat del equipo</h1>
      <p className="sub">
        Conversaciones internas entre quienes trabajan en la firma, sobre todo el equipo, un cliente o un trabajo. No salen correos ni mensajes de WhatsApp:
        quien tiene mensajes nuevos ve el número en el menú. Los mensajes no se borran.
        {total ? ` Tienes ${total} sin leer.` : ""}
      </p>
      <div className="chat">
        <aside className="chat-lista" aria-label="Conversaciones">
          {fila("general", "Todo el equipo", general)}
          {conMensajes.map((h) => fila(h.clave, tituloDe(h), h))}
          {abierto.clave !== "general" && !resumenDe(abierto.clave) && fila(abierto.clave, titulo)}
          {sinConversar.length > 0 && (
            <form method="get" className="chat-nueva">
              <label>Conversar sobre otro cliente
                <select name="hilo" defaultValue="">
                  <option value="" disabled>Elige el cliente…</option>
                  {sinConversar.map((c) => <option key={c.id} value={hiloDeCliente(c.id).clave}>{c.nombre}</option>)}
                </select>
              </label>
              <button>Abrir</button>
            </form>
          )}
        </aside>
        <section className="chat-hilo-abierto" aria-label={titulo}>
          <header>
            <h2 style={{ margin: 0 }}>{titulo}</h2>
            {abierto.empresaId && (
              <p className="sub" style={{ margin: "2px 0 0" }}>
                <Link href={`/e/${abierto.empresaId}`}>Abrir el cliente</Link>
                {abierto.solicitudId && <> · <Link href={`/e/${abierto.empresaId}/solicitudes/${abierto.solicitudId}`}>Abrir el trabajo</Link></>}
              </p>
            )}
          </header>
          <div className="chat-mensajes" role="log" aria-live="polite">
            {mensajes.length === 0 && <p className="sub">Todavía no hay mensajes. Escribe el primero.</p>}
            {mensajes.map((m) => (
              <div key={m.id} className={`chat-burbuja${m.autor_id === usuario.id ? " mia" : ""}`}>
                <div className="chat-quien">{m.autor_id === usuario.id ? "Tú" : m.autor} · {cuando(m.creado)}</div>
                <div className="chat-texto">{m.texto}</div>
              </div>
            ))}
            <div id="chat-fin" />
          </div>
          <Escribir firmaId={fid} clave={abierto.clave} />
          <Actualizar firmaId={fid} clave={abierto.clave} sinLeer={sinLeerAbierto} cantidad={mensajes.length} />
        </section>
      </div>
    </>
  );
}
