"use client";

import { alEnviar } from "@/app/enviar";
import { useActionState, useMemo, useState } from "react";
import type { Estado } from "@/app/acciones-cuenta";
import { verFecha, verMonto } from "@/lib/montos";

type Cliente = { id: string; nombre: string; retenciones: string[] };
type Pendiente = {
  id: string; ncf: string; fecha: string; vence: string; moneda: string; total: string; itbis: string; subtotal: string; saldo: string; cliente_id: string;
};
type Cuenta = { id: string; codigo: string; nombre: string };
type Retencion = { id: string; nombre: string; impuesto: "itbis" | "isr"; tasa: string; vigente_desde: string; vigente_hasta: string | null };

const cent = (v: string) => {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const texto = (c: number) => (c / 100).toFixed(2);

export function FormularioCobro({ accion, clientes, pendientes, cuentas, retenciones, hoy, clienteInicial, facturaInicial, banco }: {
  accion: (estado: Estado, fd: FormData) => Promise<Estado>;
  clientes: Cliente[];
  pendientes: Pendiente[];
  cuentas: Cuenta[];
  retenciones: Retencion[];
  hoy: string;
  clienteInicial: string;
  facturaInicial: string;
  banco?: { movimientoId: string; fecha: string; referencia: string | null; cuentaId: string; monto: string }; // desde un movimiento del banco
}) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const [clienteId, setClienteId] = useState(clienteInicial);
  const [fecha, setFecha] = useState(banco?.fecha ?? hoy);
  const deCliente = useMemo(() => pendientes.filter((p) => p.cliente_id === clienteId), [pendientes, clienteId]);
  const monedas = [...new Set(deCliente.map((p) => p.moneda))];
  const [moneda, setMoneda] = useState(deCliente[0]?.moneda ?? "DOP");
  const visibles = deCliente.filter((p) => p.moneda === moneda);
  const [aplicar, setAplicar] = useState<Record<string, string>>(() =>
    facturaInicial ? { [facturaInicial]: pendientes.find((p) => p.id === facturaInicial)?.saldo ?? "" } : {});
  const habituales = (id: string) => new Set(clientes.find((c) => c.id === id)?.retenciones ?? []);
  const [marcadas, setMarcadas] = useState<Set<string>>(() => habituales(clienteInicial));
  // Monto escrito a mano por retención; si no hay, se usa el sugerido.
  const [manual, setManual] = useState<Record<string, string>>({});

  const vigentes = retenciones.filter((r) => r.vigente_desde <= fecha && (!r.vigente_hasta || r.vigente_hasta >= fecha));
  const aplicadas = visibles.map((p) => ({ p, ap: cent(aplicar[p.id] ?? "") || 0 })).filter((x) => x.ap > 0);
  const totalAplicado = aplicadas.reduce((s, x) => s + x.ap, 0);
  // Bases proporcionales a lo aplicado de cada factura: ITBIS facturado y monto sin impuestos.
  const baseItbis = aplicadas.reduce((s, { p, ap }) => s + (ap * cent(p.itbis)) / cent(p.total), 0);
  const baseIsr = aplicadas.reduce((s, { p, ap }) => s + (ap * cent(p.subtotal)) / cent(p.total), 0);
  const sugerido = (r: Retencion) => Math.round(((r.impuesto === "itbis" ? baseItbis : baseIsr) * Number(r.tasa)) / 100);
  const montoDe = (r: Retencion) => (manual[r.id] !== undefined ? cent(manual[r.id]) || 0 : sugerido(r));
  const elegidas = vigentes.filter((r) => marcadas.has(r.id));
  const totalRetenido = elegidas.reduce((s, r) => s + montoDe(r), 0);
  const recibido = totalAplicado - totalRetenido;

  const elegirCliente = (id: string) => {
    setClienteId(id);
    setAplicar({});
    setManual({});
    setMarcadas(habituales(id));
    setMoneda(pendientes.find((p) => p.cliente_id === id)?.moneda ?? "DOP");
  };
  const marcar = (p: Pendiente, si: boolean) => setAplicar((a) => ({ ...a, [p.id]: si ? p.saldo : "" }));
  const marcarRetencion = (id: string, si: boolean) => setMarcadas((m) => {
    const n = new Set(m);
    if (si) n.add(id); else n.delete(id);
    return n;
  });

  const aplicaciones = aplicadas.map(({ p }) => ({ facturaId: p.id, monto: aplicar[p.id] }));
  const retencionesEnviar = elegidas.filter((r) => montoDe(r) > 0).map((r) => ({ retencionId: r.id, monto: texto(montoDe(r)) }));

  return (
    <form onSubmit={alEnviar(enviar)}>
      <div className="fila" style={{ marginBottom: 16 }}>
        <label style={{ flex: "2 1 260px" }}>Cliente
          <select name="cliente" value={clienteId} onChange={(e) => elegirCliente(e.target.value)} required>
            <option value="">Elige el cliente…</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label>Fecha<input type="date" name="fecha" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></label>
        {monedas.length > 1 && (
          <label>Moneda
            <select value={moneda} onChange={(e) => { setMoneda(e.target.value); setAplicar({}); }}>
              {monedas.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        )}
        <input type="hidden" name="moneda" value={moneda} />
        {moneda === "USD" && <label style={{ width: 130 }}>Tasa del día<input name="tasa" inputMode="decimal" required /></label>}
      </div>

      {clienteId && (
        <div className="tabla-envoltura" style={{ marginBottom: 16 }}>
          <table>
            <thead><tr><th /><th>NCF</th><th>Fecha</th><th>Vence</th><th className="num">Total</th><th className="num">Saldo</th><th className="num">Aplicar</th></tr></thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id}>
                  <td><input type="checkbox" aria-label={`Cobrar ${p.ncf}`} checked={!!aplicar[p.id]} onChange={(e) => marcar(p, e.target.checked)} style={{ minHeight: 0 }} /></td>
                  <td>{p.ncf}</td>
                  <td>{verFecha(p.fecha)}</td>
                  <td className={p.vence < hoy ? "error" : undefined}>{verFecha(p.vence)}</td>
                  <td className="num">{verMonto(p.total)}</td>
                  <td className="num">{verMonto(p.saldo)}</td>
                  <td className="num"><input aria-label={`Monto a aplicar a ${p.ncf}`} inputMode="decimal" value={aplicar[p.id] ?? ""} onChange={(e) => setAplicar((a) => ({ ...a, [p.id]: e.target.value }))} style={{ width: 130, textAlign: "right" }} /></td>
                </tr>
              ))}
              {visibles.length === 0 && <tr><td colSpan={7}>Este cliente no tiene facturas pendientes.</td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={6}>Total aplicado</td><td className="num">{verMonto(totalAplicado / 100)}</td></tr></tfoot>
          </table>
        </div>
      )}
      <input type="hidden" name="aplicaciones" value={JSON.stringify(aplicaciones)} />
      <input type="hidden" name="retenciones" value={JSON.stringify(retencionesEnviar)} />

      <h2>Retenciones que te hizo el cliente</h2>
      <div className="tabla-envoltura" style={{ marginBottom: 12 }}>
        <table>
          <thead><tr><th /><th>Retención</th><th>Se calcula sobre</th><th className="num">Base</th><th className="num">Sugerido</th><th className="num">Monto</th></tr></thead>
          <tbody>
            {vigentes.map((r) => {
              const base = r.impuesto === "itbis" ? baseItbis : baseIsr;
              return (
                <tr key={r.id}>
                  <td><input type="checkbox" aria-label={`Aplica ${r.nombre}`} checked={marcadas.has(r.id)} onChange={(e) => marcarRetencion(r.id, e.target.checked)} style={{ minHeight: 0 }} /></td>
                  <td>{r.nombre}</td>
                  <td>{r.impuesto === "itbis" ? "ITBIS facturado" : "Monto sin impuestos"}</td>
                  <td className="num">{verMonto(Math.round(base) / 100)}</td>
                  <td className="num">{verMonto(sugerido(r) / 100)}</td>
                  <td className="num">
                    <input aria-label={`Monto de ${r.nombre}`} inputMode="decimal" disabled={!marcadas.has(r.id)} style={{ width: 120, textAlign: "right" }}
                      value={marcadas.has(r.id) ? manual[r.id] ?? texto(sugerido(r)) : ""} onChange={(e) => setManual((m) => ({ ...m, [r.id]: e.target.value }))} />
                  </td>
                </tr>
              );
            })}
            {vigentes.length === 0 && <tr><td colSpan={6}>No hay retenciones vigentes en esa fecha.</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={5}>Total retenido</td><td className="num">{verMonto(totalRetenido / 100)}</td></tr></tfoot>
        </table>
      </div>

      <div className="fila" style={{ marginBottom: 12 }}>
        <label style={{ width: 180 }}>Recibido en banco o caja<input name="recibido" readOnly value={texto(recibido)} aria-describedby="ayuda-recibido" /></label>
        <p className="sub" id="ayuda-recibido" style={{ margin: 0, flex: "1 1 300px" }}>
          Lo aplicado menos las retenciones, que el cliente paga a la DGII a tu nombre (quedan como saldo a tu favor).
        </p>
      </div>
      <div className="fila" style={{ marginBottom: 12 }}>
        <label style={{ flex: "1 1 240px" }}>Entró a
          <select name="cuenta_destino" required defaultValue={banco?.cuentaId ?? cuentas.find((c) => c.codigo === "110103")?.id ?? ""}>
            <option value="" disabled>Elige banco o caja…</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </label>
        <label>Forma de pago
          <select name="forma_pago" defaultValue="transferencia">
            <option value="transferencia">Transferencia</option><option value="cheque">Cheque</option>
            <option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="otro">Otro</option>
          </select>
        </label>
        <label style={{ flex: "1 1 180px" }}>Referencia<input name="referencia" placeholder="N.º de transferencia o cheque" defaultValue={banco?.referencia ?? ""} /></label>
      </div>
      <label>Notas<textarea name="notas" rows={2} /></label>
      {banco && <input type="hidden" name="movimiento" value={banco.movimientoId} />}
      <div className="fila" style={{ marginTop: 12 }}>
        <button className="primario" disabled={enviando || aplicaciones.length === 0 || recibido < 0}>{enviando ? "Guardando…" : "Registrar cobro"}</button>
      </div>
      {recibido < 0 && <p className="error">Las retenciones no pueden pasar de lo aplicado.</p>}
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
    </form>
  );
}
