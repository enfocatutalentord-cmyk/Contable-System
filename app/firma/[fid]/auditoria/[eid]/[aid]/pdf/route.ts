import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { pdfAuditoria } from "@/lib/pdf-auditoria";

// El informe final de una auditoría en PDF, con el logo del cliente y las fotos. Solo el equipo de la firma, con permiso de exportar en el cliente.
export async function GET(_: Request, { params }: { params: Promise<{ fid: string; eid: string; aid: string }> }) {
  const { fid, eid, aid } = await params;
  if (!esUuid(eid) || !esUuid(aid)) return new Response("No existe", { status: 404 });
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) return new Response("No existe", { status: 404 });
  const { empresa } = await exigirPermiso(eid, "exportar", "/expediente");
  if (empresa.firma_id !== fid) return new Response("No existe", { status: 404 });
  const r = await conEmpresa(eid, (tx) => pdfAuditoria(tx, { empresaId: eid, auditoriaId: aid, empresa: empresa.nombre, rnc: empresa.rnc, firma: firma.nombre, preparadoPor: usuario.nombre }));
  if (!r) return new Response("No existe", { status: 404 });
  return new Response(r.datos, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(r.nombre)}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
  });
}
