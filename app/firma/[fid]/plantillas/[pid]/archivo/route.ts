import { accesoFirma, esUuid } from "@/lib/acceso";
import { WORD } from "@/lib/expediente";
import { plantillaDe } from "@/lib/plantillas-documento";

// El Word de una plantilla, tal como se subió (solo administradoras de la firma).
export async function GET(_: Request, { params }: { params: Promise<{ fid: string; pid: string }> }) {
  const { fid, pid } = await params;
  await accesoFirma(fid);
  if (!esUuid(pid)) return new Response("No existe", { status: 404 });
  const p = await plantillaDe(fid, pid);
  if (!p) return new Response("No existe", { status: 404 });
  return new Response(new Uint8Array(p.archivo), {
    headers: {
      "Content-Type": WORD,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(p.archivo_nombre)}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
