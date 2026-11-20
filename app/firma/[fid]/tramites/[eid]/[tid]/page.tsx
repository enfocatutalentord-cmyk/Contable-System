import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, accesoFirma, esUuid } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { laborablesEntre } from "@/lib/dias-laborables";
import { hoyISO, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { detalleTramite, ETAPAS, feriadosDe, INSTITUCIONES } from "@/lib/tramites";
import {
  agregarNotaAccion, agregarPendienteAccion, cambiarEtapaAccion, guardarComoPlantillaAccion, marcarPendienteAccion,
} from "../../../../tramites-acciones";

export const metadata = { title: "Trámite · Empire Tax & Legal" };

const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" });

// Un trámite (Prioridad 1.5 del prompt de Patricia): estado, plazo en días laborables, pendientes que se tachan, la cronología de notas con
// fecha y los documentos. Todo el equipo con acceso al cliente lo ve.
export default async function Tramite({ params, searchParams }: {
  params: Promise<{ fid: string; eid: string; tid: string }>; searchParams: Promise<{ creado?: string }>;
}) {
  const { fid, eid, tid } = await params;
  const sp = await searchParams;
  if (!esUuid(eid) || !esUuid(tid)) notFound();
  await accesoFirma(fid, false);
  const { empresa, permisos } = await accesoEmpresa(eid);
  if (empresa.firma_id !== fid) notFound();
  const [t, feriados] = await Promise.all([conEmpresa(eid, (tx) => detalleTramite(tx, tid)), feriadosDe(fid)]);
  if (!t) notFound();
  const hoy = hoyISO();
  const edita = puede(permisos, "registrar");
  const n = laborablesEntre(hoy, t.plazo, feriados);
  const abierto = t.estado === "abierto";
  const hechos = t.pendientes.filter((p) => p.hecho).length;

  return (
    <>
      <p><Link href={`/firma/${fid}/tramites`}>← Trámites abiertos</Link></p>
      {sp.creado && (
        <p className="exito">
          Trámite creado.{sp.creado === "plantilla" && " Como es la primera vez con este nombre, quedó en la lista con sus pasos y tiempos: la próxima vez solo elígelo."}
        </p>
      )}
      <div className="entre">
        <div>
          <h1>{t.tipo}</h1>
          <p className="sub">
            {empresa.nombre}{t.institucion !== "otra" && ` · ${INSTITUCIONES[t.institucion]}`} · desde el {verFecha(t.fecha)}
            {t.dias_estimados && ` · ${t.dias_estimados} días laborables`} · {t.responsable ? `responsable: ${t.responsable}` : "sin responsable"}
          </p>
        </div>
        {edita && <Formulario accion={guardarComoPlantillaAccion.bind(null, fid, eid, tid)} boton="Guardar como plantilla" className="fila"><></></Formulario>}
      </div>

      <div className="cifras">
        <div className="tarjeta cifra"><div className="etiqueta">Estado</div><div className="valor" style={{ fontSize: "1.2rem" }}>{ETAPAS[t.etapa]}</div>
          {t.etapa === "en_espera" && t.espera_motivo && <div className="sub">{t.espera_motivo}{t.espera_hasta && ` · hasta el ${verFecha(t.espera_hasta)}`}</div>}</div>
        <div className="tarjeta cifra"><div className="etiqueta">Plazo</div><div className="valor" style={{ fontSize: "1.2rem", color: abierto && n <= 2 ? "var(--peligro)" : undefined }}>{verFecha(t.plazo)}</div>
          {abierto && <div className="sub">{n < 0 ? `venció hace ${-n} días laborables` : n === 0 ? "vence hoy" : `faltan ${n} días laborables`}</div>}</div>
        <div className="tarjeta cifra"><div className="etiqueta">Pendientes</div><div className="valor" style={{ fontSize: "1.2rem" }}>{hechos} de {t.pendientes.length}</div></div>
      </div>

      {edita && (
        <details className="tarjeta" style={{ marginBottom: 16 }}>
          <summary><strong>Cambiar el estado</strong></summary>
          <Formulario accion={cambiarEtapaAccion.bind(null, fid, eid, tid)} boton="Guardar el estado">
            <div className="fila">
              <label>Estado
                <select name="etapa" defaultValue={t.etapa === "completado" ? "completado" : t.etapa}>
                  {Object.entries(ETAPAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label style={{ flex: "3 1 260px" }}>Si es «En espera»: motivo<input name="espera_motivo" maxLength={300} placeholder="Ej.: esperando que el cliente mande el correo" /></label>
              <label style={{ width: 150 }}>Días de espera (laborables)<input name="espera_dias" type="number" min={1} max={365} /></label>
            </div>
            <label>Si es «Completado»: respuesta o resultado (opcional)<input name="respuesta" maxLength={1000} /></label>
          </Formulario>
        </details>
      )}

      <div className="inicio-firma">
        <section>
          <h2>Pendientes</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px", display: "grid", gap: 6 }}>
            {t.pendientes.map((p) => (
              <li key={p.id} className="fila" style={{ alignItems: "center", gap: 8 }}>
                {edita && (
                  <Formulario accion={marcarPendienteAccion.bind(null, fid, eid, tid, p.id, !p.hecho)} boton={p.hecho ? "Reabrir" : "Tachar"} className="fila boton-chico"><></></Formulario>
                )}
                <span style={p.hecho ? { textDecoration: "line-through", color: "var(--suave)" } : p.vence && p.vence < hoy ? { color: "var(--peligro)" } : undefined}>
                  {p.texto}
                  {p.vence && <span className="sub"> · {p.hecho ? "" : "toca "}el {verFecha(p.vence)}</span>}
                  {p.hecho && p.quien && p.hecho_en && <span className="sub"> · lo tachó {p.quien} el {fechaHora(p.hecho_en)}</span>}
                </span>
              </li>
            ))}
            {t.pendientes.length === 0 && <li className="sub">Sin pendientes.</li>}
          </ul>
          {edita && (
            <Formulario accion={agregarPendienteAccion.bind(null, fid, eid, tid)} boton="Agregar pendiente" className="fila">
              <label style={{ flex: "3 1 220px" }}>Pendiente<input name="texto" required maxLength={300} placeholder="Ej.: falta la clave de la Oficina Virtual" /></label>
              <label style={{ width: 140 }}>Día laborable (opcional)<input name="dia" type="number" min={0} max={365} /></label>
            </Formulario>
          )}

          <h2 style={{ marginTop: 20 }}>Documentos</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {t.volantes.map((d) => <li key={d.id}><a href={`/e/${eid}/documentos/${d.id}`} target="_blank" rel="noreferrer">{d.nombre}</a>{d.descripcion && <span className="sub"> · {d.descripcion}</span>}</li>)}
            {t.volantes.length === 0 && <li className="sub">Sin documentos. Se adjuntan con una nota.</li>}
          </ul>
        </section>

        <section>
          <h2>Cronología</h2>
          {edita && (
            <Formulario accion={agregarNotaAccion.bind(null, fid, eid, tid)} boton="Agregar nota">
              <div className="fila">
                <label style={{ flex: "3 1 220px" }}>Nota<input name="texto" required maxLength={1000} placeholder="Ej.: falta el correo del representante" /></label>
                <label>Fecha<input type="date" name="fecha" defaultValue={hoy} /></label>
              </div>
              <label>Adjuntar (opcional, hasta 3: PDF, foto, Word o Excel)<input type="file" name="archivo" multiple /></label>
            </Formulario>
          )}
          <ol style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 10 }}>
            {t.notas.map((x) => (
              <li key={x.id} style={{ borderLeft: "3px solid var(--dorado)", paddingLeft: 10 }}>
                <div><strong>{verFecha(x.fecha)}</strong> · {x.texto}</div>
                <div className="sub" style={{ margin: 0 }}>{x.autor} · {fechaHora(x.creado)}</div>
              </li>
            ))}
            {t.notas.length === 0 && <li className="sub">Todavía no hay notas.</li>}
          </ol>
        </section>
      </div>
    </>
  );
}
