import Link from "next/link";
import { puedeVer } from "@/lib/pestanas";
import { Descargar } from "@/app/descargar";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { COMPARAR, porcentaje, variacion, type Fila } from "@/lib/estados";
import { armarEstado, consultaEstados, leerFiltrosEstados, TITULOS, type TipoEstado } from "@/lib/estados-pantalla";
import { verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { borrarCorte, guardarFirmasEstados, guardarSaldosRegistro } from "../estados-acciones";
import { llevaContabilidad } from "@/lib/reportes";
import { CONCEPTOS_BALANCE, corteA, cortesDe, sugeridosA } from "@/lib/saldos-registro";

export const metadata = { title: "Estados financieros · Empire Tax’N Legal" };

// Estado de resultados y estado de situación financiera, con comparativos y clic al libro mayor de cada cuenta.
export default async function Estados({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa, permisos, pestanas } = await accesoEmpresa(id);
  const f = leerFiltrosEstados(sp);
  // Cliente sin contabilidad (rediseño R5): sus estados salen de las facturas, las compras y los saldos del formulario. El flujo de
  // efectivo y los cambios en el patrimonio necesitan asientos: se ofrecen solo donde se lleva contabilidad.
  const registro = !(await conEmpresa(id, (tx) => llevaContabilidad(tx)));
  if (registro && (f.tipo === "flujo" || f.tipo === "patrimonio")) f.tipo = "resultados";
  const { estado, firmas, unidades, unidad } = await conEmpresa(id, (tx) => armarEstado(tx, f));
  const fechaCorte = /^\d{4}-\d{2}-\d{2}$/.test(sp.corte_saldos ?? "") ? sp.corte_saldos! : f.tipo === "balance" ? f.corte : estado.columnas[0].hasta;
  const saldos = registro ? await conEmpresa(id, async (tx) => {
    const cortes = await cortesDe(tx);
    return { cortes, exacto: cortes.find((c) => c.fecha === fechaCorte) ?? null, vigente: corteA(cortes, fechaCorte), sugeridos: await sugeridosA(tx, fechaCorte) };
  }) : null;
  const cols = estado.columnas;
  const dos = cols.length === 2 && !estado.sinVariacion;
  const conPct = f.tipo === "resultados" && cols.length === 1;
  const enlaceTipo = (t: TipoEstado) => `/e/${id}/estados?${consultaEstados({ ...f, tipo: t })}`;
  const mayor = (fila: Fila) => {
    if (!fila.cuentaId || !puedeVer(pestanas, "/mayor")) return null;
    const desde = f.tipo === "balance" ? `${cols[0].hasta.slice(0, 4)}-01-01` : cols[0].desde;
    return `/e/${id}/mayor?cuenta=${fila.cuentaId}&desde=${desde}&hasta=${cols[0].hasta}`;
  };

  return (
    <>
      <div className="entre">
        <div>
          <h1>Estados financieros</h1>
          <p className="sub">
            {empresa.nombre}{empresa.rnc && <> · RNC {empresa.rnc}</>} · valores en {empresa.moneda} ·{" "}
            {registro ? <>de sus facturas emitidas, sus compras registradas y los saldos del balance · preparados por {empresa.firma}</> : "de los asientos contabilizados"}
          </p>
        </div>
        {puede(permisos, "exportar") && <Descargar href={`/e/${id}/exportar/estado-financiero?${consultaEstados(f)}`} />}
      </div>
      <nav className="fila" style={{ marginBottom: 12 }} aria-label="Estado">
        {(Object.keys(TITULOS) as TipoEstado[]).filter((t) => !registro || t === "resultados" || t === "balance").map((t) => (
          <Link key={t} className={`boton${t === f.tipo ? " primario" : ""}`} href={enlaceTipo(t)}>{TITULOS[t]}</Link>
        ))}
      </nav>
      <form className="fila" style={{ marginBottom: 16 }}>
        <input type="hidden" name="tipo" value={f.tipo} />
        {f.tipo !== "balance" ? (
          <>
            <label>Desde<input type="date" name="desde" defaultValue={f.desde} required /></label>
            <label>Hasta<input type="date" name="hasta" defaultValue={f.hasta} required /></label>
          </>
        ) : (
          <label>Al<input type="date" name="corte" defaultValue={f.corte} required /></label>
        )}
        {f.tipo !== "patrimonio" && (
          <label>Comparar con
            <select name="comparar" defaultValue={f.comparar}>
              {Object.entries(COMPARAR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        )}
        {(f.tipo === "resultados" || f.tipo === "balance") && (
          <label>Detalle
            <select name="agrupar" defaultValue={f.agrupar}>
              <option value="cuentas">Por cuenta</option>
              <option value="grupos">Por subgrupo</option>
            </select>
          </label>
        )}
        {f.tipo === "resultados" && unidades.length > 0 && (
          <label>Unidad de negocio
            <select name="unidad" defaultValue={f.unidad}>
              <option value="">General (todas)</option>
              <option value="columnas">Una columna por unidad</option>
              {unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              <option value="sin">Sin unidad</option>
            </select>
          </label>
        )}
        <button>Ver</button>
      </form>

      <h2 style={{ marginBottom: 4 }}>{TITULOS[f.tipo]}{unidad && ` · ${unidad}`}</h2>
      <p className="sub">
        {f.tipo === "balance" ? `Al ${verFecha(cols[0].hasta)}` : `Del ${verFecha(cols[0].desde)} al ${verFecha(cols[0].hasta)}`}
        {f.tipo === "flujo" && " · método indirecto; la actividad de cada cuenta se cambia en el Catálogo de cuentas"}
        {f.tipo !== "patrimonio" && puedeVer(pestanas, "/mayor") && " · toca una cuenta para ver su libro mayor"}
      </p>
      {estado.cuadraEfectivo?.some((c) => !c) && (
        <p className="aviso">El efectivo al final no coincide con el saldo de las cuentas de efectivo. Revisa en el Catálogo qué cuentas están marcadas como «Efectivo y equivalentes».</p>
      )}
      {estado.cuadra && estado.cuadra.some((c) => !c) && (
        <p className="aviso">El activo no es igual al pasivo más el patrimonio en alguna fecha. {registro ? "Revisa los saldos del balance de abajo." : "Revisa la balanza de comprobación."}</p>
      )}
      <div className="tabla-envoltura">
        <table className="estado-financiero">
          <thead>
            <tr>
              <th />
              {cols.map((c) => <th key={c.titulo} className="num">{c.titulo}</th>)}
              {conPct && <th className="num">% de ingresos</th>}
              {dos && <><th className="num">Variación</th><th className="num">%</th></>}
            </tr>
          </thead>
          <tbody>
            {estado.filas.map((fila, i) => {
              const v = dos ? variacion(fila.valores) : null;
              const enlace = fila.tipo === "cuenta" && f.tipo !== "patrimonio" ? mayor(fila) : null;
              return (
                <tr key={i} className={`fila-${fila.tipo}`}>
                  <td>{enlace ? <Link href={enlace}>{fila.texto}</Link> : fila.texto}</td>
                  {fila.tipo === "seccion" ? cols.map((c) => <td key={c.titulo} />) : fila.valores.map((x, j) => <td key={j} className="num">{verMonto(x)}</td>)}
                  {conPct && <td className="num">{fila.tipo === "seccion" ? "" : porcentaje(fila.valores[0], estado.base?.[0] ?? 0n)}</td>}
                  {dos && (fila.tipo === "seccion" ? <><td /><td /></> : <><td className="num">{verMonto(v!.monto)}</td><td className="num">{v!.pct}</td></>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {saldos && (
        <section className="tarjeta" style={{ marginTop: 20 }} id="saldos">
          <h2 style={{ marginTop: 0 }}>Saldos del balance</h2>
          <p className="sub">
            Lo que las facturas no traen, al {verFecha(fechaCorte)}. Los ingresos, costos y gastos salen solos de las facturas emitidas y las
            compras registradas; el resultado del ejercicio también. {saldos.exacto ? `Guardados el ${saldos.exacto.en.toLocaleDateString("es-DO")}${saldos.exacto.por ? ` por ${saldos.exacto.por}` : ""}.`
              : saldos.vigente ? `Sin saldos a esta fecha: el balance usa los del ${verFecha(saldos.vigente.fecha)}.` : "Todavía no hay saldos guardados."}
          </p>
          <Formulario key={fechaCorte} accion={guardarSaldosRegistro.bind(null, id)} boton={puede(permisos, "registrar") ? "Guardar saldos" : ""}>
            <div className="fila">
              <label>Fecha de corte<input type="date" name="fecha" defaultValue={fechaCorte} required /></label>
            </div>
            {[...new Set(CONCEPTOS_BALANCE.map((c) => c.grupo))].map((g) => (
              <fieldset key={g} style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="sub" style={{ fontWeight: 600 }}>{g}</legend>
                <div className="fila">
                  {CONCEPTOS_BALANCE.filter((c) => c.grupo === g).map((c) => {
                    const sugerido = (saldos.sugeridos as Record<string, string | undefined>)[c.clave];
                    const valor = saldos.exacto?.montos[c.clave] ?? saldos.vigente?.montos[c.clave] ?? (sugerido && sugerido !== "0.00" ? sugerido : "");
                    return (
                      <label key={c.clave} style={{ flex: "1 1 220px" }}>{c.nombre}
                        <input name={c.clave} inputMode="decimal" defaultValue={valor} placeholder="0.00" />
                        {sugerido !== undefined && <small className="sub">Según lo registrado: RD${verMonto(sugerido)}</small>}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            <label>Notas<input name="notas" maxLength={500} defaultValue={saldos.exacto?.notas ?? ""} placeholder="Ej.: según el estado de cuenta del banco al cierre" /></label>
          </Formulario>
          {saldos.cortes.length > 0 && (
            <p className="sub" style={{ margin: "12px 0 0" }}>
              Cortes guardados:{" "}
              {saldos.cortes.map((c, i) => (
                <span key={c.id}>{i > 0 && " · "}<Link href={`/e/${id}/estados?tipo=balance&corte=${c.fecha}&corte_saldos=${c.fecha}#saldos`}>{verFecha(c.fecha)}</Link></span>
              ))}
              {saldos.exacto && puede(permisos, "registrar") && (
                <Formulario accion={borrarCorte.bind(null, id, saldos.exacto.fecha)} boton={`Borrar el corte del ${verFecha(saldos.exacto.fecha)}`} className="fila"><span /></Formulario>
              )}
            </p>
          )}
        </section>
      )}

      <details className="tarjeta" style={{ marginTop: 20 }}>
        <summary><strong>Firmas del PDF</strong>{firmas.firma_preparado ? ` · preparado por ${firmas.firma_preparado}` : " · sin completar"}</summary>
        <p className="sub">Aparecen al pie de los estados en PDF y Excel.</p>
        <Formulario accion={guardarFirmasEstados.bind(null, id)} boton={puede(permisos, "empresa") ? "Guardar firmas" : ""} className="fila">
          <label style={{ flex: "2 1 220px" }}>Preparado por (contador)<input name="firma_preparado" maxLength={120} defaultValue={firmas.firma_preparado ?? ""} /></label>
          <label style={{ flex: "1 1 160px" }}>N.º de registro del ICPARD<input name="firma_icpard" maxLength={120} defaultValue={firmas.firma_icpard ?? ""} /></label>
          <label style={{ flex: "2 1 220px" }}>Aprobado por<input name="firma_aprobado" maxLength={120} defaultValue={firmas.firma_aprobado ?? ""} /></label>
          <label style={{ flex: "1 1 160px" }}>Cargo<input name="firma_cargo" maxLength={120} defaultValue={firmas.firma_cargo ?? ""} placeholder="Gerente general" /></label>
        </Formulario>
      </details>
    </>
  );
}
