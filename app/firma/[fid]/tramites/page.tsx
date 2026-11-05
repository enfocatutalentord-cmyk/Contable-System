import Link from "next/link";
import { notFound } from "next/navigation";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { clientesDeFirma } from "@/lib/firma";
import { hoyISO, verFecha } from "@/lib/montos";
import { AVISO_DIAS, diasEntre, INSTITUCIONES, listarTramites } from "@/lib/tramites";

export const metadata = { title: "Trámites abiertos · Empire Tax’N Legal" };

// Trámites abiertos de todos los clientes (bloque 5a, Fase 2, sección 7): los que vencen primero arriba, con los días que faltan.
export default async function TramitesAbiertos({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  const hoy = hoyISO();
  const clientes = await clientesDeFirma(fid, usuario.id, firma.administrador);
  const filas = (await Promise.all(clientes.map(async (c) => (await conEmpresa(c.id, (tx) => listarTramites(tx, true))).map((t) => ({ c, t })))))
    .flat().sort((a, b) => a.t.plazo.localeCompare(b.t.plazo));
  const vencidos = filas.filter((f) => f.t.plazo < hoy).length;

  return (
    <>
      <h1>Trámites abiertos</h1>
      <p className="sub">
        Trámites ante la DGII, la TSS, la Cámara de Comercio u ONAPI esperando respuesta. Avisan {AVISO_DIAS} días antes del plazo y el día que vence.
        {" "}{filas.length ? `${filas.length} abierto${filas.length > 1 ? "s" : ""}${vencidos ? `, ${vencidos} vencido${vencidos > 1 ? "s" : ""}` : ""}.` : "No hay trámites abiertos."}
      </p>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cliente</th><th>Trámite</th><th>Fecha</th><th>Plazo</th><th>Responsable</th></tr></thead>
          <tbody>
            {filas.map(({ c, t }) => {
              const faltan = diasEntre(hoy, t.plazo);
              return (
                <tr key={t.id}>
                  <td><Link href={`/e/${c.id}/expediente?ver=tramites`}>{c.nombre}</Link></td>
                  <td>{INSTITUCIONES[t.institucion]} · {t.tipo}{t.numero && ` · n.º ${t.numero}`}</td>
                  <td>{verFecha(t.fecha)}</td>
                  <td style={faltan <= AVISO_DIAS ? { color: "var(--peligro)", fontWeight: 600 } : undefined}>
                    {verFecha(t.plazo)} · {faltan < 0 ? `venció hace ${-faltan} día${faltan === -1 ? "" : "s"}` : faltan === 0 ? "vence hoy" : `faltan ${faltan} día${faltan === 1 ? "" : "s"}`}
                  </td>
                  <td>{t.responsable ?? "—"}</td>
                </tr>
              );
            })}
            {filas.length === 0 && <tr><td colSpan={5}>No hay trámites abiertos.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
