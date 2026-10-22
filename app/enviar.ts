"use client";

import { startTransition, type FormEvent } from "react";

// Envía el formulario a su server action sin que React lo vacíe al terminar: si vuelve un error o un aviso,
// lo que la persona escribió se conserva. Incluye el botón que lo envió (por ejemplo, «Contabilizar»).
export function alEnviar(enviar: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    startTransition(() => enviar(fd));
  };
}
