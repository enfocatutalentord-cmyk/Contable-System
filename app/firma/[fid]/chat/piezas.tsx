"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import type { Estado } from "@/app/acciones-cuenta";
import { enviarMensajeChat, marcarLeidoChat } from "../../chat-acciones";

// Cuadro para escribir: Enter envía, Mayús + Enter baja de renglón. Se vacía solo al enviar.
export function Escribir({ firmaId, clave }: { firmaId: string; clave: string }) {
  const [estado, enviar, enviando] = useActionState(enviarMensajeChat.bind(null, firmaId, clave), {} as Estado);
  const form = useRef<HTMLFormElement>(null);
  const caja = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (estado.ok !== undefined) { form.current?.reset(); caja.current?.focus(); } }, [estado]);
  return (
    <form ref={form} action={enviar} className="chat-escribir">
      <textarea ref={caja} name="texto" required maxLength={2000} rows={2} placeholder="Escribe un mensaje al equipo…" aria-label="Mensaje"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.current?.requestSubmit(); } }} />
      <button className="primario" disabled={enviando}>{enviando ? "Enviando…" : "Enviar"}</button>
      {estado.error && <p className="error" role="alert" style={{ flexBasis: "100%", margin: 0 }}>{estado.error}</p>}
    </form>
  );
}

// Mientras la conversación está abierta se vuelve a pedir cada 15 segundos (sin recargar la página); si hay mensajes sin leer, los deja leídos.
export function Actualizar({ firmaId, clave, sinLeer, cantidad }: { firmaId: string; clave: string; sinLeer: number; cantidad: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!sinLeer) return;
    let vivo = true;
    marcarLeidoChat(firmaId, clave).then(() => { if (vivo) router.refresh(); });
    return () => { vivo = false; };
  }, [firmaId, clave, sinLeer, router]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 15000);
    return () => clearInterval(t);
  }, [router]);
  // Al abrir o recibir mensajes, baja hasta el último.
  useEffect(() => { document.getElementById("chat-fin")?.scrollIntoView({ block: "end" }); }, [cantidad, clave]);
  return null;
}
