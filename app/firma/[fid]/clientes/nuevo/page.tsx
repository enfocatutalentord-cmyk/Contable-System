import { nuevaEmpresa } from "@/app/acciones-cuenta";
import { CamposFicha } from "@/app/campos-ficha";
import { Formulario } from "@/app/formulario";
import { redirect } from "next/navigation";
import { accesoFirma } from "@/lib/acceso";

export const metadata = { title: "Nuevo cliente · Empire Tax’N Legal" };

export default async function NuevoCliente({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  // Crear clientes ya no es solo de la administradora (rediseño R6): basta la casilla «Crear clientes» de la persona.
  const { firma } = await accesoFirma(fid, false);
  if (!firma.crear_clientes) redirect(`/firma/${fid}?sin_permiso=1`);
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Nuevo cliente</h1>
      <p className="sub">La empresa se crea con el catálogo de cuentas dominicano y la configuración de impuestos sugerida. Lo puedes ajustar después.</p>
      <div className="tarjeta">
        <Formulario accion={nuevaEmpresa.bind(null, fid)} boton="Crear cliente" className="">
          <CamposFicha />
        </Formulario>
      </div>
    </div>
  );
}
