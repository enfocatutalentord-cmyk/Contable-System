import { conEmpresa } from "@/lib/db";
import { aPdf } from "@/lib/exportar";
import { enlaceVigente } from "@/lib/mensajes-db";
import { tablaFactura, tablaPropuesta } from "@/lib/pdf-documentos";
import { tablaReporte, type DatosReporte } from "@/lib/reporte-mensual";
import { tablaProyeccion, type Proyeccion } from "@/lib/proyeccion";

// Descarga sin sesión desde el enlace seguro de WhatsApp (bloque 3c). El enlace vale 30 días y se puede retirar antes; solo se
// guarda su hash. Entrega un único documento: la factura, la propuesta o el PDF subido (como la notificación de pago).

const CABECERAS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };

function aviso(estado: number, texto: string) {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Documento</title><style>body{font-family:system-ui,sans-serif;background:#F6F3EC;color:#1d1d1b;margin:0;padding:48px 16px}
main{max-width:480px;margin:auto;background:#fff;border-top:4px solid #B88A40;border-radius:8px;padding:24px}h1{color:#003D19;font-size:1.3rem;margin-top:0}</style>
</head><body><main><h1>No se puede abrir este documento</h1><p>${texto}</p></main></body></html>`;
  return new Response(html, { status: estado, headers: { ...CABECERAS, "Content-Type": "text/html; charset=utf-8" } });
}

const nombreSeguro = (n: string) => n.normalize("NFD").replace(/[^A-Za-z0-9 ._-]/g, "").slice(0, 100) || "documento.pdf";

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const e = await enlaceVigente(token);
  if (!e) return aviso(404, "El enlace venció, fue retirado o no existe. Pida que se lo envíen de nuevo.");
  const archivo = await conEmpresa(e.empresa_id, async (tx) => {
    if (e.tipo === "documento") {
      const [d] = await tx<{ nombre: string; tipo: string; contenido: Buffer }[]>`
        SELECT nombre, tipo, contenido FROM documentos WHERE id = ${e.ref_id} AND NOT eliminado`;
      return d ? { nombre: d.nombre, tipo: d.tipo, datos: new Uint8Array(d.contenido) } : null;
    }
    const [{ nombre, rnc }] = await tx<{ nombre: string; rnc: string | null }[]>`SELECT nombre, rnc FROM empresas WHERE id = ${e.empresa_id}`;
    const ahora = new Date().toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" });
    const base = { empresa: nombre + (rnc ? ` · RNC ${rnc}` : ""), generado: `Descargado el ${ahora}` };
    if (e.tipo === "proyeccion") {
      const [p] = await tx<{ datos: Proyeccion; notas: string | null; periodo: string }[]>`
        SELECT datos, notas, periodo FROM proyecciones_fiscales WHERE id = ${e.ref_id}`;
      return p ? { nombre: `proyeccion-${p.periodo}.pdf`, tipo: "application/pdf", datos: new Uint8Array(await aPdf(tablaProyeccion(p.datos, p.notas, base))) } : null;
    }
    if (e.tipo === "reporte") {
      const [r] = await tx<{ datos: DatosReporte | null; notas: string | null; periodo: string }[]>`
        SELECT datos, notas, periodo FROM reportes_mensuales WHERE id = ${e.ref_id} AND estado IN ('aprobado', 'enviado')`;
      return r?.datos ? { nombre: `reporte-${r.periodo}.pdf`, tipo: "application/pdf", datos: new Uint8Array(await aPdf(tablaReporte(r.datos, r.notas, base))) } : null;
    }
    const armado = e.tipo === "factura" ? await tablaFactura(tx, e.ref_id, base) : await tablaPropuesta(tx, e.ref_id, base);
    return armado ? { nombre: `${armado[0]}.pdf`, tipo: "application/pdf", datos: new Uint8Array(await aPdf(armado[1])) } : null;
  });
  if (!archivo) return aviso(404, "El documento ya no está disponible. Pida que se lo envíen de nuevo.");
  return new Response(archivo.datos, {
    headers: { ...CABECERAS, "Content-Type": archivo.tipo, "Content-Disposition": `inline; filename="${nombreSeguro(archivo.nombre)}"` },
  });
}
