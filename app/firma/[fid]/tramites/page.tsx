import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { conEmpresa, db } from "@/lib/db";
import { laborablesEntre } from "@/lib/dias-laborables";
import { clientesDeFirma, equipoDe } from "@/lib/firma";
import { hoyISO, verFecha } from "@/lib/montos";
import { ETAPAS, feriadosDe, INSTITUCIONES, plantillasDe, resumenTramites } from "@/lib/tramites";
import { agregarFeriadoAccion, crearTramiteAccion, quitarFeriadoAccion } from "../../tramites-acciones";
import { NuevoTramite } from "./nuevo-tramite";

export const metadata = { title: "Trámites abiertos · Empire Tax & Legal" };

// Trámites de todos los clientes (bloque 5a; Prioridad 1.5 del prompt de Patricia): se crean aquí con «+ Nuevo trámite», con su tiempo en
// días laborables, su estado, sus pendientes y su cronología. Los que vencen primero arriba.
export default async function TramitesAbiertos({ params, searchParams }: {
  params: Promise<{ fid: string }>; searchParams: Promise<{ ver?: string; nuevo?: string }>;
}) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  const hoy = hoyISO();
  const todos = sp.ver === "todos";
  const clientes = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => !c.propia);
  const [filas, plantillas, equipo, feriados, listaFeriados] = await Promise.all([
    Promise.all(clientes.map(async (c) => (await conEmpresa(c.id, (tx) => resumenTramites(tx, !todos))).map((t) => ({ c, t })))).then((x) => x.flat()),
    plantillasDe(fid), equipoDe(fid), feriadosDe(fid),
    db()<{ fecha: string; nombre: string }[]>`SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, nombre FROM feriados WHERE firma_id = ${fid} AND fecha >= ${hoy}::date - 31 ORDER BY fecha`,
  ]);
  filas.sort((a, b) => (a.t.estado === b.t.estado ? a.t.plazo.localeCompare(b.t.plazo) : a.t.estado === "abierto" ? -1 : 1));
  const abiertos = filas.filter((f) => f.t.estado === "abierto");
  const vencidos = abiertos.filter((f) => f.t.plazo < hoy).length;
  const faltan = (hasta: string) => {
    const n = laborablesEntre(hoy, hasta, feriados);
    return n < 0 ? `venció hace ${-n} día${n === -1 ? "" : "s"} laborable${n === -1 ? "" : "s"}` : n === 0 ? "vence hoy" : `faltan ${n} día${n === 1 ? "" : "s"} laborable${n === 1 ? "" : "s"}`;
  };

  return (
    <>
      <div className="entre">
        <div>
          <h1>Trámites abiertos</h1>
          <p className="sub">
            Cada trámite con su cliente, su tiempo en días laborables (lunes a viernes, sin feriados), su estado, sus pendientes y sus notas. Avisa en
            Alertas antes del plazo, cuando termina la espera y cuando toca un paso.{" "}
            {abiertos.length ? `${abiertos.length} abierto${abiertos.length > 1 ? "s" : ""}${vencidos ? `, ${vencidos} vencido${vencidos > 1 ? "s" : ""}` : ""}.` : "No hay trámites abiertos."}
          </p>
        </div>
        <Link className="boton" href={`/firma/${fid}/tramites${todos ? "" : "?ver=todos"}`}>{todos ? "Solo los abiertos" : "Ver también los completados"}</Link>
      </div>

      <details className="tarjeta" style={{ marginBottom: 16 }} open={sp.nuevo === "1" || undefined}>
        <summary><strong>+ Nuevo trámite</strong></summary>
        <div style={{ marginTop: 12 }}>
          <NuevoTramite accion={crearTramiteAccion.bind(null, fid)} plantillas={plantillas} clientes={clientes.map((c) => ({ id: c.id, nombre: c.nombre }))}
            equipo={equipo} instituciones={INSTITUCIONES} etapas={ETAPAS} crearClientes={firma.crear_clientes} hoy={hoy} />
        </div>
      </details>

      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Trámite</th><th>Cliente</th><th>Estado</th><th>Plazo</th><th>Pendientes</th><th>Responsable</th></tr></thead>
          <tbody>
            {filas.map(({ c, t }) => {
              const urgente = t.estado === "abierto" && laborablesEntre(hoy, t.plazo, feriados) <= 2;
              return (
                <tr key={t.id}>
                  <td>
                    <Link href={`/firma/${fid}/tramites/${c.id}/${t.id}`}><strong>{t.tipo}</strong></Link>
                    <div className="sub" style={{ margin: 0 }}>{t.institucion !== "otra" && `${INSTITUCIONES[t.institucion]} · `}desde el {verFecha(t.fecha)}{t.numero && ` · n.º ${t.numero}`}</div>
                  </td>
                  <td>{c.nombre}</td>
                  <td>
                    {ETAPAS[t.etapa]}
                    {t.etapa === "en_espera" && t.espera_motivo && <div className="sub" style={{ margin: 0 }}>{t.espera_motivo}{t.espera_hasta && ` · hasta el ${verFecha(t.espera_hasta)}`}</div>}
                  </td>
                  <td style={urgente ? { color: "var(--peligro)", fontWeight: 600 } : undefined}>
                    {verFecha(t.plazo)}{t.estado === "abierto" && <div className="sub" style={{ margin: 0, color: "inherit" }}>{faltan(t.plazo)}</div>}
                  </td>
                  <td>
                    {t.pendientes ? `${t.hechos} de ${t.pendientes} hechos` : <span className="sub">—</span>}
                    {t.proximo && <div className="sub" style={{ margin: 0 }}>Sigue: {t.proximo}{t.proximo_vence && ` (${verFecha(t.proximo_vence)})`}</div>}
                  </td>
                  <td>{t.responsable ?? "—"}</td>
                </tr>
              );
            })}
            {filas.length === 0 && <tr><td colSpan={6}>{todos ? "No hay trámites." : "No hay trámites abiertos."} Crea uno con «+ Nuevo trámite».</td></tr>}
          </tbody>
        </table>
      </div>

      {firma.administrador && (
        <details className="tarjeta" style={{ marginTop: 16 }}>
          <summary><strong>Feriados</strong> · para contar los días laborables</summary>
          <p className="sub">Vienen los de 2026 según el calendario del Ministerio de Trabajo (Ley 139-97, con los traslados). Agrega los de 2027 cuando se publiquen.</p>
          <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
            {listaFeriados.map((f) => (
              <li key={f.fecha} className="fila" style={{ alignItems: "center", gap: 8 }}>
                <span>{verFecha(f.fecha)} · {f.nombre}</span>
                <Formulario accion={quitarFeriadoAccion.bind(null, fid, f.fecha)} boton="Quitar" className="fila boton-chico"><></></Formulario>
              </li>
            ))}
          </ul>
          <Formulario accion={agregarFeriadoAccion.bind(null, fid)} boton="Agregar feriado" className="fila">
            <label>Fecha<input type="date" name="fecha" required /></label>
            <label style={{ flex: "2 1 240px" }}>Nombre<input name="nombre" required maxLength={120} placeholder="Ej.: Año Nuevo" /></label>
          </Formulario>
        </details>
      )}
    </>
  );
}
