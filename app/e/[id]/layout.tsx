import { accesoEmpresa, soloCliente } from "@/lib/acceso";
import { clientesDeFirma } from "@/lib/firma";
import { puede } from "@/lib/permisos";
import { Marco } from "../../marco";

export default async function LayoutEmpresa({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { empresa, usuario, perfil, permisos, adminFirma, pestanas } = await accesoEmpresa(id);
  const [clientes, cliente] = await Promise.all([
    clientesDeFirma(empresa.firma_id, usuario.id, adminFirma, !empresa.activa), soloCliente(empresa.firma_id, usuario.id),
  ]);
  return (
    <Marco firma={{ id: empresa.firma_id, nombre: empresa.firma }} clientes={clientes} actual={id} usuario={usuario} perfil={perfil}
      admin={adminFirma} auditoria={puede(permisos, "auditoria")} pestanas={pestanas} soloCliente={cliente}>
      {!empresa.activa && <p className="aviso">Este cliente está inactivo.</p>}
      {children}
    </Marco>
  );
}
