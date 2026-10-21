import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";

export default async function Asientos({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mes?: string; q?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { rol } = await accesoEmpresa(id);
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : hoyISO().slice(0, 7);
  const q = (sp.q ?? "").trim();
  const asientos = await conEmpresa(id, (tx) => tx<
    { numero: number; fecha: string; concepto: string; referencia: string | null; anulado: boolean; total: string; origen: string }[]
  >`
    SELECT a.numero, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.concepto, a.referencia, a.anulado, a.origen,
           sum(l.debe)::text AS total
      FROM asientos a JOIN lineas_asiento l ON l.asiento_id = a.id
     WHERE to_char(a.fecha, 'YYYY-MM') = ${mes}
       AND (${q} = '' OR a.concepto ILIKE ${"%" + q + "%"} OR a.referencia ILIKE ${"%" + q + "%"} OR a.numero::text = ${q})
     GROUP BY a.id ORDER BY a.fecha, a.numero`);

  return (
    <>
      <div className="entre">
        <div>
          <h1>Asientos</h1>
          <p className="sub">Asientos de diario registrados. Los anulados se ven tachados y no cuentan en los libros.</p>
        </div>
        {puede(rol, "registrar") && <Link className="boton primario" href={`/e/${id}/asientos/nuevo`}>+ Nuevo asiento</Link>}
      </div>
      <form className="fila" style={{ marginBottom: 16 }}>
        <label>Mes<input type="month" name="mes" defaultValue={mes} /></label>
        <label>Buscar<input name="q" defaultValue={q} placeholder="Concepto, referencia o n.º" /></label>
        <button>Ver</button>
      </form>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>N.º</th><th>Fecha</th><th>Concepto</th><th>Referencia</th><th className="num">Total</th></tr></thead>
          <tbody>
            {asientos.map((a) => (
              <tr key={a.numero} className={a.anulado ? "anulado" : undefined}>
                <td><Link href={`/e/${id}/asientos/${a.numero}`}>{a.numero}</Link></td>
                <td>{verFecha(a.fecha)}</td>
                <td>{a.concepto}</td>
                <td>{a.referencia}</td>
                <td className="num">{verMonto(a.total)}</td>
              </tr>
            ))}
            {asientos.length === 0 && <tr><td colSpan={5}>No hay asientos en este mes.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
