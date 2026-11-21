import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { aPdf, aXlsx } from "@/lib/exportar";
import { calcularNomina, leerNomina, tablaNomina } from "@/lib/nomina";

// La hoja de la nómina en Excel o PDF. Llega por POST (con los datos del formulario) para que los sueldos no queden en la dirección; se vuelve a calcular aquí.
// Pide ver el cliente y poder descargar.
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
  const ahora = new Date().toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" });
  const tabla = tablaNomina(entrada, calcularNomina(entrada), empresa.nombre + (empresa.rnc ? ` · RNC ${empresa.rnc}` : ""), `Generado por ${usuario.nombre} el ${ahora}`);
  const pdf = String(fd.get("formato")) === "pdf";
  const cuerpo = pdf ? await aPdf(tabla) : await aXlsx(tabla);
  const nombre = `Nomina_${entrada.periodo.replace("-", "")}_${empresa.rnc ?? "cliente"}.${pdf ? "pdf" : "xlsx"}`;
  return new Response(new Uint8Array(cuerpo), {
    headers: {
      "Content-Type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    },
  });
}
