import Link from "next/link";
import { Descargar } from "@/app/descargar";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { FORMULARIOS, manualesDe, type Formulario as Form } from "@/lib/declaraciones";
import { periodoAnterior, periodoDe } from "@/lib/formatos-dgii";
import { esRelleno, type Columna, type Resultado } from "@/lib/it1";
import type { FilaIr6 } from "@/lib/ir17";
import { deCentavos, hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { guardarDeclaracion, presentarDeclaracion, quitarDeclaracion } from "../dgii-acciones";

type Envio = { referencia: string | null; huella: string; enviado_en: Date; quien: string | null };

// Cómo se ve y cómo se escribe cada valor: montos con dos decimales, cantidades enteras, porcentajes con dos decimales.
const texto = (col: Columna, v: bigint) => (col.tipo === "cantidad" ? String(v / 100n) : deCentavos(v));
const ver = (col: Columna, v: bigint) =>
  col.tipo === "cantidad" ? String(v / 100n) : col.tipo === "porcentaje" ? `${deCentavos(v)} %` : verMonto(deCentavos(v));
const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" });

// Pantalla de una declaración jurada (IT-1, IR-17): las casillas del formulario oficial, lo sugerido desde lo registrado,
// lo escrito a mano, la revisión y la constancia de presentación.
export async function Declaracion({ id, formulario, mes }: { id: string; formulario: Form; mes?: string }) {
  const def = FORMULARIOS[formulario];
  const { permisos } = await accesoEmpresa(id);
  const hoy = hoyISO();
  const p = periodoDe((mes ?? "").replace("-", "")) ?? periodoDe(periodoAnterior(hoy))!;
  const mesTexto = `${p.periodo.slice(0, 4)}-${p.periodo.slice(4)}`;
  const { r, manuales, envio, guardado } = await conEmpresa(id, async (tx) => {
    const manuales = await manualesDe(tx, formulario, p.periodo);
    const [d] = await tx<{ actualizado_en: Date; quien: string | null }[]>`
      SELECT d.actualizado_en, u.nombre AS quien FROM declaraciones d LEFT JOIN usuarios u ON u.id = d.actualizado_por
       WHERE d.formulario = ${formulario} AND d.periodo = ${p.periodo}`;
    const [e] = await tx<Envio[]>`
      SELECT e.referencia, e.huella, e.enviado_en, u.nombre AS quien FROM envios_dgii e LEFT JOIN usuarios u ON u.id = e.enviado_por
       WHERE e.formato = ${formulario} AND e.periodo = ${p.periodo}`;
    return { r: await def.calcular(tx, p, manuales), manuales, envio: e, guardado: d };
  });
  const editar = puede(permisos, "impuestos") && !envio;
  const errores = r.avisos.filter((a) => a.nivel === "error");
  const avisos = r.avisos.filter((a) => a.nivel === "aviso");
  const cambio = envio && envio.huella !== r.huella;
  const v = (k: string) => r.valores[k] ?? 0n;
  const vence = `${p.vence.slice(0, 8)}${String(def.diaVence).padStart(2, "0")}`;

  const celda = (col: Columna) => {
    if (esRelleno(col.clave)) return <td key={col.clave} />;
    const valor = v(col.clave);
    const escrito = manuales[col.clave] !== undefined;
    if (!col.editable || !editar) return <td key={col.clave} className={`num${col.editable && escrito ? " escrito" : ""}`}>{ver(col, valor)}</td>;
    const sugerido = r.sugeridos[col.clave] ?? 0n;
    return (
      <td key={col.clave} className="num">
        <input name={col.clave} defaultValue={texto(col, valor)} inputMode="decimal" aria-label={`Casilla ${col.clave}`}
          className={escrito ? "escrito" : undefined} title={r.origen[col.clave]} />
        <input type="hidden" name={`${col.clave}_auto`} value={texto(col, sugerido)} />
        {escrito && sugerido !== valor && <small className="sugerido">Sugerido: {ver(col, sugerido)}</small>}
      </td>
    );
  };

  return (
    <>
      <p><Link href={`/e/${id}/dgii?mes=${mesTexto}`}>← Reportes DGII</Link></p>
      <div className="entre">
        <div>
          <h1>{def.nombre}</h1>
          <p className="sub">
            Borrador con las casillas del formulario oficial de la DGII. Lo que el sistema sabe se llena solo; lo demás se escribe.
            Vence el {verFecha(vence)}.
          </p>
        </div>
        <span className={`estado-envio ${envio ? (cambio ? "cambio" : "enviado") : errores.length ? "con-errores" : "listo"}`}>
          {envio ? (cambio ? "Cambió después de presentarlo" : "Presentado") : errores.length ? `${errores.length} por corregir` : "Listo para presentar"}
        </span>
      </div>
      <form className="fila" style={{ marginBottom: 12 }}>
        <label>Mes que se declara<input type="month" name="mes" defaultValue={mesTexto} /></label>
        <button>Ver</button>
        <Descargar href={`/e/${id}/exportar/${def.ruta}?periodo=${p.periodo}`} />
      </form>

      <dl className="cifras-dgii tarjeta">
        {def.cifras.map(([k, t]) => <div key={k}><dt>{t}</dt><dd>{verMonto(deCentavos(v(k)))}</dd></div>)}
      </dl>

      {errores.length > 0 && (
        <ul className="avisos-dgii">{errores.map((a, i) => <li key={i} className="error">{a.texto}{a.enlace && <> <Link href={`/e/${id}${a.enlace}`}>Corregir →</Link></>}</li>)}</ul>
      )}
      {avisos.length > 0 && <ul className="avisos-dgii">{avisos.map((a, i) => <li key={i} className="aviso-texto">{a.texto}</li>)}</ul>}

      {envio && (
        <div className="tarjeta" style={{ margin: "12px 0" }}>
          <p className="sub" style={{ margin: 0 }}>
            Marcado como presentado el {fechaHora(envio.enviado_en)} por {envio.quien ?? "—"}{envio.referencia && <> · referencia {envio.referencia}</>}.
            Su nuevo saldo a favor pasa como saldo a favor anterior al mes siguiente.
          </p>
          {cambio && <p className="error">Después de presentarlo cambió algo de este mes. Si corresponde, presenta una rectificativa y vuelve a marcarlo.</p>}
          {puede(permisos, "impuestos") && <Formulario accion={quitarDeclaracion.bind(null, id, formulario, p.periodo)} boton="Quitar marca de presentado" className="fila"><span /></Formulario>}
        </div>
      )}

      <Formulario accion={guardarDeclaracion.bind(null, id, formulario, p.periodo)} boton={editar ? "Guardar y recalcular" : ""} className="it1">
        {def.hojas.map(([hoja, titulo]) => (
          <section key={hoja} className="tarjeta formato-dgii">
            <h2 style={{ marginTop: 0 }}>{titulo}</h2>
            {def.secciones.filter((s) => s.hoja === hoja).map((s) => (
              <div key={s.titulo} className="tabla-envoltura">
                <table className="tabla-it1">
                  <thead><tr><th>Casilla</th><th>{s.titulo}</th>{s.encabezados.map((e) => <th key={e} className="num">{e}</th>)}</tr></thead>
                  <tbody>
                    {s.renglones.map((f) => (
                      <tr key={f.n} className={f.columnas.every((col) => !col.editable) ? "calculada" : undefined}>
                        <td>{f.n}</td><td>{f.texto}</td>{f.columnas.map(celda)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        ))}
        {guardado && <p className="sub">Última edición: {fechaHora(guardado.actualizado_en)} por {guardado.quien ?? "—"}.</p>}
      </Formulario>

      {editar && errores.length === 0 && (
        <Formulario accion={presentarDeclaracion.bind(null, id, formulario, p.periodo)} boton="Marcar como presentado" className="fila">
          <label style={{ flex: "1 1 260px" }}>Referencia de la Oficina Virtual (opcional)<input name="referencia" maxLength={60} /></label>
        </Formulario>
      )}
      {"ir6" in r && <AnexoIr6 filas={(r as Resultado & { ir6: FilaIr6[] }).ir6} descarga={`/e/${id}/exportar/ir6?periodo=${p.periodo}`} />}
      <ResumenOrigen r={r} />
    </>
  );
}

function AnexoIr6({ filas, descarga }: { filas: FilaIr6[]; descarga: string }) {
  return (
    <section className="tarjeta formato-dgii" style={{ marginTop: 12 }}>
      <div className="entre">
        <h2 style={{ margin: 0 }}>Anexo IR-6 · Detalle de las retenciones del mes</h2>
        {filas.length > 0 && <Descargar href={descarga} />}
      </div>
      <p className="sub">El formulario pide conservar este detalle por beneficiario, disponible para la DGII. Sale de los pagos con retención de ISR.</p>
      {filas.length === 0 ? <p className="sub">No hubo retenciones de ISR este mes.</p> : (
        <div className="tabla-envoltura"><table>
          <thead><tr><th>Fecha</th><th>Pago</th><th>Forma de pago</th><th>Beneficiario</th><th>RNC/Cédula</th><th>Código</th><th className="num">Monto del pago</th><th className="num">Sujeto a retención</th><th className="num">Tasa</th><th className="num">Retenido</th></tr></thead>
          <tbody>{filas.map((f, i) => (
            <tr key={i}>
              <td>{verFecha(f.fecha)}</td><td>{f.pagoNumero}</td><td>{f.formaPago}</td><td>{f.beneficiario}</td><td>{f.identificacion}</td>
              <td className={f.codigo === null ? "error" : undefined}>{f.codigo ?? "Sin concepto"}</td>
              <td className="num">{verMonto(deCentavos(f.montoPago))}</td><td className="num">{verMonto(deCentavos(f.sujeto))}</td>
              <td className="num">{deCentavos(f.tasa)} %</td><td className="num">{verMonto(deCentavos(f.retenido))}</td>
            </tr>))}
          </tbody>
        </table></div>
      )}
    </section>
  );
}

function ResumenOrigen({ r }: { r: Resultado }) {
  const filas = Object.entries(r.origen);
  if (!filas.length) return null;
  return (
    <details className="tarjeta" style={{ marginTop: 12 }}>
      <summary>De dónde salen los valores sugeridos</summary>
      <ul>{filas.map(([k, t]) => <li key={k}><b>{k.startsWith("A") ? `Anexo A ${k.slice(1)}` : `Casilla ${k.slice(1).replace(/[a-z]$/, "")}`}</b>: {t}</li>)}</ul>
    </details>
  );
}
