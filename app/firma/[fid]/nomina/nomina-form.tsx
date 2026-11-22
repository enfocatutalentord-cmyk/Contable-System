"use client";

import { useActionState, useState } from "react";
import { alEnviar } from "@/app/enviar";
import { DECISIONES_NOMINA, FUENTES_NOMINA, REGLAS_NOMINA, TIPOS_INGRESO } from "@/lib/nomina";
import type { Estado } from "@/app/acciones-cuenta";
import { calcularNominaAccion, guardarNominaEnExpediente, type EstadoNomina } from "../../nomina-acciones";

export type EmpleadoNomina = { nombre: string; cedula: string; sueldo: string };
type Fila = { incluir: boolean; nombre: string; cedula: string; salario: string; comisiones: string; vacaciones: string; otras: string; regalia: string; indemnizacion: string; pension: string; isr: string; tipo: string };
const vacia = (): Fila => ({ incluir: true, nombre: "", cedula: "", salario: "", comisiones: "", vacaciones: "", otras: "", regalia: "", indemnizacion: "", pension: "", isr: "", tipo: "0001" });

const CAMPOS: { k: keyof Fila; titulo: string; ancho: number; ayuda?: string }[] = [
  { k: "salario", titulo: "Salario del mes", ancho: 120, ayuda: "Lo realmente devengado en el mes (la parte proporcional si entró o salió)." },
  { k: "comisiones", titulo: "Comisiones", ancho: 100 },
  { k: "vacaciones", titulo: "Vacaciones por ley", ancho: 100, ayuda: "Cotizan a la TSS y cuentan como otras remuneraciones del ISR." },
  { k: "otras", titulo: "Otras remuneraciones", ancho: 110, ayuda: "Incentivos, horas extras, bonos y otras retribuciones: aplican al ISR." },
  { k: "regalia", titulo: "Regalía pascual (exenta)", ancho: 110 },
  { k: "indemnizacion", titulo: "Preaviso, cesantía (exentos)", ancho: 110 },
  { k: "pension", titulo: "Pensión alimenticia", ancho: 100 },
  { k: "isr", titulo: "ISR a mano", ancho: 100, ayuda: "Opcional: si lo sabes, manda sobre el estimado." },
];

// La nómina del mes: una fila por empleado (de la ficha del cliente o escritos), los aportes y retenciones, y las descargas (hoja y archivo de la TSS).
export function NominaForm({ firmaId, empresaId, empleados, puedeGuardar }: { firmaId: string; empresaId: string; empleados: EmpleadoNomina[]; puedeGuardar: boolean }) {
  const [estado, enviar, enviando] = useActionState<EstadoNomina, FormData>(calcularNominaAccion.bind(null, firmaId, empresaId), {});
  const [guardado, guardar, guardando] = useActionState<Estado, FormData>(guardarNominaEnExpediente.bind(null, firmaId, empresaId), {});
  const [filas, setFilas] = useState<Fila[]>(empleados.length ? empleados.map((e) => ({ ...vacia(), nombre: e.nombre, cedula: e.cedula, salario: e.sueldo })) : [vacia()]);
  const cambiar = (i: number, k: keyof Fila, v: string | boolean) => setFilas(filas.map((f, j) => (j === i ? { ...f, [k]: v } : f)));
  const r = estado.resultado;
  const fmt = (m: string) => Number(m).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const alEnviarNomina = (e: React.FormEvent<HTMLFormElement>) => {
    // Los botones de descarga mandan el formulario tal cual a su dirección (en otra pestaña); solo «Calcular» pasa por la acción.
    const boton = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    if (boton?.dataset.descarga) return;
    alEnviar(boton?.dataset.guardar ? guardar : enviar)(e);
  };

  return (
    <>
      <form onSubmit={alEnviarNomina} method="post" encType="multipart/form-data" className="tarjeta" style={{ display: "grid", gap: 12, marginBottom: 16 }}>
        <input type="hidden" name="empresa" value={empresaId} />
        <input type="hidden" name="n" value={filas.length} />
        <div className="fila">
          <label>Mes de la nómina<input type="month" name="periodo" defaultValue={new Date().toISOString().slice(0, 7)} required /></label>
          <label>Archivo de la TSS
            <select name="proceso" defaultValue="AM"><option value="AM">Mensual (AM): mes vigente</option><option value="AR">Retroactiva (AR): mes vencido</option></select>
          </label>
          <label>Salario mínimo nacional (RD$)<input name="smn" inputMode="decimal" defaultValue="23,223.00" style={{ textAlign: "right", width: 130 }} /></label>
          <label>Riesgos laborales, % variable<input name="srl_variable" inputMode="decimal" defaultValue="0.10" style={{ textAlign: "right", width: 90 }} /></label>
        </div>
        <p className="sub" style={{ margin: 0 }}>
          Salario mínimo de la Guía de la TSS 2026 (desde el 1 de febrero de 2026): de él salen los topes de cotización. El porcentaje variable de riesgos laborales (de 0.10 a 0.30) es el que la TSS asigna a la empresa según su
          factor de riesgo: escribe el de su notificación.
        </p>

        <div className="tabla-envoltura">
          <table>
            <thead>
              <tr>
                <th>Incluir</th><th style={{ minWidth: 170 }}>Empleado</th><th style={{ minWidth: 130 }}>Cédula</th>
                {CAMPOS.map((c) => <th key={c.k} className="num" title={c.ayuda} style={{ minWidth: c.ancho }}>{c.titulo}</th>)}
                <th style={{ minWidth: 150 }}>Tipo de ingreso</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i}>
                  <td><input type="checkbox" name={`p${i}_incluir`} checked={f.incluir} onChange={(e) => cambiar(i, "incluir", e.target.checked)} aria-label={`Incluir a ${f.nombre || `empleado ${i + 1}`}`} style={{ minHeight: 0 }} /></td>
                  <td><input name={`p${i}_nombre`} value={f.nombre} onChange={(e) => cambiar(i, "nombre", e.target.value)} maxLength={120} aria-label={`Empleado ${i + 1}, nombre`} /></td>
                  <td><input name={`p${i}_cedula`} value={f.cedula} onChange={(e) => cambiar(i, "cedula", e.target.value)} inputMode="numeric" placeholder="402-1234567-8" aria-label={`Empleado ${i + 1}, cédula`} /></td>
                  {CAMPOS.map((c) => (
                    <td key={c.k}><input name={`p${i}_${c.k}`} value={f[c.k] as string} onChange={(e) => cambiar(i, c.k, e.target.value)} inputMode="decimal" style={{ textAlign: "right" }} aria-label={`Empleado ${i + 1}, ${c.titulo}`} /></td>
                  ))}
                  <td>
                    <select name={`p${i}_tipo`} value={f.tipo} onChange={(e) => cambiar(i, "tipo", e.target.value)} aria-label={`Empleado ${i + 1}, tipo de ingreso`}>
                      {Object.entries(TIPOS_INGRESO).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div><button type="button" className="boton" onClick={() => setFilas([...filas, vacia()])}>+ Agregar empleado</button></div>
        <p className="sub" style={{ margin: 0 }}>
          Aquí no se guarda nada, salvo que guardes la hoja en el expediente: cada mes se vuelven a escribir las partes que cambian (los empleados y sus sueldos vienen de la ficha del cliente si tu perfil puede verla).
          Los extranjeros sin cédula se reportan directamente en el SUIR Plus.
        </p>

        {estado.error && <p className="error" role="alert" style={{ margin: 0 }}>{estado.error}</p>}
        <div className="fila" style={{ alignItems: "center" }}>
          <button className="primario" disabled={enviando}>{enviando ? "Calculando…" : "Calcular"}</button>
          <button type="submit" className="boton" data-descarga="1" formAction={`/firma/${firmaId}/nomina/hoja`} formTarget="_blank" name="formato" value="xlsx">Hoja en Excel</button>
          <button type="submit" className="boton" data-descarga="1" formAction={`/firma/${firmaId}/nomina/hoja`} formTarget="_blank" name="formato" value="pdf">Hoja en PDF</button>
          <button type="submit" className="boton" data-descarga="1" formAction={`/firma/${firmaId}/nomina/archivo`} formTarget="_blank">Archivo para la TSS</button>
          {puedeGuardar && <button type="submit" className="boton" data-guardar="1" disabled={guardando}>{guardando ? "Guardando…" : "Guardar la hoja en el expediente"}</button>}
        </div>
        {guardado.ok && <p className="exito" role="status" style={{ margin: 0 }}>{guardado.ok}</p>}
        {guardado.error && <p className="error" role="alert" style={{ margin: 0 }}>{guardado.error}</p>}
      </form>

      {r && (
        <section className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Resultado</h2>
          <div className="cifras">
            <div className="tarjeta cifra"><div className="etiqueta">Pago a los empleados (neto)</div><div className="valor">RD${fmt(r.totales.neto)}</div></div>
            <div className="tarjeta cifra"><div className="etiqueta">A pagar a la TSS</div><div className="valor">RD${fmt(r.totales.totalTSS)}</div><div className="sub">trabajadores y empleador</div></div>
            <div className="tarjeta cifra"><div className="etiqueta">ISR retenido (IR-3)</div><div className="valor">RD${fmt(r.totales.isr)}</div></div>
            <div className="tarjeta cifra"><div className="etiqueta">INFOTEP</div><div className="valor">RD${fmt(r.totales.infotep)}</div></div>
          </div>
          <div className="tabla-envoltura">
            <table>
              <thead>
                <tr><th style={{ minWidth: 150 }}>Empleado</th><th className="num">Neto a pagar</th><th className="num">AFP 2.87 %</th><th className="num">SFS 3.04 %</th><th className="num">ISR</th><th className="num">Salario cotizable</th>
                  <th className="num">AFP 7.10 %</th><th className="num">SFS 7.09 %</th><th className="num">Riesgos lab.</th><th className="num">INFOTEP</th></tr>
              </thead>
              <tbody>
                {r.filas.map((f, i) => (
                  <tr key={i}>
                    <td>{f.nombre}</td><td className="num"><strong>{fmt(f.neto)}</strong></td><td className="num">{fmt(f.afpTrabajador)}</td><td className="num">{fmt(f.sfsTrabajador)}</td>
                    <td className="num">{fmt(f.isr)}{f.manual && <div className="sub" style={{ margin: 0 }}>a mano (estimado {fmt(f.isrEstimado)})</div>}</td>
                    <td className="num">{fmt(f.salarioSS)}</td><td className="num">{fmt(f.afpEmpleador)}</td><td className="num">{fmt(f.sfsEmpleador)}</td><td className="num">{fmt(f.srl)}</td><td className="num">{fmt(f.infotep)}</td>
                  </tr>
                ))}
                <tr>
                  <td><strong>Totales</strong></td><td className="num"><strong>{fmt(r.totales.neto)}</strong></td><td className="num">{fmt(r.totales.afpTrabajador)}</td><td className="num">{fmt(r.totales.sfsTrabajador)}</td>
                  <td className="num">{fmt(r.totales.isr)}</td><td className="num">{fmt(r.totales.salarioSS)}</td><td className="num">{fmt(r.totales.afpEmpleador)}</td><td className="num">{fmt(r.totales.sfsEmpleador)}</td>
                  <td className="num">{fmt(r.totales.srl)}</td><td className="num">{fmt(r.totales.infotep)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="sub">
            Costo para el empleador por encima de los salarios: RD${fmt(r.totales.costoEmpleador)} (AFP, SFS, riesgos laborales e INFOTEP). Topes de cotización: riesgos laborales RD${fmt(r.topes.srl)}, salud RD${fmt(r.topes.sfs)}, pensiones RD${fmt(r.topes.afp)}.
            La TSS se paga hasta el tercer día laborable del mes siguiente; el ISR retenido se declara a más tardar el día 10.
          </p>
          <p className="aviso" role="status">El ISR es un estimado: la DGII calcula la retención con lo que se reporta a la TSS. Revisa cómo se calcula en «Reglas que usa esta nómina».</p>
          {r.advertencias.map((a, i) => <p key={i} className="aviso" role="status">{a}</p>)}
        </section>
      )}

      <details className="tarjeta" style={{ marginBottom: 16 }}>
        <summary><strong>Reglas que usa esta nómina</strong></summary>
        <ul style={{ marginTop: 8 }}>{REGLAS_NOMINA.map((x) => <li key={x.titulo}><strong>{x.titulo}:</strong> {x.texto}</li>)}</ul>
        <h3 style={{ marginBottom: 4 }}>Cómo se resolvió lo que las fuentes no dicen</h3>
        <ul>{DECISIONES_NOMINA.map((x) => <li key={x}>{x}</li>)}</ul>
        <h3 style={{ marginBottom: 4 }}>Fuentes</h3>
        <ul>{FUENTES_NOMINA.map((x) => <li key={x}>{x}</li>)}</ul>
      </details>
    </>
  );
}
