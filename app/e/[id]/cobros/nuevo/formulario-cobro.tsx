"use client";

import { useActionState, useMemo, useState } from "react";
import type { Estado } from "@/app/acciones-cuenta";
import { verFecha, verMonto } from "@/lib/montos";

type Cliente = { id: string; nombre: string };
type Pendiente = { id: string; ncf: string; fecha: string; vence: string; moneda: string; total: string; itbis: string; saldo: string; cliente_id: string };
type Cuenta = { id: string; codigo: string; nombre: string };

const cent = (v: string) => {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const texto = (c: number) => (c / 100).toFixed(2);

export function FormularioCobro({ accion, clientes, pendientes, cuentas, hoy, clienteInicial, facturaInicial }: {
  accion: (estado: Estado, fd: FormData) => Promise<Estado>;
  clientes: Cliente[];
  pendientes: Pendiente[];
  cuentas: Cuenta[];
  hoy: string;
  clienteInicial: string;
  facturaInicial: string;
}) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const [clienteId, setClienteId] = useState(clienteInicial);
  const deCliente = useMemo(() => pendientes.filter((p) => p.cliente_id === clienteId), [pendientes, clienteId]);
  const monedas = [...new Set(deCliente.map((p) => p.moneda))];
  const [moneda, setMoneda] = useState(deCliente[0]?.moneda ?? "DOP");
  const visibles = deCliente.filter((p) => p.moneda === moneda);
  const [aplicar, setAplicar] = useState<Record<string, string>>(() =>
    facturaInicial ? { [facturaInicial]: pendientes.find((p) => p.id === facturaInicial)?.saldo ?? "" } : {});
  const [retItbis, setRetItbis] = useState("");
  const [retIsr, setRetIsr] = useState("");

  const totalAplicado = visibles.reduce((s, p) => s + (cent(aplicar[p.id] ?? "") || 0), 0);
  const retenciones = (cent(retItbis) || 0) + (cent(retIsr) || 0);
  const recibido = totalAplicado - retenciones;

  const elegirCliente = (id: string) => {
    setClienteId(id);
    setAplicar({});
    const primera = pendientes.find((p) => p.cliente_id === id);
    setMoneda(primera?.moneda ?? "DOP");
  };
  const marcar = (p: Pendiente, si: boolean) => setAplicar((a) => ({ ...a, [p.id]: si ? p.saldo : "" }));

  // 30 % del ITBIS de lo aplicado: la retención habitual de personas jurídicas a servicios (Norma 02-05).
  const sugerirItbis = () => {
    const c = visibles.reduce((s, p) => {
      const ap = cent(aplicar[p.id] ?? "") || 0;
      return s + (ap * cent(p.itbis)) / cent(p.total) * 0.3;
    }, 0);
    setRetItbis(texto(Math.round(c)));
  };

  const aplicaciones = visibles.filter((p) => (cent(aplicar[p.id] ?? "") || 0) > 0).map((p) => ({ facturaId: p.id, monto: aplicar[p.id] }));

  return (
    <form action={enviar}>
      <div className="fila" style={{ marginBottom: 16 }}>
        <label style={{ flex: "2 1 260px" }}>Cliente
          <select name="cliente" value={clienteId} onChange={(e) => elegirCliente(e.target.value)} required>
            <option value="">Elige el cliente…</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label>Fecha<input type="date" name="fecha" defaultValue={hoy} required /></label>
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

      <div className="fila" style={{ marginBottom: 12 }}>
        <label style={{ width: 160 }}>ITBIS retenido<input name="retencion_itbis" inputMode="decimal" value={retItbis} onChange={(e) => setRetItbis(e.target.value)} placeholder="0.00" /></label>
        <button type="button" onClick={sugerirItbis} disabled={totalAplicado === 0}>30 % del ITBIS</button>
        <label style={{ width: 160 }}>ISR retenido<input name="retencion_isr" inputMode="decimal" value={retIsr} onChange={(e) => setRetIsr(e.target.value)} placeholder="0.00" /></label>
        <label style={{ width: 160 }}>Recibido<input name="recibido" readOnly value={texto(recibido)} aria-describedby="ayuda-recibido" /></label>
      </div>
      <p className="sub" id="ayuda-recibido">Recibido = lo aplicado menos las retenciones que el cliente hizo y pagará a la DGII a tu nombre.</p>
      <div className="fila" style={{ marginBottom: 12 }}>
        <label style={{ flex: "1 1 240px" }}>Entró a
          <select name="cuenta_destino" required defaultValue={cuentas.find((c) => c.codigo === "110103")?.id ?? ""}>
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
        <label style={{ flex: "1 1 180px" }}>Referencia<input name="referencia" placeholder="N.º de transferencia o cheque" /></label>
      </div>
      <label>Notas<textarea name="notas" rows={2} /></label>
      <div className="fila" style={{ marginTop: 12 }}>
        <button className="primario" disabled={enviando || aplicaciones.length === 0 || recibido < 0}>{enviando ? "Guardando…" : "Registrar cobro"}</button>
      </div>
      {recibido < 0 && <p className="error">Las retenciones no pueden pasar de lo aplicado.</p>}
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
    </form>
  );
}
