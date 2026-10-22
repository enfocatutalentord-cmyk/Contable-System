import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { antiguedad } from "@/lib/cxc";
import { MODULOS } from "@/lib/modulos";
import { primerDiaMes, saldoNatural, saldosPorCuenta } from "@/lib/reportes";

export default async function InicioEmpresa({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sin_permiso?: string }>;
}) {
  const { id } = await params;
  const { sin_permiso } = await searchParams;
  const { empresa, permisos } = await accesoEmpresa(id);
  const hoy = hoyISO();
  const inicioAnio = `${hoy.slice(0, 4)}-01-01`;

  const { cuentas, delMes, recientes, cxc, borradores } = await conEmpresa(id, async (tx) => {
    const cuentas = await saldosPorCuenta(tx, inicioAnio, hoy);
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM asientos WHERE estado = 'contabilizado' AND fecha BETWEEN ${primerDiaMes(hoy)} AND ${hoy}`;
    const [{ b }] = await tx<{ b: number }[]>`SELECT count(*)::int AS b FROM asientos WHERE estado = 'borrador'`;
    const recientes = await tx<{ id: string; numero: number | null; fecha: string; concepto: string; total: string | null; estado: string }[]>`
      SELECT a.id, a.numero, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.concepto, a.estado,
             (SELECT sum(debe)::text FROM lineas_asiento WHERE asiento_id = a.id) AS total
        FROM asientos a ORDER BY a.creado DESC LIMIT 6`;
    const cxc = MODULOS.ventas ? await antiguedad(tx, hoy) : null;
    return { cuentas, delMes: n, recientes, cxc, borradores: b };
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
      {sin_permiso && <p className="aviso">Tu perfil no permite esa acción. Pídele a un administrador de la firma que te dé el permiso.</p>}
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
        {cxc && (
          <>
            <Link href={`/e/${id}/cxc`} className="tarjeta cifra" style={{ color: "inherit", textDecoration: "none" }}>
              <div className="etiqueta">Por cobrar</div><div className="valor">{verMonto(cxc.total)}</div>
            </Link>
            <Link href={`/e/${id}/cxc?detalle=1`} className="tarjeta cifra" style={{ color: "inherit", textDecoration: "none" }}>
              <div className="etiqueta">Vencido</div>
              <div className="valor" style={{ color: cxc.total - cxc.totales[0] > 0n ? "var(--peligro)" : undefined }}>{verMonto(cxc.total - cxc.totales[0])}</div>
            </Link>
          </>
        )}
        <div className="tarjeta cifra"><div className="etiqueta">Asientos contabilizados este mes</div><div className="valor">{delMes}</div></div>
        <Link href={`/e/${id}/asientos?estado=borrador`} className="tarjeta cifra" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="etiqueta">Borradores por contabilizar</div>
          <div className="valor" style={{ color: borradores ? "var(--aviso-texto)" : undefined }}>{borradores}</div>
        </Link>
      </div>

      <div className="entre">
        <h2 style={{ marginTop: 0 }}>Últimos movimientos</h2>
        {puede(permisos, "registrar") && (
          <div className="fila">
            <Link className="boton primario" href={`/e/${id}/asientos/nuevo`}>+ Nuevo asiento</Link>
            {MODULOS.ventas && <Link className="boton" href={`/e/${id}/facturas/nueva`}>+ Nueva factura</Link>}
          </div>
        )}
      </div>
      <div className="tabla-envoltura" style={{ marginTop: 8 }}>
        <table>
          <thead><tr><th>N.º</th><th>Fecha</th><th>Concepto</th><th>Estado</th><th className="num">Total</th></tr></thead>
          <tbody>
            {recientes.map((a) => (
              <tr key={a.id} className={a.estado === "anulado" ? "anulado" : a.estado === "borrador" ? "borrador" : undefined}>
                <td><Link href={`/e/${id}/asientos/${a.id}`}>{a.numero ?? "Borrador"}</Link></td>
                <td>{verFecha(a.fecha)}</td>
                <td>{a.concepto}</td>
                <td>{a.estado === "borrador" ? "Borrador" : a.estado === "anulado" ? "Anulado" : "Contabilizado"}</td>
                <td className="num">{verMonto(a.total ?? "0")}</td>
              </tr>
            ))}
            {recientes.length === 0 && <tr><td colSpan={5}>Todavía no hay asientos. Empieza con el asiento de apertura.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
