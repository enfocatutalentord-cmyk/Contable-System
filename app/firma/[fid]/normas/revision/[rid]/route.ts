import { accesoFirma, esUuid } from "@/lib/acceso";
import { db } from "@/lib/db";
import { nombreSeguro } from "@/lib/documentos";

// Documento de la DGII adjunto a una revisión de las normas (solo administradores de la firma).
export async function GET(_: Request, { params }: { params: Promise<{ fid: string; rid: string }> }) {
  const { fid, rid } = await params;
  await accesoFirma(fid);
  if (!esUuid(rid)) return new Response("No existe", { status: 404 });
  const [r] = await db()<{ archivo: Buffer | null; archivo_tipo: string | null; archivo_nombre: string | null }[]>`
    SELECT archivo, archivo_tipo, archivo_nombre FROM revisiones_normas WHERE id = ${rid} AND firma_id = ${fid}`;
  if (!r?.archivo) return new Response("No existe", { status: 404 });
  return new Response(new Uint8Array(r.archivo), {
    headers: {
      "Content-Type": r.archivo_tipo ?? "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(nombreSeguro(r.archivo_nombre ?? "documento"))}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
