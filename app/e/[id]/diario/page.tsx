import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { libroDiario } from "@/lib/libros";
import { verFecha, verMonto } from "@/lib/montos";
import { CamposPeriodo, leerPeriodo } from "../periodo";

export default async function Diario({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const { id } = await params;
  const { empresa } = await accesoEmpresa(id);
  const { desde, hasta } = leerPeriodo(await searchParams);
  const lineas = await conEmpresa(id, (tx) => libroDiario(tx, desde, hasta));
  const totalDebe = lineas.reduce((s, l) => s + Number(l.debe), 0);
  const totalHaber = lineas.reduce((s, l) => s + Number(l.haber), 0);

  return (
    <>
      <h1>Libro diario</h1>
      <p className="sub">{empresa.nombre} · del {verFecha(desde)} al {verFecha(hasta)}</p>
      <form className="fila" style={{ marginBottom: 16 }}>
        <CamposPeriodo desde={desde} hasta={hasta} />
        <button>Ver</button>
        <a className="boton" href={`/e/${id}/exportar/diario?desde=${desde}&hasta=${hasta}`}>Descargar Excel</a>
      </form>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Fecha</th><th>N.º</th><th>Cuenta</th><th>Concepto / descripción</th><th className="num">Debe</th><th className="num">Haber</th></tr></thead>
          <tbody>
            {lineas.map((l, i) => {
              const primera = i === 0 || lineas[i - 1].numero !== l.numero;
              return (
                <tr key={i}>
                  <td>{primera && verFecha(l.fecha)}</td>
                  <td>{primera && <Link href={`/e/${id}/asientos/${l.numero}`}>{l.numero}</Link>}</td>
                  <td>{l.codigo} · {l.cuenta}</td>
                  <td>{primera ? l.concepto : ""}{l.descripcion && <div className="sub" style={{ margin: 0 }}>{l.descripcion}</div>}</td>
                  <td className="num">{verMonto(l.debe, true)}</td>
                  <td className="num">{verMonto(l.haber, true)}</td>
                </tr>
              );
            })}
            {lineas.length === 0 && <tr><td colSpan={6}>No hay asientos en este período.</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={4}>Totales</td><td className="num">{verMonto(totalDebe)}</td><td className="num">{verMonto(totalHaber)}</td></tr></tfoot>
        </table>
      </div>
    </>
  );
}
