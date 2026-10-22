"use client";

import { alEnviar } from "@/app/enviar";
import { useActionState, useState } from "react";
import type { Estado } from "@/app/acciones-cuenta";
import { verMonto } from "@/lib/montos";

export type ClienteFactura = { id: string; nombre: string; rnc: string | null; dias_credito: number; ncf_predeterminado: string | null };
export type ServicioFactura = { id: string; nombre: string; precio: string; impuesto_id: string | null; impuesto_adicional_id: string | null };
export type ImpuestoFactura = { id: string; nombre: string; tipo: string; tasa: string; vigente_desde: string; vigente_hasta: string | null };
export type Linea = { servicioId: string; descripcion: string; cantidad: string; precio: string; impuesto: string; adicional: string };
export type InicialFactura = {
  cliente: string; tipo: string; fecha: string; vence: string; moneda: string; tasa: string; notas: string; lineas: Linea[];
};

const TIPOS: [string, string][] = [
  ["B01", "B01 · Crédito fiscal"], ["B02", "B02 · Consumo"], ["B14", "B14 · Régimen especial"],
  ["B15", "B15 · Gubernamental"], ["B16", "B16 · Exportaciones"],
];
const CON_RNC = ["B01", "B14", "B15"];

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

export function FormularioFactura({ accion, clientes, servicios, impuestos, impuestoPorDefecto, hoy, disponibles, puedeEmitir, inicial }: {
  accion: (estado: Estado, fd: FormData) => Promise<Estado>;
  clientes: ClienteFactura[];
  servicios: ServicioFactura[];
  impuestos: ImpuestoFactura[];
  impuestoPorDefecto: string;
  hoy: string;
  disponibles: Record<string, number>;
  puedeEmitir: boolean;
  inicial?: InicialFactura;
}) {
  const vacia = (): Linea => ({ servicioId: "", descripcion: "", cantidad: "1", precio: "", impuesto: impuestoPorDefecto, adicional: "" });
  const [estado, enviar, enviando] = useActionState(accion, {});
  const [clienteId, setClienteId] = useState(inicial?.cliente ?? "");
  const [tipo, setTipo] = useState(inicial?.tipo ?? "B01");
  const [fecha, setFecha] = useState(inicial?.fecha ?? hoy);
  const [vence, setVence] = useState(inicial?.vence ?? hoy);
  const [moneda, setMoneda] = useState(inicial?.moneda ?? "DOP");
  const [lineas, setLineas] = useState<Linea[]>(inicial?.lineas.length ? inicial.lineas : [vacia()]);
  const cliente = clientes.find((c) => c.id === clienteId);
  // Solo los impuestos vigentes en la fecha de la factura.
  const vigentes = impuestos.filter((i) => i.vigente_desde <= fecha && (!i.vigente_hasta || i.vigente_hasta >= fecha));
  const principales = vigentes.filter((i) => i.tipo === "itbis" || i.tipo === "exento");
  const adicionales = vigentes.filter((i) => i.tipo !== "itbis" && i.tipo !== "exento");
  const porId = new Map(impuestos.map((i) => [i.id, i]));

  const elegirCliente = (id: string) => {
    setClienteId(id);
    const c = clientes.find((x) => x.id === id);
    if (c) {
      setVence(sumarDias(fecha, c.dias_credito));
      setTipo(c.ncf_predeterminado ?? (c.rnc ? "B01" : "B02"));
    }
  };
  const cambiar = (i: number, campo: keyof Linea, valor: string) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
  const elegirServicio = (i: number, id: string) => {
    const s = servicios.find((x) => x.id === id);
    setLineas((ls) => ls.map((l, j) => j !== i ? l : s
      ? { ...l, servicioId: id, descripcion: s.nombre, precio: s.precio, impuesto: s.impuesto_id ?? impuestoPorDefecto, adicional: s.impuesto_adicional_id ?? "" }
      : { ...l, servicioId: "" }));
  };

  // Vista previa; el servidor recalcula todo con centavos exactos y las tasas vigentes.
  const calc = lineas.map((l) => {
    const sub = r2(num(l.cantidad) * num(l.precio));
    const imp = (id: string) => (porId.get(id) ? r2((sub * Number(porId.get(id)!.tasa)) / 100) : 0);
    const esItbis = (id: string) => porId.get(id)?.tipo === "itbis";
    return { sub, itbis: (esItbis(l.impuesto) ? imp(l.impuesto) : 0), otros: (l.adicional ? imp(l.adicional) : 0) + (esItbis(l.impuesto) ? 0 : imp(l.impuesto)) };
  });
  const subtotal = calc.reduce((s, c) => s + c.sub, 0);
  const itbis = calc.reduce((s, c) => s + c.itbis, 0);
  const otros = calc.reduce((s, c) => s + c.otros, 0);
  const total = subtotal + itbis + otros;
  const sinRnc = cliente && !cliente.rnc && CON_RNC.includes(tipo);
  const lineaInvalida = lineas.some((l) => (l.descripcion || l.precio) && !principales.some((p) => p.id === l.impuesto));

  return (
    <form onSubmit={alEnviar(enviar)}>
      <div className="fila" style={{ marginBottom: 16 }}>
        <label style={{ flex: "2 1 260px" }}>Cliente
          <select name="cliente" value={clienteId} onChange={(e) => elegirCliente(e.target.value)} required>
            <option value="">Elige el cliente…</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.rnc ? ` · ${c.rnc}` : ""}</option>)}
          </select>
        </label>
        <label>Comprobante
          <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPOS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Fecha<input type="date" name="fecha" value={fecha} onChange={(e) => { setFecha(e.target.value); if (cliente) setVence(sumarDias(e.target.value, cliente.dias_credito)); }} required /></label>
        <label>Vence<input type="date" name="vence" value={vence} min={fecha} onChange={(e) => setVence(e.target.value)} required /></label>
        <label>Moneda
          <select name="moneda" value={moneda} onChange={(e) => setMoneda(e.target.value)}>
            <option value="DOP">Pesos (DOP)</option><option value="USD">Dólares (USD)</option>
          </select>
        </label>
        {moneda === "USD" && <label style={{ width: 120 }}>Tasa<input name="tasa" inputMode="decimal" placeholder="60.50" defaultValue={inicial?.tasa} required /></label>}
      </div>
      {(disponibles[tipo] ?? 0) === 0 && <p className="aviso">No tienes comprobantes {tipo} disponibles. Puedes guardar el borrador; para emitir, agrega el rango en Comprobantes fiscales.</p>}
      {sinRnc && <p className="aviso">Este cliente no tiene RNC ni cédula. Para {tipo} hace falta: usa B02 (consumo) o agrega su identificación.</p>}
      <input type="hidden" name="lineas" value={JSON.stringify(lineas)} />
      <div className="tabla-envoltura">
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 170 }}>Producto o servicio</th><th style={{ minWidth: 200 }}>Descripción</th><th className="num">Cantidad</th>
              <th className="num">Precio</th><th>ITBIS</th>{adicionales.length > 0 && <th>Otro cargo</th>}<th className="num">Importe</th><th />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td>
                  <select aria-label={`Producto de la línea ${i + 1}`} value={l.servicioId} onChange={(e) => elegirServicio(i, e.target.value)} style={{ width: "100%" }}>
                    <option value="">Libre…</option>
                    {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </td>
                <td><input aria-label={`Descripción de la línea ${i + 1}`} value={l.descripcion} onChange={(e) => cambiar(i, "descripcion", e.target.value)} style={{ width: "100%" }} /></td>
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
            <tr><td colSpan={adicionales.length ? 6 : 5}>Subtotal</td><td className="num">{verMonto(subtotal)}</td><td /></tr>
            <tr><td colSpan={adicionales.length ? 6 : 5}>ITBIS</td><td className="num">{verMonto(itbis)}</td><td /></tr>
            {otros > 0 && <tr><td colSpan={adicionales.length ? 6 : 5}>Otros cargos</td><td className="num">{verMonto(otros)}</td><td /></tr>}
            <tr><td colSpan={adicionales.length ? 6 : 5}>Total {moneda === "USD" ? "US$" : "RD$"}</td><td className="num">{verMonto(total)}</td><td /></tr>
          </tfoot>
        </table>
      </div>
      <div className="fila" style={{ marginTop: 12 }}>
        <button type="button" onClick={() => setLineas((ls) => [...ls, vacia()])}>+ Agregar línea</button>
      </div>
      <label style={{ marginTop: 12 }}>Notas (salen en la factura)<textarea name="notas" rows={2} defaultValue={inicial?.notas} /></label>
      <div className="fila" style={{ marginTop: 12 }}>
        <button name="accion" value="borrador" disabled={enviando || !clienteId || total <= 0 || lineaInvalida}>Guardar borrador</button>
        {puedeEmitir && (
          <button className="primario" name="accion" value="emitir" disabled={enviando || !clienteId || total <= 0 || !!sinRnc || lineaInvalida}>
            {enviando ? "Guardando…" : "Emitir factura"}
          </button>
        )}
      </div>
      <p className="sub" style={{ marginTop: 8 }}>
        El borrador no tiene NCF ni asiento y se puede cambiar. Al emitir toma el siguiente NCF y registra el asiento;
        después solo se corrige con una nota de crédito o anulándola.
      </p>
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
    </form>
  );
}
