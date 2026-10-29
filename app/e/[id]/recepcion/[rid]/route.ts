import { accesoEmpresa, esUuid } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { puede } from "@/lib/permisos";

// Descarga de un documento recibido: la base solo lo entrega si es de la empresa en curso (y el rol ve la pestaña).
export async function GET(_: Request, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const { permisos } = await accesoEmpresa(id);
  if (!esUuid(rid) || !puede(permisos, "ver")) return new Response("No encontrado", { status: 404 });
  const [d] = await conEmpresa(id, (tx) => tx<{ nombre: string; tipo: string; contenido: Buffer }[]>`
    SELECT nombre, tipo, contenido FROM recepciones WHERE id = ${rid}`);
  if (!d) return new Response("No encontrado", { status: 404 });
  return new Response(new Uint8Array(d.contenido), {
    headers: {
      "Content-Type": d.tipo,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(d.nombre)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
      "Cache-Control": "private, no-store",
    },
  });
}
