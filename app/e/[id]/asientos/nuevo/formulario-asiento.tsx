"use client";

import { useActionState, useMemo, useState } from "react";
import type { Estado } from "@/app/acciones-cuenta";
import type { Cuenta } from "@/lib/cuentas";
import { aCentavos, deCentavos, leerMonto, verMonto } from "@/lib/montos";

type Linea = { cuentaId: string; descripcion: string; debe: string; haber: string };
const vacia = (): Linea => ({ cuentaId: "", descripcion: "", debe: "", haber: "" });

export function FormularioAsiento({
  accion,
  cuentas,
  hoy,
  bloqueo,
}: {
  accion: (estado: Estado, fd: FormData) => Promise<Estado>;
  cuentas: Cuenta[];
  hoy: string;
  bloqueo: string | null;
}) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const [lineas, setLineas] = useState<Linea[]>([vacia(), vacia()]);

  const total = (campo: "debe" | "haber") =>
    lineas.reduce((s, l) => s + aCentavos(leerMonto(l[campo]) ?? "0"), 0n);
  const totalDebe = useMemo(() => total("debe"), [lineas]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalHaber = useMemo(() => total("haber"), [lineas]); // eslint-disable-line react-hooks/exhaustive-deps
  const diferencia = totalDebe - totalHaber;

  const cambiar = (i: number, campo: keyof Linea, valor: string) =>
    setLineas((ls) => ls.map((l, j) => {
      if (j !== i) return l;
      const nueva = { ...l, [campo]: valor };
      // Un monto en el debe borra el del haber y viceversa.
      if (campo === "debe" && valor) nueva.haber = "";
      if (campo === "haber" && valor) nueva.debe = "";
      return nueva;
    }));

  // Pone en la línea la diferencia que falta para cuadrar.
  const cuadrar = (i: number) => {
    if (diferencia === 0n) return;
    setLineas((ls) => ls.map((l, j) => {
      if (j !== i) return l;
      const actual = aCentavos(leerMonto(l.debe) ?? "0") - aCentavos(leerMonto(l.haber) ?? "0");
      const neto = actual - diferencia;
      return neto >= 0n ? { ...l, debe: deCentavos(neto), haber: "" } : { ...l, debe: "", haber: deCentavos(-neto) };
    }));
  };

  return (
    <form action={enviar}>
      <div className="fila" style={{ marginBottom: 16 }}>
        <label>Fecha<input type="date" name="fecha" defaultValue={hoy} min={bloqueo ? siguienteDia(bloqueo) : undefined} required /></label>
        <label style={{ flex: "2 1 280px" }}>Concepto<input name="concepto" required placeholder="Ej.: Asiento de apertura" /></label>
        <label style={{ flex: "1 1 160px" }}>Referencia<input name="referencia" placeholder="Factura, cheque…" /></label>
      </div>
      <input type="hidden" name="lineas" value={JSON.stringify(lineas)} />
      <div className="tabla-envoltura">
        <table>
          <thead>
            <tr><th style={{ minWidth: 260 }}>Cuenta</th><th>Descripción</th><th className="num">Debe</th><th className="num">Haber</th><th /></tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td>
                  <select aria-label={`Cuenta de la línea ${i + 1}`} value={l.cuentaId} onChange={(e) => cambiar(i, "cuentaId", e.target.value)} style={{ width: "100%" }}>
                    <option value="">Elige la cuenta…</option>
                    {cuentas.map((c) => (
                      <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
                    ))}
                  </select>
                </td>
                <td><input aria-label={`Descripción de la línea ${i + 1}`} value={l.descripcion} onChange={(e) => cambiar(i, "descripcion", e.target.value)} style={{ width: "100%" }} /></td>
                <td className="num"><input aria-label={`Debe de la línea ${i + 1}`} inputMode="decimal" value={l.debe} onChange={(e) => cambiar(i, "debe", e.target.value)} style={{ width: 130, textAlign: "right" }} /></td>
                <td className="num"><input aria-label={`Haber de la línea ${i + 1}`} inputMode="decimal" value={l.haber} onChange={(e) => cambiar(i, "haber", e.target.value)} style={{ width: 130, textAlign: "right" }} /></td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  <button type="button" title="Poner aquí la diferencia" onClick={() => cuadrar(i)} disabled={diferencia === 0n}>=</button>{" "}
                  <button type="button" title="Quitar línea" onClick={() => setLineas((ls) => ls.length > 2 ? ls.filter((_, j) => j !== i) : ls)} disabled={lineas.length <= 2}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>
                Totales
                {diferencia !== 0n && <span className="error" style={{ marginLeft: 12 }}>Diferencia: {verMonto(diferencia < 0n ? -diferencia : diferencia)}</span>}
              </td>
              <td className="num">{verMonto(totalDebe)}</td>
              <td className="num">{verMonto(totalHaber)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="fila" style={{ marginTop: 12 }}>
        <button type="button" onClick={() => setLineas((ls) => [...ls, vacia()])}>+ Agregar línea</button>
        <button className="primario" disabled={enviando || diferencia !== 0n || totalDebe === 0n}>
          {enviando ? "Guardando…" : "Registrar asiento"}
        </button>
      </div>
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
    </form>
  );
}

function siguienteDia(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
