"use client";

import { alEnviar } from "@/app/enviar";
import { useActionState, useState } from "react";
import type { Estado } from "@/app/acciones-cuenta";
import { verMonto } from "@/lib/montos";

type Cliente = { id: string; nombre: string; rnc: string | null; dias_credito: number };
type Servicio = { id: string; nombre: string; precio: string; tasa_itbis: string };
type Linea = { servicioId: string; descripcion: string; cantidad: string; precio: string; tasa: string };
const vacia = (): Linea => ({ servicioId: "", descripcion: "", cantidad: "1", precio: "", tasa: "18" });

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

export function FormularioFactura({ accion, clientes, servicios, hoy, disponibles }: {
  accion: (estado: Estado, fd: FormData) => Promise<Estado>;
  clientes: Cliente[];
  servicios: Servicio[];
  hoy: string;
  disponibles: Record<string, number>;
}) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const [clienteId, setClienteId] = useState("");
  const [tipo, setTipo] = useState("B01");
  const [fecha, setFecha] = useState(hoy);
  const [vence, setVence] = useState(hoy);
  const [moneda, setMoneda] = useState("DOP");
  const [lineas, setLineas] = useState<Linea[]>([vacia()]);
  const cliente = clientes.find((c) => c.id === clienteId);

  const elegirCliente = (id: string) => {
    setClienteId(id);
    const c = clientes.find((x) => x.id === id);
    if (c) {
      setVence(sumarDias(fecha, c.dias_credito));
      setTipo(c.rnc ? "B01" : "B02");
    }
  };
  const cambiar = (i: number, campo: keyof Linea, valor: string) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
  const elegirServicio = (i: number, id: string) => {
    const s = servicios.find((x) => x.id === id);
    setLineas((ls) => ls.map((l, j) => j !== i ? l : s
      ? { ...l, servicioId: id, descripcion: s.nombre, precio: s.precio, tasa: String(Number(s.tasa_itbis)) }
      : { ...l, servicioId: "" }));
  };

  // Vista previa; el servidor recalcula todo con centavos exactos.
  const calc = lineas.map((l) => {
    const sub = r2(num(l.cantidad) * num(l.precio));
    return { sub, itbis: r2((sub * num(l.tasa)) / 100) };
  });
  const subtotal = calc.reduce((s, c) => s + c.sub, 0);
  const itbis = calc.reduce((s, c) => s + c.itbis, 0);
  const sinRnc = cliente && !cliente.rnc && tipo !== "B02";

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
            <option value="B01">B01 · Crédito fiscal</option>
            <option value="B02">B02 · Consumo</option>
            <option value="B14">B14 · Régimen especial</option>
            <option value="B15">B15 · Gubernamental</option>
          </select>
        </label>
        <label>Fecha<input type="date" name="fecha" value={fecha} onChange={(e) => { setFecha(e.target.value); if (cliente) setVence(sumarDias(e.target.value, cliente.dias_credito)); }} required /></label>
        <label>Vence<input type="date" name="vence" value={vence} min={fecha} onChange={(e) => setVence(e.target.value)} required /></label>
        <label>Moneda
          <select name="moneda" value={moneda} onChange={(e) => setMoneda(e.target.value)}>
            <option value="DOP">Pesos (DOP)</option><option value="USD">Dólares (USD)</option>
          </select>
        </label>
        {moneda === "USD" && <label style={{ width: 120 }}>Tasa<input name="tasa" inputMode="decimal" placeholder="60.50" required /></label>}
      </div>
      {(disponibles[tipo] ?? 0) === 0 && <p className="aviso">No tienes comprobantes {tipo} disponibles. Agrégalos en Comprobantes NCF antes de facturar.</p>}
      {sinRnc && <p className="aviso">Este cliente no tiene RNC. Para {tipo} hace falta; usa B02 (consumo) o agrega su RNC.</p>}
      <input type="hidden" name="lineas" value={JSON.stringify(lineas)} />
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th style={{ minWidth: 180 }}>Servicio</th><th style={{ minWidth: 220 }}>Descripción</th><th className="num">Cantidad</th><th className="num">Precio</th><th>ITBIS</th><th className="num">Importe</th><th /></tr></thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td>
                  <select aria-label={`Servicio de la línea ${i + 1}`} value={l.servicioId} onChange={(e) => elegirServicio(i, e.target.value)} style={{ width: "100%" }}>
                    <option value="">Libre…</option>
                    {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </td>
                <td><input aria-label={`Descripción de la línea ${i + 1}`} value={l.descripcion} onChange={(e) => cambiar(i, "descripcion", e.target.value)} style={{ width: "100%" }} /></td>
                <td className="num"><input aria-label={`Cantidad de la línea ${i + 1}`} inputMode="decimal" value={l.cantidad} onChange={(e) => cambiar(i, "cantidad", e.target.value)} style={{ width: 80, textAlign: "right" }} /></td>
                <td className="num"><input aria-label={`Precio de la línea ${i + 1}`} inputMode="decimal" value={l.precio} onChange={(e) => cambiar(i, "precio", e.target.value)} style={{ width: 120, textAlign: "right" }} /></td>
                <td>
                  <select aria-label={`ITBIS de la línea ${i + 1}`} value={l.tasa} onChange={(e) => cambiar(i, "tasa", e.target.value)}>
                    <option value="18">18 %</option><option value="16">16 %</option><option value="0">Exento</option>
                  </select>
                </td>
                <td className="num">{verMonto(calc[i].sub)}</td>
                <td><button type="button" title="Quitar línea" onClick={() => setLineas((ls) => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)} disabled={lineas.length <= 1}>×</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={5}>Subtotal</td><td className="num">{verMonto(subtotal)}</td><td /></tr>
            <tr><td colSpan={5}>ITBIS</td><td className="num">{verMonto(itbis)}</td><td /></tr>
            <tr><td colSpan={5}>Total {moneda === "USD" ? "US$" : "RD$"}</td><td className="num">{verMonto(subtotal + itbis)}</td><td /></tr>
          </tfoot>
        </table>
      </div>
      <div className="fila" style={{ marginTop: 12 }}>
        <button type="button" onClick={() => setLineas((ls) => [...ls, vacia()])}>+ Agregar línea</button>
      </div>
      <label style={{ marginTop: 12 }}>Notas (salen en la factura)<textarea name="notas" rows={2} /></label>
      <div className="fila" style={{ marginTop: 12 }}>
        <button className="primario" disabled={enviando || !clienteId || subtotal + itbis <= 0 || !!sinRnc}>{enviando ? "Emitiendo…" : "Emitir factura"}</button>
      </div>
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
    </form>
  );
}
