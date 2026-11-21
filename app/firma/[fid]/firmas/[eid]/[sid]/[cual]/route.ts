import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { archivoDe } from "@/lib/firma-digital";

// El PDF de una solicitud de firma, para el equipo: el original que se mandó o la copia firmada con su constancia. Pide poder ver el cliente.
export async function GET(_: Request, { params }: { params: Promise<{ fid: string; eid: string; sid: string; cual: string }> }) {
  const { fid, eid, sid, cual } = await params;
  const { usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) return new Response("No existe", { status: 404 });
  if (!esUuid(eid) || !esUuid(sid) || (cual !== "original" && cual !== "firmado")) return new Response("No existe", { status: 404 });
  const { empresa } = await exigirPermiso(eid, "ver");
  if (empresa.firma_id !== fid) return new Response("No existe", { status: 404 });
  const a = await conEmpresa(eid, (tx) => archivoDe(tx, sid, cual));
  if (!a) return new Response("No existe", { status: 404 });
  const nombre = `${a.titulo}${cual === "firmado" ? " (firmado)" : ""}.pdf`.replace(/[^\p{L}\p{N} ._()-]/gu, "");
  return new Response(new Uint8Array(a.bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(nombre)}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
  });
}
