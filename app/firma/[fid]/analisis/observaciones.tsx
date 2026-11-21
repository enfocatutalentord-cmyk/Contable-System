"use client";

import { useActionState } from "react";
import type { Estado } from "@/app/acciones-cuenta";
import { alEnviar } from "@/app/enviar";
import { GRUPOS, MAX_TEXTO, NOMBRES_GRUPO, type Textos } from "@/lib/analisis-financiero";
import { guardarObservacionesAnalisis } from "../../analisis-acciones";

// Observaciones y sugerencias por grupo. No se vacía al guardar: lo escrito se queda en pantalla.
export function Observaciones({ firmaId, empresaId, desde, hasta, textos, puedeEscribir }: {
  firmaId: string; empresaId: string; desde: string; hasta: string; textos: Textos; puedeEscribir: boolean;
}) {
  const [estado, enviar, enviando] = useActionState<Estado, FormData>(guardarObservacionesAnalisis.bind(null, firmaId, empresaId, desde, hasta), {});
  return (
    <form onSubmit={alEnviar(enviar)} className="tarjeta" style={{ display: "grid", gap: 14 }}>
      <h2 style={{ margin: 0 }}>Observaciones y sugerencias</h2>
      <p className="sub" style={{ margin: 0 }}>
        Lo que escribas aquí sale en el informe en PDF, debajo de cada grupo. Son tus palabras: el sistema no las inventa ni las cambia.
        {!puedeEscribir && " Tu perfil solo puede verlas."}
      </p>
      {GRUPOS.map((g) => (
        <fieldset key={g} className="fila" style={{ border: "none", padding: 0, margin: 0, alignItems: "flex-start" }}>
          <legend><strong>{NOMBRES_GRUPO[g]}</strong></legend>
          <label style={{ flex: "1 1 280px" }}>Observaciones
            <textarea name={`${g}_observaciones`} rows={3} maxLength={MAX_TEXTO} defaultValue={textos[g].observaciones} readOnly={!puedeEscribir} />
          </label>
          <label style={{ flex: "1 1 280px" }}>Sugerencias
            <textarea name={`${g}_sugerencias`} rows={3} maxLength={MAX_TEXTO} defaultValue={textos[g].sugerencias} readOnly={!puedeEscribir} />
          </label>
        </fieldset>
      ))}
      <label>Conclusión general
        <textarea name="general" rows={3} maxLength={MAX_TEXTO} defaultValue={textos.general} readOnly={!puedeEscribir} />
      </label>
      {estado.error && <p className="error" role="alert" style={{ margin: 0 }}>{estado.error}</p>}
      {estado.ok && <p className="exito" role="status" style={{ margin: 0 }}>{estado.ok}</p>}
      {puedeEscribir && <div><button className="primario" disabled={enviando}>{enviando ? "Guardando…" : "Guardar observaciones"}</button></div>}
    </form>
  );
}
