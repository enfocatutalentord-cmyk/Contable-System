"use client";

import { useState } from "react";
import { deshacerMensaje, type Preparacion, prepararMensaje, registrarMensaje } from "./e/[id]/mensajes-acciones";
import { faltantes, urlWhatsApp, verTelefono } from "@/lib/mensajes";
import type { Ref } from "@/lib/mensajes-db";

// «Enviar por WhatsApp» (bloque 3c, Documento maestro, sección 10): arma el mensaje predeterminado con los datos del cliente y,
// si el documento tiene PDF, un enlace seguro de 30 días. La persona lo revisa, abre WhatsApp (el chat del contacto o el que
// elija, como el grupo de contabilidad) y el envío queda en la bitácora, con un deshacer.
export function EnviarWhatsApp({ empresaId, clave, opciones, docRef = null, extra, etiqueta = "Enviar por WhatsApp" }: {
  empresaId: string;
  clave?: string;
  opciones?: { clave: string; nombre: string }[]; // para elegir el mensaje (en la bitácora)
  docRef?: Ref | null;
  extra?: Record<string, string>;
  etiqueta?: string;
}) {
  const [elegida, setElegida] = useState(clave ?? opciones?.[0]?.clave ?? "");
  const [p, setP] = useState<Preparacion | null>(null);
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [enviado, setEnviado] = useState<{ id: string; hora: string } | null>(null);
  const [error, setError] = useState("");

  async function preparar() {
    setCargando(true);
    setError("");
    const r = await prepararMensaje(empresaId, elegida, docRef, extra);
    setCargando(false);
    if (r.error) return setError(r.error);
    setP(r);
    setTexto(r.texto ?? "");
    setEnviado(null);
  }

  // Se llama al tocar el enlace de WhatsApp (el enlace abre WhatsApp de inmediato; esto corre al mismo tiempo).
  async function registrar(destino: "contacto" | "elegir") {
    if (!p || enviado) return;
    const r = await registrarMensaje(empresaId, { clave: p.clave!, texto, destino, ref: docRef, token: p.token ?? null });
    if (r.error) return setError(`WhatsApp se abrió, pero no se pudo anotar el envío: ${r.error}`);
    setEnviado({ id: r.id!, hora: new Date().toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit" }) });
  }

  async function deshacer() {
    if (!enviado) return;
    const r = await deshacerMensaje(empresaId, enviado.id);
    if (r.error) return setError(r.error);
    setEnviado(null);
    setP(null);
  }

  if (!p) {
    return (
      <div className="fila no-imprimir" style={{ alignItems: "center" }}>
        {opciones && (
          <select value={elegida} onChange={(e) => setElegida(e.target.value)} aria-label="Mensaje">
            {opciones.map((o) => <option key={o.clave} value={o.clave}>{o.nombre}</option>)}
          </select>
        )}
        <button type="button" className="boton-whatsapp" onClick={preparar} disabled={cargando || !elegida}>{cargando ? "Preparando…" : etiqueta}</button>
        {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
      </div>
    );
  }

  const falta = faltantes(texto);
  const llevaEnlace = !!p.token && texto.includes(p.token);
  const cerrar = () => { setP(null); setEnviado(null); setError(""); };
  // Se abre encima de la pantalla (también en el celular, donde el botón puede estar dentro de una tabla).
  return (
    <div className="velo-whatsapp no-imprimir" role="dialog" aria-modal="true" aria-label={p.nombre}>
      <div className="tarjeta">
        <h3 style={{ marginTop: 0 }}>{p.nombre}</h3>
        <p className="sub" style={{ margin: "0 0 8px" }}>
          {p.telefono ? <>Contacto: <strong>{p.contacto ?? "principal"}</strong> ({verTelefono(p.telefono)}).</> : "La ficha no tiene teléfono del contacto: elige el chat en WhatsApp."}
          {p.grupo && <> Grupo de contabilidad: <strong>{p.grupo}</strong>.</>}
          {p.enlace && <> Lleva un enlace para descargar «{p.enlace}» sin entrar al sistema; vence en 30 días.</>}
        </p>
        <label>Mensaje (puedes cambiarlo antes de enviar)
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={7} maxLength={4000} disabled={!!enviado} />
        </label>
        {!p.enlace && falta.includes("enlace") && <p className="aviso">Este documento no tiene un PDF subido para compartir: súbelo primero o quita «[enlace]» del mensaje.</p>}
        {falta.filter((x) => p.enlace || x !== "enlace").length > 0 && <p className="aviso">Completa lo que está entre corchetes: {falta.filter((x) => p.enlace || x !== "enlace").join(", ")}.</p>}
        {p.enlace && !llevaEnlace && <p className="aviso">Quitaste el enlace del mensaje: el documento no se compartirá.</p>}
        {enviado ? (
          <>
            <p className="exito" role="status">Quedó anotado en la bitácora ({enviado.hora}).</p>
            <div className="fila">
              <button type="button" className="primario" onClick={cerrar}>Listo</button>
              <button type="button" onClick={deshacer}>Deshacer el envío</button>
            </div>
          </>
        ) : (
          <div className="fila">
            {p.telefono && (
              <a className="boton boton-whatsapp" href={urlWhatsApp(texto, p.telefono)} target="_blank" rel="noreferrer" onClick={() => registrar("contacto")}>
                Abrir el chat de {p.contacto ?? "su contacto"}
              </a>
            )}
            <a className={`boton${p.telefono ? "" : " boton-whatsapp"}`} href={urlWhatsApp(texto)} target="_blank" rel="noreferrer" onClick={() => registrar("elegir")}>
              {p.grupo ? "Elegir el grupo u otro chat" : "Elegir el chat"}
            </a>
            <button type="button" onClick={cerrar}>Cancelar</button>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
