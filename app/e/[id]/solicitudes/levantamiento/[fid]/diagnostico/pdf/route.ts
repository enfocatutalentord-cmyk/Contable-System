import { accesoEmpresa, esUuid } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { puede } from "@/lib/permisos";
import { pdfDiagnostico } from "@/lib/pdf-diagnostico";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; fid: string }> }) {
  const { id, fid } = await params;
  const { permisos } = await accesoEmpresa(id);
  if (!puede(permisos, "exportar")) return new Response("Tu perfil no permite descargar", { status: 403 });
  if (!esUuid(fid)) return new Response("No existe", { status: 404 });
  const pdf = await conEmpresa(id, (tx) => pdfDiagnostico(tx, fid));
  if (!pdf) return new Response("El informe no está aprobado", { status: 404 });
  return new Response(pdf.datos, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdf.nombre}"`, "Cache-Control": "private, no-store" } });
}
