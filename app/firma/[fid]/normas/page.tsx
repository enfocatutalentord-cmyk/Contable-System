import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoFirma } from "@/lib/acceso";
import { conEmpresa, db } from "@/lib/db";
import { COMPROBANTES } from "@/lib/fiscal";
import { hoyISO, verFecha } from "@/lib/montos";
import {
  avisosDeNormas, DIAS_SIN_REVISAR, empresasDeFirma, estadoVigencia, FORMATOS_CALENDARIO, NOMBRE_FORMATO, normasDeFirma, tasasDeFirma,
} from "@/lib/normas";
import { SIN_CREDITO } from "@/lib/validar-fiscal";
import { agregarProrroga, cargarTasa, guardarCalendario, guardarResponsableNormas, quitarProrroga, registrarRevision } from "../../normas-acciones";
import { CamposTasaNueva } from "./tasa-nueva";

export const metadata = { title: "Normas y tasas · Empire Tax’N Legal" };

const ESTADO: Record<string, string> = { vigente: "Vigente", proxima: "Próxima", cerrada: "Cerrada", inactiva: "Inactiva" };
const credito = (t: string) =>
  SIN_CREDITO.includes(t) ? "No" : ["B01", "E31"].includes(t) ? "Sí" : ["B03", "B04", "E33", "E34"].includes(t) ? "Según el comprobante que modifica" : "Según el caso";

// Entrega B · Normas y tasas (documento Fase 2, sección 7): lo que cambia por ley se carga una vez para todos los clientes.
export default async function Normas({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ ver?: string }> }) {
  const { fid } = await params;
  const { ver } = await searchParams;
  await accesoFirma(fid);
  const hoy = hoyISO();
  const [empresas, normas, admins] = await Promise.all([
    empresasDeFirma(fid),
    normasDeFirma(fid),
    db()<{ id: string; nombre: string }[]>`
      SELECT u.id, u.nombre FROM miembros_firma mf JOIN usuarios u ON u.id = mf.usuario_id WHERE mf.firma_id = ${fid} AND mf.administrador ORDER BY u.nombre`,
  ]);
  const [conceptos, rangos] = await Promise.all([
    tasasDeFirma(empresas),
    Promise.all(empresas.map((e) => conEmpresa(e.id, (tx) => tx<{ tipo: string }[]>`SELECT DISTINCT tipo FROM secuencias_ncf WHERE activa`))),
  ]);
  const ultima = normas.revisiones[0]?.fecha ?? null;
  const avisos = avisosDeNormas({ firmaId: fid, hoy, conceptos, prorrogas: normas.prorrogas, ultimaRevision: ultima, responsable: normas.responsable });
  const nombreEmpresa = (e: { id: string; nombre: string }) => (empresas.find((x) => x.id === e.id)?.propia ? `${e.nombre} (Empire)` : e.nombre);

  // Conceptos vigentes hoy, uno por clase y nombre (con todas las empresas que lo tienen) para «Cargar una tasa nueva».
  const opciones = new Map<string, { clave: string; nombre: string; clase: "impuesto" | "retencion"; tasas: Set<string>; empresas: { id: string; nombre: string }[] }>();
  for (const c of conceptos) {
    if (estadoVigencia(c, hoy) !== "vigente") continue;
    const clave = `${c.clase}|${c.nombre}`;
    const o = opciones.get(clave) ?? { clave, nombre: c.nombre, clase: c.clase, tasas: new Set(), empresas: [] };
    o.tasas.add(c.tasa);
    for (const e of c.empresas) if (!o.empresas.some((x) => x.id === e.id)) o.empresas.push({ id: e.id, nombre: nombreEmpresa(e) });
    opciones.set(clave, o);
  }
  const lista = [...opciones.values()].map(({ tasas, ...o }) => ({ ...o, tasa: tasas.size === 1 ? [...tasas][0] : [...tasas].join(" o ") }));
  const visibles = ver === "todas" ? conceptos : conceptos.filter((c) => ["vigente", "proxima"].includes(estadoVigencia(c, hoy)));
  const dia = (f: string) => normas.calendario.find((c) => c.formato === f);

  return (
    <>
      <h1>Normas y tasas</h1>
      <p className="sub">
        Cuando una ley o norma de la DGII cambia una tasa, una retención o una fecha, se carga aquí una vez y vale para todos los clientes desde
        su fecha de vigencia. Lo ya registrado no cambia: cada factura y compra guarda la tasa que se le aplicó.
      </p>
      {avisos.length > 0 && (
        <ul className="aviso" style={{ paddingLeft: 28 }}>
          {avisos.map((a, i) => <li key={i} style={a.nivel === "urgente" ? { color: "var(--peligro)", fontWeight: 600 } : undefined}>{a.texto}</li>)}
        </ul>
      )}

      <section className="tarjeta" style={{ marginBottom: 20 }} id="tasas">
        <div className="entre">
          <h2 style={{ marginTop: 0 }}>Tasas y retenciones de los clientes</h2>
          <Link href={ver === "todas" ? `/firma/${fid}/normas` : `/firma/${fid}/normas?ver=todas#tasas`}>{ver === "todas" ? "Ver solo vigentes y próximas" : "Ver también las cerradas"}</Link>
        </div>
        <div className="tabla-envoltura">
          <table>
            <thead><tr><th>Concepto</th><th>Clase</th><th className="num">Tasa</th><th>Vigencia</th><th>Estado</th><th>Empresas</th></tr></thead>
            <tbody>
              {visibles.map((c, i) => {
                const est = estadoVigencia(c, hoy);
                return (
                  <tr key={i}>
                    <td><strong>{c.nombre}</strong></td>
                    <td>{c.clase === "impuesto" ? "Impuesto" : `Retención de ${c.tipo === "isr" ? "ISR" : "ITBIS"}`}</td>
                    <td className="num">{c.tasa} %</td>
                    <td>{c.desde <= "2000-01-01" ? "Siempre" : `Desde el ${verFecha(c.desde)}`}{c.hasta && ` hasta el ${verFecha(c.hasta)}`}</td>
                    <td style={est === "proxima" ? { color: "var(--dorado, #B88A40)", fontWeight: 600 } : undefined}>{ESTADO[est]}</td>
                    <td>
                      {c.empresas.length === empresas.length ? `Todas (${c.empresas.length})` : (
                        <details><summary>{c.empresas.length} de {empresas.length}</summary>{c.empresas.map((e) => nombreEmpresa(e)).join(", ")}</details>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visibles.length === 0 && <tr><td colSpan={6}>Las empresas aún no tienen impuestos ni retenciones.</td></tr>}
            </tbody>
          </table>
        </div>

        <h3>Cargar una tasa nueva</h3>
        <p className="sub">La tasa actual de cada empresa marcada se cierra el día antes y se crea la nueva con las mismas cuentas y códigos del 606 y el IR-17.</p>
        <Formulario accion={cargarTasa.bind(null, fid)} boton="Aplicar a las empresas marcadas">
          <CamposTasaNueva opciones={lista} hoy={hoy} />
        </Formulario>
      </section>

      <section className="tarjeta" style={{ marginBottom: 20 }} id="calendario">
        <h2 style={{ marginTop: 0 }}>Calendario fiscal</h2>
        <p className="sub">
          Día del mes siguiente en que vence cada declaración (y, para el IR-2, los días después del cierre del ejercicio). Lo usan las alertas,
          Impuestos del mes y el reporte mensual. Si el día no existe en un mes, vence el último día.
        </p>
        <Formulario accion={guardarCalendario.bind(null, fid)} boton="Guardar el calendario">
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Declaración</th><th>Vence</th><th>De dónde sale</th><th>Último cambio</th></tr></thead>
              <tbody>
                {FORMATOS_CALENDARIO.map((f) => {
                  const d = dia(f);
                  return (
                    <tr key={f}>
                      <td><strong>{NOMBRE_FORMATO[f]}</strong></td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {f === "IR-2" ? "" : "Día "}
                        <input name={`dia_${f}`} type="number" min={1} max={f === "IR-2" ? 365 : 31} defaultValue={d?.dia ?? ""} required style={{ width: 80 }} aria-label={`Día de ${f}`} />
                        {f === "IR-2" ? " días después del cierre" : " del mes siguiente"}
                      </td>
                      <td><input name={`norma_${f}`} defaultValue={d?.norma ?? ""} maxLength={200} aria-label={`Norma de ${f}`} /></td>
                      <td className="sub">{d?.cambiado_en ? `${d.cambiado_por ?? ""} · ${verFecha(d.cambiado_en)}` : "Sugerido"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Formulario>

        <h3>Prórrogas de un mes</h3>
        <p className="sub">Cuando un feriado o un aviso de la DGII corre la fecha de un mes, la prórroga manda sobre el día del calendario.</p>
        {normas.prorrogas.length > 0 && (
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Declaración</th><th>Mes declarado</th><th>Vence</th><th>Motivo</th><th></th></tr></thead>
              <tbody>
                {normas.prorrogas.map((p) => (
                  <tr key={p.id}>
                    <td>{p.formato}</td><td>{p.periodo.slice(4)}/{p.periodo.slice(0, 4)}</td><td>{verFecha(p.vence)}</td>
                    <td>{p.motivo}{p.creado_por && <span className="sub"> · {p.creado_por}</span>}</td>
                    <td><Formulario accion={quitarProrroga.bind(null, fid, p.id)} boton="Quitar" className="fila"><span /></Formulario></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Formulario accion={agregarProrroga.bind(null, fid)} boton="Agregar la prórroga">
          <div className="fila">
            <label style={{ flex: "1 1 160px" }}>Declaración
              <select name="formato" required>{FORMATOS_CALENDARIO.map((f) => <option key={f} value={f}>{NOMBRE_FORMATO[f]}</option>)}</select>
            </label>
            <label style={{ flex: "1 1 150px" }}>Mes declarado (IR-2: mes de cierre)<input type="month" name="mes" required /></label>
            <label style={{ flex: "1 1 150px" }}>Nueva fecha límite<input type="date" name="vence" required /></label>
            <label style={{ flex: "2 1 220px" }}>Motivo<input name="motivo" placeholder="Feriado · Aviso DGII 12-26" maxLength={300} required /></label>
          </div>
        </Formulario>
      </section>

      <section className="tarjeta" style={{ marginBottom: 20 }} id="revisiones">
        <h2 style={{ marginTop: 0 }}>Responsable y revisiones</h2>
        <p className="sub">
          Una vez al mes la responsable revisa los avisos y normas nuevas de la DGII y lo anota aquí. Si pasan {DIAS_SIN_REVISAR} días sin una revisión, sale
          un recordatorio en las alertas de la firma.
        </p>
        <Formulario accion={guardarResponsableNormas.bind(null, fid)} boton="Guardar responsable">
          <label>Responsable de las normas
            <select name="responsable" defaultValue={normas.responsable_id ?? ""}>
              <option value="">Nadie</option>
              {admins.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </label>
        </Formulario>

        <h3>Registrar una revisión</h3>
        <Formulario accion={registrarRevision.bind(null, fid)} boton="Registrar la revisión">
          <div className="fila">
            <label style={{ flex: "1 1 150px" }}>Fecha<input type="date" name="fecha" defaultValue={hoy} max={hoy} required /></label>
            <label style={{ flex: "3 1 320px" }}>Qué se revisó
              <input name="revisado" placeholder="Avisos, normas generales y calendario de la DGII de noviembre" maxLength={1000} required />
            </label>
          </div>
          <div className="fila">
            <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <input type="checkbox" name="hubo_cambios" style={{ minHeight: 0 }} /> Hubo cambios (cárgalos en las tasas o el calendario)
            </label>
            <label style={{ flex: "1 1 260px" }}>Documento de la DGII (PDF, JPG o PNG, opcional)<input type="file" name="archivo" accept=".pdf,.jpg,.jpeg,.png" /></label>
          </div>
        </Formulario>
        <div className="tabla-envoltura">
          <table>
            <thead><tr><th>Fecha</th><th>Qué se revisó</th><th>Cambios</th><th>Documento</th><th>Por</th></tr></thead>
            <tbody>
              {normas.revisiones.map((r) => (
                <tr key={r.id}>
                  <td>{verFecha(r.fecha)}</td><td>{r.revisado}</td><td>{r.hubo_cambios ? "Sí" : "No"}</td>
                  <td>{r.archivo_nombre ? <a href={`/firma/${fid}/normas/revision/${r.id}`}>{r.archivo_nombre}</a> : <span className="sub">—</span>}</td>
                  <td>{r.por ?? "—"}</td>
                </tr>
              ))}
              {normas.revisiones.length === 0 && <tr><td colSpan={5}>Aún no hay revisiones registradas.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="tarjeta" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Tipos de comprobante</h2>
        <p className="sub">
          Para consultar (Norma General 06-2018 y sus equivalentes electrónicos). «En uso» cuenta las empresas con un rango activo cargado en
          «Comprobantes NCF». «Crédito del ITBIS»: si el comprobante sirve para sustentar el crédito fiscal.
        </p>
        <div className="tabla-envoltura">
          <table>
            <thead><tr><th>Tipo</th><th>Nombre</th><th>Se usa para</th><th>Crédito del ITBIS</th><th className="num">En uso</th></tr></thead>
            <tbody>
              {Object.entries(COMPROBANTES).sort(([a], [b]) => a.localeCompare(b)).map(([t, c]) => {
                const n = rangos.filter((r) => r.some((x) => x.tipo === t)).length;
                return (
                  <tr key={t}>
                    <td><strong>{t}</strong>{c.equivalente && <span className="sub"> ↔ {c.equivalente}</span>}</td>
                    <td>{c.nombre}</td><td>{c.uso === "venta" ? "Ventas" : "Compras (lo emite el comprador)"} · <span className="sub">{c.detalle}</span></td>
                    <td>{credito(t)}</td><td className="num">{n || <span className="sub">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="tarjeta">
        <h2 style={{ marginTop: 0 }}>Historial de cambios</h2>
        <p className="sub">Cada tasa cargada queda además en el historial de cambios de cada empresa.</p>
        <ul style={{ paddingLeft: 18 }}>
          {normas.historial.map((h, i) => <li key={i}><span className="sub">{verFecha(h.fecha)} · {h.por ?? "—"}:</span> {h.que}</li>)}
          {normas.historial.length === 0 && <li className="sub">Sin cambios todavía.</li>}
        </ul>
      </section>
    </>
  );
}
