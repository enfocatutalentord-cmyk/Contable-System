import { accesoEmpresa } from "@/lib/acceso";
import { clientesDeFirma } from "@/lib/firma";
import { puede } from "@/lib/permisos";
import { Marco } from "../../marco";

export default async function LayoutEmpresa({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { empresa, usuario, perfil, permisos, adminFirma } = await accesoEmpresa(id);
  const clientes = await clientesDeFirma(empresa.firma_id, usuario.id, adminFirma, !empresa.activa);
  return (
    <Marco firma={{ id: empresa.firma_id, nombre: empresa.firma }} clientes={clientes} actual={id} usuario={usuario} perfil={perfil}
      admin={adminFirma} auditoria={puede(permisos, "auditoria")}>
      {!empresa.activa && <p className="aviso">Este cliente está inactivo.</p>}
      {children}
    </Marco>
  );
}
