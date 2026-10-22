"use client";

import { alEnviar } from "@/app/enviar";
import { useActionState, useMemo, useState } from "react";
import type { Estado } from "@/app/acciones-cuenta";
import { verFecha, verMonto } from "@/lib/montos";

type Proveedor = { id: string; nombre: string; retenciones: string[] };
type Pendiente = {
  id: string; ncf: string; fecha: string; vence: string; moneda: string; total: string; itbis: string; subtotal: string; saldo: string; proveedor_id: string;
};
type Cuenta = { id: string; codigo: string; nombre: string };
type Retencion = { id: string; nombre: string; impuesto: "itbis" | "isr"; tasa: string; vigente_desde: string; vigente_hasta: string | null };

const cent = (v: string) => {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const texto = (c: number) => (c / 100).toFixed(2);

export function FormularioPago({ accion, proveedores, pendientes, cuentas, retenciones, formasPago, hoy, proveedorInicial, compraInicial }: {
  accion: (estado: Estado, fd: FormData) => Promise<Estado>;
  proveedores: Proveedor[];
  pendientes: Pendiente[];
  cuentas: Cuenta[];
  retenciones: Retencion[];
  formasPago: Record<string, string>;
  hoy: string;
  proveedorInicial: string;
  compraInicial: string;
}) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const [proveedorId, setProveedorId] = useState(proveedorInicial);
  const [fecha, setFecha] = useState(hoy);
  const deProveedor = useMemo(() => pendientes.filter((p) => p.proveedor_id === proveedorId), [pendientes, proveedorId]);
  const monedas = [...new Set(deProveedor.map((p) => p.moneda))];
  const [moneda, setMoneda] = useState(deProveedor[0]?.moneda ?? "DOP");
  const visibles = deProveedor.filter((p) => p.moneda === moneda);
  const [aplicar, setAplicar] = useState<Record<string, string>>(() =>
    compraInicial ? { [compraInicial]: pendientes.find((p) => p.id === compraInicial)?.saldo ?? "" } : {});
  const habituales = (id: string) => new Set(proveedores.find((c) => c.id === id)?.retenciones ?? []);
  const [marcadas, setMarcadas] = useState<Set<string>>(() => habituales(proveedorInicial));
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
  const pagado = totalAplicado - totalRetenido;

  const elegirProveedor = (id: string) => {
    setProveedorId(id);
    setAplicar({});
    setManual({});
    setMarcadas(habituales(id));
    setMoneda(pendientes.find((p) => p.proveedor_id === id)?.moneda ?? "DOP");
  };
  const marcar = (p: Pendiente, si: boolean) => setAplicar((a) => ({ ...a, [p.id]: si ? p.saldo : "" }));
  const marcarRetencion = (id: string, si: boolean) => setMarcadas((m) => {
    const n = new Set(m);
    if (si) n.add(id); else n.delete(id);
    return n;
  });

  const aplicaciones = aplicadas.map(({ p }) => ({ compraId: p.id, monto: aplicar[p.id] }));
  const retencionesEnviar = elegidas.filter((r) => montoDe(r) > 0).map((r) => ({ retencionId: r.id, monto: texto(montoDe(r)) }));

  return (
    <form onSubmit={alEnviar(enviar)}>
      <div className="fila" style={{ marginBottom: 16 }}>
        <label style={{ flex: "2 1 260px" }}>Proveedor
          <select name="proveedor" value={proveedorId} onChange={(e) => elegirProveedor(e.target.value)} required>
            <option value="">Elige el proveedor…</option>
            {proveedores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
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

      {proveedorId && (
        <div className="tabla-envoltura" style={{ marginBottom: 16 }}>
          <table>
            <thead><tr><th /><th>NCF</th><th>Fecha</th><th>Vence</th><th className="num">Total</th><th className="num">Saldo</th><th className="num">Aplicar</th></tr></thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id}>
                  <td><input type="checkbox" aria-label={`Pagar ${p.ncf}`} checked={!!aplicar[p.id]} onChange={(e) => marcar(p, e.target.checked)} style={{ minHeight: 0 }} /></td>
                  <td>{p.ncf}</td>
                  <td>{verFecha(p.fecha)}</td>
                  <td className={p.vence < hoy ? "error" : undefined}>{verFecha(p.vence)}</td>
                  <td className="num">{verMonto(p.total)}</td>
                  <td className="num">{verMonto(p.saldo)}</td>
                  <td className="num"><input aria-label={`Monto a aplicar a ${p.ncf}`} inputMode="decimal" value={aplicar[p.id] ?? ""} onChange={(e) => setAplicar((a) => ({ ...a, [p.id]: e.target.value }))} style={{ width: 130, textAlign: "right" }} /></td>
                </tr>
              ))}
              {visibles.length === 0 && <tr><td colSpan={7}>No hay compras pendientes de este proveedor.</td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={6}>Total aplicado</td><td className="num">{verMonto(totalAplicado / 100)}</td></tr></tfoot>
          </table>
        </div>
      )}
      <input type="hidden" name="aplicaciones" value={JSON.stringify(aplicaciones)} />
      <input type="hidden" name="retenciones" value={JSON.stringify(retencionesEnviar)} />

      <h2>Retenciones que le haces al proveedor</h2>
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
        <label style={{ width: 180 }}>Sale del banco o caja<input name="pagado" readOnly value={texto(pagado)} aria-describedby="ayuda-pagado" /></label>
        <p className="sub" id="ayuda-pagado" style={{ margin: 0, flex: "1 1 300px" }}>
          Lo aplicado menos las retenciones. Lo retenido lo pagas tú a la DGII (IR-17 o IT-1) a nombre del proveedor.
        </p>
      </div>
      <div className="fila" style={{ marginBottom: 12 }}>
        <label style={{ flex: "1 1 240px" }}>Salió de
          <select name="cuenta_origen" required defaultValue={cuentas.find((c) => c.codigo === "110103")?.id ?? ""}>
            <option value="" disabled>Elige banco o caja…</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </label>
        <label>Forma de pago (606)
          <select name="forma_pago" defaultValue="02">
            {Object.entries(formasPago).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
          </select>
        </label>
        <label style={{ flex: "1 1 180px" }}>Referencia<input name="referencia" placeholder="N.º de transferencia o cheque" /></label>
      </div>
      <label>Notas<textarea name="notas" rows={2} /></label>
      <div className="fila" style={{ marginTop: 12 }}>
        <button className="primario" disabled={enviando || aplicaciones.length === 0 || pagado < 0}>{enviando ? "Guardando…" : "Registrar pago"}</button>
      </div>
      {pagado < 0 && <p className="error">Las retenciones no pueden pasar de lo aplicado.</p>}
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
    </form>
  );
}
