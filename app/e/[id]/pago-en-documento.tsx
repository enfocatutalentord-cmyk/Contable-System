import { Formulario } from "@/app/formulario";
import type { Estado } from "../../acciones-cuenta";
import { FORMAS_PAGO } from "@/lib/compras";
import { hoyISO, verMonto } from "@/lib/montos";

const FORMAS_COBRO: Record<string, string> = {
  transferencia: "Transferencia o depósito", efectivo: "Efectivo", cheque: "Cheque", tarjeta: "Tarjeta", permuta: "Permuta (trueque)", otro: "Otra forma",
};

// Rediseño, n.º 9: el cobro de una factura o el pago de una compra de un cliente sin contabilidad se anota dentro del documento.
// Es lo que piden el 606, el 607, el IT-1 y el IR-17: la fecha, la forma y las retenciones. No hace asiento.
export function PagoEnDocumento({ tipo, accion, saldo, moneda, retenciones }: {
  tipo: "cobro" | "pago";
  accion: (estado: Estado, fd: FormData) => Promise<Estado>;
  saldo: string;
  moneda: string;
  retenciones: { id: string; nombre: string }[];
}) {
  const cobro = tipo === "cobro";
  const formas = cobro ? FORMAS_COBRO : Object.fromEntries(Object.entries(FORMAS_PAGO).map(([k, v]) => [k, `${k} · ${v}`]));
  const retencion = (i: number) => (
    <div className="fila" key={i}>
      <label style={{ flex: "2 1 240px" }}>{i === 1 ? "Retención (si hubo)" : "Otra retención"}
        <select name={`ret${i}`} defaultValue="">
          <option value="">Ninguna</option>
          {retenciones.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
      </label>
      <label style={{ width: 160 }}>Monto retenido<input name={`ret${i}_monto`} inputMode="decimal" placeholder="0.00" /></label>
    </div>
  );
  return (
    <details className="tarjeta" style={{ marginBottom: 16 }}>
      <summary><strong>{cobro ? "Registrar el cobro" : "Registrar el pago"}</strong> · saldo {moneda === "USD" ? "US$" : "RD$"}{verMonto(saldo)}</summary>
      <p className="sub" style={{ marginTop: 8 }}>
        {cobro
          ? "Cuándo y cómo pagó el cliente y si le retuvo ITBIS o ISR: va al 607 y al IT-1. No hace asiento: a este cliente no se le lleva contabilidad."
          : "Cuándo y cómo se pagó y las retenciones que se hicieron: va al 606, al IT-1 y al IR-17. No hace asiento: a este cliente no se le lleva contabilidad."}
      </p>
      <Formulario accion={accion} boton={cobro ? "Registrar el cobro" : "Registrar el pago"}>
        <div className="fila">
          <label>Fecha<input type="date" name="fecha" defaultValue={hoyISO()} required /></label>
          <label style={{ flex: "2 1 220px" }}>{cobro ? "Cómo pagó" : "Forma de pago (606)"}
            <select name="forma_pago" defaultValue={cobro ? "transferencia" : "02"}>
              {Object.entries(formas).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label style={{ width: 170 }}>Monto que salda<input name="aplicado" inputMode="decimal" defaultValue={saldo} /></label>
          {moneda === "USD" && <label style={{ width: 130 }}>Tasa del día<input name="tasa" inputMode="decimal" required /></label>}
          <label style={{ flex: "1 1 160px" }}>Referencia<input name="referencia" maxLength={60} placeholder="N.º de transferencia o cheque" /></label>
        </div>
        {retencion(1)}
        {retencion(2)}
        <p className="sub" style={{ margin: 0 }}>{cobro ? "Lo recibido" : "Lo pagado"} es el monto que salda menos las retenciones.</p>
      </Formulario>
    </details>
  );
}
