import { accesoEmpresa } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { calcularOperacion, leerPorcentaje, listarImpuestos, listarRetenciones, perfilFiscal, verPorcentaje } from "@/lib/fiscal";
import { aCentavos, deCentavos, hoyISO, leerMonto, verFecha, verMonto } from "@/lib/montos";
import { fechaValida } from "@/lib/reportes";

const FILAS = 3;
type Movimiento = { cuenta: string; debe: bigint; haber: bigint };

function Asiento({ titulo, movimientos }: { titulo: string; movimientos: Movimiento[] }) {
  const lineas = movimientos.filter((m) => m.debe > 0n || m.haber > 0n);
  const debe = lineas.reduce((s, m) => s + m.debe, 0n);
  const haber = lineas.reduce((s, m) => s + m.haber, 0n);
  return (
    <div style={{ flex: "1 1 420px" }}>
      <h3>{titulo}</h3>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cuenta</th><th className="num">Debe</th><th className="num">Haber</th></tr></thead>
          <tbody>
            {lineas.map((m, i) => (
              <tr key={i}><td>{m.cuenta}</td><td className="num">{verMonto(deCentavos(m.debe), true)}</td><td className="num">{verMonto(deCentavos(m.haber), true)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td>Totales {debe === haber ? "· cuadra" : "· NO CUADRA"}</td><td className="num">{verMonto(deCentavos(debe))}</td><td className="num">{verMonto(deCentavos(haber))}</td></tr></tfoot>
        </table>
      </div>
    </div>
  );
}

// Vista previa: con la configuración de este cliente, cuánto impuesto y retención sale y qué asientos generaría.
export default async function ProbarCalculo({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  await accesoEmpresa(id);
  const uno = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? "";
  const operacion = uno("operacion") === "compra" ? "compra" : "venta";
  const fecha = fechaValida(uno("fecha")) ? uno("fecha") : hoyISO();
  const elegidas = new Set([sp.retencion ?? []].flat());

  const { impuestos, retenciones, perfil, cuentas } = await conEmpresa(id, async (tx) => ({
    impuestos: await listarImpuestos(tx, fecha),
    retenciones: await listarRetenciones(tx, fecha),
    perfil: await perfilFiscal(tx),
    cuentas: await listarCuentas(tx),
  }));
  const nombre = new Map(cuentas.map((c) => [c.id, `${c.codigo} · ${c.nombre}`]));
  const porId = new Map(impuestos.map((i) => [i.id, i]));

  const adicionales = impuestos.filter((i) => i.tipo !== "itbis" && i.tipo !== "exento");
  const filas = Array.from({ length: FILAS }, (_, n) => ({ monto: uno(`monto${n}`), impuesto: uno(`impuesto${n}`), adicional: uno(`adicional${n}`) }));
  const lineas = filas.flatMap((f) => {
    const m = leerMonto(f.monto);
    const imps = [porId.get(f.impuesto), porId.get(f.adicional)].filter((i) => i !== undefined);
    return m && imps.length && aCentavos(m) > 0n
      ? [{ monto: aCentavos(m), impuestos: imps.map((i) => ({ tasa: leerPorcentaje(i.tasa) ?? 0n, tipo: i.tipo, config: i })) }]
      : [];
  });
  const usadas = retenciones.filter((r) => elegidas.has(r.id));
  const calculo = lineas.length ? calcularOperacion(lineas, usadas.map((r) => ({ impuesto: r.impuesto, tasa: leerPorcentaje(r.tasa) ?? 0n }))) : null;

  let documento: Movimiento[] = [];
  let liquidacion: Movimiento[] = [];
  if (calculo) {
    type Config = (typeof lineas)[number]["impuestos"][number]["config"];
    const impuestosPorCuenta = (cuenta: (i: Config) => string) => {
      const m = new Map<string, bigint>();
      calculo.lineas.forEach((l, n) => l.montos.forEach((monto, k) => {
        const c = cuenta(lineas[n].impuestos[k].config);
        if (monto > 0n) m.set(c, (m.get(c) ?? 0n) + monto);
      }));
      return [...m.entries()];
    };
    if (operacion === "venta") {
      documento = [
        { cuenta: "Cuentas por cobrar (se elige en Ventas)", debe: calculo.total, haber: 0n },
        { cuenta: "Ingresos (según el servicio o producto)", debe: 0n, haber: calculo.subtotal },
        ...impuestosPorCuenta((i) => nombre.get(i.cuenta_ventas_id!) ?? "—").map(([cuenta, v]) => ({ cuenta, debe: 0n, haber: v })),
      ];
      liquidacion = [
        { cuenta: "Banco o caja", debe: calculo.neto, haber: 0n },
        ...calculo.retenciones.map((r, i) => ({ cuenta: `${nombre.get(usadas[i].cuenta_por_terceros_id)} (${usadas[i].nombre})`, debe: r.monto, haber: 0n })),
        { cuenta: "Cuentas por cobrar", debe: 0n, haber: calculo.total },
      ];
    } else {
      // Sin derecho a crédito (no contribuyente de ITBIS) o impuestos que no son ITBIS: van al costo o gasto.
      const conCredito = (tipo: string) => tipo === "itbis" && perfil.contribuye_itbis;
      const alCosto = calculo.lineas.reduce((s, l) => s + l.montos.reduce((t, m, k) => t + (conCredito(l.impuestos[k].tipo) ? 0n : m), 0n), 0n);
      documento = [
        { cuenta: `Gasto, costo o activo (según la compra)${alCosto > 0n ? " · incluye impuestos sin crédito" : ""}`, debe: calculo.subtotal + alCosto, haber: 0n },
        ...impuestosPorCuenta((i) => (conCredito(i.tipo) ? nombre.get(i.cuenta_compras_id!) ?? "—" : ""))
          .filter(([cuenta]) => cuenta).map(([cuenta, v]) => ({ cuenta, debe: v, haber: 0n })),
        { cuenta: "Cuentas por pagar (se elige en Compras)", debe: 0n, haber: calculo.total },
      ];
      liquidacion = [
        { cuenta: "Cuentas por pagar", debe: calculo.total, haber: 0n },
        { cuenta: "Banco o caja", debe: 0n, haber: calculo.neto },
        ...calculo.retenciones.map((r, i) => ({ cuenta: `${nombre.get(usadas[i].cuenta_a_terceros_id)} (${usadas[i].nombre})`, debe: 0n, haber: r.monto })),
      ];
    }
  }

  return (
    <>
      <h1>Probar cálculo</h1>
      <p className="sub">
        Con la configuración de este cliente a la fecha que elijas: cuánto impuesto y retención resulta y qué asientos se
        generarían. Es solo una vista previa: no registra nada.
      </p>
      <form className="tarjeta" style={{ display: "grid", gap: 14 }}>
        <div className="fila">
          <label>Operación
            <select name="operacion" defaultValue={operacion}>
              <option value="venta">Venta (nos retienen al cobrar)</option>
              <option value="compra">Compra (retenemos al pagar)</option>
            </select>
          </label>
          <label>Fecha<input type="date" name="fecha" defaultValue={fecha} /></label>
        </div>
        {filas.map((f, n) => (
          <div className="fila" key={n}>
            <label style={{ width: 180 }}>Monto sin impuestos{n > 0 && " (opcional)"}<input name={`monto${n}`} inputMode="decimal" defaultValue={f.monto} placeholder="0.00" /></label>
            <label style={{ flex: "1 1 240px" }}>Impuesto
              <select name={`impuesto${n}`} defaultValue={f.impuesto || impuestos[0]?.id}>
                {impuestos.map((i) => <option key={i.id} value={i.id}>{i.nombre} ({verPorcentaje(i.tasa)})</option>)}
              </select>
            </label>
            {adicionales.length > 0 && (
              <label style={{ flex: "1 1 220px" }}>Otro cargo sobre el mismo monto
                <select name={`adicional${n}`} defaultValue={f.adicional}>
                  <option value="">Ninguno</option>
                  {adicionales.map((i) => <option key={i.id} value={i.id}>{i.nombre} ({verPorcentaje(i.tasa)})</option>)}
                </select>
              </label>
            )}
          </div>
        ))}
        <div>
          <div className="sub" style={{ margin: 0 }}>Retenciones vigentes al {verFecha(fecha)}</div>
          <div className="casillas">
            {retenciones.map((r) => (
              <label key={r.id} className="casilla"><input type="checkbox" name="retencion" value={r.id} defaultChecked={elegidas.has(r.id)} /> {r.nombre}</label>
            ))}
            {retenciones.length === 0 && <span className="sub">No hay retenciones vigentes en esa fecha.</span>}
          </div>
        </div>
        <div><button className="primario">Calcular</button></div>
      </form>

      {!perfil.contribuye_itbis && (
        <p className="aviso" style={{ marginTop: 16 }}>
          Este cliente no está marcado como contribuyente de ITBIS: en compras, el ITBIS pagado va al costo o gasto porque no da crédito.
        </p>
      )}

      {calculo && (
        <>
          <h2>Resultado</h2>
          <div className="cifras">
            <div className="tarjeta cifra"><div className="etiqueta">Monto sin impuestos</div><div className="valor">{verMonto(deCentavos(calculo.subtotal))}</div></div>
            <div className="tarjeta cifra"><div className="etiqueta">ITBIS</div><div className="valor">{verMonto(deCentavos(calculo.itbis))}</div></div>
            {calculo.otros > 0n && <div className="tarjeta cifra"><div className="etiqueta">Otros impuestos</div><div className="valor">{verMonto(deCentavos(calculo.otros))}</div></div>}
            <div className="tarjeta cifra"><div className="etiqueta">Total del comprobante</div><div className="valor">{verMonto(deCentavos(calculo.total))}</div></div>
            <div className="tarjeta cifra"><div className="etiqueta">Retenido</div><div className="valor">{verMonto(deCentavos(calculo.totalRetenido))}</div></div>
            <div className="tarjeta cifra"><div className="etiqueta">{operacion === "venta" ? "Se cobra" : "Se paga"}</div><div className="valor">{verMonto(deCentavos(calculo.neto))}</div></div>
          </div>
          {calculo.retenciones.length > 0 && (
            <div className="tabla-envoltura">
              <table>
                <thead><tr><th>Retención</th><th>Se calcula sobre</th><th className="num">Base</th><th className="num">Tasa</th><th className="num">Monto</th></tr></thead>
                <tbody>
                  {calculo.retenciones.map((r, i) => (
                    <tr key={i}>
                      <td>{usadas[i].nombre}</td>
                      <td>{r.impuesto === "itbis" ? "ITBIS facturado" : "Monto sin impuestos"}</td>
                      <td className="num">{verMonto(deCentavos(r.impuesto === "itbis" ? calculo.itbis : calculo.subtotal))}</td>
                      <td className="num">{verPorcentaje(r.tasa)}</td>
                      <td className="num">{verMonto(deCentavos(r.monto))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="fila" style={{ alignItems: "start" }}>
            <Asiento titulo={operacion === "venta" ? "1. Al facturar" : "1. Al registrar la compra"} movimientos={documento} />
            <Asiento titulo={operacion === "venta" ? "2. Al cobrar" : "2. Al pagar"} movimientos={liquidacion} />
          </div>
        </>
      )}
    </>
  );
}
