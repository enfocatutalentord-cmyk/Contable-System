"use client";

import { useEffect } from "react";
import { CLAVE_MENU } from "./e/[id]/menu";

// Al entrar al sistema el menú empieza cerrado (Prioridad 1.4): se olvida lo que quedó abierto en la sesión anterior.
export function LimpiarMenu() {
  useEffect(() => { try { sessionStorage.removeItem(CLAVE_MENU); } catch { /* sin almacenamiento */ } }, []);
  return null;
}
