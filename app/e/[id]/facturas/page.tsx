import { exigirModulo } from "@/lib/modulos";
import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";

type Fila = { id: string; ncf: string; tipo_ncf: string; fecha: string; vence: string; cliente: string; moneda: string; total: string; saldo: string | null; anulada: boolean; origen: string | null };

const ESTADOS: Record<string, string> = { todas: "Todas", pendientes: "Pendientes", vencidas: "Vencidas", pagadas: "Pagadas", anuladas: "Anuladas", notas: "Notas de crédito" };

export default async function Facturas({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mes?: string; estado?: string; q?: string }>;
}) {
  exigirModulo("ventas");
  const { id } = await params;
  const sp = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const hoy = hoyISO();
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : sp.mes === "" ? "" : hoy.slice(0, 7);
  const estado = ESTADOS[sp.estado ?? ""] ? sp.estado! : "todas";
  const q = (sp.q ?? "").trim();
  const filas = await conEmpresa(id, (tx) => tx<Fila[]>`
    SELECT f.id, f.ncf, f.tipo_ncf, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, to_char(f.vence, 'YYYY-MM-DD') AS vence,
           c.nombre AS cliente, f.moneda, f.total::text, s.saldo::text, f.anulada, o.ncf AS origen
      FROM facturas f JOIN clientes c ON c.id = f.cliente_id
      LEFT JOIN saldos_factura s ON s.factura_id = f.id
      LEFT JOIN facturas o ON o.id = f.factura_origen_id
     WHERE (${mes} = '' OR to_char(f.fecha, 'YYYY-MM') = ${mes})
       AND (${q} = '' OR f.ncf ILIKE ${"%" + q + "%"} OR c.nombre ILIKE ${"%" + q + "%"})
       AND CASE ${estado}
             WHEN 'pendientes' THEN NOT f.anulada AND f.tipo_ncf <> 'B04' AND s.saldo > 0
             WHEN 'vencidas' THEN NOT f.anulada AND f.tipo_ncf <> 'B04' AND s.saldo > 0 AND f.vence < ${hoy}
             WHEN 'pagadas' THEN NOT f.anulada AND f.tipo_ncf <> 'B04' AND s.saldo <= 0
             WHEN 'anuladas' THEN f.anulada
             WHEN 'notas' THEN f.tipo_ncf = 'B04'
             ELSE true END
     ORDER BY f.fecha DESC, f.ncf DESC`);
  const vigentes = filas.filter((f) => !f.anulada && f.tipo_ncf !== "B04" && f.moneda === "DOP");

  return (
    <>
      <div className="entre">
        <div>
          <h1>Facturas</h1>
          <p className="sub">Facturas y notas de crédito con su NCF. Cada una genera su asiento automáticamente.</p>
        </div>
        {puede(permisos, "registrar") && <Link className="boton primario" href={`/e/${id}/facturas/nueva`}>+ Nueva factura</Link>}
      </div>
      <form className="fila" style={{ marginBottom: 12 }}>
        <label>Mes<input type="month" name="mes" defaultValue={mes} /></label>
        <label>Estado
          <select name="estado" defaultValue={estado}>
            {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label style={{ flex: "1 1 220px" }}>Buscar<input name="q" defaultValue={q} placeholder="NCF o cliente" /></label>
        <button>Ver</button>
        <Link className="boton" href={`/e/${id}/facturas?mes=&estado=pendientes`}>Todas las pendientes</Link>
      </form>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>NCF</th><th>Fecha</th><th>Cliente</th><th>Vence</th><th className="num">Total</th><th className="num">Saldo</th><th>Estado</th></tr></thead>
          <tbody>
            {filas.map((f) => {
              const esNota = f.tipo_ncf === "B04";
              const saldo = Number(f.saldo ?? 0);
              const estadoTexto = f.anulada ? "Anulada" : esNota ? `Nota a ${f.origen}` : saldo <= 0 ? "Pagada" : f.vence < hoy ? "Vencida" : "Pendiente";
              return (
                <tr key={f.id} className={f.anulada ? "anulado" : undefined}>
                  <td><Link href={`/e/${id}/facturas/${f.id}`}>{f.ncf}</Link></td>
                  <td>{verFecha(f.fecha)}</td>
                  <td>{f.cliente}</td>
                  <td>{esNota ? "" : verFecha(f.vence)}</td>
                  <td className="num">{f.moneda === "USD" && "US$ "}{verMonto(esNota ? -Number(f.total) : f.total)}</td>
                  <td className="num">{esNota || f.anulada ? "" : verMonto(f.saldo)}</td>
                  <td className={estadoTexto === "Vencida" ? "error" : undefined}>{estadoTexto}</td>
                </tr>
              );
            })}
            {filas.length === 0 && <tr><td colSpan={7}>No hay comprobantes con esos filtros.</td></tr>}
          </tbody>
          {vigentes.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4}>Facturas vigentes en pesos ({vigentes.length})</td>
                <td className="num">{verMonto(vigentes.reduce((s, f) => s + Number(f.total), 0))}</td>
                <td className="num">{verMonto(vigentes.reduce((s, f) => s + Number(f.saldo ?? 0), 0))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
