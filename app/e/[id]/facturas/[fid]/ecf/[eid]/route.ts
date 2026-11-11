import { accesoEmpresa, esUuid } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { nombreArchivo } from "@/lib/ecf-xml";
import { puede } from "@/lib/permisos";

// XML firmado de un e-CF (entrega E2a), para revisarlo. Se descarga tal cual se firmó: alterarlo invalida la firma.
export async function GET(_: Request, { params }: { params: Promise<{ id: string; fid: string; eid: string }> }) {
  const { id, fid, eid } = await params;
  const { permisos, empresa } = await accesoEmpresa(id);
  if (!puede(permisos, "exportar") || !esUuid(fid) || !esUuid(eid)) return new Response("No existe", { status: 404 });
  const [r] = await conEmpresa(id, (tx) => tx<{ xml: string; encf: string }[]>`
    SELECT xml, encf FROM ecf_envios WHERE id = ${eid} AND factura_id = ${fid}`);
  if (!r) return new Response("No existe", { status: 404 });
  return new Response(r.xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombreArchivo(empresa.rnc ?? "", r.encf)}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
