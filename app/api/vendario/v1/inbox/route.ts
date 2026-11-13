// Entrada de Vendario (acuerdo docs/vendario/acuerdo.md, secciones 2 a 5): POST /api/vendario/v1/inbox.
// Firma HMAC con V2E_SECRET (dos claves separadas por coma durante una rotación) y 5 minutos de tolerancia: si no, 401.
// Sin repetir el id (200 {"duplicate": true}). Responde 202 enseguida y procesa después de responder.
import { after, type NextRequest } from "next/server";
import { enviarPendientes, guardarMensaje, procesarMensaje, registrarRechazo } from "@/lib/vendario";
import { contabilizarEvento } from "@/lib/vendario-registro";
import { clavesDe, verificar } from "@/lib/vendario-firma";
import { leerSobre } from "@/lib/vendario-sobre";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (cuerpo: unknown, status: number) => Response.json(cuerpo, { status });
const ipDe = (req: NextRequest) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

export async function POST(req: NextRequest) {
  const cuerpo = await req.text();
  const v = verificar(req.headers.get("x-signature"), cuerpo, clavesDe(process.env.V2E_SECRET));
  if (!v.ok) {
    const motivo = { sin_clave: "Falta V2E_SECRET en el servidor", sin_firma: "Sin firma X-Signature", hora: "Hora fuera de los 5 minutos", firma: "La firma no coincide" }[v.motivo];
    await registrarRechazo({ codigo: 401, motivo, ip: ipDe(req), largo: cuerpo.length }).catch(() => {});
    return json({ error: v.motivo === "hora" ? "EXPIRED_SIGNATURE" : "INVALID_SIGNATURE" }, 401);
  }
  const l = leerSobre(cuerpo);
  if (!l.ok) {
    await registrarRechazo({ codigo: 422, motivo: l.error, ip: ipDe(req), largo: cuerpo.length }).catch(() => {});
    return json({ error: l.error }, 422);
  }
  let nuevo: boolean;
  try {
    nuevo = await guardarMensaje(l.sobre, cuerpo);
  } catch (e) {
    console.error("vendario inbox", (e as Error).message);
    return json({ error: "FAILED" }, 500); // falla temporal: Vendario reintenta
  }
  if (!nuevo) return json({ duplicate: true }, 200);
  after(async () => {
    await procesarMensaje(l.sobre.id).catch((e) => console.error("vendario procesar", (e as Error).message));
    if (l.sobre.type === "accounting.event") await contabilizarEvento(l.sobre.id).catch((e) => console.error("vendario contabilizar", (e as Error).message));
    await enviarPendientes().catch((e) => console.error("vendario enviar", (e as Error).message));
  });
  return json({ received: true, id: l.sobre.id }, 202);
}
