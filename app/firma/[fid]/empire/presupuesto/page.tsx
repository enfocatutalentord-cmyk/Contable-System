import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoFirma } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { esLaborable } from "@/lib/dias-laborables";
import { hoyISO, verMonto } from "@/lib/montos";
import {
  categoriasDe, claveMonto, desviacion, diasDelMes, estadoPartida, GRUPOS_INGRESO, ingresosDelAnio, MESES, metaDiaria, metaQuincenal,
  montosDelAnio, necesidadDelMes, realDelAnio, sembrarCategorias, sumar, totalIngresos, type GrupoIngreso, type ListaPresupuesto,
} from "@/lib/presupuesto";
import { feriadosDe } from "@/lib/tramites";
import {
  agregarCategoriaAccion, copiarAnioAccion, guardarPresupuestoAccion, quitarCategoriaAccion, renombrarCategoriaAccion,
} from "../../../presupuesto-acciones";

export const metadata = { title: "Presupuesto · Empire Tax & Legal" };

const color = { "Sin presupuesto": undefined, Excedido: "var(--peligro)", "Cerca del límite": "#9a6b00", Dentro: "var(--exito, #1d6b3a)" } as const;

// Presupuesto de Empire (Prioridad 1.6 del prompt de Patricia, 20-nov-2026): el formato de «Presupuesto_Empire_12_meses» —doce meses, por
// año, con ingresos, gastos de oficina, gastos personales, ahorro, deuda y resumen—. Lo gastado viene de «Registrar salidas» (cada una con su
// asiento) y lo cobrado de las facturas de Empire, así presupuesto y contabilidad son el mismo registro. Solo administradores.
export default async function Presupuesto({ params, searchParams }: {
  params: Promise<{ fid: string }>; searchParams: Promise<{ anio?: string; mes?: string }>;
}) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma } = await accesoFirma(fid);
  const empresaId = firma.empresa_propia_id;
  if (!empresaId) {
    return (
      <>
        <h1>Presupuesto</h1>
        <p className="aviso">Primero elige la empresa que factura en <Link href={`/firma/${fid}/contabilidad`}>Contabilidad</Link>: el presupuesto es el de esa empresa.</p>
      </>
    );
  }
  const hoy = hoyISO();
  const anio = /^\d{4}$/.test(sp.anio ?? "") ? Number(sp.anio) : Number(hoy.slice(0, 4));
  const mes = /^\d{1,2}$/.test(sp.mes ?? "") && Number(sp.mes) >= 1 && Number(sp.mes) <= 12 ? Number(sp.mes) : anio === Number(hoy.slice(0, 4)) ? Number(hoy.slice(5, 7)) : 1;
  const feriados = await feriadosDe(fid);

  const d = await conEmpresa(empresaId, async (tx) => {
    await sembrarCategorias(tx, empresaId);
    return {
      oficina: await categoriasDe(tx, "oficina"), personal: await categoriasDe(tx, "personal"),
      montos: await montosDelAnio(tx, anio), real: await realDelAnio(tx, anio), ingresos: await ingresosDelAnio(tx, anio),
    };
  });

  const presup = (lista: string, categoria: string, m = mes) => d.montos.get(claveMonto(lista, categoria, m)) ?? 0n;
  const presupTotal = (lista: ListaPresupuesto, m: number) => (lista === "oficina" ? d.oficina : d.personal).reduce((a, c) => a + presup(lista, c.nombre, m), 0n);
  const real = d.real[mes - 1];
  const ing = d.ingresos[mes - 1];
  const realOficina = sumar(real.oficina), realPersonal = sumar(real.personal);
  const presOficina = presupTotal("oficina", mes), presPersonal = presupTotal("personal", mes);
  const presAhorro = presup("ahorro", "Total"), presDeuda = presup("deuda", "Total");
  const totalIng = totalIngresos(ing);
  const netoOficina = totalIng - realOficina;
  const disponible = netoOficina - realPersonal - real.ahorro - real.deuda;
  const excesoOficina = [...real.oficina].reduce((a, [k, v]) => { const p = presup("oficina", k); return a + (v > p ? v - p : 0n); }, 0n);
  const excesoPersonal = [...real.personal].reduce((a, [k, v]) => { const p = presup("personal", k); return a + (v > p ? v - p : 0n); }, 0n);

  // «Cuánto necesitas cubrir este mes»: con lo presupuestado. Los ingresos presupuestados son los del mes (lo cobrado si ya hay, si no 0).
  const necesidad = necesidadDelMes(totalIng, presOficina, presPersonal, presDeuda, presAhorro);
  let laborables = 0;
  for (let dia = 1; dia <= diasDelMes(anio, mes); dia++) if (esLaborable(`${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`, feriados)) laborables++;

  // Mes por mes y la proyección: promedio de los meses que ya tienen movimientos.
  const filas = MESES.map((nombre, i) => {
    const r = d.real[i], g = d.ingresos[i];
    const ingreso = totalIngresos(g), oficina = sumar(r.oficina), personal = sumar(r.personal);
    return { nombre, ingreso, oficina, neto: ingreso - oficina, personal, ahorro: r.ahorro, deuda: r.deuda, disponible: ingreso - oficina - personal - r.ahorro - r.deuda, hay: ingreso + oficina + personal + r.ahorro + r.deuda > 0n };
  });
  const conDatos = filas.filter((f) => f.hay);
  const prom = (f: (x: (typeof filas)[number]) => bigint) => (conDatos.length ? conDatos.reduce((a, x) => a + f(x), 0n) / BigInt(conDatos.length) : 0n);
  const proyeccion = prom((x) => x.oficina) + prom((x) => x.personal) + prom((x) => x.deuda) + prom((x) => x.ahorro);

  const tablaLista = (lista: ListaPresupuesto, titulo: string, categorias: { id: string; nombre: string }[]) => {
    const realLista = real[lista];
    const nombres = new Set(categorias.map((c) => c.nombre.trim().toUpperCase()));
    const otras = [...realLista].filter(([k]) => !nombres.has(k.trim().toUpperCase()));
    const tot = categorias.reduce((a, c) => a + presup(lista, c.nombre), 0n);
    return (
      <section className="tarjeta" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>{titulo}</h2>
        <div className="tabla-envoltura">
          <table>
            <thead><tr><th>Categoría</th><th className="num">Presupuestado (RD$)</th><th className="num">Real (RD$)</th><th className="num">Diferencia</th><th className="num">% desv.</th><th>Estado</th></tr></thead>
            <tbody>
              {categorias.map((c) => {
                const p = presup(lista, c.nombre);
                const r = [...realLista].reduce((a, [k, v]) => (k.trim().toUpperCase() === c.nombre.trim().toUpperCase() ? a + v : a), 0n);
                const est = estadoPartida(p, r);
                const dv = desviacion(p, r);
                return (
                  <tr key={c.id}>
                    <td>{c.nombre}</td>
                    <td className="num"><input name={`m|${lista}|${c.nombre}`} inputMode="decimal" defaultValue={p ? verMonto(p) : ""} aria-label={`Presupuestado ${c.nombre}`} style={{ width: 130, textAlign: "right" }} /></td>
                    <td className="num">{verMonto(r)}</td>
                    <td className="num">{verMonto(r - p)}</td>
                    <td className="num">{dv === null ? "" : `${dv > 0 ? "+" : ""}${dv.toFixed(1)} %`}</td>
                    <td style={{ color: color[est], fontWeight: 600 }}>{est}</td>
                  </tr>
                );
              })}
              {otras.map(([k, v]) => (
                <tr key={`o-${k}`}>
                  <td><em>{k}</em> <span className="sub">(no está en la lista)</span></td><td className="num">—</td><td className="num">{verMonto(v)}</td><td className="num">{verMonto(v)}</td><td /><td style={{ color: "var(--peligro)", fontWeight: 600 }}>Sin presupuesto</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td>Total</td><td className="num">{verMonto(tot)}</td><td className="num">{verMonto(sumar(realLista))}</td><td className="num">{verMonto(sumar(realLista) - tot)}</td><td /><td />
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  const enlace = (a: number, m: number) => `/firma/${fid}/empire/presupuesto?anio=${a}&mes=${m}`;

  return (
    <>
      <h1>Presupuesto</h1>
      <p className="sub">
        El presupuesto de {firma.nombre ?? "la firma"} mes por mes, contra lo que de verdad se cobró y se pagó. Lo gastado sale de{" "}
        <Link href={`/e/${empresaId}/salidas`}>Registrar salidas</Link> (cada salida genera su asiento y, si tiene factura con comprobante,
        va en Compras y gastos para el 606) y lo cobrado, de las facturas de Empire. Solo lo cobrado cuenta como ingreso.
      </p>

      <form className="fila" style={{ alignItems: "flex-end", marginBottom: 12 }}>
        <label>Año<input name="anio" type="number" min={2000} max={2100} defaultValue={anio} style={{ width: 100 }} /></label>
        <label>Mes
          <select name="mes" defaultValue={mes}>{MESES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}</select>
        </label>
        <button className="boton">Ver</button>
        <span className="sub" style={{ marginLeft: "auto" }}>
          <Link href={enlace(anio - 1, mes)}>← {anio - 1}</Link> · <Link href={enlace(anio + 1, mes)}>{anio + 1} →</Link>
        </span>
      </form>

      <h2>Resumen de {MESES[mes - 1].toLowerCase()} {anio}</h2>
      <div className="cifras">
        <div className="tarjeta cifra"><div className="etiqueta">Ingresos cobrados</div><div className="valor">{verMonto(totalIng)}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Gastos de oficina</div><div className="valor">{verMonto(realOficina)}</div><div className="sub">presupuestado {verMonto(presOficina)}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Lo que generó la oficina</div><div className="valor">{verMonto(netoOficina)}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Disponible para la propietaria</div><div className="valor">{verMonto(disponible)}</div></div>
      </div>
      <div className="tabla-envoltura" style={{ marginBottom: 16 }}>
        <table>
          <tbody>
            {(Object.keys(GRUPOS_INGRESO) as GrupoIngreso[]).map((g) => <tr key={g}><td>Ingresos · {GRUPOS_INGRESO[g]}</td><td className="num">{verMonto(ing[g])}</td></tr>)}
            <tr style={{ fontWeight: 700 }}><td>Total ingresos del mes</td><td className="num">{verMonto(totalIng)}</td></tr>
            <tr><td>(−) Gastos de oficina</td><td className="num">{verMonto(realOficina)}</td></tr>
            <tr style={{ fontWeight: 700 }}><td>» Dinero que generó la oficina (neto)</td><td className="num">{verMonto(netoOficina)}</td></tr>
            <tr><td>(−) Gastos personales y del hogar</td><td className="num">{verMonto(realPersonal)}</td></tr>
            <tr><td>(−) Ahorrado este mes</td><td className="num">{verMonto(real.ahorro)}</td></tr>
            <tr><td>(−) Pagado a deudas este mes</td><td className="num">{verMonto(real.deuda)}</td></tr>
            <tr style={{ fontWeight: 700 }}><td>» Disponible para la propietaria</td><td className="num">{verMonto(disponible)}</td></tr>
            <tr><td className="sub">Traspasos entre cuentas propias (no cuentan en el resultado)</td><td className="num sub">{verMonto(real.traspaso)}</td></tr>
            <tr><td className="sub">Exceso sobre el presupuesto · oficina</td><td className="num sub">{verMonto(excesoOficina)}</td></tr>
            <tr><td className="sub">Exceso sobre el presupuesto · personal</td><td className="num sub">{verMonto(excesoPersonal)}</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Cuánto necesitas cubrir este mes</h2>
      <p className="sub">Con lo presupuestado: ingresos menos oficina, personal, deuda y ahorro comprometidos. Los días son laborables (lunes a viernes, sin feriados).</p>
      <div className="tabla-envoltura" style={{ marginBottom: 16 }}>
        <table>
          <tbody>
            <tr><td>Ingresos cobrados del mes</td><td className="num">{verMonto(totalIng)}</td></tr>
            <tr><td>(−) Oficina presupuestada</td><td className="num">{verMonto(presOficina)}</td></tr>
            <tr><td>(−) Personal presupuestado</td><td className="num">{verMonto(presPersonal)}</td></tr>
            <tr><td>(−) Deuda: pago mensual comprometido</td><td className="num">{verMonto(presDeuda)}</td></tr>
            <tr><td>(−) Ahorro mensual comprometido</td><td className="num">{verMonto(presAhorro)}</td></tr>
            <tr><td>Diferencia</td><td className="num">{verMonto(necesidad.diferencia)}</td></tr>
            <tr style={{ fontWeight: 700 }}><td>» Necesitas buscar para cubrir el mes</td><td className="num">{verMonto(necesidad.buscar)}</td></tr>
            <tr><td>Días laborables del mes</td><td className="num">{laborables}</td></tr>
            <tr><td>Meta por día laborable</td><td className="num">{verMonto(metaDiaria(necesidad.buscar, laborables))}</td></tr>
            <tr><td>Meta por quincena</td><td className="num">{verMonto(metaQuincenal(necesidad.buscar))}</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Presupuesto de {MESES[mes - 1].toLowerCase()}</h2>
      <Formulario accion={guardarPresupuestoAccion.bind(null, fid, anio, mes)} boton="Guardar el presupuesto del mes" className="">
        {tablaLista("oficina", "Gastos de oficina (negocio)", d.oficina)}
        {tablaLista("personal", "Gastos personales y del hogar", d.personal)}
        <section className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Ahorro y deuda comprometidos</h2>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th /><th className="num">Presupuestado (RD$)</th><th className="num">Real (RD$)</th><th>Estado</th></tr></thead>
              <tbody>
                {([["ahorro", "Ahorro del mes", presAhorro, real.ahorro], ["deuda", "Pago de deudas del mes", presDeuda, real.deuda]] as const).map(([lista, nombre, p, r]) => (
                  <tr key={lista}>
                    <td>{nombre}</td>
                    <td className="num"><input name={`m|${lista}|Total`} inputMode="decimal" defaultValue={p ? verMonto(p) : ""} aria-label={`Presupuestado ${nombre}`} style={{ width: 130, textAlign: "right" }} /></td>
                    <td className="num">{verMonto(r)}</td>
                    <td style={{ color: color[estadoPartida(p, r)], fontWeight: 600 }}>{estadoPartida(p, r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input type="checkbox" name="todos" style={{ width: "auto" }} /> Repetir estos montos en los 12 meses de {anio}
        </label>
      </Formulario>

      <h2>Mes por mes · {anio}</h2>
      <div className="tabla-envoltura" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>Mes</th><th className="num">Ingresos</th><th className="num">Oficina</th><th className="num">Neto oficina</th><th className="num">Personal</th><th className="num">Ahorro</th><th className="num">Deuda</th><th className="num">Disponible</th></tr></thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={f.nombre} style={f.hay ? undefined : { color: "var(--suave)" }}>
                <td><Link href={enlace(anio, i + 1)}>{f.nombre}</Link></td>
                <td className="num">{verMonto(f.ingreso)}</td><td className="num">{verMonto(f.oficina)}</td><td className="num">{verMonto(f.neto)}</td>
                <td className="num">{verMonto(f.personal)}</td><td className="num">{verMonto(f.ahorro)}</td><td className="num">{verMonto(f.deuda)}</td><td className="num">{verMonto(f.disponible)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tarjeta" style={{ marginBottom: 16 }}>
        <strong>Proyección del mes siguiente · cuánto necesito generar</strong>
        <p className="sub" style={{ margin: "4px 0 0" }}>
          Promedio de los {conDatos.length} {conDatos.length === 1 ? "mes con movimientos" : "meses con movimientos"} de {anio}:
          oficina {verMonto(prom((x) => x.oficina))} + personal {verMonto(prom((x) => x.personal))} + deuda {verMonto(prom((x) => x.deuda))} + ahorro {verMonto(prom((x) => x.ahorro))}.
        </p>
        <div className="valor" style={{ fontSize: "1.3rem" }}>RD$ {verMonto(proyeccion)}</div>
      </div>

      <details className="tarjeta" style={{ marginBottom: 16 }}>
        <summary><strong>Categorías</strong> · agregar, cambiar o quitar</summary>
        <p className="sub">Las mismas listas salen al registrar una salida. Quitar una categoría solo la esconde: lo ya gastado se sigue viendo.</p>
        {([["oficina", "Gastos de oficina", d.oficina], ["personal", "Gastos personales y del hogar", d.personal]] as const).map(([lista, titulo, cats]) => (
          <div key={lista} style={{ marginBottom: 12 }}>
            <h3>{titulo}</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 8px", display: "grid", gap: 6 }}>
              {cats.map((c) => (
                <li key={c.id} className="fila" style={{ alignItems: "center", gap: 8 }}>
                  <Formulario accion={renombrarCategoriaAccion.bind(null, fid, c.id)} boton="Cambiar" className="fila">
                    <input name="nombre" defaultValue={c.nombre} maxLength={80} aria-label={`Nombre de ${c.nombre}`} />
                  </Formulario>
                  <Formulario accion={quitarCategoriaAccion.bind(null, fid, c.id)} boton="Quitar" className="fila boton-chico"><></></Formulario>
                </li>
              ))}
            </ul>
            <Formulario accion={agregarCategoriaAccion.bind(null, fid, lista)} boton="Agregar categoría" className="fila">
              <label style={{ flex: "2 1 240px" }}>Nueva categoría<input name="nombre" required maxLength={80} /></label>
            </Formulario>
          </div>
        ))}
      </details>

      <details className="tarjeta">
        <summary><strong>Empezar {anio} con lo de otro año</strong></summary>
        <p className="sub">Copia los montos presupuestados de otro año a {anio} (solo donde {anio} no tiene nada). Los años anteriores quedan guardados para consultar y comparar.</p>
        <Formulario accion={copiarAnioAccion.bind(null, fid, anio)} boton="Copiar" className="fila">
          <label>Copiar desde el año<input name="desde" type="number" min={2000} max={2100} defaultValue={anio - 1} style={{ width: 110 }} /></label>
        </Formulario>
      </details>
    </>
  );
}
