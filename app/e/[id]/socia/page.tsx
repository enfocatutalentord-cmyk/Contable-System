import Link from "next/link";
import { Descargar } from "@/app/descargar";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, esUuid } from "@/lib/acceso";
import { finEjercicio } from "@/lib/cierre-ejercicio";
import { conEmpresa } from "@/lib/db";
import { inicioEjercicio } from "@/lib/estados";
import { deCentavos, hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { esEmpresaPropia } from "@/lib/propia";
import { fechaValida } from "@/lib/reportes";
import { cuentasDeSocia } from "@/lib/salidas";
import { acumuladosDisponibles, brutoDeNeto, estadoDeCuenta, liquidacionesDe, saldoSocia, TASA_DIVIDENDOS } from "@/lib/socia";
import { deshacerLiquidacionAccion, liquidarAccion } from "../socia-acciones";

const diaAntes = (f: string) => { const d = new Date(`${f}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const diaDespues = (f: string) => { const d = new Date(`${f}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

// Cuenta de la socia (bloque 7a): estado de cuenta de su cuenta corriente con las categorías y, al cierre del ejercicio, la
// liquidación que decide Patricia: dividendos con retención o dejar el saldo como cuenta por cobrar.
export default async function CuentaSocia({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa, permisos } = await accesoEmpresa(id);
  if (!(await esEmpresaPropia(id))) {
    return (<><h1>Cuenta de la socia</h1><p className="aviso">La cuenta de la socia es de la empresa propia de la firma. Elígela en «Empresas Empire › Empresa propia de la firma».</p></>);
  }
  const hoy = hoyISO();
  const datos = await conEmpresa(id, async (tx) => {
    const cuentas = await cuentasDeSocia(tx);
    const [{ mes_cierre }] = await tx<{ mes_cierre: number }[]>`SELECT mes_cierre FROM empresas WHERE id = ${id}`;
    const cuenta = cuentas.find((c) => c.id === sp.cuenta && esUuid(sp.cuenta)) ?? cuentas[0];
    if (!cuenta) return { cuentas, cuenta: null } as const;
    const desde = fechaValida(sp.desde) ? sp.desde : inicioEjercicio(hoy, mes_cierre);
    const hasta = fechaValida(sp.hasta) ? sp.hasta : hoy;
    const categoria = sp.categoria?.trim() || null;
    const estado = await estadoDeCuenta(tx, cuenta.id, desde, hasta, categoria);
    const categorias = (await estadoDeCuenta(tx, cuenta.id, desde, hasta)).porCategoria.map(([c]) => c);
    // Los dos últimos ejercicios terminados, con su saldo al cierre y lo que se decidió.
    const liquidaciones = await liquidacionesDe(tx, cuenta.id);
    const ejercicios = [];
    for (let fin = finEjercicio(diaAntes(inicioEjercicio(hoy, mes_cierre)), mes_cierre), n = 0; n < 2; n++, fin = finEjercicio(diaAntes(inicioEjercicio(fin, mes_cierre)), mes_cierre)) {
      const saldo = await saldoSocia(tx, cuenta.id, fin);
      const fecha = diaDespues(fin);
      ejercicios.push({ fin, saldo, fecha, acumulados: await acumuladosDisponibles(tx, fecha), liquidacion: liquidaciones.find((l) => l.fin_ejercicio === fin) ?? null });
    }
    return { cuentas, cuenta, desde, hasta, categoria, estado, categorias, ejercicios } as const;
  });

  if (!datos.cuenta) {
    return (
      <>
        <h1>Cuenta de la socia</h1>
        <p className="aviso">No hay «Cuenta corriente – socia» en el catálogo. Registra a la socia en Ficha de la empresa › Socios y vuelve a preparar la
          empresa propia en Empresas Empire.</p>
      </>
    );
  }
  const { cuentas, cuenta, desde, hasta, categoria, estado, categorias, ejercicios } = datos;
  const filtros = `cuenta=${cuenta.id}&desde=${desde}&hasta=${hasta}${categoria ? `&categoria=${encodeURIComponent(categoria)}` : ""}`;
  const liquida = puede(permisos, "cerrar");
  const reabre = puede(permisos, "reabrir");

  return (
    <>
      <h1>Cuenta de la socia</h1>
      <p className="sub">
        La cuenta corriente es una cuenta por cobrar a la socia: ahí va lo personal que sale de {empresa.nombre} (gastos personales y pagos de
        deudas). Al cierre del año se liquida contra las ganancias como dividendos, con la retención de ISR del {deCentavos(TASA_DIVIDENDOS).replace(/\.00$/, "")} %
        (casilla 5 del IR-17), o queda como cuenta por cobrar, según decida la socia.
      </p>
      <form className="fila" style={{ alignItems: "flex-end", marginBottom: 12 }}>
        {cuentas.length > 1 && (
          <label>Cuenta
            <select name="cuenta" defaultValue={cuenta.id}>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
          </label>
        )}
        {cuentas.length === 1 && <input type="hidden" name="cuenta" value={cuenta.id} />}
        <label>Desde<input type="date" name="desde" defaultValue={desde} /></label>
        <label>Hasta<input type="date" name="hasta" defaultValue={hasta} /></label>
        <label>Categoría
          <select name="categoria" defaultValue={categoria ?? ""}>
            <option value="">Todas</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button>Ver</button>
        <Descargar href={`/e/${id}/exportar/socia?${filtros}`} />
        <Link href={`/e/${id}/salidas`}>Registrar salidas →</Link>
      </form>

      <div className="cifras" style={{ marginBottom: 16 }}>
        <div className="tarjeta"><div className="sub">Saldo al {verFecha(diaAntes(desde))}</div><strong>RD${verMonto(estado.inicial)}</strong></div>
        <div className="tarjeta"><div className="sub">Cargos del período</div><strong>RD${verMonto(estado.cargos)}</strong></div>
        <div className="tarjeta"><div className="sub">Abonos del período</div><strong>RD${verMonto(estado.abonos)}</strong></div>
        <div className="tarjeta"><div className="sub">Saldo al {verFecha(hasta)}</div><strong>RD${verMonto(estado.final)}</strong></div>
      </div>

      {estado.porCategoria.length > 0 && (
        <div className="tabla-envoltura" style={{ marginBottom: 16, maxWidth: 520 }}>
          <table>
            <thead><tr><th>Categoría</th><th className="num">Cargos</th><th className="num">% del total</th></tr></thead>
            <tbody>
              {estado.porCategoria.map(([c, m]) => (
                <tr key={c}><td>{c}</td><td className="num">{verMonto(m)}</td><td className="num">{estado.cargos ? `${deCentavos((m * 10000n + estado.cargos / 2n) / estado.cargos)} %` : ""}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Fecha</th><th>Asiento</th><th>Concepto</th><th>Categoría</th><th className="num">Cargos</th><th className="num">Abonos</th>{!categoria && <th className="num">Saldo</th>}</tr></thead>
          <tbody>
            {estado.movimientos.map((m, i) => (
              <tr key={`${m.asiento_id}-${i}`}>
                <td>{verFecha(m.fecha)}</td>
                <td><Link href={`/e/${id}/asientos/${m.asiento_id}`}>n.º {m.numero}</Link></td>
                <td>{m.concepto}</td>
                <td>{m.categoria ?? ""}</td>
                <td className="num">{verMonto(m.cargo, true)}</td>
                <td className="num">{verMonto(m.abono, true)}</td>
                {!categoria && <td className="num">{verMonto(m.saldo)}</td>}
              </tr>
            ))}
            {estado.movimientos.length === 0 && <tr><td colSpan={7}>Sin movimientos en el período.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 28 }}>Liquidación al cierre del ejercicio</h2>
      <p className="sub">
        Primero se cierra el ejercicio y se pasa el resultado a resultados acumulados (Cierre del mes › Cierre del ejercicio). Con dividendos, el
        dividendo bruto se calcula para que, después de la retención, se liquide justo lo que se elija de la cuenta corriente.
      </p>
      {ejercicios.map((e) => {
        const { bruto, retencion } = brutoDeNeto(e.saldo > 0n ? e.saldo : 0n);
        return (
          <div key={e.fin} className="tarjeta" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Ejercicio que terminó el {verFecha(e.fin)}</h3>
            <p>Saldo de la cuenta corriente a esa fecha: <strong>RD${verMonto(e.saldo)}</strong>
              {e.acumulados !== null && <> · Ganancias acumuladas al {verFecha(e.fecha)}: RD${verMonto(e.acumulados > 0n ? e.acumulados : 0n)}</>}</p>
            {e.liquidacion ? (
              <>
                <p className="exito">
                  {e.liquidacion.modo === "dividendos"
                    ? <>Liquidada como dividendos el {verFecha(e.liquidacion.fecha)}: dividendo RD${verMonto(e.liquidacion.bruto)}, retención RD${verMonto(e.liquidacion.retencion)} y RD${verMonto(e.liquidacion.neto)} rebajados de la cuenta corriente
                      {e.liquidacion.asiento_id && <> (<Link href={`/e/${id}/asientos/${e.liquidacion.asiento_id}`}>asiento n.º {e.liquidacion.asiento}</Link>)</>}.</>
                    : <>Se decidió dejar el saldo como cuenta por cobrar a la socia ({verFecha(e.liquidacion.fecha)}).</>}
                  {e.liquidacion.quien && <> Lo registró {e.liquidacion.quien}.</>}
                  {e.liquidacion.nota && <> Nota: {e.liquidacion.nota}</>}
                </p>
                {reabre && <Formulario accion={deshacerLiquidacionAccion.bind(null, id, e.liquidacion.id)} boton="Deshacer la liquidación" className="fila"><span /></Formulario>}
              </>
            ) : e.saldo <= 0n ? (
              <p className="sub">No hay saldo a cargo de la socia: no hay nada que liquidar.</p>
            ) : liquida ? (
              <Formulario accion={liquidarAccion.bind(null, id)} boton="Registrar la liquidación">
                <input type="hidden" name="cuenta" value={cuenta.id} />
                <input type="hidden" name="fin" value={e.fin} />
                <fieldset className="fila" style={{ border: 0, padding: 0, margin: 0 }}>
                  <label style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
                    <input type="radio" name="modo" value="dividendos" defaultChecked style={{ minHeight: 0 }} /> Dividendos (contra resultados acumulados)
                  </label>
                  <label style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
                    <input type="radio" name="modo" value="cuenta_por_cobrar" style={{ minHeight: 0 }} /> Dejarlo como cuenta por cobrar
                  </label>
                </fieldset>
                <div className="fila">
                  <label>Fecha<input type="date" name="fecha" defaultValue={e.fecha} min={e.fecha} required /></label>
                  <label style={{ width: 200 }}>Se liquida (RD$)<input name="neto" inputMode="decimal" defaultValue={deCentavos(e.saldo)} /></label>
                  <label style={{ flex: "2 1 260px" }}>Nota<input name="nota" maxLength={500} placeholder="Opcional: acta o decisión" /></label>
                </div>
                <p className="sub">
                  Si se liquida todo: dividendo RD${verMonto(bruto)}, retención de ISR RD${verMonto(retencion)} (va a la cuenta 210203 y a la casilla 5
                  del IR-17 del mes) y la cuenta corriente queda en cero.
                </p>
              </Formulario>
            ) : (
              <p className="sub">La liquidación la registra quien tiene el permiso de cerrar.</p>
            )}
          </div>
        );
      })}
    </>
  );
}
