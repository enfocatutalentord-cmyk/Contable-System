import { accesoFirma } from "@/lib/acceso";
import { clientesDeFirma } from "@/lib/firma";
import { Marco } from "../../marco";

export default async function LayoutFirma({ children, params }: { children: React.ReactNode; params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid, false);
  const clientes = await clientesDeFirma(fid, usuario.id, firma.administrador);
  return (
    <Marco firma={firma} clientes={clientes} actual={null} usuario={usuario}
      perfil={firma.administrador ? "Administrador de la firma" : "Equipo"} admin={firma.administrador} auditoria={firma.administrador}>
      {children}
    </Marco>
  );
}
