import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { aXlsx } from "@/lib/exportar";
import { pdfInventario, reporteConteo, tablaInventario } from "@/lib/inventario-reporte";

// El reporte de diferencias de un conteo cerrado, en Excel o PDF. Solo el equipo de la firma, con permiso de exportar en el cliente.
export async function GET(req: Request, { params }: { params: Promise<{ fid: string; eid: string; cid: string }> }) {
  const { fid, eid, cid } = await params;
  const sp = new URL(req.url).searchParams;
  if (!esUuid(eid) || !esUuid(cid)) return new Response("No existe", { status: 404 });
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) return new Response("No existe", { status: 404 });
  const { empresa } = await exigirPermiso(eid, "exportar", "/expediente");
  if (empresa.firma_id !== fid) return new Response("No existe", { status: 404 });
  const todos = sp.get("todos") === "1", pdf = sp.get("formato") === "pdf";
  const cabeceras = { "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" };
  const r = await conEmpresa(eid, async (tx) => {
    const rep = await reporteConteo(tx, cid);
    if (!rep || "error" in rep) return rep;
    if (pdf) return { rep, archivo: await pdfInventario(tx, { empresaId: eid, empresa: empresa.nombre, rnc: empresa.rnc, firma: firma.nombre, preparadoPor: usuario.nombre, rep, todos }) };
    const ahora = new Date().toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" });
    const tabla = tablaInventario(rep, empresa.nombre + (empresa.rnc ? ` · RNC ${empresa.rnc}` : ""), `Generado por ${usuario.nombre} el ${ahora}`, todos);
    return { rep, archivo: { nombre: `diferencias-inventario-${empresa.rnc ?? "cliente"}-n${rep.numero}.xlsx`, datos: new Uint8Array(await aXlsx(tabla)) } };
  });
  if (!r) return new Response("No existe", { status: 404 });
  if ("error" in r) return new Response(r.error, { status: 409, headers: cabeceras });
  return new Response(r.archivo.datos, {
    headers: {
      ...cabeceras, "Content-Type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `${pdf ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(r.archivo.nombre)}`,
    },
  });
}
