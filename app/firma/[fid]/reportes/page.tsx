import Link from "next/link";
import { notFound } from "next/navigation";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { moverMes, nombreMes } from "@/lib/bitacora";
import { conEmpresa } from "@/lib/db";
import { clientesDeFirma } from "@/lib/firma";
import { hoyISO } from "@/lib/montos";
import { ESTADOS_REPORTE } from "@/lib/reporte-mensual";

export const metadata = { title: "Reportes del mes · Empire Tax’N Legal" };

const fechaHora = (d: Date | null) => d?.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" }) ?? "";

// Reportes del mes (bloque 4b): en qué paso va el reporte mensual de cada cliente (en preparación, revisado, aprobado, enviado).
export default async function ReportesDelMes({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ mes?: string }> }) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes ?? "") ? sp.mes! : moverMes(hoyISO().slice(0, 7), -1);
  const periodo = mes.replace("-", "");
  const clientes = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => c.activa && !c.propia);
  const filas = await Promise.all(clientes.map(async (c) => {
    const [r] = await conEmpresa(c.id, (tx) => tx<{ estado: string; aprobado_en: Date | null; enviado_en: Date | null; quien: string | null }[]>`
      SELECT m.estado, m.aprobado_en, m.enviado_en, u.nombre AS quien FROM reportes_mensuales m LEFT JOIN usuarios u ON u.id = m.aprobado_por
       WHERE m.periodo = ${periodo}`);
    return { c, r };
  }));
  const cuenta = (e: string) => filas.filter((f) => (f.r?.estado ?? "borrador") === e).length;

  return (
    <>
      <h1>Reportes del mes</h1>
      <p className="sub">
        El reporte mensual de cada cliente de {nombreMes(mes)}: la coordinadora lo prepara, la socia o la contadora lo revisa, Patricia lo
        aprueba y sale por WhatsApp con la factura del mes. {Object.entries(ESTADOS_REPORTE).map(([k, v]) => `${v}: ${cuenta(k)}`).join(" · ")}.
      </p>
      <nav className="fila" style={{ marginBottom: 12, alignItems: "center" }} aria-label="Mes">
        <Link className="boton" href={`/firma/${fid}/reportes?mes=${moverMes(mes, -1)}`}>← {nombreMes(moverMes(mes, -1))}</Link>
        <strong style={{ textTransform: "capitalize" }}>{nombreMes(mes)}</strong>
        <Link className="boton" href={`/firma/${fid}/reportes?mes=${moverMes(mes, 1)}`}>{nombreMes(moverMes(mes, 1))} →</Link>
      </nav>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cliente</th><th>Responsable</th><th>Estado</th><th>Aprobado</th><th>Enviado</th></tr></thead>
          <tbody>
            {filas.map(({ c, r }) => (
              <tr key={c.id}>
                <td><Link href={`/e/${c.id}/bitacora/reporte?mes=${mes}`}>{c.nombre}</Link></td>
                <td>{c.responsable ?? "—"}</td>
                <td>{ESTADOS_REPORTE[r?.estado ?? "borrador"]}</td>
                <td>{r?.aprobado_en ? `${fechaHora(r.aprobado_en)}${r.quien ? ` · ${r.quien}` : ""}` : ""}</td>
                <td>{fechaHora(r?.enviado_en ?? null)}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={5}>No hay clientes activos.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
