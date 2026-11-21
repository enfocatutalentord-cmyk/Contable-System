"use client";

import { useActionState, useState } from "react";
import { alEnviar } from "@/app/enviar";
import { DECISIONES, FUENTE, REGLAS, TERMINACIONES, type Terminacion } from "@/lib/prestaciones";
import { calcularPrestaciones, type EstadoPrestaciones } from "../../prestaciones-acciones";

export type EmpleadoFicha = { nombre: string; ingreso: string; sueldo: string };

const hoy = () => new Date().toISOString().slice(0, 10);

// La calculadora: datos del empleado (de la ficha o a mano), cómo terminó el contrato y lo que cambia el cálculo. Muestra cada concepto con su artículo.
export function Calculadora({ firmaId, empresaId, empleados }: { firmaId: string; empresaId: string; empleados: EmpleadoFicha[] }) {
  const [estado, enviar, enviando] = useActionState<EstadoPrestaciones, FormData>(calcularPrestaciones.bind(null, firmaId, empresaId), {});
  const [v, setV] = useState({ nombre: "", ingreso: "", termino: hoy(), sueldo: "", promedio: "", terminacion: "desahucio" as Terminacion, preaviso_dado: "", vacaciones_pendientes: "", devengado: "", minimo: "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const r = estado.resultado;

  const elegir = (i: string) => {
    const e = empleados[Number(i)];
    if (!e) return;
    setV({ ...v, nombre: e.nombre, ingreso: e.ingreso, sueldo: e.sueldo });
  };

  return (
    <>
      <form onSubmit={alEnviar(enviar)} className="tarjeta" style={{ display: "grid", gap: 12, marginBottom: 16 }}>
        {empleados.length > 0 && (
          <label>Empleado de la ficha del cliente
            <select defaultValue="" onChange={(e) => elegir(e.target.value)}>
              <option value="">Escribir los datos a mano</option>
              {empleados.map((e, i) => <option key={i} value={i}>{e.nombre}</option>)}
            </select>
          </label>
        )}
        <div className="fila">
          <label style={{ flex: "2 1 220px" }}>Nombre<input name="nombre" value={v.nombre} onChange={set("nombre")} maxLength={120} /></label>
          <label>Fecha de ingreso<input type="date" name="ingreso" value={v.ingreso} onChange={set("ingreso")} required /></label>
          <label>Último día trabajado<input type="date" name="termino" value={v.termino} onChange={set("termino")} required /></label>
        </div>
        <div className="fila">
          <label>Salario mensual (RD$)<input name="sueldo" inputMode="decimal" value={v.sueldo} onChange={set("sueldo")} required placeholder="50,000.00" style={{ textAlign: "right" }} /></label>
          <label>Promedio mensual del último año (RD$, si varió)<input name="promedio" inputMode="decimal" value={v.promedio} onChange={set("promedio")} placeholder="Opcional" style={{ textAlign: "right" }} /></label>
        </div>
        <label>Cómo terminó el contrato
          <select name="terminacion" value={v.terminacion} onChange={set("terminacion")}>
            {Object.entries(TERMINACIONES).map(([k, t]) => <option key={k} value={k}>{t.nombre}</option>)}
          </select>
          <span className="sub" style={{ margin: 0 }}>{TERMINACIONES[v.terminacion].detalle}</span>
        </label>
        <div className="fila">
          <label>Días de preaviso que sí se dieron<input name="preaviso_dado" inputMode="numeric" value={v.preaviso_dado} onChange={set("preaviso_dado")} placeholder="0" style={{ width: 120, textAlign: "right" }} /></label>
          <label>Años completos con vacaciones sin disfrutar<input name="vacaciones_pendientes" inputMode="numeric" value={v.vacaciones_pendientes} onChange={set("vacaciones_pendientes")} placeholder="0" style={{ width: 120, textAlign: "right" }} /></label>
        </div>
        <div className="fila">
          <label>Salarios ordinarios devengados este año (RD$, si los sabes)<input name="devengado" inputMode="decimal" value={v.devengado} onChange={set("devengado")} placeholder="Opcional" style={{ textAlign: "right" }} /></label>
          <label>Salario mínimo (RD$, para el tope de la Navidad)<input name="minimo" inputMode="decimal" value={v.minimo} onChange={set("minimo")} placeholder="Opcional" style={{ textAlign: "right" }} /></label>
        </div>
        {estado.error && <p className="error" role="alert" style={{ margin: 0 }}>{estado.error}</p>}
        <div><button className="primario" disabled={enviando}>{enviando ? "Calculando…" : "Calcular"}</button></div>
      </form>

      {r && (
        <section className="tarjeta" style={{ marginBottom: 16 }}>
          <div className="fila" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>Resultado</h2>
            <form method="post" action={`/firma/${firmaId}/laboral/pdf`} target="_blank">
              <input type="hidden" name="empresa" value={empresaId} />
              {Object.entries(v).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
              <button className="boton" type="submit">Hoja en PDF</button>
            </form>
          </div>
          <p className="sub">
            Antigüedad: <strong>{r.antiguedad}</strong> · Salario diario: RD${fmt(r.salarioDiario)}
            {r.salarioDiarioPromedio !== r.salarioDiario && <> (con el promedio: RD${fmt(r.salarioDiarioPromedio)})</>}
          </p>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th style={{ minWidth: 130 }}>Concepto</th><th className="num">Días</th><th className="num" style={{ minWidth: 100 }}>RD$</th><th style={{ minWidth: 240 }}>Cómo se calcula</th></tr></thead>
              <tbody>
                {r.conceptos.map((c) => (
                  <tr key={c.clave}>
                    <td><strong>{c.nombre}</strong><div className="sub" style={{ margin: 0 }}>{c.articulos}</div></td>
                    <td className="num">{c.dias ?? ""}</td>
                    <td className="num">{fmt(c.monto)}</td>
                    <td>{c.formula}{c.nota && <div className="sub" style={{ margin: 0 }}>{c.nota}</div>}</td>
                  </tr>
                ))}
                <tr><td colSpan={2}><strong>Total</strong></td><td className="num"><strong>{fmt(r.total)}</strong></td><td /></tr>
              </tbody>
            </table>
          </div>
          <p className="sub">
            Plazo de pago (Art. 86): hasta el {fechaLarga(r.fechaLimite)}. Cada día de retraso suma un día de salario (RD${fmt(r.recargoDiario)}).
          </p>
          {r.advertencias.map((a, i) => <p key={i} className="aviso" role="status">{a}</p>)}
        </section>
      )}

      <details className="tarjeta" style={{ marginBottom: 16 }}>
        <summary><strong>Reglas que usa esta calculadora</strong></summary>
        <ul style={{ marginTop: 8 }}>
          {REGLAS.map((x) => <li key={x.articulo + x.titulo}><strong>{x.articulo} · {x.titulo}:</strong> {x.texto}</li>)}
        </ul>
        <h3 style={{ marginBottom: 4 }}>Cómo se resolvieron los puntos dudosos</h3>
        <ul>{DECISIONES.map((x) => <li key={x}>{x}</li>)}</ul>
        <p className="sub">Fuente: {FUENTE}.</p>
      </details>
    </>
  );
}

const fmt = (m: string) => Number(m).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaLarga = (f: string) => { const [a, m, d] = f.split("-"); return `${d}/${m}/${a}`; };
