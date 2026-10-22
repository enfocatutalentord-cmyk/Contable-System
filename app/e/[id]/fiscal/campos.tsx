import type { Cuenta } from "@/lib/cuentas";
import { CODIGOS_606, IMPUESTOS_RETENIDOS, porcentajeTexto, leerPorcentaje, TIPOS_IMPUESTO, type Impuesto, type Retencion } from "@/lib/fiscal";

const tasa = (t?: string) => (t ? porcentajeTexto(leerPorcentaje(t) ?? 0n) : "");
const fecha = (f?: string | null) => (f && f > "2000-01-01" ? f : "");

function SelectorCuenta({ nombre, etiqueta, ayuda, cuentas, valor, requerida = true }: {
  nombre: string; etiqueta: string; ayuda: string; cuentas: Cuenta[]; valor?: string | null; requerida?: boolean;
}) {
  return (
    <label style={{ flex: "1 1 300px" }}>
      <span><strong style={{ color: "var(--texto)" }}>{etiqueta}</strong> · {ayuda}</span>
      <select name={nombre} defaultValue={valor ?? ""} required={requerida}>
        <option value="">{requerida ? "Elige…" : "Ninguna (impuesto sin tasa)"}</option>
        {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
      </select>
    </label>
  );
}

function Vigencia({ desde, hasta, activo, edicion }: { desde?: string; hasta?: string | null; activo?: boolean; edicion: boolean }) {
  return (
    <div className="fila">
      <label>Vigente desde<input type="date" name="vigente_desde" defaultValue={fecha(desde)} /></label>
      <label>Vigente hasta<input type="date" name="vigente_hasta" defaultValue={fecha(hasta)} /></label>
      {edicion && <label className="casilla" style={{ alignSelf: "center" }}><input type="checkbox" name="activo" defaultChecked={activo} /> Activo</label>}
      <span className="sub" style={{ margin: 0, flex: "1 1 260px" }}>
        En blanco: sin límite. Cuando la ley cambie una tasa, cierra la vigencia de la anterior y crea la nueva desde la fecha del cambio.
      </span>
    </div>
  );
}

export function CamposImpuesto({ d, cuentas, edicion = false }: { d?: Impuesto; cuentas: Cuenta[]; edicion?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14 }}>
      <div className="fila">
        <label style={{ flex: "2 1 220px" }}>Nombre<input name="nombre" defaultValue={d?.nombre} placeholder="ITBIS 18 %" required /></label>
        <label style={{ flex: "1 1 200px" }}>Tipo
          <select name="tipo" defaultValue={d?.tipo ?? "itbis"}>
            {Object.entries(TIPOS_IMPUESTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label style={{ width: 130 }}>Tasa (%)<input name="tasa" inputMode="decimal" defaultValue={tasa(d?.tasa)} placeholder="18" /></label>
      </div>
      <div className="fila">
        <SelectorCuenta nombre="cuenta_ventas" etiqueta="Cuenta en ventas" ayuda="el impuesto cobrado (por pagar)" cuentas={cuentas} valor={d?.cuenta_ventas_id} requerida={false} />
        <SelectorCuenta nombre="cuenta_compras" etiqueta="Cuenta en compras" ayuda="el impuesto pagado que da crédito" cuentas={cuentas} valor={d?.cuenta_compras_id} requerida={false} />
      </div>
      <Vigencia desde={d?.vigente_desde} hasta={d?.vigente_hasta} activo={d?.activo} edicion={edicion} />
      <label>Base legal o nota<input name="nota" defaultValue={d?.nota ?? ""} placeholder="Norma o artículo que la sustenta" /></label>
    </div>
  );
}

export function CamposRetencion({ d, cuentas, edicion = false }: { d?: Retencion; cuentas: Cuenta[]; edicion?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14 }}>
      <div className="fila">
        <label style={{ flex: "2 1 240px" }}>Nombre<input name="nombre" defaultValue={d?.nombre} placeholder="ISR honorarios 15 %" required /></label>
        <label style={{ flex: "1 1 240px" }}>Impuesto retenido
          <select name="impuesto" defaultValue={d?.impuesto ?? "isr"}>
            {Object.entries(IMPUESTOS_RETENIDOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label style={{ width: 130 }}>Tasa (%)<input name="tasa" inputMode="decimal" defaultValue={tasa(d?.tasa)} placeholder="10" required /></label>
        <label style={{ flex: "1 1 240px" }}>Tipo de retención en el 606 (solo ISR)
          <select name="codigo_606" defaultValue={d?.codigo_606 ?? ""}>
            <option value="">—</option>
            {Object.entries(CODIGOS_606).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
          </select>
        </label>
      </div>
      <div className="fila">
        <SelectorCuenta nombre="cuenta_por_terceros" etiqueta="Cuando nos retienen" ayuda="un cliente nos retiene al pagar (activo)" cuentas={cuentas} valor={d?.cuenta_por_terceros_id} />
        <SelectorCuenta nombre="cuenta_a_terceros" etiqueta="Cuando retenemos" ayuda="retenemos a un proveedor; se paga a la DGII (pasivo)" cuentas={cuentas} valor={d?.cuenta_a_terceros_id} />
      </div>
      <Vigencia desde={d?.vigente_desde} hasta={d?.vigente_hasta} activo={d?.activo} edicion={edicion} />
      <label>Base legal o nota<input name="nota" defaultValue={d?.nota ?? ""} placeholder="Norma o artículo que la sustenta" /></label>
    </div>
  );
}
