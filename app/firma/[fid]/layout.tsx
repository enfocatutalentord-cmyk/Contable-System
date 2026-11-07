import { redirect } from "next/navigation";
import { accesoFirma, pestanasDePropia, soloCliente } from "@/lib/acceso";
import { clientesDeFirma } from "@/lib/firma";
import { Marco } from "../../marco";

export default async function LayoutFirma({ children, params }: { children: React.ReactNode; params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid, false);
  const clientes = await clientesDeFirma(fid, usuario.id, firma.administrador);
  // Los usuarios de las empresas cliente no ven las pantallas de la firma: entran directo a su empresa.
  if (clientes.length && (await soloCliente(fid, usuario.id))) redirect(`/e/${clientes[0].id}`);
  const pestanasPropia = await pestanasDePropia(firma.empresa_propia_id, usuario.id, firma.administrador);
  return (
    <Marco firma={firma} clientes={clientes} actual={null} usuario={usuario}
      perfil={firma.administrador ? "Administrador de la firma" : "Equipo"} admin={firma.administrador} auditoria={firma.administrador}
      pestanasPropia={pestanasPropia}>
      {children}
    </Marco>
  );
}
