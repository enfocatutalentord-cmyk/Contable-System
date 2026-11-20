// Abono o adelanto al facturar (Prioridad 1.2 del prompt de Patricia): opcional, en porcentaje o en monto. Al emitir la factura se aplica
// ese pago de una vez y sale su recibo; el resto queda en cuentas por cobrar.
export function CamposAbono({ cuentas }: { cuentas: { id: string; codigo: string; nombre: string }[] }) {
  return (
    <details style={{ flexBasis: "100%" }}>
      <summary>¿Hay abono o adelanto? (opcional)</summary>
      <div className="fila" style={{ marginTop: 8 }}>
        <label style={{ width: 130 }}>Abono<input name="abono" inputMode="decimal" placeholder="0.00" /></label>
        <label>En
          <select name="abono_tipo" defaultValue="monto"><option value="monto">Monto (RD$)</option><option value="porcentaje">Porcentaje (%)</option></select>
        </label>
        <label>Forma
          <select name="abono_forma" defaultValue="transferencia">
            <option value="transferencia">Transferencia o depósito</option><option value="efectivo">Efectivo</option>
            <option value="cheque">Cheque</option><option value="tarjeta">Tarjeta</option><option value="otro">Otra</option>
          </select>
        </label>
        <label style={{ flex: "2 1 220px" }}>Entró a
          <select name="abono_cuenta" defaultValue={cuentas[0]?.id ?? ""}>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </label>
        <label style={{ flex: "1 1 140px" }}>Referencia<input name="abono_referencia" maxLength={60} /></label>
      </div>
    </details>
  );
}
