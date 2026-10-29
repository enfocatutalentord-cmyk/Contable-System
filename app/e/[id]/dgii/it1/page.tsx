import Link from "next/link";
import { Descargar } from "@/app/descargar";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { periodoAnterior, periodoDe } from "@/lib/formatos-dgii";
import { calcularIt1, esRelleno, SECCIONES, type Columna, type Resultado } from "@/lib/it1";
import { deCentavos, hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { guardarIt1, presentarIt1, quitarIt1 } from "../../dgii-acciones";

type Envio = { referencia: string | null; huella: string; enviado_en: Date; quien: string | null };

// Cómo se ve y cómo se escribe cada valor: montos con dos decimales, cantidades enteras, porcentajes con dos decimales.
const texto = (col: Columna, v: bigint) => (col.tipo === "cantidad" ? String(v / 100n) : deCentavos(v));
const ver = (col: Columna, v: bigint) =>
  col.tipo === "cantidad" ? String(v / 100n) : col.tipo === "porcentaje" ? `${deCentavos(v)} %` : verMonto(deCentavos(v));

export default async function It1({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string }> }) {
  const { id } = await params;
  const { mes } = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const hoy = hoyISO();
  const p = periodoDe((mes ?? "").replace("-", "")) ?? periodoDe(periodoAnterior(hoy))!;
  const { r, manuales, envio, guardado } = await conEmpresa(id, async (tx) => {
    const [d] = await tx<{ manuales: Record<string, string>; actualizado_en: Date; quien: string | null }[]>`
      SELECT d.manuales, d.actualizado_en, u.nombre AS quien FROM declaraciones_itbis d LEFT JOIN usuarios u ON u.id = d.actualizado_por
       WHERE d.periodo = ${p.periodo}`;
    const [e] = await tx<Envio[]>`
      SELECT e.referencia, e.huella, e.enviado_en, u.nombre AS quien FROM envios_dgii e LEFT JOIN usuarios u ON u.id = e.enviado_por
       WHERE e.formato = 'IT-1' AND e.periodo = ${p.periodo}`;
    return { r: await calcularIt1(tx, p, d?.manuales ?? {}), manuales: d?.manuales ?? {}, envio: e, guardado: d };
  });
  const editar = puede(permisos, "impuestos") && !envio;
  const errores = r.avisos.filter((a) => a.nivel === "error");
  const avisos = r.avisos.filter((a) => a.nivel === "aviso");
  const cambio = envio && envio.huella !== r.huella;
  const v = (k: string) => r.valores[k] ?? 0n;
  const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" });

  const celda = (col: Columna) => {
    if (esRelleno(col.clave)) return <td key={col.clave} />;
    const valor = v(col.clave);
    if (!col.editable || !editar) {
      return <td key={col.clave} className={`num${col.editable && manuales[col.clave] !== undefined ? " escrito" : ""}`}>{ver(col, valor)}</td>;
    }
    const sugerido = r.sugeridos[col.clave] ?? 0n;
    const escrito = manuales[col.clave] !== undefined;
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
      <p><Link href={`/e/${id}/dgii?mes=${p.periodo.slice(0, 4)}-${p.periodo.slice(4)}`}>← Reportes DGII</Link></p>
      <div className="entre">
        <div>
          <h1>IT-1 · Declaración del ITBIS</h1>
          <p className="sub">
            Borrador del formulario IT-1 2020 y su Anexo A, con las casillas del formulario de la DGII. Lo que el sistema sabe se
            llena solo (los 606 y 607 deben enviarse antes); lo demás se escribe. Vence el {verFecha(`${p.vence.slice(0, 8)}20`)}.
          </p>
        </div>
        <span className={`estado-envio ${envio ? (cambio ? "cambio" : "enviado") : errores.length ? "con-errores" : "listo"}`}>
          {envio ? (cambio ? "Cambió después de presentarlo" : "Presentado") : errores.length ? `${errores.length} por corregir` : "Listo para presentar"}
        </span>
      </div>
      <form className="fila" style={{ marginBottom: 12 }}>
        <label>Mes que se declara<input type="month" name="mes" defaultValue={`${p.periodo.slice(0, 4)}-${p.periodo.slice(4)}`} /></label>
        <button>Ver</button>
        <Descargar href={`/e/${id}/exportar/it1?periodo=${p.periodo}`} />
      </form>

      <dl className="cifras-dgii tarjeta">
        <div><dt>ITBIS cobrado (21)</dt><dd>{verMonto(deCentavos(v("I21")))}</dd></div>
        <div><dt>ITBIS deducible (25)</dt><dd>{verMonto(deCentavos(v("I25")))}</dd></div>
        <div><dt>Diferencia a pagar (33)</dt><dd>{verMonto(deCentavos(v("I33")))}</dd></div>
        <div><dt>Nuevo saldo a favor (34)</dt><dd>{verMonto(deCentavos(v("I34")))}</dd></div>
        <div><dt>Retenciones a pagar (67)</dt><dd>{verMonto(deCentavos(v("I67")))}</dd></div>
        <div><dt>Total general (68)</dt><dd>{verMonto(deCentavos(v("I68")))}</dd></div>
      </dl>

      {errores.length > 0 && <ul className="avisos-dgii">{errores.map((a, i) => <li key={i} className="error">{a.texto}</li>)}</ul>}
      {avisos.length > 0 && <ul className="avisos-dgii">{avisos.map((a, i) => <li key={i} className="aviso-texto">{a.texto}</li>)}</ul>}

      {envio && (
        <div className="tarjeta" style={{ margin: "12px 0" }}>
          <p className="sub" style={{ margin: 0 }}>
            Marcado como presentado el {fechaHora(envio.enviado_en)} por {envio.quien ?? "—"}{envio.referencia && <> · referencia {envio.referencia}</>}.
            Su casilla 34 pasa como saldo a favor anterior al mes siguiente.
          </p>
          {cambio && <p className="error">Después de presentarlo cambió algo de este mes. Si corresponde, presenta una rectificativa y vuelve a marcarlo.</p>}
          {puede(permisos, "impuestos") && <Formulario accion={quitarIt1.bind(null, id, p.periodo)} boton="Quitar marca de presentado" className="fila"><span /></Formulario>}
        </div>
      )}

      <Formulario accion={guardarIt1.bind(null, id, p.periodo)} boton={editar ? "Guardar y recalcular" : ""} className="it1">
        {(["A", "I"] as const).map((hoja) => (
          <section key={hoja} className="tarjeta formato-dgii">
            <h2 style={{ marginTop: 0 }}>{hoja === "A" ? "Anexo A" : "Formulario IT-1"}</h2>
            {SECCIONES.filter((s) => s.hoja === hoja).map((s) => (
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
        <Formulario accion={presentarIt1.bind(null, id, p.periodo)} boton="Marcar como presentado" className="fila">
          <label style={{ flex: "1 1 260px" }}>Referencia de la Oficina Virtual (opcional)<input name="referencia" maxLength={60} /></label>
        </Formulario>
      )}
      <ResumenOrigen r={r} />
    </>
  );
}

function ResumenOrigen({ r }: { r: Resultado }) {
  const filas = Object.entries(r.origen);
  if (!filas.length) return null;
  return (
    <details className="tarjeta" style={{ marginTop: 12 }}>
      <summary>De dónde salen los valores sugeridos</summary>
      <ul>{filas.map(([k, t]) => <li key={k}><b>{k.startsWith("A") ? `Anexo A ${k.slice(1)}` : `IT-1 ${k.slice(1)}`}</b>: {t}</li>)}</ul>
    </details>
  );
}
