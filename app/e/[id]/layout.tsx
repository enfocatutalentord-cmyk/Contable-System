import { accesoEmpresa, misFirmas, pestanasDePropia, soloCliente } from "@/lib/acceso";
import { clientesDeFirma } from "@/lib/firma";
import { puede } from "@/lib/permisos";
import { terminarSupervision } from "@/app/plataforma/acciones";
import { Marco } from "../../marco";

export default async function LayoutEmpresa({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { empresa, usuario, perfil, permisos, adminFirma, pestanas, supervision } = await accesoEmpresa(id);
  const [clientes, cliente, firmas] = await Promise.all([
    clientesDeFirma(empresa.firma_id, usuario.id, adminFirma || !!supervision, !empresa.activa), supervision ? true : soloCliente(empresa.firma_id, usuario.id),
    misFirmas(usuario.id),
  ]);
  const propiaId = firmas.find((f) => f.id === empresa.firma_id)?.empresa_propia_id ?? null;
  const pestanasPropia = supervision || cliente ? false : propiaId === id ? pestanas : await pestanasDePropia(propiaId, usuario.id, adminFirma);
  return (
    <Marco firma={{ id: empresa.firma_id, nombre: empresa.firma }} clientes={clientes} actual={id} usuario={usuario} perfil={perfil}
      admin={adminFirma} auditoria={puede(permisos, "auditoria")} pestanas={pestanas} pestanasPropia={pestanasPropia} soloCliente={cliente}
      franja={supervision && (
        <div className="franja-supervision" role="status">
          <span>Supervisión de la plataforma · <b>solo lectura</b> · termina a las {supervision.expira.toLocaleTimeString("es-DO", { timeZone: "America/Santo_Domingo", timeStyle: "short" })} · motivo: {supervision.motivo}</span>
          <form action={terminarSupervision.bind(null, empresa.firma_id)}><button>Terminar</button></form>
        </div>
      )}>
      {!empresa.activa && <p className="aviso">Este cliente está inactivo.</p>}
      {children}
    </Marco>
  );
}
