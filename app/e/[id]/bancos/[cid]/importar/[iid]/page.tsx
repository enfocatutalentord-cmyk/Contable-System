import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, esUuid } from "@/lib/acceso";
import { armarMovimientos, CAMPOS, columnas, NOMBRE_TIPO, revisarFormato, type Celda } from "@/lib/archivos-banco";
import { leerImportacion, vistaPrevia } from "@/lib/bancos";
import { conEmpresa } from "@/lib/db";
import { verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { descartarImportacion, guardarFormato, importarMovimientos } from "../../../../bancos-acciones";

export const metadata = { title: "Importar estado de cuenta · Empire Tax’N Legal" };

const verCelda = (c: Celda) => (c === null ? "" : c instanceof Date ? verFecha(c.toISOString()) : String(c));
const ORDENES: Record<string, string> = { dma: "Día/mes/año (31/12/2026)", mda: "Mes/día/año (12/31/2026)", amd: "Año-mes-día (2026-12-31)" };

// Vista previa de un estado de cuenta antes de importarlo: qué columna es cada dato, qué movimientos son nuevos y
// cuáles ya estaban. Nada se guarda en los movimientos hasta «Importar».
export default async function Importar({ params }: { params: Promise<{ id: string; cid: string; iid: string }> }) {
  const { id, cid, iid } = await params;
  if (!esUuid(cid) || !esUuid(iid)) notFound();
  const { permisos } = await accesoEmpresa(id);
  if (!puede(permisos, "registrar")) redirect(`/e/${id}/bancos/${cid}?sin_permiso=1`);
  const datos = await conEmpresa(id, async (tx) => {
    const d = await leerImportacion(tx, iid).catch(() => null);
    if (!d || d.i.cuenta_bancaria_id !== cid) return null;
    const cols = columnas(d.filas, d.formato.encabezado);
    const problema = revisarFormato(d.formato, cols);
    const lectura = problema ? null : armarMovimientos(d.filas, d.formato);
    const vista = lectura ? await vistaPrevia(tx, cid, d.cuenta.fecha_inicial, lectura) : null;
    return { ...d, cols, problema, vista };
  });
  if (!datos) notFound();
  const { i, cuenta, filas, formato, cols, problema, vista } = datos;
  if (i.estado !== "borrador") redirect(`/e/${id}/bancos/${cid}`);
  const usd = cuenta.moneda === "USD" ? "US$ " : "";
  const muestra = filas.slice(0, Math.max(formato.encabezado + 6, 8));

  return (
    <>
      <p className="sub" style={{ marginBottom: 4 }}><Link href={`/e/${id}/bancos/${cid}`}>← {cuenta.nombre}</Link></p>
      <h1>Importar estado de cuenta</h1>
      <p className="sub">{i.nombre} · {NOMBRE_TIPO[i.tipo]} · {filas.length} filas · a la cuenta {cuenta.nombre} ({cuenta.banco})</p>

      <div className="tarjeta" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>1. Qué columna es cada dato</h2>
        <p className="sub">Lo primero que se ve del archivo, tal como viene. Si el banco pone títulos arriba, indica en qué fila está el encabezado.</p>
        <div className="tabla-envoltura" style={{ marginBottom: 12 }}>
          <table>
            <tbody>
              {muestra.map((r, n) => (
                <tr key={n} style={n === formato.encabezado ? { fontWeight: 650, background: "var(--aviso-fondo)" } : undefined}>
                  <td className="sub" style={{ margin: 0 }}>{n + 1}</td>
                  {r.map((c, k) => <td key={k}>{verCelda(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Formulario accion={guardarFormato.bind(null, id, iid)} boton="Aplicar" className="fila">
          <label style={{ flex: "0 1 150px" }}>Fila del encabezado
            <select name="encabezado" defaultValue={formato.encabezado}>
              {filas.slice(0, 30).map((_, n) => <option key={n} value={n}>{n + 1}</option>)}
            </select>
          </label>
          {CAMPOS.map(([campo, nombre]) => (
            <label key={campo} style={{ flex: "1 1 170px" }}>{nombre}
              <select name={campo} defaultValue={(formato[campo] as string | null) ?? ""}>
                <option value="">{campo === "fecha" || campo === "descripcion" ? "Elige…" : "No tiene"}</option>
                {cols.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          ))}
          <label style={{ flex: "1 1 220px" }}>Las fechas vienen como
            <select name="orden" defaultValue={formato.orden}>
              {Object.entries(ORDENES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="casilla" style={{ flex: "1 1 280px" }}>
            <input type="checkbox" name="invertir" defaultChecked={formato.invertir} /> Con un solo monto: el banco pone los retiros en positivo
          </label>
        </Formulario>
        <p className="sub" style={{ marginBottom: 0 }}>Usa débito y crédito si el banco los separa en dos columnas, o «monto con signo» si es una sola.</p>
      </div>

      <div className="tarjeta">
        <h2 style={{ marginTop: 0 }}>2. Vista previa</h2>
        {problema && <p className="aviso">{problema}</p>}
        {vista && (
          <>
            <dl className="cifras-dgii">
              <div><dt>Nuevos</dt><dd>{vista.nuevos}</dd></div>
              <div><dt>Ya estaban</dt><dd>{vista.repetidos}</dd></div>
              {vista.anteriores > 0 && <div><dt>Antes del {verFecha(cuenta.fecha_inicial)}</dt><dd>{vista.anteriores}</dd></div>}
              <div><dt>Entradas</dt><dd>{usd}{verMonto(vista.entradas)}</dd></div>
              <div><dt>Salidas</dt><dd>{usd}{verMonto(vista.salidas)}</dd></div>
              <div><dt>Período</dt><dd>{vista.desde ? `${verFecha(vista.desde)} al ${verFecha(vista.hasta)}` : "—"}</dd></div>
            </dl>
            {vista.errores.length > 0 && (
              <div className="aviso" role="alert">
                <strong>Hay {vista.errores.length} fila{vista.errores.length > 1 ? "s" : ""} con errores</strong>; corrige el formato:
                <ul style={{ margin: "6px 0 0" }}>{vista.errores.slice(0, 10).map((e) => <li key={e.fila}>Fila {e.fila}: {e.texto}</li>)}</ul>
              </div>
            )}
            {vista.avisos.map((a) => <p key={a} className="aviso">{a}</p>)}
            {vista.anteriores > 0 && <p className="sub">Los movimientos anteriores al {verFecha(cuenta.fecha_inicial)} (la fecha desde la que se concilia esta cuenta) no se importan.</p>}
            <div className="tabla-envoltura" style={{ margin: "12px 0" }}>
              <table>
                <thead><tr><th>Fila</th><th>Fecha</th><th>Descripción</th><th>Referencia</th><th className="num">Entra</th><th className="num">Sale</th><th className="num">Saldo</th><th /></tr></thead>
                <tbody>
                  {vista.movimientos.slice(0, 200).map((m) => {
                    const ya = vista.repetido.has(`${m.huella}:${m.ocurrencia}`);
                    const antes = m.fecha < cuenta.fecha_inicial;
                    return (
                      <tr key={`${m.huella}:${m.ocurrencia}`} className={ya || antes ? "anulado" : undefined}>
                        <td>{m.fila}</td>
                        <td>{verFecha(m.fecha)}</td>
                        <td>{m.descripcion}</td>
                        <td>{m.referencia}</td>
                        <td className="num">{m.monto > 0n ? verMonto(m.monto) : ""}</td>
                        <td className="num">{m.monto < 0n ? verMonto(-m.monto) : ""}</td>
                        <td className="num">{m.saldo === null ? "" : verMonto(m.saldo)}</td>
                        <td>{ya ? "Ya estaba" : antes ? "Anterior" : "Nuevo"}</td>
                      </tr>
                    );
                  })}
                  {vista.movimientos.length === 0 && <tr><td colSpan={8}>Con este formato no sale ningún movimiento. Revisa las columnas.</td></tr>}
                </tbody>
              </table>
            </div>
            {vista.movimientos.length > 200 && <p className="sub">Se muestran los primeros 200 de {vista.movimientos.length}.</p>}
          </>
        )}
        <div className="fila">
          {vista && vista.errores.length === 0 && vista.nuevos > 0 && (
            <Formulario accion={importarMovimientos.bind(null, id, iid)} boton={`Importar ${vista.nuevos} movimiento${vista.nuevos > 1 ? "s" : ""}`} className="fila"><span /></Formulario>
          )}
          <Formulario accion={descartarImportacion.bind(null, id, iid)} boton="Descartar este archivo" className="fila"><span /></Formulario>
        </div>
      </div>
    </>
  );
}
