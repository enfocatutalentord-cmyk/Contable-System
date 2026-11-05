"use client";

import { useActionState, useMemo, useState } from "react";
import { alEnviar } from "@/app/enviar";
import type { EstadoAsiento } from "../../acciones";
import type { Cuenta } from "@/lib/cuentas";
import { aCentavos, deCentavos, leerMonto, verMonto } from "@/lib/montos";
import { SelectorUnidad, type UnidadOpcion } from "@/app/unidad";

// categoria: categoría personal de la línea (cuenta corriente de la socia); viaja sin mostrarse para no perderla al editar.
export type Linea = { cuentaId: string; descripcion: string; debe: string; haber: string; unidad?: string; categoria?: string };
// Modo plantilla (bloque 7a): en vez de fecha, el nombre y cada cuánto se repite.
export type DatosPlantilla = { nombre: string; frecuencia: "ninguna" | "mensual"; dia: number | null; desde: string; hasta: string | null };
const vacia = (): Linea => ({ cuentaId: "", descripcion: "", debe: "", haber: "", unidad: "" });

export function FormularioAsiento({
  accion,
  cuentas,
  hoy,
  bloqueo,
  puedeContabilizar,
  inicial,
  unidades = [],
  plantilla,
}: {
  accion: (estado: EstadoAsiento, fd: FormData) => Promise<EstadoAsiento>;
  cuentas: Cuenta[];
  hoy: string;
  bloqueo: string | null;
  puedeContabilizar: boolean;
  inicial?: { fecha: string; concepto: string; referencia: string; lineas: Linea[] };
  unidades?: UnidadOpcion[];
  plantilla?: DatosPlantilla;
}) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const [frecuencia, setFrecuencia] = useState(plantilla?.frecuencia ?? "ninguna");
  const [lineas, setLineas] = useState<Linea[]>(inicial?.lineas.length ? [...inicial.lineas, ...(inicial.lineas.length < 2 ? [vacia()] : [])] : [vacia(), vacia()]);

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
    <form onSubmit={alEnviar(enviar)}>
      {plantilla && (
        <div className="fila" style={{ marginBottom: 12 }}>
          <label style={{ flex: "2 1 240px" }}>Nombre de la plantilla<input name="nombre" required maxLength={100} defaultValue={plantilla.nombre} placeholder="Ej.: Pago de luz" /></label>
          <label>Se repite
            <select name="frecuencia" value={frecuencia} onChange={(e) => setFrecuencia(e.target.value as "ninguna" | "mensual")}>
              <option value="ninguna">No: se usa a mano</option>
              <option value="mensual">Cada mes (prepara un borrador)</option>
            </select>
          </label>
          {frecuencia === "mensual" && <>
            <label style={{ width: 110 }}>Día del mes<input type="number" name="dia" min={1} max={30} required defaultValue={plantilla.dia ?? 30} /></label>
            <label>Desde<input type="month" name="desde" required defaultValue={plantilla.desde} /></label>
            <label>Hasta (opcional)<input type="date" name="hasta" defaultValue={plantilla.hasta ?? ""} /></label>
          </>}
        </div>
      )}
      {plantilla && frecuencia === "mensual" && <p className="sub" style={{ marginTop: -4 }}>El día 30 es siempre el último día del mes. Cada mes queda un borrador en Asientos frecuentes para contabilizarlo con un clic.</p>}
      <div className="fila" style={{ marginBottom: 16 }}>
        {!plantilla && <label>Fecha<input type="date" name="fecha" defaultValue={inicial?.fecha ?? hoy} min={bloqueo ? siguienteDia(bloqueo) : undefined} required /></label>}
        <label style={{ flex: "2 1 280px" }}>Concepto<input name="concepto" required defaultValue={inicial?.concepto} placeholder="Ej.: Asiento de apertura" /></label>
        <label style={{ flex: "1 1 160px" }}>Referencia<input name="referencia" defaultValue={inicial?.referencia} placeholder="Factura, cheque…" /></label>
      </div>
      <input type="hidden" name="lineas" value={JSON.stringify(lineas)} />
      <div className="tabla-envoltura">
        <table>
          <thead>
            <tr><th style={{ minWidth: 260 }}>Cuenta</th><th>Descripción</th>{unidades.length > 0 && <th>Unidad</th>}<th className="num">Debe</th><th className="num">Haber</th><th /></tr>
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
                {unidades.length > 0 && (
                  <td><SelectorUnidad unidades={unidades} valor={l.unidad ?? ""} cambiar={(v) => cambiar(i, "unidad", v)} etiqueta={`Unidad de la línea ${i + 1}`} /></td>
                )}
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
              <td colSpan={unidades.length > 0 ? 3 : 2}>
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
        <button type="button" onClick={() => setLineas((ls) => [...ls, { ...vacia(), unidad: ls[ls.length - 1]?.unidad ?? "" }])}>+ Agregar línea</button>
        {plantilla && <button className="primario" disabled={enviando}>{enviando ? "Guardando…" : "Guardar plantilla"}</button>}
        {!plantilla && <button name="accion" value="borrador" disabled={enviando}>{enviando ? "Guardando…" : "Guardar borrador"}</button>}
        {!plantilla && puedeContabilizar && (
          <button className="primario" name="accion" value="contabilizar" disabled={enviando || diferencia !== 0n || totalDebe === 0n}>
            {enviando ? "Guardando…" : "Contabilizar"}
          </button>
        )}
      </div>
      {!plantilla && !puedeContabilizar && <p className="sub" style={{ marginTop: 8 }}>Se guardará como borrador para que otra persona con permiso lo contabilice.</p>}
      {estado.duplicado && (
        <label className="aviso" style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
          <input type="checkbox" name="confirmar_duplicado" style={{ minHeight: 0 }} /> Es otro asiento distinto: registrarlo de todas formas
        </label>
      )}
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
    </form>
  );
}

function siguienteDia(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
