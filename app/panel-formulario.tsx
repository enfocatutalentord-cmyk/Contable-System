"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Prioridad 1.3 del prompt de Patricia (20-nov-2026): en Impuestos del mes cada formulario se abre ahí mismo, en un panel encima del
// tablero, sin ir a otra pantalla. El formulario es la misma página de siempre, dentro del panel y sin el menú (ver `EnPanel`). Al
// cerrarlo, el tablero se pone al día con lo que se haya marcado.
export function AbrirEnPanel({ href, titulo, children }: { href: string; titulo: string; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const dialogo = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);
  useEffect(() => {
    if (!abierto) return;
    const alMensaje = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data === "cerrar-panel") { setAbierto(false); router.refresh(); } };
    window.addEventListener("message", alMensaje);
    return () => window.removeEventListener("message", alMensaje);
  }, [abierto, router]);
  const cerrar = () => { setAbierto(false); router.refresh(); };
  return (
    <>
      <a href={href} title={titulo} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); setAbierto(true); }}>{children}</a>
      <dialog ref={dialogo} className="panel-formulario" aria-label={titulo} onClose={() => { if (abierto) cerrar(); }}>
        <div className="panel-cabeza">
          <strong>{titulo}</strong>
          <span className="fila" style={{ gap: 8 }}>
            <a href={href} className="boton" target="_blank" rel="noreferrer">Abrir aparte</a>
            <button type="button" className="primario" onClick={cerrar}>Cerrar</button>
          </span>
        </div>
        {abierto && <iframe src={conPanel(href)} title={titulo} />}
      </dialog>
    </>
  );
}

// Dentro del panel la página se muestra sin el menú ni la barra de arriba, y «Volver a Impuestos del mes» cierra el panel.
export function EnPanel() {
  useEffect(() => {
    if (window.self === window.top) return;
    document.documentElement.classList.add("en-panel");
    const alClic = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a[data-cerrar-panel]");
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      window.parent.postMessage("cerrar-panel", window.location.origin);
    };
    document.addEventListener("click", alClic, true); // antes que el enlace de Next lo lleve a otra pantalla
    return () => document.removeEventListener("click", alClic, true);
  }, []);
  return null;
}

// «?panel=1» va antes del ancla (#f606), si la hay.
const conPanel = (href: string) => {
  const [ruta, ancla] = href.split("#");
  return `${ruta}${ruta.includes("?") ? "&" : "?"}panel=1${ancla ? `#${ancla}` : ""}`;
};
