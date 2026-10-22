"use client";

import { useActionState, useEffect, useRef } from "react";
import type { Estado } from "./acciones-cuenta";
import { alEnviar } from "./enviar";

// Envuelve un formulario con su server action y muestra el error o el aviso que devuelva.
// Los datos escritos se conservan si hay error; se limpian cuando la acción sale bien.
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
      <div>
        <button className="primario" disabled={enviando}>{enviando ? "Guardando…" : boton}</button>
      </div>
    </form>
  );
}
