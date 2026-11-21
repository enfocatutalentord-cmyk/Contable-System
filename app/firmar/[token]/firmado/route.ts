import { archivoPorToken } from "@/lib/firma-digital";

// La copia firmada, con su constancia, para que el firmante la guarde (sin sesión; vale 30 días después de firmar).
const CABECERAS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await archivoPorToken(token, "firmado");
  if (!a) return new Response("El enlace venció o ya no existe.", { status: 404, headers: CABECERAS });
  const nombre = `${a.titulo} (firmado).pdf`.replace(/[^\p{L}\p{N} ._()-]/gu, "");
  return new Response(new Uint8Array(a.bytes), { headers: { ...CABECERAS, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}` } });
}
