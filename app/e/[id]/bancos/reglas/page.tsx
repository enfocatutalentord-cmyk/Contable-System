import Link from "next/link";
import { redirect } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { listarCuentasBancarias } from "@/lib/bancos";
import { listarReglas, type Regla } from "@/lib/conciliacion";
import { listarCuentas, type Cuenta } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { puede } from "@/lib/permisos";
import { agregarReglasSugeridas, borrarRegla, guardarRegla } from "../../bancos-acciones";

export const metadata = { title: "Reglas del banco · Empire Tax’N Legal" };

const DIRECCION: Record<string, string> = { sale: "Sale del banco", entra: "Entra al banco", ambas: "Entra o sale" };

function Campos({ r, cuentas, bancos }: { r?: Regla; cuentas: Cuenta[]; bancos: { id: string; nombre: string }[] }) {
  return (
    <>
      <label style={{ flex: "1 1 200px" }}>Nombre<input name="nombre" required maxLength={100} defaultValue={r?.nombre} placeholder="Comisiones del banco" /></label>
      <label style={{ flex: "2 1 300px" }}>La descripción contiene (separa con comas)
        <input name="textos" required maxLength={500} defaultValue={r?.textos} placeholder="comision, cargo por servicio" />
      </label>
      <label style={{ flex: "0 1 170px" }}>Dirección
        <select name="direccion" defaultValue={r?.direccion ?? "sale"}>
          {Object.entries(DIRECCION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label style={{ flex: "0 1 130px" }}>Monto desde<input name="monto_desde" inputMode="decimal" defaultValue={r?.monto_desde ?? ""} /></label>
      <label style={{ flex: "0 1 130px" }}>Monto hasta<input name="monto_hasta" inputMode="decimal" defaultValue={r?.monto_hasta ?? ""} /></label>
      <label style={{ flex: "2 1 260px" }}>Se registra en
        <select name="cuenta_id" required defaultValue={r?.cuenta_id ?? ""}>
          <option value="" disabled>Elige…</option>
          {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
        </select>
      </label>
      <label style={{ flex: "2 1 220px" }}>Concepto del asiento<input name="concepto" maxLength={200} defaultValue={r?.concepto} /></label>
      <label style={{ flex: "1 1 200px" }}>Cuenta bancaria
        <select name="cuenta_bancaria_id" defaultValue={r?.cuenta_bancaria_id ?? ""}>
          <option value="">Todas</option>
          {bancos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
        </select>
      </label>
    </>
  );
}

// Reglas del banco, como las «bank rules» de Xero: dicen en qué cuenta se registra un movimiento que se repite (comisiones,
// impuesto a las transferencias, cargos fijos). Solo sugieren; una persona confirma cada movimiento.
export default async function Reglas({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ agregadas?: string; faltan?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  if (!puede(permisos, "catalogo")) redirect(`/e/${id}/bancos?sin_permiso=1`);
  const { reglas, cuentas, bancos } = await conEmpresa(id, async (tx) => ({
    reglas: await listarReglas(tx),
    cuentas: (await listarCuentas(tx)).filter((c) => c.de_detalle && c.activa),
    bancos: (await listarCuentasBancarias(tx)).map((b) => ({ id: b.id, nombre: b.nombre })),
  }));

  return (
    <>
      <p className="sub" style={{ marginBottom: 4 }}><Link href={`/e/${id}/bancos`}>← Bancos</Link></p>
      <h1>Reglas del banco</h1>
      <p className="sub">
        Si la descripción del movimiento contiene alguno de los textos, se sugiere registrarlo en la cuenta de la regla. La
        regla nunca registra sola: en la conciliación aparece «Registrar y conciliar» para confirmarlo.
      </p>

      {sp.agregadas && (
        <p className="exito" role="status">
          Se agregaron {sp.agregadas} regla{sp.agregadas === "1" ? "" : "s"}.{sp.faltan && /^[\d,]+$/.test(sp.faltan) && ` Falta en el catálogo la cuenta ${sp.faltan.split(",").join(" y ")}.`}
        </p>
      )}
      {reglas.map((r) => (
        <details key={r.id} className="tarjeta" style={{ marginBottom: 12 }}>
          <summary>
            <strong>{r.nombre}</strong>{!r.activa && " (inactiva)"} · {DIRECCION[r.direccion].toLowerCase()} · «{r.textos}» → {r.cuenta}
          </summary>
          <Formulario accion={guardarRegla.bind(null, id, r.id)} boton="Guardar" className="fila">
            <Campos r={r} cuentas={cuentas} bancos={bancos} />
            <label className="casilla" style={{ flex: "0 1 120px" }}><input type="checkbox" name="activa" defaultChecked={r.activa} /> Activa</label>
          </Formulario>
          <Formulario accion={borrarRegla.bind(null, id, r.id)} boton="Borrar regla" className="fila"><span /></Formulario>
        </details>
      ))}
      {reglas.length === 0 && (
        <div className="tarjeta" style={{ marginBottom: 12 }}>
          <p style={{ marginTop: 0 }}>Todavía no hay reglas. Puedes empezar con las sugeridas: comisiones y cargos del banco (620101) e impuesto a cheques y transferencias (620104; 0.20 % desde el 3 de julio de 2026, Ley 30-26).</p>
          <Formulario accion={agregarReglasSugeridas.bind(null, id)} boton="Agregar reglas sugeridas" className="fila"><span /></Formulario>
        </div>
      )}

      <div className="tarjeta" style={{ marginTop: 20 }}>
        <h2 style={{ marginTop: 0 }}>Nueva regla</h2>
        <Formulario accion={guardarRegla.bind(null, id, null)} boton="Agregar regla" className="fila">
          <Campos cuentas={cuentas} bancos={bancos} />
        </Formulario>
      </div>
    </>
  );
}
