import { accesoEmpresa, esUuid } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { aPdf } from "@/lib/exportar";
import { tablaProyeccion, type Proyeccion } from "@/lib/proyeccion";
import { tablaReporte, type DatosReporte } from "@/lib/reporte-mensual";

// Lo que el cliente descarga desde su pantalla de inicio (bloque 8a): su reporte aprobado, su proyección y el PDF de sus
// notificaciones de pago. Solo de su propia empresa (RLS) y solo para quien entra como cliente o tiene «exportar».
const CABECERAS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(_: Request, { params }: { params: Promise<{ id: string; tipo: string; rid: string }> }) {
  const { id, tipo, rid } = await params;
  const { empresa, permisos, paraClientes, supervision } = await accesoEmpresa(id);
  if (supervision || (!paraClientes && !permisos.includes("exportar"))) return new Response("No disponible", { status: 403 });
  if (!esUuid(rid)) return new Response("No existe", { status: 404 });
  const ahora = new Date().toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" });
  const base = { empresa: empresa.nombre + (empresa.rnc ? ` · RNC ${empresa.rnc}` : ""), generado: `Descargado el ${ahora}` };
  const archivo = await conEmpresa(id, async (tx) => {
    if (tipo === "reporte") {
      const [r] = await tx<{ datos: DatosReporte | null; notas: string | null; periodo: string }[]>`
        SELECT datos, notas, periodo FROM reportes_mensuales WHERE id = ${rid} AND estado IN ('aprobado', 'enviado')`;
      return r?.datos ? { nombre: `reporte-${r.periodo}.pdf`, tipo: "application/pdf", datos: new Uint8Array(await aPdf(tablaReporte(r.datos, r.notas, base))) } : null;
    }
    if (tipo === "proyeccion") {
      const [p] = await tx<{ datos: Proyeccion; notas: string | null; periodo: string }[]>`SELECT datos, notas, periodo FROM proyecciones_fiscales WHERE id = ${rid}`;
      return p ? { nombre: `proyeccion-${p.periodo}.pdf`, tipo: "application/pdf", datos: new Uint8Array(await aPdf(tablaProyeccion(p.datos, p.notas, base))) } : null;
    }
    if (tipo === "notificacion") {
      const [d] = await tx<{ nombre: string; tipo: string; contenido: Buffer }[]>`
        SELECT nombre, tipo, contenido FROM documentos WHERE entidad = 'notificacion' AND entidad_id = ${rid} AND NOT eliminado ORDER BY subido_en DESC LIMIT 1`;
      return d ? { nombre: d.nombre, tipo: d.tipo, datos: new Uint8Array(d.contenido) } : null;
    }
    return null;
  });
  if (!archivo) return new Response("Ese documento no está disponible.", { status: 404 });
  const nombre = archivo.nombre.normalize("NFD").replace(/[^A-Za-z0-9 ._-]/g, "").slice(0, 100) || "documento.pdf";
  return new Response(archivo.datos, { headers: { ...CABECERAS, "Content-Type": archivo.tipo, "Content-Disposition": `inline; filename="${nombre}"` } });
}
