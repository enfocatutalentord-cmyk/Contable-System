import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { logoDe } from "@/lib/pdf-analisis";
import { pdfPrestaciones } from "@/lib/pdf-prestaciones";
import { calcular, leerEntrada } from "@/lib/prestaciones";

// La hoja de cálculo de prestaciones en PDF. Llega por POST (con los datos del formulario) para que los sueldos no queden en la dirección; el resultado se
// vuelve a calcular aquí, nunca se toma del navegador. Pide ver el cliente y poder descargar.
export async function POST(req: Request, { params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const fd = await req.formData();
  const { usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) return new Response("No existe", { status: 404 });
  const empresaId = String(fd.get("empresa") ?? "");
  if (!esUuid(empresaId)) return new Response("No existe", { status: 404 });
  const { empresa } = await exigirPermiso(empresaId, "exportar");
  if (empresa.firma_id !== fid) return new Response("No existe", { status: 404 });
  const entrada = leerEntrada(fd);
  if (typeof entrada === "string") return new Response(entrada, { status: 400 });
  const logo = await conEmpresa(empresa.id, (tx) => logoDe(tx, empresa.id));
  const r = await pdfPrestaciones({ empresa: empresa.nombre, rnc: empresa.rnc, entrada, resultado: calcular(entrada), preparadoPor: usuario.nombre, logo });
  return new Response(r.datos, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(r.nombre)}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
  });
}
