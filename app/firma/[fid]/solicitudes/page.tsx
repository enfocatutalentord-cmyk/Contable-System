import Link from "next/link";
import { notFound } from "next/navigation";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { clientesDeFirma } from "@/lib/firma";
import { ESTADOS_SOLICITUD, listarSolicitudes, ORIGENES_SOLICITUD, PRIORIDADES, TIPOS_FORMULARIO } from "@/lib/formularios";
import { hoyISO, verFecha } from "@/lib/montos";

export const metadata = { title: "Solicitudes · Empire Tax’N Legal" };

// Solicitudes abiertas y formularios por revisar de todos los clientes (bloque 6a): lo más urgente arriba.
export default async function SolicitudesDeLaFirma({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  const hoy = hoyISO();
  const clientes = await clientesDeFirma(fid, usuario.id, firma.administrador);
  const datos = await Promise.all(clientes.map((c) => conEmpresa(c.id, async (tx) => ({
    c,
    solicitudes: await listarSolicitudes(tx, true),
    formularios: await tx<{ id: string; tipo: string; recibido_en: Date }[]>`SELECT id, tipo, recibido_en FROM formularios WHERE estado = 'recibido' ORDER BY recibido_en`,
  }))));
  const solicitudes = datos.flatMap((d) => d.solicitudes.map((s) => ({ c: d.c, s })));
  const formularios = datos.flatMap((d) => d.formularios.map((f) => ({ c: d.c, f })));

  return (
    <>
      <h1>Solicitudes</h1>
      <p className="sub">Lo que piden los clientes y los formularios que mandaron y esperan revisión. Al aceptarlos, sus datos entran a la ficha.</p>
      {formularios.length > 0 && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Formularios por revisar ({formularios.length})</h2>
          <ul>{formularios.map(({ c, f }) => (
            <li key={f.id}><Link href={`/e/${c.id}/solicitudes`}>{c.nombre}: {TIPOS_FORMULARIO[f.tipo].nombre}</Link> · recibido el {f.recibido_en.toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo" })}</li>
          ))}</ul>
        </div>
      )}
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cliente</th><th>Solicitud</th><th>Para cuándo</th><th>Prioridad</th><th>Estado</th><th>Responsable</th></tr></thead>
          <tbody>
            {solicitudes.map(({ c, s }) => (
              <tr key={s.id}>
                <td><Link href={`/e/${c.id}/solicitudes`}>{c.nombre}</Link></td>
                <td>{s.servicio && <strong>{s.servicio}: </strong>}{s.descripcion}<div className="sub" style={{ margin: 0 }}>{ORIGENES_SOLICITUD[s.origen]}</div></td>
                <td style={s.fecha_requerida && s.fecha_requerida < hoy ? { color: "var(--peligro)", fontWeight: 600 } : undefined}>{s.fecha_requerida ? verFecha(s.fecha_requerida) : "—"}</td>
                <td>{PRIORIDADES[s.prioridad]}</td>
                <td>{ESTADOS_SOLICITUD[s.estado]}</td>
                <td>{s.responsable ?? "—"}</td>
              </tr>
            ))}
            {solicitudes.length === 0 && <tr><td colSpan={6}>No hay solicitudes abiertas.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
