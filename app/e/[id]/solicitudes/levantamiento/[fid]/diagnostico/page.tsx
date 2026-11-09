import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { EnviarWhatsApp } from "@/app/whatsapp";
import { accesoEmpresa, esUuid } from "@/lib/acceso";
import { conEmpresa, db } from "@/lib/db";
import { AREAS, igualaReferencia, inicial, MENSUALES, NIVELES, serviciosIniciales, type Diagnostico } from "@/lib/diagnostico";
import { CATEGORIAS } from "@/lib/ficha";
import { categoriaDe } from "@/lib/formularios";
import { igualaBajoMinimo } from "@/lib/igualas";
import { aCentavos, deCentavos, hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { preciosVigentes, type CategoriaPrecio } from "@/lib/precios";
import { aprobarDiagnostico, guardarDiagnostico, quitarAprobacionDiagnostico } from "../../../../diagnostico-acciones";

export const metadata = { title: "Diagnóstico · Empire Tax’N Legal" };

// Informe de diagnóstico y propuesta económica (6b.3): el sistema sugiere y Patricia decide; nada sale al cliente sin su aprobación.
export default async function PaginaDiagnostico({ params }: { params: Promise<{ id: string; fid: string }> }) {
  const { id, fid } = await params;
  if (!esUuid(fid)) notFound();
  const { permisos, empresa } = await accesoEmpresa(id);
  const [f] = await conEmpresa(id, (tx) => tx<{ estado: string; respuestas: Record<string, string> | null; aprobado_en: Date | null; diagnostico: Diagnostico | null; diagnostico_aprobado_en: Date | null;
    propuesta_servicios_numero: number | null; propuesta_iguala_numero: number | null; aprobador: string | null; tipo_persona: string | null; categoria: string | null }[]>`
    SELECT f.estado, f.respuestas, f.aprobado_en, f.diagnostico, f.diagnostico_aprobado_en, f.propuesta_servicios_numero, f.propuesta_iguala_numero, u.nombre AS aprobador, e.tipo_persona, e.categoria
      FROM formularios f JOIN empresas e ON e.id = f.empresa_id LEFT JOIN usuarios u ON u.id = f.diagnostico_aprobado_por WHERE f.id = ${fid} AND f.tipo = 'levantamiento'`);
  if (!f?.respuestas || f.estado !== "aceptado") notFound();
  const r = f.respuestas;
  const sugerida = f.categoria ?? categoriaDe({ ventas_mes: r.ventas_mes ?? "", facturas_mes: r.facturas_mes ?? "", empleados_mes: String(Number(r.empleados_fijos ?? 0) + Number(r.empleados_servicio ?? 0)) });
  const d = f.diagnostico ?? inicial(r, f.tipo_persona, sugerida);
  const [{ propia }] = await db()<{ propia: string | null }[]>`SELECT empresa_propia_id AS propia FROM firmas WHERE id = ${empresa.firma_id}`;
  const lista = propia ? await conEmpresa(propia, async (tx) => {
    const s = await tx<{ id: string; nombre: string }[]>`SELECT id, nombre FROM servicios WHERE activo ORDER BY nombre`;
    const p = await preciosVigentes(tx, hoyISO());
    return s.map((x) => ({ nombre: x.nombre, precios: p.get(x.id) ?? {} }));
  }) : [];
  const cat = d.categoria as CategoriaPrecio | null;
  const precios = new Map(lista.map((s) => [s.nombre, (cat && s.precios[cat]) || "0.00"]));
  const iniciales = serviciosIniciales(d);
  const total = iniciales.reduce((t, n) => t + aCentavos(precios.get(n) ?? "0"), 0n);
  const referencia = igualaReferencia(r, precios, d.categoria);
  const aprobado = !!f.diagnostico_aprobado_en, edita = puede(permisos, "registrar") && !aprobado, aprueba = puede(permisos, "empresa");
  const bajo = d.iguala && igualaBajoMinimo(aCentavos(d.iguala), "normal", d.categoria);
  const filas = [...d.hallazgos, ...Array.from({ length: edita ? 3 : 0 }, () => ({ area: "", hallazgo: "", recomendacion: "", servicio: null, prioridad: "media" }))];

  return (
    <>
      <p><Link href={`/e/${id}/solicitudes/levantamiento/${fid}`}>← Levantamiento contable</Link></p>
      <div className="entre">
        <div>
          <h1>Informe de diagnóstico</h1>
          <p className="sub">{empresa.nombre} · {aprobado ? `Aprobado${f.aprobador ? ` por ${f.aprobador}` : ""} el ${verFecha(f.diagnostico_aprobado_en)}` : "Borrador: revísalo, cámbialo y guárdalo antes de aprobar."}</p>
        </div>
        {aprobado && <a className="boton" href={`/e/${id}/solicitudes/levantamiento/${fid}/diagnostico/pdf`} target="_blank" rel="noreferrer">Ver PDF</a>}
      </div>
      {!propia && <p className="aviso">Sin empresa propia elegida no hay lista de precios: elígela en Empresas Empire.</p>}
      {propia && lista.length === 0 && <p className="aviso">La lista de precios está vacía: cárgala en Contabilidad Empire › Productos y servicios.</p>}
      {!f.aprobado_en && <p className="aviso">El estado inicial todavía no está aprobado; hace falta para aprobar este informe.</p>}

      {aprobado ? (
        <section className="tarjeta" style={{ marginBottom: 16 }}>
          <p style={{ marginTop: 0 }}>{d.resumen}</p>
          <div className="tabla-envoltura"><table><thead><tr><th>Área</th><th>Hallazgo</th><th>Recomendación</th><th>Servicio</th><th>Prioridad</th></tr></thead>
            <tbody>{d.hallazgos.map((h, i) => <tr key={i}><td>{h.area}</td><td>{h.hallazgo}</td><td>{h.recomendacion}</td><td>{h.servicio ?? "—"}</td><td>{NIVELES[h.prioridad]}</td></tr>)}</tbody></table></div>
          <p>
            {f.propuesta_servicios_numero && <>Propuesta n.º {f.propuesta_servicios_numero} (servicios iniciales). </>}
            {f.propuesta_iguala_numero && <>Propuesta n.º {f.propuesta_iguala_numero} (iguala). </>}
            {propia && <Link href={`/e/${propia}/propuestas`}>Ver propuestas</Link>}
          </p>
          <div className="fila">
            {puede(permisos, "exportar") && <EnviarWhatsApp empresaId={id} clave="diagnostico" docRef={{ tipo: "diagnostico", id: fid }} etiqueta="Enviar por WhatsApp" />}
            {aprueba && <Formulario accion={quitarAprobacionDiagnostico.bind(null, id, fid)} boton="Quitar la aprobación" className="fila"><span /></Formulario>}
          </div>
        </section>
      ) : (
        <Formulario accion={guardarDiagnostico.bind(null, id, fid)} boton={edita ? "Guardar" : ""}>
          <section className="tarjeta">
            <label>Resumen para el cliente<textarea name="resumen" rows={3} maxLength={1500} defaultValue={d.resumen} /></label>
            <h2>Hallazgos</h2>
            {filas.map((h, i) => (
              <div key={i} className="fila" style={{ borderBottom: "1px solid var(--borde)", paddingBottom: 8, marginBottom: 8 }}>
                <label style={{ flex: "1 1 130px" }}>Área<select name={`h${i}_area`} defaultValue={h.area}><option value="">—</option>{AREAS.map((a) => <option key={a}>{a}</option>)}</select></label>
                <label style={{ flex: "3 1 260px" }}>Hallazgo<input name={`h${i}_hallazgo`} defaultValue={h.hallazgo} maxLength={500} /></label>
                <label style={{ flex: "3 1 260px" }}>Recomendación<input name={`h${i}_recomendacion`} defaultValue={h.recomendacion} maxLength={500} /></label>
                <label style={{ flex: "2 1 220px" }}>Servicio{h.servicio && <span className="sub"> · RD${verMonto(precios.get(h.servicio) ?? "0")}{MENSUALES.includes(h.servicio) ? " (va en la iguala)" : ""}</span>}
                  <select name={`h${i}_servicio`} defaultValue={h.servicio ?? ""}><option value="">Sin servicio</option>{lista.map((s) => <option key={s.nombre}>{s.nombre}</option>)}</select>
                </label>
                <label style={{ flex: "1 1 100px" }}>Prioridad<select name={`h${i}_prioridad`} defaultValue={h.prioridad}>{Object.entries(NIVELES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                {h.hallazgo && <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><input type="checkbox" name={`h${i}_quitar`} style={{ minHeight: 0 }} /> Quitar</label>}
              </div>
            ))}
            <h2>Propuesta económica</h2>
            <div className="fila">
              <label>Categoría del cliente<select name="categoria" defaultValue={d.categoria ?? ""}><option value="">—</option>{Object.entries(CATEGORIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Iguala mensual (RD$)<input name="iguala" defaultValue={d.iguala} inputMode="decimal" placeholder={`Referencia: ${verMonto(referencia)}`} /></label>
              <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><input type="checkbox" name="incluir_levantamiento" defaultChecked={d.incluirLevantamiento} style={{ minHeight: 0 }} /> Cobrar el levantamiento contable</label>
            </div>
            <p className="sub">Referencia de la iguala: RD${verMonto(referencia)}, la suma de lo mensual que le toca (mínimo RD$4,000, salvo emprendedor). La lista de precios no trae un precio de iguala: lo escribes tú.</p>
            {bajo && <p className="aviso">Esta iguala está por debajo del mínimo de RD$4,000.</p>}
            <table><thead><tr><th>Servicios iniciales (según lo guardado)</th><th className="num">RD$</th></tr></thead>
              <tbody>{iniciales.map((n) => <tr key={n}><td>{n}</td><td className="num">{verMonto(precios.get(n) ?? "0")}</td></tr>)}</tbody>
              <tfoot><tr><td>Total, sin ITBIS</td><td className="num">{verMonto(deCentavos(total))}</td></tr></tfoot></table>
          </section>
        </Formulario>
      )}
      {!aprobado && aprueba && f.diagnostico && f.aprobado_en && (
        <div style={{ marginTop: 12 }}><Formulario accion={aprobarDiagnostico.bind(null, id, fid)} boton="Aprobar y crear las propuestas" className="fila"><span /></Formulario></div>
      )}
      {!aprobado && !aprueba && <p className="sub">Lo aprueba Patricia.</p>}
    </>
  );
}
