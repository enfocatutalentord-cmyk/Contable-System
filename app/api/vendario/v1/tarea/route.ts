// Tarea programada de Vercel (vercel.json › crons, cada 5 minutos): procesa lo que quedó pendiente y manda los estados que tocan
// (reintentos de 1 min, 5 min, 30 min, 2 h, 6 h y 24 h). Vercel la llama con Authorization: Bearer <CRON_SECRET>.
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { enviarPendientes, procesarPendientes } from "@/lib/vendario";
import { contabilizarPendientes } from "@/lib/vendario-registro";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function autorizada(req: NextRequest): boolean {
  const clave = process.env.CRON_SECRET;
  if (!clave) return false;
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${clave}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!autorizada(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const procesados = await procesarPendientes();
  const contabilizados = await contabilizarPendientes({ limite: 200 });
  const envios = await enviarPendientes({ limite: 50 });
  return Response.json({ procesados, contabilizados, ...envios });
}
