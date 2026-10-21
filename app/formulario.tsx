"use client";

import { useActionState } from "react";
import type { Estado } from "./acciones-cuenta";

// Envuelve un formulario con su server action y muestra el error que devuelva.
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
  return (
    <form action={enviar} className={className}>
      {children}
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
      {estado.ok && <p className="exito" role="status">{estado.ok}</p>}
      <div>
        <button className="primario" disabled={enviando}>{enviando ? "Guardando…" : boton}</button>
      </div>
    </form>
  );
}
