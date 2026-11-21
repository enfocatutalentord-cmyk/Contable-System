import { archivoPorToken } from "@/lib/firma-digital";

// El PDF que se va a firmar, para leerlo desde el enlace (sin sesión). Solo mientras la solicitud está abierta.
const CABECERAS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await archivoPorToken(token, "original");
  if (!a) return new Response("El enlace venció o ya no existe.", { status: 404, headers: CABECERAS });
  return new Response(new Uint8Array(a.bytes), { headers: { ...CABECERAS, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="documento.pdf"` } });
}
