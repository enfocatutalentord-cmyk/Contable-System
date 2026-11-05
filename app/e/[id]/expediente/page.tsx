import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { EnviarWhatsApp } from "@/app/whatsapp";
import { accesoEmpresa, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { CARPETAS, listarExpediente } from "@/lib/expediente";
import { equipoDe } from "@/lib/firma";
import { hoyISO, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { AVISO_DIAS, diasEntre, ESTADOS_PASO, INSTITUCIONES, listarPasos, listarTramites, PASOS, PLAZO_DIAS, sumarDias, TIPOS_TRAMITE } from "@/lib/tramites";
import { abrirConstitucionAccion, cerrarTramiteAccion, guardarPaso, registrarTramite, retirarDocumento, subirExpediente } from "../expediente-acciones";

// Expediente digital del cliente (bloque 5a, Documento maestro, sección 5): las seis carpetas del Drive con lo que se sube y lo que el
// sistema genera, los trámites ante instituciones con su plazo y, si es una empresa nueva, la lista de sus 9 pasos.
export default async function Expediente({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ ver?: string; carpeta?: string; anio?: string; q?: string; retirados?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa, permisos, usuario } = await accesoEmpresa(id);
  const ver = ["tramites", "empresa-nueva"].includes(sp.ver ?? "") ? sp.ver! : "carpetas";
  const retirados = sp.retirados === "1";
  const hoy = hoyISO();
  const { elementos, tramites, pasos, enConstitucion, recibidos } = await conEmpresa(id, async (tx) => ({
    elementos: await listarExpediente(tx, id, retirados),
    tramites: await listarTramites(tx),
    pasos: await listarPasos(tx),
    enConstitucion: (await tx<{ en: boolean }[]>`SELECT en_constitucion AS en FROM empresas WHERE id = ${id}`)[0]?.en ?? false,
    recibidos: (await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM recepciones`)[0].n,
  }));
  const equipo = await equipoDe(empresa.firma_id);
  const deLaFirma = !(await soloCliente(empresa.firma_id, usuario.id));
  const carpeta = sp.carpeta && sp.carpeta in CARPETAS ? sp.carpeta : "";
  const q = (sp.q ?? "").trim().toLowerCase();
  const anio = /^\d{4}$/.test(sp.anio ?? "") ? Number(sp.anio) : null;
  const filtrados = elementos.filter((e) => (!carpeta || e.carpeta === carpeta) && (!anio || e.anio === anio)
    && (!q || `${e.titulo} ${e.detalle ?? ""}`.toLowerCase().includes(q)));
  const anios = [...new Set(elementos.map((e) => e.anio).filter((x): x is number => !!x))].sort((a, b) => b - a);
  const cuenta = (c: string) => elementos.filter((e) => e.carpeta === c).length;
  const abiertos = tramites.filter((t) => t.estado === "abierto");
  const enlace = (extra: Record<string, string>) => `/e/${id}/expediente?${new URLSearchParams({ ver, ...(carpeta ? { carpeta } : {}), ...extra })}`;
  const sube = puede(permisos, "adjuntar"), registra = puede(permisos, "registrar");

  return (
    <>
      <h1>Expediente</h1>
      <p className="sub">Todo lo de {empresa.nombre} en un solo lugar, con la misma estructura de carpetas del Drive. Lo que el sistema genera aparece solo.</p>
      <nav className="fila" style={{ marginBottom: 12 }} aria-label="Secciones">
        <Link className={`boton${ver === "carpetas" ? " primario" : ""}`} href={`/e/${id}/expediente`}>Carpetas</Link>
        <Link className={`boton${ver === "tramites" ? " primario" : ""}`} href={`/e/${id}/expediente?ver=tramites`}>Trámites ({abiertos.length} abiertos)</Link>
        <Link className={`boton${ver === "empresa-nueva" ? " primario" : ""}`} href={`/e/${id}/expediente?ver=empresa-nueva`}>Empresa nueva</Link>
      </nav>

      {ver === "carpetas" && (
        <>
          <div className="carpetas-expediente">
            <Link className={`tarjeta carpeta${!carpeta ? " elegida" : ""}`} href={`/e/${id}/expediente`}><strong>Todas</strong><span>{elementos.length} documentos</span></Link>
            {Object.entries(CARPETAS).map(([k, c]) => (
              <Link key={k} className={`tarjeta carpeta${carpeta === k ? " elegida" : ""}`} href={`/e/${id}/expediente?carpeta=${k}`} title={c.contenido}>
                <strong>{k} {c.nombre}</strong><span>{cuenta(k)} documento{cuenta(k) === 1 ? "" : "s"}</span>
              </Link>
            ))}
            <Link className="tarjeta carpeta" href={`/e/${id}/recepcion`}><strong>Documentos del cliente</strong><span>{recibidos} recibidos</span></Link>
          </div>
          {carpeta && <p className="sub">{CARPETAS[carpeta].contenido}.</p>}

          {sube && !retirados && (
            <details className="tarjeta" style={{ marginBottom: 12 }} open={elementos.length === 0}>
              <summary><strong>Subir documentos</strong></summary>
              <Formulario accion={subirExpediente.bind(null, id)} boton="Guardar en el expediente" className="fila">
                <label>Carpeta
                  <select name="carpeta" defaultValue={carpeta || "01"}>{Object.entries(CARPETAS).map(([k, c]) => <option key={k} value={k}>{k} {c.nombre}</option>)}</select>
                </label>
                <label style={{ width: 110 }}>Año<input name="anio" inputMode="numeric" maxLength={4} placeholder={hoy.slice(0, 4)} /></label>
                <label style={{ flex: "1 1 240px" }}>Descripción<input name="descripcion" maxLength={300} placeholder="Ej.: Registro mercantil 2026" /></label>
                <label style={{ flex: "1 1 260px" }}>Archivos (PDF, JPG, PNG, Word o Excel; hasta 10 y 4 MB en total)
                  <input type="file" name="archivos" multiple required accept="application/pdf,image/jpeg,image/png,.docx,.xlsx" />
                </label>
              </Formulario>
            </details>
          )}

          <form className="fila" style={{ marginBottom: 12 }}>
            {carpeta && <input type="hidden" name="carpeta" value={carpeta} />}
            {retirados && <input type="hidden" name="retirados" value="1" />}
            <label style={{ flex: "1 1 240px" }}>Buscar<input name="q" defaultValue={sp.q} placeholder="Nombre o descripción" /></label>
            <label>Año<select name="anio" defaultValue={anio ?? ""}><option value="">Todos</option>{anios.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
            <button>Ver</button>
            <Link className="boton" href={enlace(retirados ? {} : { retirados: "1" })}>{retirados ? "Ver los vigentes" : "Ver retirados"}</Link>
          </form>

          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Documento</th><th>Carpeta</th><th>Fecha</th><th>Origen</th><th /></tr></thead>
              <tbody>
                {filtrados.map((e) => (
                  <tr key={e.id}>
                    <td><a href={e.enlace} target={e.documentoId ? "_blank" : undefined} rel="noreferrer">{e.titulo}</a>{e.detalle && <div className="sub" style={{ margin: 0 }}>{e.detalle}</div>}</td>
                    <td>{e.carpeta} {CARPETAS[e.carpeta]?.nombre}</td>
                    <td>{verFecha(e.fecha)}{e.anio && e.origen === "subido" ? ` · ${e.anio}` : ""}</td>
                    <td>{e.origen === "sistema" ? "Del sistema" : `Subido${e.quien ? ` por ${e.quien}` : ""}`}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      {e.origen === "subido" && deLaFirma && puede(permisos, "exportar") && !retirados && (
                        <EnviarWhatsApp empresaId={id} clave="documento_listo" docRef={{ tipo: "expediente", id: e.id }} etiqueta="WhatsApp" />
                      )}
                      {e.origen === "subido" && registra && (
                        <Formulario accion={retirarDocumento.bind(null, id, e.id, retirados)} boton={retirados ? "Devolver" : "Retirar"} className="fila"><span /></Formulario>
                      )}
                    </td>
                  </tr>
                ))}
                {filtrados.length === 0 && <tr><td colSpan={5}>{retirados ? "No hay documentos retirados." : "No hay documentos con ese filtro."}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {ver === "tramites" && (
        <>
          {registra && (
            <details className="tarjeta" style={{ marginBottom: 12 }} open={tramites.length === 0}>
              <summary><strong>Registrar un trámite</strong></summary>
              <Formulario accion={registrarTramite.bind(null, id)} boton="Registrar" className="fila">
                <label>Institución<select name="institucion" defaultValue="dgii">{Object.entries(INSTITUCIONES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label style={{ flex: "1 1 240px" }}>Trámite
                  <input name="tipo" list="tipos-tramite" required maxLength={120} placeholder="Ej.: Declaración rectificativa" />
                  <datalist id="tipos-tramite">{[...new Set(Object.values(TIPOS_TRAMITE).flat())].map((t) => <option key={t} value={t} />)}</datalist>
                </label>
                <label style={{ width: 160 }}>N.º de volante<input name="numero" maxLength={60} /></label>
                <label>Fecha<input type="date" name="fecha" defaultValue={hoy} required /></label>
                <label>Respuesta a más tardar<input type="date" name="plazo" defaultValue={sumarDias(hoy, PLAZO_DIAS)} /></label>
                <label>Responsable<select name="responsable" defaultValue={usuario.id}><option value="">—</option>{equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
                <label style={{ flex: "1 1 100%" }}>Descripción<input name="descripcion" maxLength={1000} /></label>
                <label style={{ flex: "1 1 260px" }}>Volante de recepción (opcional)<input type="file" name="volante" multiple accept="application/pdf,image/jpeg,image/png" /></label>
                <p className="sub" style={{ flexBasis: "100%", margin: 0 }}>Si el volante no dice plazo, quedan {PLAZO_DIAS} días. Avisa {AVISO_DIAS} días antes y el día que vence sin respuesta.</p>
              </Formulario>
            </details>
          )}
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Trámite</th><th>Fecha</th><th>Plazo</th><th>Responsable</th><th>Estado</th></tr></thead>
              <tbody>
                {tramites.map((t) => {
                  const faltan = diasEntre(hoy, t.plazo);
                  const urgente = t.estado === "abierto" && faltan <= AVISO_DIAS;
                  return (
                    <tr key={t.id} style={t.estado === "cerrado" ? { opacity: 0.65 } : undefined}>
                      <td>
                        <strong>{INSTITUCIONES[t.institucion]} · {t.tipo}</strong>{t.numero && ` · n.º ${t.numero}`}
                        {t.descripcion && <div className="sub" style={{ margin: 0 }}>{t.descripcion}</div>}
                        {t.volantes.map((v) => <div key={v.id}><a href={`/e/${id}/documentos/${v.id}`} target="_blank" rel="noreferrer">{v.descripcion ?? "Documento"}: {v.nombre}</a></div>)}
                      </td>
                      <td>{verFecha(t.fecha)}</td>
                      <td style={urgente ? { color: "var(--peligro)", fontWeight: 600 } : undefined}>
                        {verFecha(t.plazo)}{t.estado === "abierto" && <div className="sub" style={{ margin: 0, color: "inherit" }}>{faltan < 0 ? `venció hace ${-faltan} día${faltan === -1 ? "" : "s"}` : faltan === 0 ? "vence hoy" : `faltan ${faltan} día${faltan === 1 ? "" : "s"}`}</div>}
                      </td>
                      <td>{t.responsable ?? "—"}</td>
                      <td style={{ minWidth: 220 }}>
                        {t.estado === "cerrado" ? <>Cerrado{t.respuesta && `: ${t.respuesta}`}</> : registra ? (
                          <Formulario accion={cerrarTramiteAccion.bind(null, id, t.id)} boton="Cerrar con la respuesta" className="fila">
                            <input name="respuesta" maxLength={1000} placeholder="Qué respondieron" aria-label="Respuesta" />
                            <input type="file" name="documento" accept="application/pdf,image/jpeg,image/png" aria-label="Documento de respuesta" />
                          </Formulario>
                        ) : "Abierto"}
                      </td>
                    </tr>
                  );
                })}
                {tramites.length === 0 && <tr><td colSpan={5}>Todavía no hay trámites.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {ver === "empresa-nueva" && (
        !enConstitucion ? (
          <div className="tarjeta">
            <p style={{ marginTop: 0 }}>Si {empresa.nombre} es una empresa en constitución, abre la lista de los 9 pasos del manual: cada uno con estado, fecha, responsable y documento.</p>
            {registra && <Formulario accion={abrirConstitucionAccion.bind(null, id)} boton="Abrir la lista de pasos" className="fila"><span /></Formulario>}
          </div>
        ) : (
          <>
            <p className="sub">
              {pasos.filter((p) => p.estado === "hecho" || p.estado === "no_aplica").length} de {PASOS.length} pasos listos. El documento de cada paso va a
              «01 Documentos legales». El reparto de cuotas de los socios está en la <Link href={`/e/${id}/empresa?seccion=socios`}>ficha</Link>.
            </p>
            <div className="tabla-envoltura">
              <table>
                <thead><tr><th>Paso</th><th>Estado y datos</th></tr></thead>
                <tbody>
                  {pasos.map((p) => (
                    <tr key={p.paso}>
                      <td style={{ minWidth: 240 }}>
                        <strong>{p.paso}. {PASOS[p.paso - 1]}</strong>
                        <div className="sub" style={{ margin: 0 }}>{ESTADOS_PASO[p.estado]}{p.fecha && ` · ${verFecha(p.fecha)}`}{p.responsable && ` · ${p.responsable}`}</div>
                        {p.documento_id && <div><a href={`/e/${id}/documentos/${p.documento_id}`} target="_blank" rel="noreferrer">{p.documento}</a></div>}
                      </td>
                      <td>
                        {registra ? (
                          <Formulario accion={guardarPaso.bind(null, id, p.paso)} boton="Guardar" className="fila">
                            <select name="estado" defaultValue={p.estado} aria-label="Estado">{Object.entries(ESTADOS_PASO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                            <input type="date" name="fecha" defaultValue={p.fecha ?? ""} aria-label="Fecha" />
                            <select name="responsable" defaultValue={p.responsable_id ?? ""} aria-label="Responsable"><option value="">—</option>{equipo.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
                            <input name="nota" defaultValue={p.nota ?? ""} maxLength={500} placeholder="Nota" aria-label="Nota" />
                            <input type="file" name="documento" accept="application/pdf,image/jpeg,image/png,.docx" aria-label="Documento" />
                          </Formulario>
                        ) : p.nota}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </>
  );
}
