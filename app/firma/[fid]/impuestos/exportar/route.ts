import { notFound } from "next/navigation";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { nombreMes } from "@/lib/bitacora";
import { aPdf, aXlsx, type Celda } from "@/lib/exportar";
import { clientesDeFirma, impuestosDeFirma } from "@/lib/firma";
import { MENSUALES } from "@/lib/impuestos-mes";
import { hoyISO, verFecha } from "@/lib/montos";

const TEXTO: Record<string, string> = { presentada: "Presentada", en_cero: "En cero", pendiente: "Pendiente", vencida: "Vencida" };

// Excel o PDF de «Impuestos del mes» (bloque 4a): todos los clientes con el estado de cada declaración.
export async function GET(req: Request, { params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound(); // solo el equipo de la firma
  const sp = new URL(req.url).searchParams;
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.get("mes") ?? "") ? sp.get("mes")! : hoyISO().slice(0, 7);
  const filas = await impuestosDeFirma((await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => c.activa && !c.propia && c.estado_cliente !== "prospecto"), mes.replace("-", ""), hoyISO());
  const ahora = new Date().toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" });
  const tabla = {
    titulo: "Impuestos del mes", empresa: firma.nombre + (firma.rnc ? ` · RNC ${firma.rnc}` : ""), horizontal: true,
    detalle: `${nombreMes(mes)} · ${filas.length} clientes · ${filas.filter((f) => f.cerrado).length} cerrados`,
    generado: `Generado por ${usuario.nombre} el ${ahora}`,
    columnas: [{ titulo: "Cliente", ancho: 30 }, { titulo: "Responsable", ancho: 18 }, ...MENSUALES.map((m) => ({ titulo: m.formato, ancho: 14 })),
      { titulo: "Compras revisadas", ancho: 14 }, { titulo: "A pagar", num: true }, { titulo: "Mes", ancho: 12 }],
    filas: filas.map((f): Celda[] => [
      f.cliente.nombre, f.cliente.responsable ?? "",
      ...MENSUALES.map((m) => {
        const d = f.declaraciones.find((x) => x.formato === m.formato);
        return d ? `${TEXTO[d.estado]}${d.estado === "pendiente" || d.estado === "vencida" ? ` (vence ${verFecha(d.vence)})` : ""}` : "—";
      }),
      f.compras ? `${f.revisadas} de ${f.compras}` : "", f.aPagar, f.cerrado ? "Cerrado" : f.listo ? "Listo para cerrar" : "Abierto",
    ]),
  };
  const pdf = sp.get("formato") === "pdf";
  const cabeceras = {
    "Content-Type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="impuestos-del-mes-${mes}.${pdf ? "pdf" : "xlsx"}"`,
    "Cache-Control": "private, no-store",
  };
  return new Response(new Uint8Array(pdf ? await aPdf(tabla) : await aXlsx(tabla)), { headers: cabeceras });
}
