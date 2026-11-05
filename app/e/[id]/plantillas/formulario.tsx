import Link from "next/link";
import { exigirPermiso } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { listarUnidades } from "@/lib/empresa-propia";
import { hoyISO } from "@/lib/montos";
import type { LineaPlantilla } from "@/lib/plantillas";
import { FormularioAsiento } from "../asientos/nuevo/formulario-asiento";
import { guardarPlantilla } from "../plantillas-acciones";

export type Inicial = {
  nombre: string; concepto: string; referencia: string; lineas: LineaPlantilla[]; frecuencia: "ninguna" | "mensual"; dia: number | null;
  desde: string; hasta: string | null;
};

// Formulario de una plantilla (nueva o existente): las mismas líneas que un asiento, con el nombre y cada cuánto se repite.
export async function PaginaPlantilla({ id, plantillaId, inicial }: { id: string; plantillaId: string | null; inicial: Inicial }) {
  const { empresa } = await exigirPermiso(id, "registrar", "/plantillas");
  const [cuentas, unidades] = await conEmpresa(id, async (tx) => [(await listarCuentas(tx)).filter((c) => c.de_detalle && c.activa), await listarUnidades(tx)] as const);
  return (
    <>
      <p><Link href={`/e/${id}/plantillas`}>← Asientos frecuentes</Link></p>
      <h1>{plantillaId ? `Plantilla: ${inicial.nombre}` : "Nueva plantilla"}</h1>
      <p className="sub">
        Las líneas son las del asiento. En una plantilla que se usa a mano los montos pueden quedar en blanco y se escriben al usarla;
        una mensual necesita los montos y que cuadre, porque prepara el borrador sola.
      </p>
      <FormularioAsiento accion={guardarPlantilla.bind(null, id, plantillaId)} cuentas={cuentas} hoy={hoyISO()} bloqueo={empresa.fecha_bloqueo}
        unidades={unidades} puedeContabilizar={false}
        inicial={{ fecha: hoyISO(), concepto: inicial.concepto, referencia: inicial.referencia, lineas: inicial.lineas }}
        plantilla={{ nombre: inicial.nombre, frecuencia: inicial.frecuencia, dia: inicial.dia, desde: inicial.desde, hasta: inicial.hasta }} />
    </>
  );
}
