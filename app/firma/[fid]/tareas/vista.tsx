import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoFirma } from "@/lib/acceso";
import { moverMes, nombreMes } from "@/lib/bitacora";
import { conUsuario } from "@/lib/db";
import { equipoDe } from "@/lib/firma";
import { hoyISO, verFecha } from "@/lib/montos";
import { ALCANCES, DIAS_SEMANA, generarTareas, listarPlantillas, listarTareas, SECCIONES_TAREA, type SeccionTarea } from "@/lib/tareas";
import { asignarTarea, guardarPlantilla, marcarTareaAccion } from "../../tareas-acciones";

// Tareas del mes (bloque 3b): el cronograma del manual hecho tareas, con responsable y estado. Se generan solas al abrir la
// pantalla para el mes en curso y los siguientes; las de un cliente, al hacerse, quedan en su bitácora.
// Rediseño R2: la misma pantalla en dos lugares. En la Firma, el trabajo a los clientes; en Contabilidad Empire, las de igualas y cobros.
export async function VistaTareas({ fid, sp, seccion }: { fid: string; sp: { mes?: string; mias?: string; editar?: string }; seccion: SeccionTarea }) {
  const { firma, usuario } = await accesoFirma(fid, false);
  const ruta = seccion === "firma" ? `/firma/${fid}/tareas` : `/firma/${fid}/empire/tareas`;
  const hoy = hoyISO();
  const actual = hoy.slice(0, 7);
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes ?? "") ? sp.mes! : actual;
  const { tareas, plantillas, equipo } = await conUsuario(usuario.id, async (tx) => {
    if (mes >= actual) await generarTareas(tx, fid, mes);
    return { tareas: await listarTareas(tx, fid, mes, seccion), plantillas: await listarPlantillas(tx, fid, seccion), equipo: await equipoDe(fid) };
  });
  const mias = sp.mias === "1";
  const visibles = mias ? tareas.filter((t) => t.responsable_id === usuario.id) : tareas;
  const atrasadas = visibles.filter((t) => t.estado === "pendiente" && t.hasta < hoy);
  const deHoy = visibles.filter((t) => t.estado === "pendiente" && t.desde <= hoy && t.hasta >= hoy);
  const enlace = (m: string, extra: Record<string, string> = {}) => `${ruta}?${new URLSearchParams({ mes: m, ...(mias ? { mias: "1" } : {}), ...extra })}`;
  const enEdicion = plantillas.find((p) => p.id === sp.editar);
  const cuando = (p: (typeof plantillas)[number]) => p.dia_semana ? `Cada ${DIAS_SEMANA[p.dia_semana]}` : p.dia_desde === p.dia_hasta ? `Día ${p.dia_desde}` : `Día ${p.dia_desde} al ${p.dia_hasta}`;

  return (
    <>
      <h1>{seccion === "firma" ? "Tareas del mes" : "Tareas de cobro"}</h1>
      <p className="sub">
        {seccion === "firma"
          ? "El cronograma del manual hecho tareas, con responsable y estado. Las de un cliente, al marcarlas hechas, quedan en su bitácora. Las de igualas y cobros están en Contabilidad Empire › Tareas de cobro."
          : "Las tareas del cronograma de igualas y cobros de Empire: revisar las igualas, emitir sus facturas y cobrarlas. Las de un cliente, al marcarlas hechas, quedan en su bitácora."}
        {atrasadas.length > 0 && <> <strong style={{ color: "var(--peligro)" }}>{atrasadas.length} atrasada{atrasadas.length > 1 ? "s" : ""}.</strong></>}
        {deHoy.length > 0 && <> {deHoy.length} para hoy.</>}
      </p>
      <nav className="fila" style={{ marginBottom: 12, alignItems: "center" }} aria-label="Mes">
        <Link className="boton" href={enlace(moverMes(mes, -1))}>← {nombreMes(moverMes(mes, -1))}</Link>
        <strong style={{ textTransform: "capitalize" }}>{nombreMes(mes)}</strong>
        <Link className="boton" href={enlace(moverMes(mes, 1))}>{nombreMes(moverMes(mes, 1))} →</Link>
        <Link className="boton" href={`${ruta}?${new URLSearchParams({ mes, ...(mias ? {} : { mias: "1" }) })}`}>{mias ? "Ver todas" : "Solo las mías"}</Link>
      </nav>
      <div className="tabla-envoltura" style={{ marginBottom: 24 }}>
        <table>
          <thead><tr><th>Cuándo</th><th>Tarea</th><th>Cliente</th><th>Responsable</th><th>Estado</th></tr></thead>
          <tbody>
            {visibles.map((t) => {
              const atrasada = t.estado === "pendiente" && t.hasta < hoy;
              return (
                <tr key={t.id} style={t.estado === "hecha" ? { opacity: 0.6 } : undefined}>
                  <td style={atrasada ? { color: "var(--peligro)", fontWeight: 600 } : undefined}>
                    {t.desde === t.hasta ? verFecha(t.desde) : `${verFecha(t.desde)} al ${verFecha(t.hasta)}`}{atrasada && " · atrasada"}
                  </td>
                  <td>{t.titulo}</td>
                  <td>{t.empresa_id ? <Link href={`/e/${t.empresa_id}/bitacora`}>{t.cliente}</Link> : seccion === "empire" ? "Empire" : "Firma"}</td>
                  <td>
                    <Formulario accion={asignarTarea.bind(null, fid, t.id)} boton="Guardar" className="fila">
                      <select name="responsable" defaultValue={t.responsable_id ?? ""} aria-label={`Responsable de ${t.titulo}`}>
                        <option value="">Sin responsable</option>
                        {equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                    </Formulario>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {t.estado === "hecha"
                      ? <><span>Hecha{t.hecha_por && ` por ${t.hecha_por}`}</span><Formulario accion={marcarTareaAccion.bind(null, fid, t.id, false)} boton="Reabrir" className="fila"><span /></Formulario></>
                      : <Formulario accion={marcarTareaAccion.bind(null, fid, t.id, true)} boton="Hecha" className="fila"><span /></Formulario>}
                  </td>
                </tr>
              );
            })}
            {visibles.length === 0 && <tr><td colSpan={5}>{mes < actual ? "No hubo tareas en ese mes." : "No hay tareas."}</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Cronograma</h2>
      <p className="sub">Las tareas que se generan cada mes. {firma.administrador ? "Los cambios valen desde las tareas que se generen después." : "Lo ajusta un administrador de la firma."}</p>
      <div className="tabla-envoltura" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>Cuándo</th><th>Tarea</th><th>Para</th><th>Activa</th>{firma.administrador && <th />}</tr></thead>
          <tbody>
            {plantillas.map((p) => (
              <tr key={p.id} style={p.activa ? undefined : { opacity: 0.55 }}>
                <td>{cuando(p)}</td><td>{p.titulo}</td><td>{ALCANCES[p.alcance]}</td><td>{p.activa ? "Sí" : "No"}</td>
                {firma.administrador && <td className="num"><Link href={enlace(mes, { editar: p.id })}>Editar</Link></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {firma.administrador && (
        <div className="tarjeta" style={{ maxWidth: 760 }}>
          <h3 style={{ marginTop: 0 }}>{enEdicion ? "Editar tarea del cronograma" : "Agregar tarea al cronograma"}</h3>
          <Formulario key={enEdicion?.id ?? "nueva"} accion={guardarPlantilla.bind(null, fid, enEdicion?.id ?? null)} boton="Guardar" className="fila">
            <label style={{ flex: "3 1 320px" }}>Tarea<input name="titulo" defaultValue={enEdicion?.titulo} required maxLength={200} /></label>
            <label style={{ width: 110 }}>Del día<input name="dia_desde" type="number" min={1} max={31} defaultValue={enEdicion?.dia_desde ?? ""} /></label>
            <label style={{ width: 110 }}>Al día<input name="dia_hasta" type="number" min={1} max={31} defaultValue={enEdicion?.dia_hasta ?? ""} /></label>
            <label>O cada semana el
              <select name="dia_semana" defaultValue={enEdicion?.dia_semana ?? ""}>
                <option value="">— (por días del mes)</option>
                {DIAS_SEMANA.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
              </select>
            </label>
            <label>Se ve en
              <select name="seccion" defaultValue={enEdicion?.seccion ?? seccion}>
                {Object.entries(SECCIONES_TAREA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Para
              <select name="alcance" defaultValue={enEdicion?.alcance ?? "firma"}>
                {Object.entries(ALCANCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            {enEdicion && (
              <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <input type="checkbox" name="activa" defaultChecked={enEdicion.activa} style={{ minHeight: 0 }} /> Activa
              </label>
            )}
          </Formulario>
          {enEdicion && <p><Link href={enlace(mes)}>Cancelar</Link></p>}
        </div>
      )}
    </>
  );
}
