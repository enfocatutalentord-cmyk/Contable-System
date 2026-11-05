"use client";

import { useActionState, useState } from "react";
import type { Estado } from "@/app/acciones-cuenta";
import { alEnviar } from "@/app/enviar";
import { SelectorUnidad, type UnidadOpcion } from "@/app/unidad";
import { verMonto } from "@/lib/montos";
import type { ClienteFactura, ImpuestoFactura, ServicioFactura } from "../facturas/nueva/formulario-factura";

// Propuesta de servicios (bloque 2c): el precio de lista sale de la categoría del cliente y el descuento se ve aparte.
export type LineaForm = { servicioId: string; descripcion: string; cantidad: string; precio: string; descuento: string; impuesto: string; adicional: string; unidad: string };
export type InicialPropuesta = {
  cliente: string; fecha: string; validaHasta: string; requisitos: string; anticipo: string; formaPago: string; entrega: string; notas: string; lineas: LineaForm[];
};

const num = (v: string) => { const n = Number(v.replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const sumarDias = (f: string, d: number) => { const x = new Date(`${f}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

export function FormularioPropuesta({ accion, clientes, servicios, impuestos, impuestoPorDefecto, unidades, hoy, inicial }: {
  accion: (e: Estado, fd: FormData) => Promise<Estado>; clientes: ClienteFactura[]; servicios: ServicioFactura[]; impuestos: ImpuestoFactura[];
  impuestoPorDefecto: string; unidades: UnidadOpcion[]; hoy: string; inicial?: InicialPropuesta;
}) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const vacia = (): LineaForm => ({ servicioId: "", descripcion: "", cantidad: "1", precio: "", descuento: "", impuesto: impuestoPorDefecto, adicional: "", unidad: "" });
  const [clienteId, setClienteId] = useState(inicial?.cliente ?? "");
  const [anticipo, setAnticipo] = useState(inicial?.anticipo ?? "60");
  const [lineas, setLineas] = useState<LineaForm[]>(inicial?.lineas.length ? inicial.lineas : [vacia()]);
  const cliente = clientes.find((c) => c.id === clienteId);
  const porId = new Map(impuestos.map((i) => [i.id, i]));
  const principales = impuestos.filter((i) => i.tipo === "itbis" || i.tipo === "exento");
  const precioDe = (s: ServicioFactura, cat: string | null | undefined) => (cat && s.precios[cat]) || s.precio;
  const cambiar = (i: number, campo: keyof LineaForm, v: string) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: v } : l)));
  const elegirServicio = (i: number, sid: string) => {
    const s = servicios.find((x) => x.id === sid);
    setLineas((ls) => ls.map((l, j) => j !== i ? l : s
      ? { ...l, servicioId: sid, descripcion: s.nombre, precio: precioDe(s, cliente?.categoria), impuesto: s.impuesto_id ?? impuestoPorDefecto,
          adicional: s.impuesto_adicional_id ?? "", unidad: s.unidad_id ?? l.unidad }
      : { ...l, servicioId: "" }));
  };
  const elegirCliente = (cid: string) => {
    setClienteId(cid);
    const c = clientes.find((x) => x.id === cid);
    setLineas((ls) => ls.map((l) => { const s = servicios.find((x) => x.id === l.servicioId); return s ? { ...l, precio: precioDe(s, c?.categoria) } : l; }));
  };
  const calc = lineas.map((l) => {
    const lista = r2(num(l.cantidad) * num(l.precio));
    const final = r2(num(l.cantidad) * (num(l.precio) - num(l.descuento)));
    const imp = [l.impuesto, l.adicional].reduce((s, id) => s + (porId.get(id) ? r2((final * Number(porId.get(id)!.tasa)) / 100) : 0), 0);
    return { lista, final, imp };
  });
  const lista = calc.reduce((s, c) => s + c.lista, 0);
  const final = calc.reduce((s, c) => s + c.final, 0);
  const total = final + calc.reduce((s, c) => s + c.imp, 0);
  const malDescuento = lineas.some((l) => num(l.descuento) > num(l.precio));

  return (
    <form onSubmit={alEnviar(enviar)}>
      <div className="fila" style={{ marginBottom: 12 }}>
        <label style={{ flex: "2 1 260px" }}>Cliente
          <select name="cliente" value={clienteId} onChange={(e) => elegirCliente(e.target.value)} required>
            <option value="">Elige el cliente…</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.rnc ? ` · ${c.rnc}` : ""}</option>)}
          </select>
        </label>
        <label>Fecha<input type="date" name="fecha" defaultValue={inicial?.fecha ?? hoy} required /></label>
        <label>Válida hasta<input type="date" name="valida_hasta" defaultValue={inicial?.validaHasta ?? sumarDias(hoy, 15)} required /></label>
        <label>Entrega estimada<input type="date" name="entrega" defaultValue={inicial?.entrega ?? ""} /></label>
      </div>
      {cliente && !cliente.categoria && <p className="sub">Este cliente no tiene categoría: se usa el precio general de cada servicio.</p>}
      <input type="hidden" name="lineas" value={JSON.stringify(lineas)} />
      <div className="tabla-envoltura">
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 170 }}>Servicio</th><th style={{ minWidth: 200 }}>Descripción</th><th className="num">Cantidad</th>
              <th className="num">Precio de lista</th><th className="num">Descuento</th><th className="num">Precio final</th><th>ITBIS</th>
              {unidades.length > 0 && <th>Unidad</th>}<th />
            </tr>
          </thead>
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
                <td className="num"><input aria-label={`Cantidad de la línea ${i + 1}`} inputMode="decimal" value={l.cantidad} onChange={(e) => cambiar(i, "cantidad", e.target.value)} style={{ width: 70, textAlign: "right" }} /></td>
                <td className="num"><input aria-label={`Precio de lista de la línea ${i + 1}`} inputMode="decimal" value={l.precio} onChange={(e) => cambiar(i, "precio", e.target.value)} style={{ width: 110, textAlign: "right" }} /></td>
                <td className="num"><input aria-label={`Descuento de la línea ${i + 1}`} inputMode="decimal" value={l.descuento} onChange={(e) => cambiar(i, "descuento", e.target.value)} style={{ width: 100, textAlign: "right" }} /></td>
                <td className="num">{verMonto(calc[i].final)}</td>
                <td>
                  <select aria-label={`ITBIS de la línea ${i + 1}`} value={l.impuesto} onChange={(e) => cambiar(i, "impuesto", e.target.value)}>
                    {principales.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </td>
                {unidades.length > 0 && <td><SelectorUnidad unidades={unidades} valor={l.unidad} cambiar={(v) => cambiar(i, "unidad", v)} etiqueta={`Unidad de la línea ${i + 1}`} /></td>}
                <td><button type="button" title="Quitar línea" onClick={() => setLineas((ls) => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)} disabled={lineas.length <= 1}>×</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>Totales</td><td className="num">{verMonto(lista)}</td><td className="num">{verMonto(lista - final)}</td><td className="num">{verMonto(final)}</td><td colSpan={unidades.length ? 3 : 2} /></tr>
            <tr><td colSpan={5}>Total con impuestos</td><td className="num"><strong>{verMonto(total)}</strong></td><td colSpan={unidades.length ? 3 : 2} /></tr>
          </tfoot>
        </table>
      </div>
      <div className="fila" style={{ marginTop: 12 }}>
        <button type="button" onClick={() => setLineas((ls) => [...ls, vacia()])}>+ Agregar servicio</button>
      </div>
      <div className="fila" style={{ marginTop: 12 }}>
        <label style={{ width: 130 }}>Anticipo (%)<input name="anticipo" inputMode="decimal" value={anticipo} onChange={(e) => setAnticipo(e.target.value)} /></label>
        <p className="sub" style={{ margin: 0, alignSelf: "end" }}>= RD${verMonto(r2((total * num(anticipo)) / 100))} antes de empezar; el resto, al entregar.</p>
        <label style={{ flex: "2 1 260px" }}>Forma de pago<input name="forma_pago" defaultValue={inicial?.formaPago ?? ""} placeholder="Transferencia, efectivo, trueque…" /></label>
      </div>
      <label style={{ marginTop: 12 }}>Requisitos (lo que el cliente debe entregar)<textarea name="requisitos" rows={3} defaultValue={inicial?.requisitos} /></label>
      <label style={{ marginTop: 12 }}>Notas<textarea name="notas" rows={2} defaultValue={inicial?.notas} /></label>
      <div className="fila" style={{ marginTop: 12 }}>
        <button className="primario" disabled={enviando || !clienteId || final <= 0 || malDescuento}>{enviando ? "Guardando…" : "Guardar propuesta"}</button>
      </div>
      {malDescuento && <p className="error">El descuento no puede pasar del precio de lista.</p>}
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
    </form>
  );
}
