import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { archivoTSS, calcularNomina, leerNomina, nombreArchivoTSS } from "@/lib/nomina";

// El archivo de autodeterminación (AM) o retroactiva (AR) de la TSS, con las posiciones de su instructivo v6.0. Llega por POST para que los sueldos y las cédulas no
// queden en la dirección. Pide ver el cliente y poder descargar. Cada descarga es un archivo nuevo: no se guarda.
export async function POST(req: Request, { params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const fd = await req.formData();
  const { usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) return new Response("No existe", { status: 404 });
  const empresaId = String(fd.get("empresa") ?? "");
  if (!esUuid(empresaId)) return new Response("No existe", { status: 404 });
  const { empresa } = await exigirPermiso(empresaId, "exportar");
  if (empresa.firma_id !== fid) return new Response("No existe", { status: 404 });
  const entrada = leerNomina(fd, empresa.rnc ?? "");
  if (typeof entrada === "string") return new Response(entrada, { status: 400 });
  let texto: string;
  try {
    texto = archivoTSS(entrada, calcularNomina(entrada));
  } catch (e) {
    return new Response((e as Error).message, { status: 400 });
  }
  return new Response(texto, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${nombreArchivoTSS(entrada)}"`,
      "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    },
  });
}
