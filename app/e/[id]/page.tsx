import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { antiguedad } from "@/lib/cxc";
import { primerDiaMes, saldoNatural, saldosPorCuenta } from "@/lib/reportes";

export default async function InicioEmpresa({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sin_permiso?: string }>;
}) {
  const { id } = await params;
  const { sin_permiso } = await searchParams;
  const { empresa, rol } = await accesoEmpresa(id);
  const hoy = hoyISO();
  const inicioAnio = `${hoy.slice(0, 4)}-01-01`;

  const { cuentas, delMes, recientes, cxc } = await conEmpresa(id, async (tx) => {
    const cuentas = await saldosPorCuenta(tx, inicioAnio, hoy);
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM asientos WHERE NOT anulado AND fecha BETWEEN ${primerDiaMes(hoy)} AND ${hoy}`;
    const recientes = await tx<{ numero: number; fecha: string; concepto: string; total: string; anulado: boolean }[]>`
      SELECT a.numero, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.concepto, a.anulado, sum(l.debe)::text AS total
        FROM asientos a JOIN lineas_asiento l ON l.asiento_id = a.id
       GROUP BY a.id ORDER BY a.fecha DESC, a.numero DESC LIMIT 5`;
    const cxc = await antiguedad(tx, hoy);
    return { cuentas, delMes: n, recientes, cxc };
  });

  const clase = (c: string) => cuentas.find((x) => x.codigo === c);
  const saldo = (c: string) => {
    const x = clase(c);
    return x ? saldoNatural(x.tipo, x.final) : 0n;
  };
  // Resultado del año: ingresos - costos - gastos, solo con movimientos del período.
  const mov = (c: string) => {
    const x = clase(c);
    return x ? x.haber - x.debe : 0n;
  };
  const resultado = mov("4") + mov("5") + mov("6");

  return (
    <>
      {sin_permiso && <p className="aviso">Tu rol no permite esa acción. Pídele al dueño de la empresa que te dé el permiso.</p>}
      <h1>Inicio</h1>
      <p className="sub">
        {empresa.nombre} · cifras al {verFecha(hoy)}
        {empresa.fecha_bloqueo && <> · período cerrado hasta el {verFecha(empresa.fecha_bloqueo)}</>}
      </p>
      <div className="cifras">
        <div className="tarjeta cifra"><div className="etiqueta">Activos</div><div className="valor">{verMonto(saldo("1"))}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Pasivos</div><div className="valor">{verMonto(saldo("2"))}</div></div>
        <div className="tarjeta cifra">
          <div className="etiqueta">Resultado de {hoy.slice(0, 4)}</div>
          <div className="valor" style={{ color: resultado < 0n ? "var(--peligro)" : undefined }}>{verMonto(resultado)}</div>
        </div>
        <Link href={`/e/${id}/cxc`} className="tarjeta cifra" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="etiqueta">Por cobrar</div><div className="valor">{verMonto(cxc.total)}</div>
        </Link>
        <Link href={`/e/${id}/cxc?detalle=1`} className="tarjeta cifra" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="etiqueta">Vencido</div>
          <div className="valor" style={{ color: cxc.total - cxc.totales[0] > 0n ? "var(--peligro)" : undefined }}>{verMonto(cxc.total - cxc.totales[0])}</div>
        </Link>
        <div className="tarjeta cifra"><div className="etiqueta">Asientos este mes</div><div className="valor">{delMes}</div></div>
      </div>

      <div className="entre">
        <h2 style={{ marginTop: 0 }}>Últimos asientos</h2>
        {puede(rol, "registrar") && (
          <div className="fila">
            <Link className="boton" href={`/e/${id}/asientos/nuevo`}>+ Nuevo asiento</Link>
            <Link className="boton primario" href={`/e/${id}/facturas/nueva`}>+ Nueva factura</Link>
          </div>
        )}
      </div>
      <div className="tabla-envoltura" style={{ marginTop: 8 }}>
        <table>
          <thead><tr><th>N.º</th><th>Fecha</th><th>Concepto</th><th className="num">Total</th></tr></thead>
          <tbody>
            {recientes.map((a) => (
              <tr key={a.numero} className={a.anulado ? "anulado" : undefined}>
                <td><Link href={`/e/${id}/asientos/${a.numero}`}>{a.numero}</Link></td>
                <td>{verFecha(a.fecha)}</td>
                <td>{a.concepto}</td>
                <td className="num">{verMonto(a.total)}</td>
              </tr>
            ))}
            {recientes.length === 0 && <tr><td colSpan={4}>Todavía no hay asientos. Empieza con el asiento de apertura.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
