import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { leerFiltrosAnalisis } from "@/lib/analisis-financiero";
import { conEmpresa } from "@/lib/db";
import { pdfAnalisis } from "@/lib/pdf-analisis";

// El informe de análisis financiero de un cliente en PDF, con su logo. Pide ver el cliente y su pestaña de Estados financieros, y poder descargar.
export async function GET(req: Request, { params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const sp = Object.fromEntries(new URL(req.url).searchParams) as Record<string, string>;
  const { usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) return new Response("No existe", { status: 404 });
  if (!esUuid(sp.empresa ?? "")) return new Response("No existe", { status: 404 });
  const { empresa } = await exigirPermiso(sp.empresa, "exportar", "/estados");
  if (empresa.firma_id !== fid) return new Response("No existe", { status: 404 });
  const f = leerFiltrosAnalisis(sp);
  const r = await conEmpresa(empresa.id, (tx) => pdfAnalisis(tx, { empresaId: empresa.id, empresa: empresa.nombre, rnc: empresa.rnc, ...f, preparadoPor: usuario.nombre }));
  return new Response(r.datos, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(r.nombre)}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
  });
}
