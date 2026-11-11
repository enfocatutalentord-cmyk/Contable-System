"use client";

import { useRef, useState } from "react";
import { leerDocumentoConIa } from "@/app/e/[id]/lectura-ia-acciones";

// Botón «Leer con IA» dentro del formulario de un documento recibido: llena los campos vacíos y marca en amarillo lo dudoso.
export function BotonLeerDocumento({ empresaId, recepcionId }: { empresaId: string; recepcionId: string }) {
  const ancla = useRef<HTMLDivElement>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [error, setError] = useState("");

  const leer = async () => {
    const form = ancla.current?.closest("form");
    if (!form) return;
    setLeyendo(true); setError(""); setAvisos([]);
    const tipo = (form.elements.namedItem("tipo") as HTMLSelectElement | null)?.value ?? "gasto";
    try {
      const r = await leerDocumentoConIa(empresaId, recepcionId, tipo);
      if (r.error) { setError(r.error); return; }
      for (const [k, v] of Object.entries(r.valores ?? {})) {
        const e = form.elements.namedItem(k) as HTMLInputElement | null;
        if (e && v && (!e.value || (k === "itbis" && e.value === "0.00"))) e.value = v;
      }
      for (const k of ["rnc", "nombre", "ncf", "fecha", "subtotal", "itbis"]) {
        const e = form.elements.namedItem(k) as HTMLInputElement | null;
        if (e) e.style.background = r.dudosos?.includes(k as never) ? "#FFF3C4" : "";
      }
      setAvisos(r.avisos ?? []);
    } catch {
      setError("No se pudo leer. Puedes digitarla a mano.");
    } finally {
      setLeyendo(false);
    }
  };

  return (
    <div ref={ancla} style={{ marginBottom: 8 }}>
      <button type="button" className="boton" onClick={leer} disabled={leyendo}>{leyendo ? "Leyendo…" : "Leer con IA"}</button>
      <span className="sub"> Llena lo vacío; compáralo con el archivo antes de aprobar. Si es una venta, elige «Es» primero.</span>
      {error && <p className="error" role="alert">{error}</p>}
      {avisos.length > 0 && <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>{avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
    </div>
  );
}
