import Link from "next/link";
import { Descargar } from "@/app/descargar";
import { accesoEmpresa } from "@/lib/acceso";
import { ejercicios } from "@/lib/cierre-ejercicio";
import { conEmpresa } from "@/lib/db";
import { Declaracion } from "../declaracion";
import { AnexosH } from "./anexos-h";
import { anexoB1ConCostoD } from "@/lib/declaraciones";
import { A1, anexoA1, anexoJ, B1, type Anexo1, type Casilla } from "@/lib/ir2";
import { verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";

export const metadata = { title: "IR-2 · Empire Tax’N Legal" };

const ANEXOS: Record<string, string> = {
  a1: "Anexo A-1 · Balance general", b1: "Anexo B-1 · Estado de resultados", j: "Anexo J · Comprobantes",
  liq: "Liquidación · anexos D, G, E y activos", h: "Anexos H-1 y H-2 · Beneficiario final",
};

function TablaAnexo({ casillas, anexo, id }: { casillas: Casilla[]; anexo: Anexo1; id: string }) {
  return (
    <div className="tabla-envoltura">
      <table className="estado-financiero">
        <thead><tr><th style={{ width: 70 }}>Casilla</th><th>Concepto</th><th className="num">Monto</th></tr></thead>
        <tbody>
          {casillas.map((k) => {
            const det = anexo.detalle[k.c] ?? [];
            return (
              <tr key={k.c} className={k.total ? "fila-subtotal" : "fila-cuenta"}>
                <td>{k.c}</td>
                <td>
                  {det.length ? (
                    <details>
                      <summary>{k.texto}</summary>
                      <ul className="conciliar-lineas">
                        {det.map((d, i) => (
                          <li key={i}>{d.cuentaId ? <Link href={`/e/${id}/catalogo?editar=${d.cuentaId}`}>{d.codigo} {d.nombre}</Link> : d.nombre}: {verMonto(d.monto)}</li>
                        ))}
                      </ul>
                    </details>
                  ) : k.texto}
                </td>
                <td className="num">{verMonto(anexo.valores[k.c] ?? 0n)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// IR-2 2026: anexos A-1, B-1 y J del ejercicio elegido, desde la contabilidad (cada cuenta va a la casilla que tiene en el
// catálogo o a la sugerida por su código), y la liquidación con los anexos D, G y E y el impuesto a los activos.
export default async function Ir2({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ejercicio?: string; anexo?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa, permisos } = await accesoEmpresa(id);
  const anexoElegido = sp.anexo && sp.anexo in ANEXOS ? sp.anexo : "a1";
  const datos = await conEmpresa(id, async (tx) => {
    const [{ mes_cierre }] = await tx<{ mes_cierre: number }[]>`SELECT mes_cierre FROM empresas WHERE id = ${id}`;
    const lista = await ejercicios(tx, mes_cierre);
    const e = lista.find((x) => x.fin === sp.ejercicio) ?? lista.find((x) => x.terminado) ?? lista[0];
    if (!e) return null;
    return { lista, e, a1: await anexoA1(tx, e.fin, mes_cierre), b1: await anexoB1ConCostoD(tx, e.inicio, e.fin), j: await anexoJ(tx, e.inicio, e.fin) };
  });

  return (
    <>
      <p className="sub" style={{ marginBottom: 4 }}><Link href={`/e/${id}/dgii`}>← Reportes DGII</Link></p>
      <div className="entre">
        <div>
          <h1>IR-2 · ISR anual de sociedades</h1>
          <p className="sub">{empresa.nombre}{empresa.rnc && ` · RNC ${empresa.rnc}`} · formulario IR-2 versión 2026 · manufactura, comercio, agropecuaria y hoteles</p>
        </div>
        {datos && puede(permisos, "exportar") && <Descargar href={anexoElegido === "liq" ? `/e/${id}/exportar/ir2?periodo=${datos.e.fin.slice(0, 7).replace("-", "")}` : `/e/${id}/exportar/ir2-${anexoElegido}?ejercicio=${datos.e.fin}`} />}
      </div>
      {!datos ? <p>Todavía no hay asientos contabilizados.</p> : (
        <>
          <nav className="fila" style={{ marginBottom: 8 }} aria-label="Ejercicio">
            {datos.lista.map((x) => (
              <Link key={x.fin} className={`boton${x.fin === datos.e.fin ? " primario" : ""}`} href={`/e/${id}/dgii/ir2?ejercicio=${x.fin}&anexo=${anexoElegido}`}>
                Ejercicio {x.fin.slice(0, 4)}{!x.terminado ? " (en curso)" : x.cierre ? " · cerrado" : ""}
              </Link>
            ))}
          </nav>
          <nav className="fila" style={{ marginBottom: 12 }} aria-label="Anexo">
            {Object.entries(ANEXOS).map(([k, v]) => (
              <Link key={k} className={`boton${k === anexoElegido ? " primario" : ""}`} href={`/e/${id}/dgii/ir2?ejercicio=${datos.e.fin}&anexo=${k}`}>{v}</Link>
            ))}
          </nav>
          {anexoElegido === "liq" && <Declaracion id={id} formulario="IR-2" mes={datos.e.fin.slice(0, 7).replace("-", "")} incrustada />}
          {anexoElegido === "h" && <AnexosH id={id} />}
          {(anexoElegido === "a1" || anexoElegido === "b1" || anexoElegido === "j") && <p className="sub">Ejercicio del {verFecha(datos.e.inicio)} al {verFecha(datos.e.fin)}. Toca un concepto para ver sus cuentas; la casilla de cada cuenta se cambia en el Catálogo de cuentas.</p>}
          {(anexoElegido === "a1" || anexoElegido === "b1" || anexoElegido === "j") && !datos.e.terminado && <p className="aviso">El ejercicio todavía no ha terminado: las cifras pueden cambiar.</p>}
          {(anexoElegido === "a1" || anexoElegido === "b1") && (() => {
            const an = anexoElegido === "a1" ? datos.a1 : datos.b1;
            return (
              <>
                {an.sinCasilla.length > 0 && (
                  <div className="aviso" role="alert">
                    <strong>{an.sinCasilla.length} cuenta{an.sinCasilla.length > 1 ? "s" : ""} con saldo sin casilla en este anexo</strong>; asígnala{an.sinCasilla.length > 1 ? "s" : ""} en el catálogo:
                    <ul style={{ margin: "6px 0 0" }}>
                      {an.sinCasilla.map((d) => <li key={d.cuentaId}><Link href={`/e/${id}/catalogo?editar=${d.cuentaId}`}>{d.codigo} {d.nombre}</Link>: {verMonto(d.monto)}</li>)}
                    </ul>
                  </div>
                )}
                {anexoElegido === "a1" && datos.a1.valores["6"] !== datos.a1.valores["11"] && (
                  <p className="aviso">El total de activos no es igual al total de pasivos y patrimonio: revisa las cuentas sin casilla o asignadas al anexo equivocado.</p>
                )}
                {anexoElegido === "b1" && <p className="sub">El costo de venta (casilla 5) viene del anexo D, en la pestaña Liquidación. El ISR del ejercicio no va en el B-1.</p>}
                <TablaAnexo casillas={anexoElegido === "a1" ? A1 : B1} anexo={an} id={id} />
              </>
            );
          })()}
          {anexoElegido === "j" && (
            <>
              {datos.j.avisos.map((a) => <p key={a} className="aviso">{a}</p>)}
              <div className="tabla-envoltura">
                <table className="estado-financiero">
                  <thead><tr><th style={{ width: 70 }}>Casilla</th><th>Concepto</th><th className="num">Cantidad</th><th className="num">Monto (sin impuestos)</th></tr></thead>
                  <tbody>
                    {datos.j.filas.map((f) => (
                      <tr key={f.c} className={f.total ? "fila-subtotal" : "fila-cuenta"}><td>{f.c}</td><td>{f.texto}</td><td className="num">{f.cantidad}</td><td className="num">{verMonto(f.monto)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="sub">1: ventas del 607 (facturas emitidas no anuladas). 2: compras del 606 (registradas no anuladas). Montos en pesos, sin ITBIS.</p>
            </>
          )}
        </>
      )}
    </>
  );
}
