import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { balanza } from "@/lib/libros";
import { verFecha, verMonto } from "@/lib/montos";
import { CamposPeriodo, leerPeriodo } from "../periodo";

export default async function Balanza({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ desde?: string; hasta?: string; nivel?: string; ceros?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa } = await accesoEmpresa(id);
  const { desde, hasta } = leerPeriodo(sp);
  const nivel = Math.min(6, Math.max(1, Number(sp.nivel) || 6));
  const conCeros = sp.ceros === "1";
  const { filas, totales } = await conEmpresa(id, (tx) => balanza(tx, desde, hasta, nivel, conCeros));
  const cuadra = totales.debe === totales.haber && totales.saldoDeudor === totales.saldoAcreedor;
  const consulta = `desde=${desde}&hasta=${hasta}&nivel=${nivel}${conCeros ? "&ceros=1" : ""}`;

  return (
    <>
      <h1>Balanza de comprobación</h1>
      <p className="sub">{empresa.nombre}{empresa.rnc && <> · RNC {empresa.rnc}</>} · del {verFecha(desde)} al {verFecha(hasta)} · valores en {empresa.moneda}</p>
      <form className="fila" style={{ marginBottom: 16 }}>
        <CamposPeriodo desde={desde} hasta={hasta} />
        <label>Nivel
          <select name="nivel" defaultValue={String(nivel)}>
            <option value="1">1 · Clases</option>
            <option value="2">2 · Grupos</option>
            <option value="3">3 · Subgrupos</option>
            <option value="6">Todas las cuentas</option>
          </select>
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" name="ceros" value="1" defaultChecked={conCeros} style={{ minHeight: 0 }} /> Incluir cuentas en cero
        </label>
        <button>Ver</button>
        <><a className="boton" href={`/e/${id}/exportar/balanza?formato=xlsx&${consulta}`}>Excel</a><a className="boton" href={`/e/${id}/exportar/balanza?formato=pdf&${consulta}`}>PDF</a></>
      </form>
      {!cuadra && <p className="aviso">La balanza no cuadra. Esto no debería pasar; avísale al soporte.</p>}
      <div className="tabla-envoltura">
        <table>
          <thead>
            <tr>
              <th rowSpan={2}>Código</th><th rowSpan={2}>Cuenta</th>
              <th className="num" colSpan={2}>Saldo inicial</th><th className="num" colSpan={2}>Movimientos</th><th className="num" colSpan={2}>Saldo final</th>
            </tr>
            <tr><th className="num">Deudor</th><th className="num">Acreedor</th><th className="num">Debe</th><th className="num">Haber</th><th className="num">Deudor</th><th className="num">Acreedor</th></tr>
          </thead>
          <tbody>
            {filas.map((c) => (
              <tr key={c.id} className={c.de_detalle ? undefined : "grupo"}>
                <td>{c.codigo}</td>
                <td style={{ paddingLeft: 12 + (c.nivel - 1) * 14 }}>
                  {c.de_detalle ? <Link href={`/e/${id}/mayor?cuenta=${c.id}&desde=${desde}&hasta=${hasta}`}>{c.nombre}</Link> : c.nombre}
                </td>
                <td className="num">{verMonto(c.inicialDeudor, true)}</td>
                <td className="num">{verMonto(c.inicialAcreedor, true)}</td>
                <td className="num">{verMonto(c.debe, true)}</td>
                <td className="num">{verMonto(c.haber, true)}</td>
                <td className="num">{verMonto(c.saldoDeudor, true)}</td>
                <td className="num">{verMonto(c.saldoAcreedor, true)}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={8}>No hay movimientos en este período.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Totales</td>
              <td className="num">{verMonto(totales.inicialDeudor)}</td>
              <td className="num">{verMonto(totales.inicialAcreedor)}</td>
              <td className="num">{verMonto(totales.debe)}</td>
              <td className="num">{verMonto(totales.haber)}</td>
              <td className="num">{verMonto(totales.saldoDeudor)}</td>
              <td className="num">{verMonto(totales.saldoAcreedor)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
