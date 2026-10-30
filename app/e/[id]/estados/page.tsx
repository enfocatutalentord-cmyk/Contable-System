import Link from "next/link";
import { Descargar } from "@/app/descargar";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { COMPARAR, porcentaje, variacion, type Fila } from "@/lib/estados";
import { armarEstado, consultaEstados, leerFiltrosEstados, TITULOS, type TipoEstado } from "@/lib/estados-pantalla";
import { verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { guardarFirmasEstados } from "../estados-acciones";

export const metadata = { title: "Estados financieros · Empire Tax’N Legal" };

// Estado de resultados y estado de situación financiera, con comparativos y clic al libro mayor de cada cuenta.
export default async function Estados({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa, permisos } = await accesoEmpresa(id);
  const f = leerFiltrosEstados(sp);
  const { estado, firmas } = await conEmpresa(id, (tx) => armarEstado(tx, f));
  const cols = estado.columnas;
  const dos = cols.length === 2 && !estado.sinVariacion;
  const conPct = f.tipo === "resultados" && cols.length === 1;
  const enlaceTipo = (t: TipoEstado) => `/e/${id}/estados?${consultaEstados({ ...f, tipo: t })}`;
  const mayor = (fila: Fila) => {
    if (!fila.cuentaId) return null;
    const desde = f.tipo === "balance" ? `${cols[0].hasta.slice(0, 4)}-01-01` : cols[0].desde;
    return `/e/${id}/mayor?cuenta=${fila.cuentaId}&desde=${desde}&hasta=${cols[0].hasta}`;
  };

  return (
    <>
      <div className="entre">
        <div>
          <h1>Estados financieros</h1>
          <p className="sub">{empresa.nombre}{empresa.rnc && <> · RNC {empresa.rnc}</>} · valores en {empresa.moneda} · de los asientos contabilizados</p>
        </div>
        {puede(permisos, "exportar") && <Descargar href={`/e/${id}/exportar/estado-financiero?${consultaEstados(f)}`} />}
      </div>
      <nav className="fila" style={{ marginBottom: 12 }} aria-label="Estado">
        {(Object.keys(TITULOS) as TipoEstado[]).map((t) => (
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
        <button>Ver</button>
      </form>

      <h2 style={{ marginBottom: 4 }}>{TITULOS[f.tipo]}</h2>
      <p className="sub">
        {f.tipo === "balance" ? `Al ${verFecha(cols[0].hasta)}` : `Del ${verFecha(cols[0].desde)} al ${verFecha(cols[0].hasta)}`}
        {f.tipo === "flujo" && " · método indirecto; la actividad de cada cuenta se cambia en el Catálogo de cuentas"}
        {f.tipo !== "patrimonio" && " · toca una cuenta para ver su libro mayor"}
      </p>
      {estado.cuadraEfectivo?.some((c) => !c) && (
        <p className="aviso">El efectivo al final no coincide con el saldo de las cuentas de efectivo. Revisa en el Catálogo qué cuentas están marcadas como «Efectivo y equivalentes».</p>
      )}
      {estado.cuadra && estado.cuadra.some((c) => !c) && (
        <p className="aviso">El activo no es igual al pasivo más el patrimonio en alguna fecha. Revisa la balanza de comprobación.</p>
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
