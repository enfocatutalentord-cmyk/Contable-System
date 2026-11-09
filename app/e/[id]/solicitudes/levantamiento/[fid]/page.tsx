import Link from "next/link";
import { notFound } from "next/navigation";
import { Descargar } from "@/app/descargar";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, esUuid } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { categoriaDe, ESTADOS_FORMULARIO, type FilaFormulario } from "@/lib/formularios";
import { CATEGORIAS } from "@/lib/ficha";
import { ANEXOS, estadoInicial, filasDe, SECCIONES_LEV, type Linea } from "@/lib/levantamiento";
import { deCentavos, hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { aceptarFormularioAccion, descartarFormularioAccion } from "../../../solicitudes-acciones";
import { aprobarEstadoInicial, guardarPatrimonio, pasarASaldos, quitarAprobacionEstado } from "../../../levantamiento-acciones";

export const metadata = { title: "Levantamiento contable · Empire Tax’N Legal" };

const dinero = (v: bigint) => (v < 0n ? `-${verMonto(deCentavos(-v))}` : verMonto(deCentavos(v)));
const SECCIONES: [string, string, string[]][] = [
  ["empresa", "Datos de la empresa", ["nombre", "nombre_comercial", "rnc", "direccion", "telefono", "correo"]],
  ["sociedad", "Sociedad", ["fecha_constitucion", "municipio", "provincia"]],
  ["operaciones", "Operaciones", ["ventas_mes", "facturas_mes", "en_tss", "sistema_usa"]],
];
const ETIQUETA = Object.fromEntries(SECCIONES_LEV.flatMap((s) => s.preguntas.map((p) => [p.k, p.t])));
const Tabla = ({ lineas }: { lineas: Linea[] }) => (
  <div className="tabla-envoltura"><table>
    <thead><tr><th>Concepto</th><th className="num">Monto (RD$)</th><th>Referencia</th></tr></thead>
    <tbody>{lineas.map((l, i) => (
      <tr key={i} style={l.negrita ? { fontWeight: 700 } : undefined}><td>{l.concepto}</td><td className="num">{l.monto === null ? "" : dinero(l.monto)}</td><td className="sub">{l.ref}</td></tr>
    ))}</tbody>
  </table></div>
);

// Revisión del levantamiento (6b.2): lo que envió el cliente, sus anexos y el estado de situación financiera inicial.
export default async function Levantamiento({ params }: { params: Promise<{ id: string; fid: string }> }) {
  const { id, fid } = await params;
  if (!esUuid(fid)) notFound();
  const { permisos, empresa } = await accesoEmpresa(id);
  const datos = await conEmpresa(id, async (tx) => {
    const [f] = await tx<(Pick<FilaFormulario, "estado" | "recibido_en" | "aceptadas"> & { respuestas: Record<string, string> | null; aprobado_en: Date | null; aprobador: string | null; revisor: string | null })[]>`
      SELECT f.estado, f.recibido_en, f.aceptadas, f.respuestas, f.aprobado_en, ua.nombre AS aprobador, ur.nombre AS revisor
        FROM formularios f LEFT JOIN usuarios ua ON ua.id = f.aprobado_por LEFT JOIN usuarios ur ON ur.id = f.revisado_por
       WHERE f.id = ${fid} AND f.tipo = 'levantamiento'`;
    const [e] = await tx<Record<string, string | null>[]>`
      SELECT nombre, nombre_comercial, rnc, direccion, telefono, correo, to_char(fecha_constitucion, 'YYYY-MM-DD') AS fecha_constitucion, municipio, provincia,
             ventas_mes::text, facturas_mes::text, CASE tiene_tss WHEN true THEN 'Sí' WHEN false THEN 'No' END AS en_tss, sistema_usa, capital_social::text, lleva_contabilidad::text
        FROM empresas WHERE id = ${id}`;
    const adjuntos = await tx<{ id: string; nombre: string }[]>`SELECT id, nombre FROM documentos WHERE entidad = 'formulario' AND entidad_id = ${fid} AND NOT eliminado`;
    return { f, e, adjuntos };
  });
  const f = datos.f;
  if (!f?.respuestas) notFound();
  const r: Record<string, string> = { ...f.respuestas, pat_capital: f.respuestas.pat_capital ?? datos.e.capital_social ?? "" };
  const est = estadoInicial(r);
  const registra = puede(permisos, "registrar"), aprueba = puede(permisos, "empresa"), verSalarios = aprueba;
  const sugerida = categoriaDe({ ventas_mes: r.ventas_mes ?? "", facturas_mes: r.facturas_mes ?? "", empleados_mes: String(Number(r.empleados_fijos ?? 0) + Number(r.empleados_servicio ?? 0)) });
  const nomina = ANEXOS[0], filasNomina = filasDe(r, nomina);
  const porAceptar = f.estado === "recibido";

  return (
    <>
      <p><Link href={`/e/${id}/solicitudes`}>← Solicitudes y formularios</Link></p>
      <div className="entre">
        <div>
          <h1>Levantamiento contable</h1>
          <p className="sub">{empresa.nombre} · {ESTADOS_FORMULARIO[f.estado]}{r.acepta_nombre && ` · confirmado por ${r.acepta_nombre} (${r.acepta_cedula})`}{f.recibido_en && ` el ${verFecha(f.recibido_en)}`}{f.revisor && ` · revisó ${f.revisor}`}</p>
        </div>
        {puede(permisos, "exportar") && f.aprobado_en && <Descargar href={`/e/${id}/exportar/estado-inicial?id=${fid}`} />}
      </div>

      {f.estado === "aceptado" && <p><Link className="boton primario" href={`/e/${id}/solicitudes/levantamiento/${fid}/diagnostico`}>Informe de diagnóstico y propuesta</Link></p>}
      <section className="tarjeta" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Estado de situación financiera inicial</h2>
        {est.avisos.map((a, i) => <p key={i} className="aviso">{a}</p>)}
        <Tabla lineas={est.lineas} />
        {est.diferencia === 0n
          ? <p className="exito">Cuadra: activos = pasivos + patrimonio.</p>
          : <p className="error">No cuadra: diferencia de RD${dinero(est.diferencia)}. Con estos anexos y capital, las utilidades acumuladas que cuadran serían RD${dinero(est.sugeridaUtilidades)}.</p>}
        <h3>Referencia operativa mensual</h3>
        <Tabla lineas={est.operativa} />
        {est.margen && <p><strong>Margen de ganancia:</strong> {est.margen}</p>}
        {registra && !f.aprobado_en && (
          <Formulario accion={guardarPatrimonio.bind(null, id, fid)} boton="Guardar y recalcular" className="fila">
            <label>Capital social (RD$)<input name="pat_capital" defaultValue={r.pat_capital} inputMode="decimal" /></label>
            <label>Utilidades acumuladas (RD$)<input name="pat_utilidades" defaultValue={r.pat_utilidades ?? ""} placeholder="Puede ser negativo" /></label>
            <label>Resultado del ejercicio (RD$)<input name="pat_resultado" defaultValue={r.pat_resultado ?? ""} placeholder="Puede ser negativo" /></label>
            <label>Próxima cita o acción<input name="proxima_accion" defaultValue={r.proxima_accion ?? ""} maxLength={300} /></label>
            <label>Fecha acordada<input type="date" name="proxima_fecha" defaultValue={r.proxima_fecha ?? ""} /></label>
          </Formulario>
        )}
        {f.estado === "aceptado" && !f.aprobado_en && aprueba && est.diferencia === 0n && (
          <Formulario accion={aprobarEstadoInicial.bind(null, id, fid)} boton="Aprobar el estado inicial" className="fila"><span /></Formulario>
        )}
        {f.estado === "aceptado" && !f.aprobado_en && !aprueba && <p className="sub">Lo aprueba Patricia.</p>}
        {f.aprobado_en && (
          <>
            <p className="exito">Aprobado{f.aprobador && ` por ${f.aprobador}`} el {verFecha(f.aprobado_en)}.</p>
            {aprueba && <Formulario accion={quitarAprobacionEstado.bind(null, id, fid)} boton="Quitar la aprobación" className="fila"><span /></Formulario>}
            {registra && datos.e.lleva_contabilidad !== "true" && (
              <Formulario accion={pasarASaldos.bind(null, id, fid)} boton="Pasar a los Saldos del balance" className="fila">
                <label>Fecha de corte<input type="date" name="fecha" defaultValue={hoyISO()} required /></label>
              </Formulario>
            )}
          </>
        )}
      </section>

      {porAceptar && registra && (
        <section className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Cargar a la ficha</h2>
          <p className="sub">Marca lo que quieres cargar; lo que el cliente dejó en blanco no borra lo que ya hay.</p>
          <Formulario accion={aceptarFormularioAccion.bind(null, id, fid)} boton="Aceptar el levantamiento">
            {SECCIONES.map(([sec, nombre, claves]) => (
              <fieldset key={sec}>
                <legend><label style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><input type="checkbox" name={`sec_${sec}`} defaultChecked style={{ minHeight: 0 }} /> {nombre}</label></legend>
                <table><thead><tr><th>Dato</th><th>Lo que envió</th><th>Lo que hay hoy</th></tr></thead>
                  <tbody>{claves.filter((k) => r[k]).map((k) => <tr key={k}><td>{ETIQUETA[k]}</td><td><strong>{r[k]}</strong></td><td className="sub">{datos.e[k] ?? "—"}</td></tr>)}</tbody>
                </table>
              </fieldset>
            ))}
            {verSalarios && filasNomina.length > 0 && <label style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><input type="checkbox" name="sec_empleados" defaultChecked style={{ minHeight: 0 }} /> Empleados (reemplazan los de la ficha)</label>}
            {datos.adjuntos.length > 0 && <label style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><input type="checkbox" name="sec_adjuntos" defaultChecked style={{ minHeight: 0 }} /> Documentos adjuntos (van a «01 Documentos legales»)</label>}
            {sugerida && <p className="sub">Categoría sugerida: <strong>{CATEGORIAS[sugerida]}</strong> (se elige en la ficha, en Relación con Empire).</p>}
          </Formulario>
          <Formulario accion={descartarFormularioAccion.bind(null, id, fid)} boton="Descartar" className="fila"><span /></Formulario>
        </section>
      )}

      <section className="tarjeta" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Respuestas</h2>
        {SECCIONES_LEV.map((s) => {
          const con = s.preguntas.filter((p) => r[p.k]);
          return con.length > 0 && (
            <details key={s.titulo} open><summary><strong>{s.titulo}</strong></summary>
              <table><tbody>{con.map((p) => <tr key={p.k}><td>{p.t}</td><td><strong>{r[p.k]}</strong></td></tr>)}</tbody></table>
            </details>
          );
        })}
        {datos.adjuntos.length > 0 && <ul>{datos.adjuntos.map((d) => <li key={d.id}><a href={`/e/${id}/documentos/${d.id}`} target="_blank" rel="noreferrer">{d.nombre}</a></li>)}</ul>}
      </section>

      <section className="tarjeta">
        <h2 style={{ marginTop: 0 }}>Anexos</h2>
        {ANEXOS.map((a) => {
          const filas = filasDe(r, a);
          if (a.clave === "nom" && !verSalarios) return <p key={a.clave}><strong>{a.titulo}:</strong> {filas.length} empleados. El detalle lo ven quienes editan la ficha.</p>;
          return (
            <details key={a.clave} open={filas.length > 0}><summary><strong>{a.titulo}</strong> ({filas.length})</summary>
              <div className="tabla-envoltura"><table>
                <thead><tr>{a.cols.map((c) => <th key={c.k} className={c.tipo === "monto" ? "num" : undefined}>{c.t}</th>)}</tr></thead>
                <tbody>{filas.map((x, i) => <tr key={i}>{a.cols.map((c) => <td key={c.k} className={c.tipo === "monto" ? "num" : undefined}>{x[c.k] ?? ""}</td>)}</tr>)}</tbody>
              </table></div>
            </details>
          );
        })}
      </section>
    </>
  );
}
