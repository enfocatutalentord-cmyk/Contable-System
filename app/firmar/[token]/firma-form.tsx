"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { Estado } from "@/app/acciones-cuenta";
import { firmarDocumento, rechazarDocumento } from "../acciones";

// El recuadro para firmar con el dedo o el ratón y los datos de quien firma. La firma se manda como imagen; se cuentan los puntos del trazo para no aceptar un
// recuadro vacío.
export function FirmaForm({ token }: { token: string }) {
  const [estado, enviar, enviando] = useActionState<Estado, FormData>(firmarDocumento.bind(null, token), {});
  const [rechazo, enviarRechazo, rechazando] = useActionState<Estado, FormData>(rechazarDocumento.bind(null, token), {});
  const [tipo, setTipo] = useState("cedula");
  const [aviso, setAviso] = useState("");
  const [rechazar, setRechazar] = useState(false);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const trazos = useRef(0);
  const dibujando = useRef(false);

  useEffect(() => {
    const c = lienzo.current;
    if (!c) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    g.lineWidth = 2.4;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#111";
  }, []);

  const punto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const empezar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dibujando.current = true;
    const g = e.currentTarget.getContext("2d")!;
    const { x, y } = punto(e);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 0.1, y + 0.1);
    g.stroke();
    trazos.current += 1;
  };
  const mover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dibujando.current) return;
    const g = e.currentTarget.getContext("2d")!;
    const { x, y } = punto(e);
    g.lineTo(x, y);
    g.stroke();
    trazos.current += 1;
  };
  const terminar = () => { dibujando.current = false; };
  const borrar = () => {
    const c = lienzo.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    trazos.current = 0;
    setAviso("");
  };

  const alEnviar = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (trazos.current < 12) { setAviso("Dibuja tu firma en el recuadro con el dedo o el ratón."); return; }
    setAviso("");
    const fd = new FormData(e.currentTarget);
    fd.set("firma", lienzo.current!.toDataURL("image/png"));
    fd.set("trazos", String(trazos.current));
    enviar(fd);
  };

  if (estado.ok) {
    return (
      <div className="tarjeta" role="status">
        <h2 style={{ marginTop: 0 }}>Firmado</h2>
        <p>{estado.ok}</p>
        <p><a className="boton primario" href={`/firmar/${token}/firmado`}>Bajar mi copia firmada (PDF)</a></p>
      </div>
    );
  }
  if (rechazo.ok) return <div className="tarjeta" role="status"><h2 style={{ marginTop: 0 }}>Recibido</h2><p>{rechazo.ok}</p></div>;

  return (
    <>
      <form onSubmit={alEnviar} className="tarjeta" style={{ display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Firmar</h2>
        <label>Nombre completo<input name="nombre" required maxLength={120} autoComplete="name" placeholder="Como aparece en su cédula" /></label>
        <div className="fila">
          <label>Identificación
            <select name="tipo_doc" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="cedula">Cédula</option><option value="pasaporte">Pasaporte</option>
            </select>
          </label>
          <label style={{ flex: "1 1 200px" }}>Número<input name="documento" required maxLength={30} inputMode={tipo === "cedula" ? "numeric" : "text"} placeholder={tipo === "cedula" ? "402-1234567-8" : "Número de pasaporte"} /></label>
        </div>
        <div>
          <div className="sub" style={{ margin: "0 0 4px" }}>Su firma (dibújela con el dedo o el ratón)</div>
          <canvas ref={lienzo} onPointerDown={empezar} onPointerMove={mover} onPointerUp={terminar} onPointerCancel={terminar} onPointerLeave={terminar}
            style={{ width: "100%", height: 180, border: "1px solid var(--borde)", borderRadius: 8, background: "#fff", touchAction: "none", cursor: "crosshair", display: "block" }}
            aria-label="Recuadro para dibujar su firma" />
          <button type="button" className="boton" onClick={borrar} style={{ marginTop: 6 }}>Borrar y volver a firmar</button>
        </div>
        <label style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <input type="checkbox" name="leido" required style={{ minHeight: 0, marginTop: 4 }} /> Leí el documento completo.
        </label>
        <label style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <input type="checkbox" name="acepto" required style={{ minHeight: 0, marginTop: 4 }} /> Acepto firmar este documento por medios electrónicos. Se guardará la fecha, la hora y la dirección de internet desde la que firmo.
        </label>
        {(aviso || estado.error) && <p className="error" role="alert" style={{ margin: 0 }}>{aviso || estado.error}</p>}
        <div><button className="primario" disabled={enviando}>{enviando ? "Firmando…" : "Firmar el documento"}</button></div>
      </form>

      <p style={{ marginTop: 12 }}>
        {!rechazar && <button type="button" className="boton" onClick={() => setRechazar(true)}>No puedo firmar este documento</button>}
      </p>
      {rechazar && (
        <form action={enviarRechazo} className="tarjeta" style={{ display: "grid", gap: 8 }}>
          <label>Cuéntele a la firma por qué no firma<input name="motivo" required minLength={3} maxLength={500} placeholder="Por ejemplo: hay un error en el monto" /></label>
          {rechazo.error && <p className="error" role="alert" style={{ margin: 0 }}>{rechazo.error}</p>}
          <div className="fila"><button className="primario" disabled={rechazando}>Enviar</button><button type="button" className="boton" onClick={() => setRechazar(false)}>Volver</button></div>
        </form>
      )}
    </>
  );
}
