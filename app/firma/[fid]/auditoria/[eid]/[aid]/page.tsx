import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, accesoFirma, esUuid, soloCliente } from "@/lib/acceso";
import {
  camposFaltantes, CAMPOS_HALLAZGO, detalleAuditoria, ESTADOS, ESTADOS_HALLAZGO, ESTADOS_PASO, RIESGOS, TRANSICIONES, type Evidencia,
} from "@/lib/auditorias";
import { conEmpresa } from "@/lib/db";
import { equipoDe } from "@/lib/firma";
import { verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { verTamano } from "@/lib/documentos";
import {
  agregarPasosAccion, agregarPruebasAccion, agregarPruebasHallazgoAccion, cambiarEstadoAuditoriaAccion, estadoHallazgoAccion, guardarAuditoriaAccion,
  guardarHallazgoAccion, marcarPasoAccion, quitarPasoAccion, retirarPruebaAccion,
} from "../../../../auditoria-acciones";
import { CamposHallazgo, CamposPlan } from "../../campos";

export const metadata = { title: "Auditoría · Empire Tax & Legal" };

const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" });
const color = (riesgo: string) => (riesgo === "alto" ? "var(--peligro)" : riesgo === "medio" ? "var(--dorado-texto, #8a6424)" : "var(--ok)");

// Una auditoría: su plan, los pasos que se marcan y los hallazgos con sus pruebas. Solo el equipo de la firma con acceso al cliente.
export default async function Auditoria({ params, searchParams }: {
  params: Promise<{ fid: string; eid: string; aid: string }>; searchParams: Promise<{ creada?: string }>;
}) {
  const { fid, eid, aid } = await params;
  const sp = await searchParams;
  if (!esUuid(eid) || !esUuid(aid)) notFound();
  const { usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  const { empresa, permisos } = await accesoEmpresa(eid);
  if (empresa.firma_id !== fid) notFound();
  const [a, equipo] = await Promise.all([conEmpresa(eid, (tx) => detalleAuditoria(tx, aid)), equipoDe(fid)]);
  if (!a) notFound();

  const cerrada = a.estado === "cerrada";
  const edita = puede(permisos, "registrar") && !cerrada;
  const adjunta = puede(permisos, "adjuntar") && !cerrada;
  const hechos = a.pasos.filter((p) => p.estado !== "pendiente").length;
  const abiertos = a.hallazgos.filter((h) => h.estado === "abierto" || h.estado === "en_seguimiento");
  const altos = abiertos.filter((h) => h.riesgo === "alto").length;
  const archivo = (e: Evidencia) => `/e/${eid}/documentos/${e.id}`;
  const lista = (ev: Evidencia[]) => ev.length === 0 ? null : (
    <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "flex", flexWrap: "wrap", gap: 10 }}>
      {ev.map((e) => (
        <li key={e.id} style={{ maxWidth: 180 }}>
          <a href={archivo(e)} target="_blank" rel="noreferrer">
            {e.tipo.startsWith("image/") ? <img src={archivo(e)} alt={e.nombre} style={{ maxWidth: 160, maxHeight: 110, display: "block", borderRadius: 6, border: "1px solid var(--borde)" }} /> : null}
            <span style={{ fontSize: "0.85rem", wordBreak: "break-word" }}>{e.nombre}</span>
          </a>
          <div className="sub" style={{ margin: 0 }}>{verTamano(e.tamano)}</div>
          {adjunta && <Formulario accion={retirarPruebaAccion.bind(null, fid, eid, aid, e.id)} boton="Retirar" className="fila boton-chico"><></></Formulario>}
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <p><Link href={`/firma/${fid}/auditoria`}>← Auditoría</Link></p>
      {sp.creada && <p className="exito">Auditoría creada. Agrega los pasos del plan y, al encontrar algo, un hallazgo con su foto o archivo de prueba.</p>}
      <div className="entre">
        <div>
          <h1>{a.nombre}</h1>
          <p className="sub">
            {empresa.nombre} · auditoría n.º {a.numero} · {a.responsable ? `responsable: ${a.responsable}` : "sin responsable"}
            {a.equipo_nombres.length > 0 && ` · equipo: ${a.equipo_nombres.join(", ")}`}
          </p>
        </div>
      </div>

      <div className="cifras">
        <div className="tarjeta cifra"><div className="etiqueta">Estado</div><div className="valor" style={{ fontSize: "1.2rem" }}>{ESTADOS[a.estado]}</div>
          {cerrada && a.cerrada_en && <div className="sub">{a.cerrada_por ? `por ${a.cerrada_por} · ` : ""}{fechaHora(a.cerrada_en)}</div>}</div>
        <div className="tarjeta cifra"><div className="etiqueta">Pasos</div><div className="valor" style={{ fontSize: "1.2rem" }}>{hechos} de {a.pasos.length}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Hallazgos abiertos</div><div className="valor" style={{ fontSize: "1.2rem" }}>{abiertos.length} de {a.hallazgos.length}</div>
          {altos > 0 && <div className="sub peligro">{altos} de riesgo alto</div>}</div>
        <div className="tarjeta cifra"><div className="etiqueta">Trabajo</div><div className="valor" style={{ fontSize: "1rem" }}>
          {a.fecha_inicio || a.fecha_fin ? `${a.fecha_inicio ? verFecha(a.fecha_inicio) : "…"} a ${a.fecha_fin ? verFecha(a.fecha_fin) : "…"}` : "Sin fechas"}</div>
          {(a.periodo_desde || a.periodo_hasta) && <div className="sub">Período auditado: {a.periodo_desde ? verFecha(a.periodo_desde) : "…"} a {a.periodo_hasta ? verFecha(a.periodo_hasta) : "…"}</div>}</div>
      </div>

      <div className="tarjeta" style={{ marginBottom: 16 }}>
        <div className="fila" style={{ alignItems: "center", gap: 8 }}>
          <strong>Estado de la auditoría:</strong>
          {TRANSICIONES[a.estado].map((s) => {
            const puedeEsto = s === "cerrada" ? puede(permisos, "cerrar") : cerrada ? puede(permisos, "reabrir") : puede(permisos, "registrar");
            if (!puedeEsto) return null;
            const nombre = s === "cerrada" ? "Cerrar la auditoría" : cerrada ? "Reabrir (vuelve a «En informe»)" : `Pasar a «${ESTADOS[s]}»`;
            return <Formulario key={s} accion={cambiarEstadoAuditoriaAccion.bind(null, fid, eid, aid, s)} boton={nombre} className="fila"><></></Formulario>;
          })}
        </div>
        <p className="sub" style={{ marginBottom: 0 }}>Para cerrarla no pueden quedar pasos pendientes ni hallazgos con campos vacíos. Cerrada, no se cambia nada hasta reabrirla.</p>
      </div>

      <section className="tarjeta" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Plan</h2>
        <p style={{ whiteSpace: "pre-wrap" }}><strong>Objetivo.</strong> {a.objetivo || <span className="sub">Sin escribir.</span>}</p>
        <p style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}><strong>Alcance.</strong> {a.alcance || <span className="sub">Sin escribir.</span>}</p>
        {edita && (
          <details style={{ marginTop: 12 }}>
            <summary><strong>Cambiar el plan</strong></summary>
            <div style={{ marginTop: 10 }}>
              <Formulario accion={guardarAuditoriaAccion.bind(null, fid, eid, aid)} boton="Guardar el plan"><CamposPlan equipo={equipo} valores={a} /></Formulario>
            </div>
          </details>
        )}
      </section>

      <section className="tarjeta" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Pasos del plan</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px", display: "grid", gap: 10 }}>
          {a.pasos.map((p) => (
            <li key={p.id} style={{ borderLeft: `3px solid ${p.estado === "hecho" ? "var(--ok)" : p.estado === "no_aplica" ? "var(--borde)" : "var(--dorado)"}`, paddingLeft: 10 }}>
              <div style={p.estado === "pendiente" ? undefined : { color: "var(--suave)" }}>
                <strong>{p.estado === "hecho" ? "✓ " : p.estado === "no_aplica" ? "— " : ""}{p.descripcion}</strong>
                <span className="sub"> · {ESTADOS_PASO[p.estado]}{p.responsable && ` · ${p.responsable}`}{p.quien && p.hecho_en && ` · ${p.quien}, ${fechaHora(p.hecho_en)}`}</span>
              </div>
              {p.nota && <div className="sub" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{p.nota}</div>}
              {edita && (
                <Formulario accion={marcarPasoAccion.bind(null, fid, eid, aid, p.id)} boton="Guardar" className="fila">
                  <label style={{ width: 150 }}>Estado
                    <select name="estado" defaultValue={p.estado}>{Object.entries(ESTADOS_PASO).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
                  </label>
                  <label style={{ flex: "3 1 240px" }}>Nota (obligatoria si «No aplica»)<input name="nota" maxLength={1000} defaultValue={p.nota} /></label>
                </Formulario>
              )}
              {edita && p.estado === "pendiente" && <Formulario accion={quitarPasoAccion.bind(null, fid, eid, aid, p.id)} boton="Quitar el paso" className="fila boton-chico"><></></Formulario>}
            </li>
          ))}
          {a.pasos.length === 0 && <li className="sub">Todavía no hay pasos.</li>}
        </ul>
        {edita && (
          <Formulario accion={agregarPasosAccion.bind(null, fid, eid, aid)} boton="Agregar pasos">
            <label>Pasos nuevos (uno por línea)<textarea name="pasos" rows={3} required /></label>
            <label style={{ maxWidth: 280 }}>Responsable (opcional)
              <select name="responsable" defaultValue=""><option value="">Sin asignar</option>{equipo.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select>
            </label>
          </Formulario>
        )}
      </section>

      <section style={{ marginBottom: 16 }}>
        <h2>Hallazgos</h2>
        {a.hallazgos.map((h) => {
          const faltan = camposFaltantes(h);
          return (
            <article key={h.id} id={`h-${h.id}`} className="tarjeta" style={{ marginBottom: 12, borderLeft: `4px solid ${color(h.riesgo)}` }}>
              <div className="entre">
                <h3 style={{ margin: 0 }}>n.º {h.numero} · {h.titulo}</h3>
                <span><strong style={{ color: color(h.riesgo) }}>Riesgo {RIESGOS[h.riesgo].toLowerCase()}</strong> · {ESTADOS_HALLAZGO[h.estado]}</span>
              </div>
              {h.paso && <div className="sub" style={{ margin: 0 }}>Paso del plan: {h.paso}</div>}
              {faltan.length > 0 && <p className="aviso" style={{ margin: "8px 0" }}>Falta escribir: {faltan.join(", ")}.</p>}
              <dl style={{ margin: "8px 0", display: "grid", gap: 8 }}>
                {CAMPOS_HALLAZGO.map((c) => h[c.clave].trim() && (
                  <div key={c.clave}><dt style={{ fontWeight: 600 }}>{c.nombre}</dt><dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{h[c.clave]}</dd></div>
                ))}
                {h.respuesta && <div><dt style={{ fontWeight: 600 }}>Respuesta o cierre</dt><dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{h.respuesta}</dd></div>}
              </dl>
              {lista(h.evidencias)}
              {edita && (
                <>
                  <details style={{ marginTop: 10 }}>
                    <summary><strong>Estado y respuesta</strong></summary>
                    <Formulario accion={estadoHallazgoAccion.bind(null, fid, eid, aid, h.id)} boton="Guardar">
                      <div className="fila">
                        <label style={{ width: 200 }}>Estado
                          <select name="estado" defaultValue={h.estado}>{Object.entries(ESTADOS_HALLAZGO).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
                        </label>
                        <label style={{ flex: "3 1 280px" }}>Respuesta del cliente, o cómo se resolvió (obligatoria si queda resuelto o aceptado)<textarea name="respuesta" rows={2} maxLength={2000} defaultValue={h.respuesta} /></label>
                      </div>
                    </Formulario>
                  </details>
                  <details style={{ marginTop: 6 }}>
                    <summary><strong>Corregir el hallazgo</strong></summary>
                    <div style={{ marginTop: 10 }}>
                      <Formulario accion={guardarHallazgoAccion.bind(null, fid, eid, aid, h.id)} boton="Guardar el hallazgo">
                        <CamposHallazgo pasos={a.pasos} valores={h} />
                      </Formulario>
                    </div>
                  </details>
                </>
              )}
              {adjunta && (
                <details style={{ marginTop: 6 }}>
                  <summary><strong>Agregar fotos o archivos de prueba</strong></summary>
                  <Formulario accion={agregarPruebasHallazgoAccion.bind(null, fid, eid, aid, h.id)} boton="Subir">
                    <label>Archivos (hasta 5 y 4 MB en total)<input type="file" name="archivo" multiple required accept="image/*,.pdf,.docx,.xlsx" /></label>
                    <label>Qué muestran (opcional)<input name="descripcion" maxLength={120} /></label>
                  </Formulario>
                </details>
              )}
            </article>
          );
        })}
        {a.hallazgos.length === 0 && <p className="sub">Todavía no hay hallazgos.</p>}
        {edita && (
          <details className="tarjeta" open={a.hallazgos.length === 0 || undefined}>
            <summary><strong>+ Nuevo hallazgo</strong></summary>
            <div style={{ marginTop: 10 }}>
              <Formulario accion={guardarHallazgoAccion.bind(null, fid, eid, aid, null)} boton="Guardar el hallazgo"><CamposHallazgo pasos={a.pasos} /></Formulario>
            </div>
          </details>
        )}
      </section>

      <section className="tarjeta">
        <h2 style={{ marginTop: 0 }}>Pruebas de la auditoría</h2>
        <p className="sub">Archivos y fotos que sirven a toda la auditoría (el listado que dio el cliente, una carta de confirmación…). Los de cada hallazgo van en el hallazgo.</p>
        {lista(a.evidencias)}
        {a.evidencias.length === 0 && <p className="sub">Sin archivos.</p>}
        {adjunta && (
          <Formulario accion={agregarPruebasAccion.bind(null, fid, eid, aid)} boton="Subir">
            <label>Archivos (hasta 5 y 4 MB en total)<input type="file" name="archivo" multiple required accept="image/*,.pdf,.docx,.xlsx" /></label>
            <label>Qué son (opcional)<input name="descripcion" maxLength={120} /></label>
          </Formulario>
        )}
      </section>
    </>
  );
}
