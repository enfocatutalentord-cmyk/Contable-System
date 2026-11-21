"use client";

import { useRef, useState } from "react";
import type { RespuestaLectura } from "../../inventario-acciones";

type Resultado = { n: number; hora: string; r: RespuestaLectura; codigo: string };

// El lector del conteo. Un lector de código de barras de USB o Bluetooth «escribe» el código y da Enter, así que basta con tener el cursor en el campo «Código» y escanear: cada
// código suma 1 y el campo queda listo para el siguiente. A mano: escribe la cantidad y el código. Las lecturas van en fila, una tras otra, aunque se escanee muy rápido.
export function LectorConteo({ accion }: { accion: (codigo: string, cantidad: string, origen: string) => Promise<RespuestaLectura> }) {
  const codigo = useRef<HTMLInputElement>(null);
  const [cantidad, setCantidad] = useState("1");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [pendientes, setPendientes] = useState(0);
  const cola = useRef<Promise<void>>(Promise.resolve());
  const contador = useRef(0);

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const c = (codigo.current?.value ?? "").trim();
    if (!c) return;
    const cant = cantidad.trim() || "1";
    const origen = cant === "1" ? "lector" : "manual";
    if (codigo.current) codigo.current.value = "";
    setCantidad("1");
    codigo.current?.focus();
    const n = ++contador.current;
    setPendientes((p) => p + 1);
    // Cada lectura espera a la anterior: así el orden queda como se escaneó.
    cola.current = cola.current.then(async () => {
      let r: RespuestaLectura;
      try { r = await accion(c, cant, origen); } catch { r = { error: "No se pudo anotar: revisa la conexión y vuelve a escanear ese código." }; }
      setPendientes((p) => p - 1);
      setResultados((x) => [{ n, hora: new Date().toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), r, codigo: c }, ...x].slice(0, 6));
    });
  }

  return (
    <div>
      <form onSubmit={enviar} className="fila" style={{ alignItems: "flex-end" }}>
        <label style={{ flex: "3 1 240px" }}>Código (escanea o escribe y da Enter)
          <input ref={codigo} name="codigo" autoFocus autoComplete="off" inputMode="text" maxLength={60} style={{ fontSize: "1.2rem" }} />
        </label>
        <label style={{ width: 120 }}>Cantidad
          <input name="cantidad" value={cantidad} onChange={(e) => setCantidad(e.target.value)} inputMode="decimal" autoComplete="off" />
        </label>
        <button className="primario" type="submit">Anotar</button>
      </form>
      <p className="sub" style={{ margin: "6px 0 0" }}>
        {pendientes > 0 ? `Anotando ${pendientes}…` : "Cada código suma 1. Para varias unidades a la vez, cambia la cantidad antes de anotar."}
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 6 }} aria-live="polite">
        {resultados.map((x) => (
          <li key={x.n} style={{ borderLeft: `4px solid ${"error" in x.r ? "var(--peligro)" : x.r.encontrado ? "var(--ok)" : "var(--dorado)"}`, paddingLeft: 10 }}>
            {"error" in x.r ? (
              <span className="peligro"><strong>{x.codigo}</strong> · {x.r.error}</span>
            ) : x.r.encontrado ? (
              <span><strong>{x.r.nombre}</strong> <span className="sub">({x.r.codigo})</span> · +{x.r.cantidad}{x.r.unidad ? ` ${x.r.unidad}` : ""} · total contado <strong>{x.r.total}</strong></span>
            ) : (
              <span><strong>{x.r.codigo}</strong> · <strong>no está en el listado</strong> (+{x.r.cantidad}; llevas {x.r.total} de este código sin listado). Revisa que esté bien escaneado.</span>
            )}
            <span className="sub"> · {x.hora}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
