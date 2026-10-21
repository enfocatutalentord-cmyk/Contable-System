import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { libroMayor } from "@/lib/libros";
import { verFecha, verMonto } from "@/lib/montos";
import { CamposPeriodo, leerPeriodo } from "../periodo";

export default async function Mayor({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ desde?: string; hasta?: string; cuenta?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa } = await accesoEmpresa(id);
  const { desde, hasta } = leerPeriodo(sp);
  const { cuentas, mayor } = await conEmpresa(id, async (tx) => {
    const cuentas = await listarCuentas(tx);
    const elegida = cuentas.find((c) => c.id === sp.cuenta);
    return { cuentas, mayor: elegida ? await libroMayor(tx, elegida.id, desde, hasta) : null };
  });

  return (
    <>
      <h1>Libro mayor</h1>
      <p className="sub">{empresa.nombre} · del {verFecha(desde)} al {verFecha(hasta)}. Si eliges una cuenta de grupo, junta todas sus subcuentas.</p>
      <form className="fila" style={{ marginBottom: 16 }}>
        <label style={{ flex: "1 1 280px" }}>Cuenta
          <select name="cuenta" defaultValue={sp.cuenta ?? ""} required>
            <option value="" disabled>Elige…</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </label>
        <CamposPeriodo desde={desde} hasta={hasta} />
        <button>Ver</button>
        {mayor && <a className="boton" href={`/e/${id}/exportar/mayor?cuenta=${mayor.cuenta.id}&desde=${desde}&hasta=${hasta}`}>Descargar Excel</a>}
      </form>
      {mayor && (
        <>
          <h2>{mayor.cuenta.codigo} · {mayor.cuenta.nombre}</h2>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Fecha</th><th>N.º</th><th>Concepto</th><th className="num">Debe</th><th className="num">Haber</th><th className="num">Saldo</th></tr></thead>
              <tbody>
                <tr className="grupo"><td>{verFecha(desde)}</td><td /><td>Saldo inicial</td><td /><td /><td className="num">{verMonto(mayor.inicial)}</td></tr>
                {mayor.movimientos.map((m, i) => (
                  <tr key={i}>
                    <td>{verFecha(m.fecha)}</td>
                    <td><Link href={`/e/${id}/asientos/${m.numero}`}>{m.numero}</Link></td>
                    <td>{m.concepto}{m.descripcion && <div className="sub" style={{ margin: 0 }}>{m.descripcion}</div>}</td>
                    <td className="num">{verMonto(m.debe, true)}</td>
                    <td className="num">{verMonto(m.haber, true)}</td>
                    <td className="num">{verMonto(m.saldo)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Saldo final</td>
                  <td className="num">{verMonto(mayor.cuenta.debe)}</td>
                  <td className="num">{verMonto(mayor.cuenta.haber)}</td>
                  <td className="num">{verMonto(mayor.final)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </>
  );
}
