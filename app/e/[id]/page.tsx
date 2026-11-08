import Link from "next/link";
import { accesoEmpresa, misFirmas } from "@/lib/acceso";
import { alertasDeEmpresa } from "@/lib/alertas";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { puedeVer } from "@/lib/pestanas";
import { InicioClienteApp } from "./inicio-cliente";
import { ResumenTrabajo } from "./resumen-trabajo";
import { antiguedad } from "@/lib/cxc";
import { antiguedadCxp } from "@/lib/cxp";
import { primerDiaMes, saldoNatural, saldosPorCuenta } from "@/lib/reportes";

export default async function InicioEmpresa({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sin_permiso?: string; sin_pestana?: string; solo_empire?: string; sin_contabilidad?: string }>;
}) {
  const { id } = await params;
  const { sin_permiso, sin_pestana, solo_empire, sin_contabilidad } = await searchParams;
  const { empresa, permisos, pestanas, usuario, paraClientes } = await accesoEmpresa(id);
  // Los usuarios de los clientes ven la pantalla de inicio de la aplicación (bloque 8a; todos los roles de clientes desde el rediseño R3).
  if (paraClientes) return <InicioClienteApp id={id} nombre={empresa.nombre} usuario={usuario.nombre} />;
  const ve = (r: string) => puedeVer(pestanas, r);
  const hoy = hoyISO();
  const inicioAnio = `${hoy.slice(0, 4)}-01-01`;

  // Contabilidad Empire (rediseño R2): sus avisos de cobro (igualas vencidas, acuerdos) salen aquí, no en las alertas de la Firma.
  const propia = (await misFirmas(usuario.id)).some((f) => f.empresa_propia_id === id);
  const avisosArriba = <>
    {solo_empire && <p className="aviso">Igualas, facturas recurrentes y propuestas son lo que Empire le cobra a sus clientes: están en Contabilidad Empire, no dentro de cada cliente.</p>}
    {sin_contabilidad && <p className="aviso">A este cliente no se le lleva contabilidad en el sistema (asientos, libros, catálogo, bancos, cierre, cobros ni pagos): sus facturas y compras sirven para los impuestos y los reportes, y el cobro o el pago se anota dentro de cada una. Si la lleva, márcalo en Ficha › Relación con Empire.</p>}
    {sin_pestana && <p className="aviso">Tus permisos no incluyen esa pantalla. Pídele a una administradora de la firma que te la agregue.</p>}
    {sin_permiso && <p className="aviso">Tu perfil no permite esa acción. Pídele a un administrador de la firma que te dé el permiso.</p>}
  </>;
  // Un cliente sin contabilidad ve el trabajo del mes, no cifras contables (rediseño R3, n.º 15).
  if (!propia && !ve("/asientos")) return <>{avisosArriba}<ResumenTrabajo id={id} nombre={empresa.nombre} hoy={hoy} ve={ve} /></>;
  const { cuentas, delMes, recientes, cxc, cxp, borradores, avisos } = await conEmpresa(id, async (tx) => {
    const cuentas = await saldosPorCuenta(tx, inicioAnio, hoy);
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM asientos WHERE estado = 'contabilizado' AND fecha BETWEEN ${primerDiaMes(hoy)} AND ${hoy}`;
    const [{ b }] = await tx<{ b: number }[]>`SELECT count(*)::int AS b FROM asientos WHERE estado = 'borrador'`;
    const recientes = await tx<{ id: string; numero: number | null; fecha: string; concepto: string; total: string | null; estado: string }[]>`
      SELECT a.id, a.numero, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.concepto, a.estado,
             (SELECT sum(debe)::text FROM lineas_asiento WHERE asiento_id = a.id) AS total
        FROM asientos a ORDER BY a.creado DESC LIMIT 6`;
    const cxc = await antiguedad(tx, hoy);
    const cxp = await antiguedadCxp(tx, hoy);
    const avisos = propia ? await alertasDeEmpresa(tx, { empresaId: id, hoy, propia: true }) : [];
    return { cuentas, delMes: n, recientes, cxc, cxp, borradores: b, avisos };
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
      {avisosArriba}
      <h1>{propia ? "Resumen de Empire" : "Inicio"}</h1>
      <p className="sub">
        {empresa.nombre} · cifras al {verFecha(hoy)}
        {empresa.fecha_bloqueo && <> · período cerrado hasta el {verFecha(empresa.fecha_bloqueo)}</>}
      </p>
      {avisos.length > 0 && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Avisos</h2>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {avisos.map((a, i) => <li key={i} className={a.nivel === "urgente" ? "error" : undefined}><Link href={a.enlace}>{a.texto}</Link></li>)}
          </ul>
        </div>
      )}
      <div className="cifras">
        <div className="tarjeta cifra"><div className="etiqueta">Activos</div><div className="valor">{verMonto(saldo("1"))}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Pasivos</div><div className="valor">{verMonto(saldo("2"))}</div></div>
        <div className="tarjeta cifra">
          <div className="etiqueta">Resultado de {hoy.slice(0, 4)}</div>
          <div className="valor" style={{ color: resultado < 0n ? "var(--peligro)" : undefined }}>{verMonto(resultado)}</div>
        </div>
        {cxc && (
          <>
            {ve("/cxc") && <Link href={`/e/${id}/cxc`} className="tarjeta cifra" style={{ color: "inherit", textDecoration: "none" }}>
              <div className="etiqueta">Por cobrar</div><div className="valor">{verMonto(cxc.total)}</div>
            </Link>}
            {ve("/cxc") && <Link href={`/e/${id}/cxc?detalle=1`} className="tarjeta cifra" style={{ color: "inherit", textDecoration: "none" }}>
              <div className="etiqueta">Por cobrar vencido</div>
              <div className="valor" style={{ color: cxc.total - cxc.totales[0] > 0n ? "var(--peligro)" : undefined }}>{verMonto(cxc.total - cxc.totales[0])}</div>
            </Link>}
            {ve("/cxp") && <Link href={`/e/${id}/cxp`} className="tarjeta cifra" style={{ color: "inherit", textDecoration: "none" }}>
              <div className="etiqueta">Por pagar</div><div className="valor">{verMonto(cxp.total)}</div>
            </Link>}
          </>
        )}
        {ve("/asientos") && (
          <>
            <div className="tarjeta cifra"><div className="etiqueta">Asientos contabilizados este mes</div><div className="valor">{delMes}</div></div>
            <Link href={`/e/${id}/asientos?estado=borrador`} className="tarjeta cifra" style={{ color: "inherit", textDecoration: "none" }}>
              <div className="etiqueta">Borradores por contabilizar</div>
              <div className="valor" style={{ color: borradores ? "var(--aviso-texto)" : undefined }}>{borradores}</div>
            </Link>
          </>
        )}
      </div>

      <div className="entre">
        {ve("/asientos") && <h2 style={{ marginTop: 0 }}>Últimos movimientos</h2>}
        {puede(permisos, "registrar") && (
          <div className="fila">
            {ve("/asientos") && <Link className="boton primario" href={`/e/${id}/asientos/nuevo`}>+ Nuevo asiento</Link>}
            {ve("/facturas") && <Link className="boton" href={`/e/${id}/facturas/nueva`}>+ Nueva factura</Link>}
            {ve("/compras") && <Link className="boton" href={`/e/${id}/compras/nueva`}>+ Nueva compra</Link>}
          </div>
        )}
      </div>
      {ve("/asientos") && <div className="tabla-envoltura" style={{ marginTop: 8 }}>
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
      </div>}
    </>
  );
}
