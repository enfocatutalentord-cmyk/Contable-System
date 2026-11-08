"use client";

import { useState } from "react";

type Opcion = { clave: string; nombre: string; clase: "impuesto" | "retencion"; tasa: string; empresas: { id: string; nombre: string }[] };

// Campos de «Cargar una tasa nueva»: al elegir el concepto aparecen marcadas todas las empresas que lo tienen vigente; se desmarca la
// que no deba cambiar (respuesta recomendada del 6-nov: para todos, con opción de quitar algunos).
export function CamposTasaNueva({ opciones, hoy }: { opciones: Opcion[]; hoy: string }) {
  const [clave, setClave] = useState("");
  const elegido = opciones.find((o) => o.clave === clave);
  return (
    <>
      <div className="fila">
        <label style={{ flex: "2 1 260px" }}>Impuesto o retención que cambia
          <select name="concepto" value={clave} onChange={(e) => setClave(e.target.value)} required>
            <option value="">Elige…</option>
            <optgroup label="Impuestos">
              {opciones.filter((o) => o.clase === "impuesto").map((o) => <option key={o.clave} value={o.clave}>{o.nombre} · hoy {o.tasa} %</option>)}
            </optgroup>
            <optgroup label="Retenciones">
              {opciones.filter((o) => o.clase === "retencion").map((o) => <option key={o.clave} value={o.clave}>{o.nombre} · hoy {o.tasa} %</option>)}
            </optgroup>
          </select>
        </label>
        <label style={{ flex: "1 1 120px" }}>Tasa nueva (%)
          <input name="tasa" inputMode="decimal" placeholder="18" required />
        </label>
        <label style={{ flex: "1 1 150px" }}>Rige desde
          <input type="date" name="desde" min={hoy.slice(0, 4) + "-01-01"} required />
        </label>
      </div>
      <div className="fila">
        <label style={{ flex: "1 1 260px" }}>Nombre nuevo (opcional)
          <input name="nuevo_nombre" placeholder={elegido ? elegido.nombre : "Si el nombre lleva la tasa, por ejemplo «ISR honorarios 15 %»"} maxLength={120} />
        </label>
        <label style={{ flex: "2 1 300px" }}>Ley o norma que la cambia
          <input name="norma" placeholder="Ley 30-26, art. 12 · Aviso DGII 10-26" required maxLength={300} />
        </label>
      </div>
      {elegido && (
        <fieldset style={{ border: "1px solid var(--borde)", borderRadius: 10, padding: 12, margin: "8px 0" }}>
          <legend style={{ fontWeight: 700, padding: "0 6px" }}>Empresas que la tienen ({elegido.empresas.length})</legend>
          <p className="sub" style={{ margin: "0 0 6px" }}>Todas marcadas; desmarca la que no deba cambiar.</p>
          <div className="fila" style={{ gap: 4 }}>
            {elegido.empresas.map((e) => (
              <label key={`${clave}-${e.id}`} style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: "1 1 220px" }}>
                <input type="checkbox" name="empresa" value={e.id} defaultChecked style={{ minHeight: 0 }} /> {e.nombre}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </>
  );
}
