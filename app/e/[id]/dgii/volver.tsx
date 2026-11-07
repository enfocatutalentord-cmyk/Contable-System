import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";

// Rediseño R4 (n.º 11): el formulario se abre desde la casilla de Impuestos del mes; desde aquí se vuelve al tablero en el mismo mes.
export async function VolverAImpuestos({ id, desde, mes }: { id: string; desde?: string; mes?: string }) {
  if (desde !== "impuestos") return null;
  const { empresa } = await accesoEmpresa(id);
  const m = /^\d{4}-\d{2}$/.test(mes ?? "") ? mes! : "";
  return (
    <p className="no-imprimir">
      <Link href={`/firma/${empresa.firma_id}/impuestos${m ? `?mes=${m}` : ""}`}>← Volver a Impuestos del mes</Link> · {empresa.nombre}
    </p>
  );
}
