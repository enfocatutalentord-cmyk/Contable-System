"use client";

import { useActionState, useEffect, useRef } from "react";
import type { Estado } from "./acciones-cuenta";
import { alEnviar } from "./enviar";

// Envuelve un formulario con su server action y muestra el error o el aviso que devuelva.
// Los datos escritos se conservan si hay error; se limpian cuando la acción sale bien. Sin `boton`, es solo lectura.
export function Formulario({
  accion,
  boton,
  children,
  className = "formulario",
}: {
  accion: (estado: Estado, fd: FormData) => Promise<Estado>;
  boton: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado.ok) form.current?.reset();
  }, [estado]);
  return (
    <form ref={form} onSubmit={alEnviar(enviar)} className={className}>
      {children}
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
      {estado.ok && <p className="exito" role="status">{estado.ok}</p>}
      {estado.codigos && (
        <div className="codigos-recuperacion">
          <ol>{estado.codigos.map((c) => <li key={c}><code>{c}</code></li>)}</ol>
          <p className="sub">Cada código sirve una sola vez para entrar si no tienes el celular. Cópialos o imprímelos y guárdalos en un lugar seguro: no se vuelven a mostrar.</p>
          <a className="boton primario" href="">Ya los guardé</a>
        </div>
      )}
      {boton && !estado.codigos && (
        <div>
          <button className="primario" disabled={enviando}>{enviando ? "Guardando…" : boton}</button>
        </div>
      )}
    </form>
  );
}
