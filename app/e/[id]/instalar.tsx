"use client";

import { useEffect, useState } from "react";

type Aviso = { prompt: () => Promise<void> };

// Invita a instalar la aplicación en el celular (bloque 8a). En Android y en computadoras el navegador la ofrece solo; en el iPhone
// se agrega con «Compartir › Agregar a inicio». Se oculta si ya está instalada o si la persona la cierra.
export function Instalar() {
  const [modo, setModo] = useState<"no" | "ios" | "boton">("no");
  const [aviso, setAviso] = useState<Aviso | null>(null);
  useEffect(() => {
    let cerrado = false;
    try { cerrado = localStorage.getItem("empire-instalar") === "no"; } catch { /* sin almacenamiento */ }
    const instalada = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (cerrado || instalada) return;
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) { setModo("ios"); return; }
    const alOfrecer = (e: Event) => { e.preventDefault(); setAviso(e as unknown as Aviso); setModo("boton"); };
    window.addEventListener("beforeinstallprompt", alOfrecer);
    return () => window.removeEventListener("beforeinstallprompt", alOfrecer);
  }, []);
  if (modo === "no") return null;
  const cerrar = () => { try { localStorage.setItem("empire-instalar", "no"); } catch { /* sin almacenamiento */ } setModo("no"); };
  return (
    <div className="aviso instalar" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
      <span style={{ flex: "1 1 220px" }}>
        {modo === "ios" ? <>Para tener la app de Empire en tu iPhone, toca <strong>Compartir</strong> y luego <strong>Agregar a inicio</strong>.</>
          : "Puedes instalar la app de Empire en este equipo para abrirla como cualquier aplicación."}
      </span>
      {modo === "boton" && aviso && <button className="primario" onClick={async () => { await aviso.prompt(); cerrar(); }}>Instalar la app</button>}
      <button onClick={cerrar}>Ahora no</button>
    </div>
  );
}
