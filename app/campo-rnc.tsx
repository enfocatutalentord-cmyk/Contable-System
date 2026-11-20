"use client";

import { useRef, useState, type CSSProperties } from "react";
import { consultarRnc } from "./padron-acciones";
import { verFecha } from "@/lib/montos";

// Campo de RNC o cédula con búsqueda en el padrón de la DGII (P2c.3). Al salir del campo (o con «Buscar en la DGII») trae el nombre y, en los
// campos del mismo formulario que se indiquen en `llena`, escribe lo que esté vacío; si ya había algo distinto, ofrece usar el de la DGII.
// Los campos se buscan por su nombre dentro del formulario, así sirve en formularios del servidor y en los controlados.

type Datos = { nombre: string; nombre_comercial: string | null; actividad: string | null; fecha_inicio: string | null; estado: string | null; regimen: string | null };
type Estado =
  | { t: "invalido" } | { t: "sin_padron" } | { t: "no_esta"; al: string } | { t: "buscando" }
  | { t: "encontrado"; al: string; datos: Datos; distinto: boolean };
export type Llena = Partial<Record<"nombre" | "nombre_comercial" | "actividad" | "fecha_inicio", string>>;

function poner(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true })); // para que React (campos controlados) se entere
}

export function CampoRnc({ etiqueta, name, llena, defaultValue = "", value, onChange, placeholder, disabled, requerido, estilo }: {
  etiqueta: string; name: string; llena: Llena; defaultValue?: string; value?: string; onChange?: (v: string) => void;
  placeholder?: string; disabled?: boolean; requerido?: boolean; estilo?: CSSProperties;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<Estado | null>(null);

  function campo(nombre: string | undefined) {
    if (!nombre) return null;
    const el = ref.current?.form?.elements.namedItem(nombre);
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
  }
  const clave: Record<keyof Llena, (d: Datos) => string | null> = {
    nombre: (d) => d.nombre, nombre_comercial: (d) => d.nombre_comercial, actividad: (d) => d.actividad, fecha_inicio: (d) => d.fecha_inicio,
  };
  function aplicar(d: Datos, forzar: boolean): boolean {
    let distinto = false;
    for (const k of Object.keys(llena) as (keyof Llena)[]) {
      const el = campo(llena[k]);
      const nuevo = clave[k](d);
      if (!el || !nuevo) continue;
      const actual = el.value.trim();
      if (!actual || forzar) poner(el, nuevo);
      else if (actual.toLowerCase() !== nuevo.toLowerCase()) distinto = true;
    }
    return distinto;
  }

  async function buscar() {
    const limpio = (ref.current?.value ?? "").replace(/[-\s]/g, "");
    if (!limpio) { setEstado(null); return; }
    if (!/^(\d{9}|\d{11})$/.test(limpio)) { setEstado({ t: "invalido" }); return; }
    setEstado({ t: "buscando" });
    try {
      const r = await consultarRnc(limpio);
      if (r.tipo === "encontrado") setEstado({ t: "encontrado", al: r.al, datos: r.datos, distinto: aplicar(r.datos, false) });
      else if (r.tipo === "no_esta") setEstado({ t: "no_esta", al: r.al });
      else setEstado({ t: r.tipo === "sin_padron" ? "sin_padron" : "invalido" });
    } catch {
      setEstado(null); // sin conexión o sin sesión: el campo sigue funcionando como siempre
    }
  }

  const controlado = value !== undefined;
  return (
    <div style={{ display: "grid", gap: 4, alignContent: "start", ...estilo }}>
      <label>{etiqueta}
        <input
          ref={ref} name={name} inputMode="numeric" placeholder={placeholder} disabled={disabled} required={requerido}
          {...(controlado ? { value, onChange: (e) => onChange?.(e.target.value) } : { defaultValue })}
          onBlur={buscar}
        />
      </label>
      {!disabled && (
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: "0.9em" }}>
          <button type="button" className="enlace" onClick={buscar} disabled={estado?.t === "buscando"}>Buscar en la DGII</button>
          {estado?.t === "buscando" && <span className="sub">Buscando…</span>}
          {estado?.t === "invalido" && <span className="error" style={{ margin: 0 }}>Debe tener 9 dígitos (RNC) u 11 (cédula).</span>}
          {estado?.t === "sin_padron" && <span className="sub">El padrón de la DGII todavía no está cargado.</span>}
          {estado?.t === "no_esta" && <span className="sub">No aparece en el padrón de la DGII del {verFecha(estado.al)}.</span>}
          {estado?.t === "encontrado" && (
            <span className={/^ACTIVO/i.test(estado.datos.estado ?? "ACTIVO") ? "sub" : "error"} style={{ margin: 0 }}>
              DGII: {estado.datos.nombre}{estado.datos.estado ? ` · ${estado.datos.estado}` : ""}
              {estado.distinto && <> · <button type="button" className="enlace" onClick={() => { aplicar(estado.datos, true); setEstado({ ...estado, distinto: false }); }}>Usar los datos de la DGII</button></>}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
