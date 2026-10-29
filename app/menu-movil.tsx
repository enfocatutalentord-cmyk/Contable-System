"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// En pantallas angostas el menú se recoge detrás del botón «Menú» (como Xero y QuickBooks en móvil) y se cierra
// solo al cambiar de pantalla. En escritorio el botón no se ve y el menú queda siempre abierto.
export function MenuMovil({ marca, children }: { marca: React.ReactNode; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const ruta = usePathname();
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setAbierto(false), [ruta]);
  return (
    <>
      <div className="menu-cabeza">
        {marca}
        <button type="button" className="menu-boton" aria-expanded={abierto} aria-controls="menu-cuerpo" onClick={() => setAbierto(!abierto)}>
          <span aria-hidden="true">{abierto ? "✕" : "☰"}</span> Menú
        </button>
      </div>
      <div id="menu-cuerpo" className={`menu-cuerpo${abierto ? " abierto" : ""}`}>{children}</div>
    </>
  );
}
