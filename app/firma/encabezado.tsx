import Link from "next/link";
import type { Firma } from "@/lib/acceso";

export function EncabezadoFirma({ firma, actual }: { firma: Firma; actual: "equipo" | "perfiles" }) {
  return (
    <>
      <p><Link href="/empresas">← Panel de la firma</Link></p>
      <h1>{firma.nombre}</h1>
      <nav className="fila" style={{ margin: "8px 0 20px" }} aria-label="Firma">
        <Link className={`boton${actual === "equipo" ? " primario" : ""}`} href={`/firma/${firma.id}/equipo`}>Equipo y accesos</Link>
        <Link className={`boton${actual === "perfiles" ? " primario" : ""}`} href={`/firma/${firma.id}/perfiles`}>Perfiles y permisos</Link>
      </nav>
    </>
  );
}
