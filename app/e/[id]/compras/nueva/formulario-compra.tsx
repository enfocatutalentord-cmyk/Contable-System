"use client";

import { alEnviar } from "@/app/enviar";
import { useActionState, useState } from "react";
import type { Estado } from "@/app/acciones-cuenta";
import { verMonto } from "@/lib/montos";

export type ProveedorCompra = {
  id: string; nombre: string; rnc: string | null; tipo_identificacion: string | null; dias_credito: number;
  tipo_gasto: string | null; cuenta_gasto_id: string | null; del_exterior: boolean;
};
export type CuentaCompra = { id: string; codigo: string; nombre: string };
export type ImpuestoCompra = { id: string; nombre: string; tipo: string; tasa: string; vigente_desde: string; vigente_hasta: string | null };
export type LineaCompra = { descripcion: string; clase: string; cuenta: string; cantidad: string; precio: string; impuesto: string; adicional: string };
export type InicialCompra = {
  proveedor: string; tipo: string; ncf: string; fecha: string; vence: string; moneda: string; tasa: string; tipoGasto: string;
  itbisAlCosto: boolean; notas: string; lineas: LineaCompra[];
};
export type OrigenNota = { id: string; ncf: string; proveedor: string; moneda: string; tasa: string; tipoGasto: string; tipo: string };

const DEL_PROVEEDOR: [string, string][] = [
  ["B01", "B01 · Crédito fiscal"], ["B02", "B02 · Consumo"], ["B14", "B14 · Régimen especial"], ["B15", "B15 · Gubernamental"],
  ["E31", "E31 · Crédito fiscal electrónica"], ["E32", "E32 · Consumo electrónica"], ["E44", "E44 · Régimen especial electrónica"],
  ["E45", "E45 · Gubernamental electrónica"],
];
const PROPIOS: [string, string][] = [["B11", "B11 · Compras (proveedor informal)"], ["B13", "B13 · Gastos menores"], ["B17", "B17 · Pagos al exterior"]];
const SIN_CREDITO = ["B02", "E32", "B13"];
const esPropio = (t: string) => PROPIOS.some(([k]) => k === t);

function num(v: string): number {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function FormularioCompra({ accion, proveedores, cuentas, impuestos, impuestoPorDefecto, cuentaPorDefecto, tiposGasto, hoy, puedeRegistrar, inicial, origen }: {
  accion: (estado: Estado, fd: FormData) => Promise<Estado>;
  proveedores: ProveedorCompra[];
  cuentas: CuentaCompra[];
  impuestos: ImpuestoCompra[];
  impuestoPorDefecto: string;
  cuentaPorDefecto: string;
  tiposGasto: Record<string, string>;
  hoy: string;
  puedeRegistrar: boolean;
  inicial?: InicialCompra;
  origen?: OrigenNota;
}) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const [proveedorId, setProveedorId] = useState(inicial?.proveedor ?? origen?.proveedor ?? "");
  const proveedor = proveedores.find((p) => p.id === proveedorId);
  const vacia = (cuenta = proveedor?.cuenta_gasto_id ?? cuentaPorDefecto): LineaCompra =>
    ({ descripcion: "", clase: "servicio", cuenta, cantidad: "1", precio: "", impuesto: impuestoPorDefecto, adicional: "" });
  const [tipo, setTipo] = useState(inicial?.tipo ?? origen?.tipo ?? "B01");
  const [fecha, setFecha] = useState(inicial?.fecha ?? hoy);
  const [vence, setVence] = useState(inicial?.vence ?? hoy);
  const [moneda, setMoneda] = useState(inicial?.moneda ?? origen?.moneda ?? "DOP");
  const [tipoGasto, setTipoGasto] = useState(inicial?.tipoGasto ?? origen?.tipoGasto ?? "02");
  const [alCosto, setAlCosto] = useState(inicial?.itbisAlCosto ?? false);
  const [lineas, setLineas] = useState<LineaCompra[]>(inicial?.lineas.length ? inicial.lineas : [vacia()]);
  const vigentes = impuestos.filter((i) => i.vigente_desde <= fecha && (!i.vigente_hasta || i.vigente_hasta >= fecha));
  const principales = vigentes.filter((i) => i.tipo === "itbis" || i.tipo === "exento");
  const adicionales = vigentes.filter((i) => i.tipo !== "itbis" && i.tipo !== "exento");
  const porId = new Map(impuestos.map((i) => [i.id, i]));
  const sinCredito = SIN_CREDITO.includes(tipo);

  const elegirProveedor = (id: string) => {
    setProveedorId(id);
    const p = proveedores.find((x) => x.id === id);
    if (!p) return;
    setVence(sumarDias(fecha, p.dias_credito));
    if (p.tipo_gasto) setTipoGasto(p.tipo_gasto);
    if (!origen) setTipo(p.del_exterior ? "B17" : p.rnc ? "B01" : "B02");
    setLineas((ls) => ls.map((l) => (l.descripcion || l.precio ? l : { ...l, cuenta: p.cuenta_gasto_id ?? cuentaPorDefecto })));
  };
  const cambiar = (i: number, campo: keyof LineaCompra, valor: string) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));

  const calc = lineas.map((l) => {
    const sub = r2(num(l.cantidad) * num(l.precio));
    const imp = (id: string) => (porId.get(id) ? r2((sub * Number(porId.get(id)!.tasa)) / 100) : 0);
    const esItbis = porId.get(l.impuesto)?.tipo === "itbis";
    return { sub, itbis: esItbis ? imp(l.impuesto) : 0, otros: (l.adicional ? imp(l.adicional) : 0) + (esItbis ? 0 : imp(l.impuesto)) };
  });
  const subtotal = calc.reduce((s, c) => s + c.sub, 0);
  const itbis = calc.reduce((s, c) => s + c.itbis, 0);
  const otros = calc.reduce((s, c) => s + c.otros, 0);
  const total = subtotal + itbis + otros;
  const lineaInvalida = lineas.some((l) => (l.descripcion || l.precio) && (!principales.some((p) => p.id === l.impuesto) || !l.cuenta));
  const columnas = adicionales.length ? 7 : 6;

  return (
    <form onSubmit={alEnviar(enviar)}>
      {origen && <input type="hidden" name="origen" value={origen.id} />}
      <div className="fila" style={{ marginBottom: 16 }}>
        <label style={{ flex: "2 1 260px" }}>Proveedor
          <select name="proveedor" value={proveedorId} onChange={(e) => elegirProveedor(e.target.value)} required disabled={!!origen}>
            <option value="">Elige el proveedor…</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.rnc ? ` · ${p.rnc}` : ""}</option>)}
          </select>
        </label>
        {origen && <input type="hidden" name="proveedor" value={proveedorId} />}
        <label style={{ flex: "1 1 220px" }}>Comprobante
          {origen ? (
            <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="B04">B04 · Nota de crédito</option><option value="E34">E34 · Nota de crédito electrónica</option>
            </select>
          ) : (
            <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <optgroup label="Lo entrega el proveedor">{DEL_PROVEEDOR.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</optgroup>
              <optgroup label="Lo emites tú">{PROPIOS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</optgroup>
            </select>
          )}
        </label>
        {esPropio(tipo) ? (
          <div style={{ flex: "1 1 180px" }} className="sub">NCF: se asigna de tu rango {tipo} al registrar</div>
        ) : (
          <label style={{ flex: "1 1 180px" }}>NCF del proveedor<input name="ncf" defaultValue={inicial?.ncf} placeholder={tipo.startsWith("E") ? `${tipo}0000000001` : `${tipo}00000001`} style={{ textTransform: "uppercase" }} /></label>
        )}
        <label>Fecha<input type="date" name="fecha" value={fecha} onChange={(e) => { setFecha(e.target.value); if (proveedor) setVence(sumarDias(e.target.value, proveedor.dias_credito)); }} required /></label>
        <label>Vence<input type="date" name="vence" value={vence} min={fecha} onChange={(e) => setVence(e.target.value)} required /></label>
        <label>Moneda
          <select name="moneda" value={moneda} onChange={(e) => setMoneda(e.target.value)} disabled={!!origen}>
            <option value="DOP">Pesos (DOP)</option><option value="USD">Dólares (USD)</option>
          </select>
        </label>
        {origen && <input type="hidden" name="moneda" value={moneda} />}
        {moneda === "USD" && <label style={{ width: 120 }}>Tasa<input name="tasa" inputMode="decimal" placeholder="60.50" defaultValue={inicial?.tasa ?? origen?.tasa} required readOnly={!!origen} /></label>}
      </div>
      <div className="fila" style={{ marginBottom: 16 }}>
        <label style={{ flex: "2 1 320px" }}>Tipo de gasto (formato 606)
          <select name="tipo_gasto" value={tipoGasto} onChange={(e) => setTipoGasto(e.target.value)}>
            {Object.entries(tiposGasto).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
          </select>
        </label>
        <label className="casilla" style={{ alignSelf: "center" }}>
          <input type="checkbox" name="itbis_al_costo" checked={alCosto || sinCredito} disabled={sinCredito} onChange={(e) => setAlCosto(e.target.checked)} />
          ITBIS al costo (sin crédito fiscal)
        </label>
        {sinCredito && <span className="sub" style={{ margin: 0, flex: "1 1 220px" }}>Un {tipo} no da crédito de ITBIS: va al gasto.</span>}
      </div>
      <input type="hidden" name="lineas" value={JSON.stringify(lineas)} />
      <div className="tabla-envoltura">
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 200 }}>Descripción</th><th>Tipo</th><th style={{ minWidth: 200 }}>Cuenta</th><th className="num">Cantidad</th>
              <th className="num">Precio</th><th>ITBIS</th>{adicionales.length > 0 && <th>Otro cargo</th>}<th className="num">Importe</th><th />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td><input aria-label={`Descripción de la línea ${i + 1}`} value={l.descripcion} onChange={(e) => cambiar(i, "descripcion", e.target.value)} style={{ width: "100%" }} /></td>
                <td>
                  <select aria-label={`Tipo de la línea ${i + 1}`} value={l.clase} onChange={(e) => cambiar(i, "clase", e.target.value)}>
                    <option value="servicio">Servicio</option><option value="bien">Bien</option>
                  </select>
                </td>
                <td>
                  <select aria-label={`Cuenta de la línea ${i + 1}`} value={l.cuenta} onChange={(e) => cambiar(i, "cuenta", e.target.value)} style={{ width: "100%" }}>
                    {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                  </select>
                </td>
                <td className="num"><input aria-label={`Cantidad de la línea ${i + 1}`} inputMode="decimal" value={l.cantidad} onChange={(e) => cambiar(i, "cantidad", e.target.value)} style={{ width: 80, textAlign: "right" }} /></td>
                <td className="num"><input aria-label={`Precio de la línea ${i + 1}`} inputMode="decimal" value={l.precio} onChange={(e) => cambiar(i, "precio", e.target.value)} style={{ width: 120, textAlign: "right" }} /></td>
                <td>
                  <select aria-label={`ITBIS de la línea ${i + 1}`} value={l.impuesto} onChange={(e) => cambiar(i, "impuesto", e.target.value)}>
                    {!principales.some((p) => p.id === l.impuesto) && <option value={l.impuesto}>Elige…</option>}
                    {principales.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </td>
                {adicionales.length > 0 && (
                  <td>
                    <select aria-label={`Otro cargo de la línea ${i + 1}`} value={l.adicional} onChange={(e) => cambiar(i, "adicional", e.target.value)}>
                      <option value="">Ninguno</option>
                      {adicionales.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </td>
                )}
                <td className="num">{verMonto(calc[i].sub)}</td>
                <td><button type="button" title="Quitar línea" onClick={() => setLineas((ls) => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)} disabled={lineas.length <= 1}>×</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={columnas}>Subtotal</td><td className="num">{verMonto(subtotal)}</td><td /></tr>
            <tr><td colSpan={columnas}>ITBIS{(alCosto || sinCredito) && " (al costo)"}</td><td className="num">{verMonto(itbis)}</td><td /></tr>
            {otros > 0 && <tr><td colSpan={columnas}>Otros cargos</td><td className="num">{verMonto(otros)}</td><td /></tr>}
            <tr><td colSpan={columnas}>Total {moneda === "USD" ? "US$" : "RD$"}</td><td className="num">{verMonto(total)}</td><td /></tr>
          </tfoot>
        </table>
      </div>
      <div className="fila" style={{ marginTop: 12 }}>
        <button type="button" onClick={() => setLineas((ls) => [...ls, vacia()])}>+ Agregar línea</button>
      </div>
      <label style={{ marginTop: 12 }}>Notas<textarea name="notas" rows={2} defaultValue={inicial?.notas} /></label>
      <div className="fila" style={{ marginTop: 12 }}>
        <button name="accion" value="borrador" disabled={enviando || !proveedorId || total <= 0 || lineaInvalida}>Guardar borrador</button>
        {puedeRegistrar && (
          <button className="primario" name="accion" value="registrar" disabled={enviando || !proveedorId || total <= 0 || lineaInvalida}>
            {enviando ? "Guardando…" : origen ? "Registrar nota de crédito" : "Registrar compra"}
          </button>
        )}
      </div>
      <p className="sub" style={{ marginTop: 8 }}>
        El borrador no tiene asiento y se puede cambiar. Al registrar se contabiliza: gasto, costo o activo e ITBIS pagado
        (si da crédito) contra cuentas por pagar. El mismo NCF del mismo proveedor no se puede registrar dos veces.
      </p>
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
    </form>
  );
}
