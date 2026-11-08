"use client";

import { useEffect, useRef, useState } from "react";
import { ANEXOS, SECCIONES_LEV, type Columna, type Pregunta } from "@/lib/levantamiento";
import { aCentavos, deCentavos, leerMonto, verMonto } from "@/lib/montos";

const estilo = (ancho: number) => ({ flex: `1 1 ${ancho}px` });

function Campo({ p, inicial }: { p: Pregunta; inicial?: string }) {
  if (p.multi) {
    return (
      <fieldset style={{ border: 0, padding: 0, margin: 0, flex: "1 1 100%" }}>
        <legend>{p.t}</legend>
        <div className="fila" style={{ gap: 4 }}>
          {p.op!.map((o) => <label key={o} style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: "1 1 180px" }}><input type="checkbox" name={p.k} value={o} style={{ minHeight: 0 }} /> {o}</label>)}
        </div>
      </fieldset>
    );
  }
  if (p.op) return <label style={estilo(220)}>{p.t}<select name={p.k} defaultValue=""><option value="">—</option>{p.op.map((o) => <option key={o}>{o}</option>)}</select></label>;
  if (p.tipo === "largo") return <label style={{ flex: "1 1 100%" }}>{p.t}<textarea name={p.k} rows={2} maxLength={2000} /></label>;
  const tipo = p.tipo === "fecha" ? "date" : p.tipo === "email" ? "email" : p.tipo === "tel" ? "tel" : "text";
  return <label style={estilo(220)}>{p.t}<input name={p.k} type={tipo} defaultValue={inicial} inputMode={p.tipo === "monto" || p.tipo === "entero" ? "decimal" : undefined} maxLength={200} /></label>;
}

const Celda = ({ n, c }: { n: string; c: Columna }) => c.op
  ? <label style={estilo(130)}>{c.t}<select name={n} defaultValue=""><option value="">—</option>{c.op.map((o) => <option key={o}>{o}</option>)}</select></label>
  : <label style={estilo(c.tipo ? 130 : 180)}>{c.t}<input name={n} type={c.tipo === "fecha" ? "date" : "text"} inputMode={c.tipo === "monto" ? "decimal" : undefined} maxLength={200} /></label>;

// Cuestionario del levantamiento (6b.2): por partes, con filas que se agregan y totales al momento. Lo escrito se conserva en esta
// pestaña del navegador si la página se recarga; al cerrarla se borra, porque lleva salarios y datos de la empresa.
export function CamposLevantamiento({ clave, iniciales }: { clave: string; iniciales: Record<string, string> }) {
  const caja = useRef<HTMLDivElement>(null);
  const [filas, setFilas] = useState<Record<string, number>>(Object.fromEntries(ANEXOS.map((a) => [a.clave, 3])));
  const [totales, setTotales] = useState<Record<string, string>>({});
  const llave = `levantamiento:${clave}`;

  const calcular = () => {
    const raiz = caja.current;
    if (!raiz) return;
    const t: Record<string, string> = {};
    for (const a of ANEXOS) {
      let s = 0n;
      for (let i = 0; i < a.max; i++) {
        const v = (raiz.querySelector(`[name="${a.clave}${i}_${a.suma}"]`) as HTMLInputElement | null)?.value;
        const m = v ? leerMonto(v) : null;
        if (m !== null) s += aCentavos(m);
      }
      t[a.clave] = verMonto(deCentavos(s));
    }
    setTotales(t);
  };

  const guardar = () => {
    const raiz = caja.current;
    if (!raiz) return;
    const d: Record<string, string | string[]> = {};
    raiz.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[name],select[name],textarea[name]").forEach((e) => {
      if (e instanceof HTMLInputElement && e.type === "checkbox") { if (e.checked) d[e.name] = [...((d[e.name] as string[]) ?? []), e.value]; } else if (e.value) d[e.name] = e.value;
    });
    try { sessionStorage.setItem(llave, JSON.stringify({ d, filas })); } catch { /* sin almacenamiento sigue funcionando */ }
  };

  // Devuelve el borrador: primero las filas y, ya pintadas, los valores.
  const borrador = useRef<Record<string, string | string[]> | null>(null);
  useEffect(() => {
    try {
      const g = JSON.parse(sessionStorage.getItem(llave) ?? "null");
      if (g) { borrador.current = g.d; setFilas(g.filas); }
    } catch { /* nada guardado */ }
  }, [llave]);
  useEffect(() => {
    const d = borrador.current, raiz = caja.current;
    if (d && raiz) {
      borrador.current = null;
      raiz.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[name],select[name],textarea[name]").forEach((e) => {
        const v = d[e.name];
        if (e instanceof HTMLInputElement && e.type === "checkbox") e.checked = Array.isArray(v) && v.includes(e.value);
        else if (typeof v === "string") e.value = v;
      });
    }
    calcular();
  }, [filas]);

  return (
    <div ref={caja} onInput={() => { calcular(); guardar(); }} onChange={guardar} style={{ display: "contents" }}>
      {SECCIONES_LEV.map((s) => (
        <fieldset key={s.titulo} className="tarjeta">
          <legend><strong>{s.titulo}</strong></legend>
          <div className="fila">{s.preguntas.map((p) => <Campo key={p.k} p={p} inicial={iniciales[p.k]} />)}</div>
        </fieldset>
      ))}
      {ANEXOS.map((a) => (
        <fieldset key={a.clave} className="tarjeta">
          <legend><strong>{a.titulo}</strong></legend>
          <p className="sub" style={{ marginTop: 0 }}>{a.ayuda}</p>
          {Array.from({ length: filas[a.clave] }, (_, i) => (
            <div key={i} className="fila" style={{ borderBottom: "1px solid var(--borde)", paddingBottom: 8, marginBottom: 8 }}>
              {a.cols.map((c) => <Celda key={c.k} n={`${a.clave}${i}_${c.k}`} c={c} />)}
            </div>
          ))}
          <div className="entre">
            {filas[a.clave] < a.max
              ? <button type="button" className="boton" onClick={() => setFilas((f) => ({ ...f, [a.clave]: Math.min(a.max, f[a.clave] + 1) }))}>+ Agregar fila</button>
              : <span className="sub">Máximo de filas alcanzado.</span>}
            <strong>Total: RD${totales[a.clave] ?? "0.00"}</strong>
          </div>
          {a.clave === "gv" && <label style={{ marginTop: 8 }}>Costos directos al mes (RD$), si los tiene<input name="costos_directos" inputMode="decimal" maxLength={30} /></label>}
        </fieldset>
      ))}
      <fieldset className="tarjeta">
        <legend><strong>Documentos</strong></legend>
        <label>Estatutos, acta, RNC y lo que tenga a mano (fotos o PDF; hasta 10 y 4 MB en total)
          <input type="file" name="archivos" multiple accept="application/pdf,image/jpeg,image/png" />
        </label>
      </fieldset>
      <fieldset className="tarjeta">
        <legend><strong>10. Validación</strong></legend>
        <div className="fila">
          <label style={estilo(240)}>Su nombre<input name="acepta_nombre" required maxLength={200} /></label>
          <label style={estilo(180)}>Su cédula o RNC<input name="acepta_cedula" required maxLength={20} /></label>
        </div>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><input type="checkbox" name="acepta" required style={{ minHeight: 0 }} /> Confirmo que esta información es correcta. Quedan la fecha y la hora del envío.</label>
      </fieldset>
    </div>
  );
}
