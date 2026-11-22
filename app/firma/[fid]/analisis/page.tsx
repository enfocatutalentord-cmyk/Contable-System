import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import {
  armarAnalisis, COMPARATIVOS, GRUPOS, leerFiltrosAnalisis, NOMBRES_GRUPO, observacionesDe, PREGUNTA_GRUPO, verCambio, verRazon, type Valor,
} from "@/lib/analisis-financiero";
import { conEmpresa } from "@/lib/db";
import { clientesDeFirma } from "@/lib/firma";
import { analisisGuardados } from "@/lib/pdf-analisis";
import { puede } from "@/lib/permisos";
import { llevaContabilidad } from "@/lib/reportes";
import { guardarInformeAnalisis } from "../../analisis-acciones";
import { Observaciones } from "./observaciones";

export const metadata = { title: "Análisis financiero · Empire Tax & Legal" };

// Análisis financiero (Prioridad 3, P3f): las razones de liquidez, endeudamiento, rentabilidad y actividad de un cliente, con las fórmulas a la vista, el
// comparativo y las observaciones de la firma. Salen de los mismos estados del cliente; el cliente se elige aquí adentro.
export default async function AnalisisFinanciero({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound(); // solo el equipo de la firma
  const clientes = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => c.estado_cliente !== "retirado" && c.estado_cliente !== "prospecto");
  const f = leerFiltrosAnalisis(sp);
  const elegido = esUuid(sp.empresa ?? "") ? clientes.find((c) => c.id === sp.empresa) : undefined;

  const detalle = elegido ? await (async () => {
    const { empresa, permisos } = await exigirPermiso(elegido.id, "ver", "/estados");
    if (empresa.firma_id !== fid) notFound();
    const r = await conEmpresa(elegido.id, async (tx) => ({
      analisis: await armarAnalisis(tx, f.desde, f.hasta, f.comparar),
      obs: await observacionesDe(tx, f.desde, f.hasta),
      contabilidad: await llevaContabilidad(tx),
      guardados: await analisisGuardados(tx, elegido.id),
    }));
    return { ...r, puedeEscribir: puede(permisos, "registrar"), puedeBajar: puede(permisos, "exportar"), puedeGuardar: puede(permisos, "adjuntar") };
  })() : null;

  const consulta = elegido ? new URLSearchParams({ empresa: elegido.id, desde: f.desde, hasta: f.hasta, comparar: f.comparar }).toString() : "";
  const celda = (kind: Parameters<typeof verRazon>[0], v: Valor) =>
    "num" in v ? verRazon(kind, v.num) : <><span>—</span><div className="sub" style={{ margin: 0, fontSize: "0.8em", fontWeight: 400 }}>{v.motivo}</div></>;

  return (
    <>
      <h1>Análisis financiero</h1>
      <p className="sub">
        Las razones que muestran cómo está un cliente: si puede pagar lo que debe, cuánto debe, cuánto gana y qué tan rápido cobra. Salen de los mismos estados financieros del cliente
        (sus facturas, compras y los saldos de su balance) y cada razón trae su fórmula. No se juzga con números de referencia: tú pones las observaciones.
      </p>

      <form method="get" className="tarjeta fila" style={{ marginBottom: 16, alignItems: "flex-end" }}>
        <label style={{ flex: "2 1 260px" }}>Cliente
          <select name="empresa" required defaultValue={elegido?.id ?? ""}>
            <option value="" disabled>Elige el cliente</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label>Desde<input type="date" name="desde" defaultValue={f.desde} required /></label>
        <label>Hasta<input type="date" name="hasta" defaultValue={f.hasta} required /></label>
        <label>Comparar con
          <select name="comparar" defaultValue={f.comparar}>
            {Object.entries(COMPARATIVOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button className="primario" type="submit">Ver el análisis</button>
      </form>

      {!detalle && <p className="sub">Elige un cliente y el período para ver su análisis.</p>}

      {elegido && detalle && (() => {
        const { analisis: a, obs, contabilidad } = detalle;
        const dos = a.columnas.length === 2;
        return (
          <>
            <div className="fila" style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>{elegido.nombre}</h2>
              {detalle.puedeBajar && <a className="boton" href={`/firma/${fid}/analisis/pdf?${consulta}`} target="_blank" rel="noopener noreferrer">Informe en PDF</a>}
            </div>

            {a.sinBalance.length > 0 && (
              <p className="aviso" role="status">
                Faltan los saldos del balance al {a.sinBalance.join(" y al ")}. Sin ellos no se calculan las razones que usan activos, pasivos o patrimonio (liquidez, endeudamiento,
                rendimientos y rotaciones) y no se inventan.{" "}
                <a href={`/e/${elegido.id}/estados?tipo=balance`}>{contabilidad ? "Revisa su contabilidad" : "Cárgalos en Estados financieros › Saldos del balance"}</a>.
              </p>
            )}
            {a.noCuadra.length > 0 && (
              <p className="aviso" role="status">El balance de {a.noCuadra.join(" y de ")} no cuadra (activos distinto de pasivos más patrimonio): revísalo antes de confiar en estas razones.</p>
            )}
            {a.sinIngresos && <p className="aviso" role="status">El período elegido no tiene ingresos operacionales: los márgenes, los días de cobro y las rotaciones no se calculan.</p>}

            {GRUPOS.map((g) => {
              const filas = a.razones.filter((r) => r.grupo === g);
              return (
                <section key={g} className="tarjeta" style={{ marginBottom: 16 }}>
                  <h2 style={{ marginTop: 0 }}>{NOMBRES_GRUPO[g]} <span className="sub" style={{ fontWeight: 400, fontSize: "0.7em" }}>· {PREGUNTA_GRUPO[g]}</span></h2>
                  <div className="tabla-envoltura">
                    <table>
                      <thead>
                        <tr><th style={{ minWidth: 160 }}>Razón</th>{a.columnas.map((c) => <th key={c.titulo} className="num" style={{ minWidth: 100 }}>{c.titulo}</th>)}{dos && <th className="num">Cambio</th>}</tr>
                      </thead>
                      <tbody>
                        {filas.map((r) => (
                          <tr key={r.clave}>
                            <td>
                              <strong>{r.nombre}</strong>
                              <div className="sub" style={{ margin: 0 }}>{r.formula}</div>
                              <div className="sub" style={{ margin: 0 }}>{r.mide}</div>
                            </td>
                            {r.valores.map((v, i) => <td key={i} className="num">{celda(r.kind, v)}</td>)}
                            {dos && <td className="num">{"num" in r.valores[0] && "num" in r.valores[1] ? verCambio(r.kind, r.valores[0].num, r.valores[1].num) : "—"}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}

            <p className="sub">
              Los saldos del balance son los del cierre de cada período (no promedios). La rentabilidad y las rotaciones son del período elegido, sin llevarlas a un año: para
              compararlas, usa períodos del mismo largo.
            </p>

            <section className="tarjeta" style={{ marginBottom: 16 }}>
              <h2 style={{ marginTop: 0 }}>Informe en el expediente</h2>
              <p className="sub">
                El informe en PDF de este período y esta comparación (con el logo del cliente y lo que escribiste abajo) se guarda en la carpeta <strong>05 · Reportes</strong> del
                expediente de {elegido.nombre}. Guarda primero las observaciones. Cada vez que se guarda queda una copia nueva.
              </p>
              <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
                {detalle.guardados.map((g) => (
                  <li key={g.id}>
                    <a href={`/e/${elegido.id}/documentos/${g.id}`} target="_blank" rel="noopener noreferrer">{g.descripcion.replace("Análisis financiero · ", "")}</a>
                    <span className="sub"> · guardado por {g.quien}, {g.subido_en.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" })}</span>
                  </li>
                ))}
                {detalle.guardados.length === 0 && <li className="sub">Todavía no se ha guardado ninguno.</li>}
              </ul>
              {detalle.puedeGuardar && <Formulario accion={guardarInformeAnalisis.bind(null, fid, elegido.id, f.desde, f.hasta, f.comparar)} boton="Guardar el informe en el expediente" className="fila"><></></Formulario>}
              <p style={{ margin: "8px 0 0" }}><a href={`/e/${elegido.id}/expediente`}>Abrir el expediente del cliente</a></p>
            </section>

            <Observaciones firmaId={fid} empresaId={elegido.id} desde={f.desde} hasta={f.hasta} textos={obs.textos} puedeEscribir={detalle.puedeEscribir} />
            {obs.en && <p className="sub">Última vez guardado{obs.por ? ` por ${obs.por}` : ""} el {obs.en.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" })}.</p>}
          </>
        );
      })()}
    </>
  );
}
