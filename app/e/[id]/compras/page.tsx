import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";

type Fila = {
  id: string; estado: string; ncf: string | null; tipo_comprobante: string; fecha: string; vence: string; proveedor: string; moneda: string;
  total: string; saldo: string | null; anulada: boolean; origen: string | null;
};

const ESTADOS: Record<string, string> = {
  todas: "Todas", borradores: "Borradores", pendientes: "Por pagar", vencidas: "Vencidas", pagadas: "Pagadas", anuladas: "Anuladas",
  notas: "Notas de crédito",
};

export default async function Compras({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mes?: string; estado?: string; q?: string; descartada?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const hoy = hoyISO();
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : sp.mes === "" ? "" : hoy.slice(0, 7);
  const estado = ESTADOS[sp.estado ?? ""] ? sp.estado! : "todas";
  const q = (sp.q ?? "").trim();
  const filas = await conEmpresa(id, (tx) => tx<Fila[]>`
    SELECT c.id, c.estado, c.ncf, c.tipo_comprobante, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, to_char(c.vence, 'YYYY-MM-DD') AS vence,
           p.nombre AS proveedor, c.moneda, c.total::text, s.saldo::text, c.anulada, o.ncf AS origen
      FROM compras c JOIN proveedores p ON p.id = c.proveedor_id
      LEFT JOIN saldos_compra s ON s.compra_id = c.id
      LEFT JOIN compras o ON o.id = c.compra_origen_id
     WHERE (${mes} = '' OR to_char(c.fecha, 'YYYY-MM') = ${mes})
       AND (${q} = '' OR c.ncf ILIKE ${"%" + q + "%"} OR p.nombre ILIKE ${"%" + q + "%"} OR p.rnc = ${q.replace(/-/g, "")})
       AND (${estado} = 'todas' OR (${estado} = 'borradores') = (c.estado = 'borrador'))
       AND CASE ${estado}
             WHEN 'pendientes' THEN NOT c.anulada AND s.saldo > 0
             WHEN 'vencidas' THEN NOT c.anulada AND s.saldo > 0 AND c.vence < ${hoy}
             WHEN 'pagadas' THEN NOT c.anulada AND s.saldo <= 0
             WHEN 'anuladas' THEN c.anulada
             WHEN 'notas' THEN c.tipo_comprobante IN ('B04', 'E34')
             ELSE true END
     ORDER BY c.estado = 'borrador' DESC, c.fecha DESC, c.ncf DESC NULLS FIRST`);
  const vigentes = filas.filter((f) => f.estado === "registrada" && !f.anulada && f.origen === null && f.moneda === "DOP");

  return (
    <>
      <div className="entre">
        <div>
          <h1>Compras</h1>
          <p className="sub">Facturas de proveedores, gastos y sus notas de crédito. El borrador no tiene asiento; al registrarse se contabiliza.</p>
        </div>
        {puede(permisos, "registrar") && <Link className="boton primario" href={`/e/${id}/compras/nueva`}>+ Nueva compra</Link>}
      </div>
      {sp.descartada && <p className="exito">Borrador descartado. Queda constancia en el historial de cambios.</p>}
      <form className="fila" style={{ marginBottom: 12 }}>
        <label>Mes<input type="month" name="mes" defaultValue={mes} /></label>
        <label>Estado
          <select name="estado" defaultValue={estado}>
            {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label style={{ flex: "1 1 220px" }}>Buscar<input name="q" defaultValue={q} placeholder="NCF, proveedor o RNC" /></label>
        <button>Ver</button>
        <Link className="boton" href={`/e/${id}/compras?mes=&estado=pendientes`}>Todas las por pagar</Link>
      </form>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>NCF</th><th>Fecha</th><th>Proveedor</th><th>Vence</th><th className="num">Total</th><th className="num">Saldo</th><th>Estado</th></tr></thead>
          <tbody>
            {filas.map((f) => {
              const esNota = f.origen !== null;
              const borrador = f.estado === "borrador";
              const saldo = Number(f.saldo ?? 0);
              const texto = borrador ? "Borrador" : f.anulada ? "Anulada" : esNota ? `Nota a ${f.origen}` : saldo <= 0 ? "Pagada" : f.vence < hoy ? "Vencida" : "Por pagar";
              return (
                <tr key={f.id} className={f.anulada ? "anulado" : borrador ? "borrador" : undefined}>
                  <td><Link href={`/e/${id}/compras/${f.id}`}>{f.ncf ?? `Borrador ${f.tipo_comprobante}`}</Link></td>
                  <td>{verFecha(f.fecha)}</td>
                  <td>{f.proveedor}</td>
                  <td>{esNota ? "" : verFecha(f.vence)}</td>
                  <td className="num">{f.moneda === "USD" && "US$ "}{verMonto(esNota ? -Number(f.total) : f.total)}</td>
                  <td className="num">{esNota || f.anulada || borrador ? "" : verMonto(f.saldo)}</td>
                  <td className={texto === "Vencida" ? "error" : undefined}>{texto}</td>
                </tr>
              );
            })}
            {filas.length === 0 && <tr><td colSpan={7}>No hay compras con esos filtros.</td></tr>}
          </tbody>
          {vigentes.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4}>Compras registradas en pesos ({vigentes.length})</td>
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
