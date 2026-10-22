import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { FORMAS_PAGO } from "@/lib/compras";
import { puede } from "@/lib/permisos";

type Fila = { numero: number; fecha: string; proveedor: string; moneda: string; pagado: string; retenciones: string; forma_pago: string; anulado: boolean; compras: string };

export default async function Pagos({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mes?: string; q?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : hoyISO().slice(0, 7);
  const q = (sp.q ?? "").trim();
  const filas = await conEmpresa(id, (tx) => tx<Fila[]>`
    SELECT c.numero, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, pr.nombre AS proveedor, c.moneda, c.pagado::text,
           (c.retencion_itbis + c.retencion_isr)::text AS retenciones, c.forma_pago, c.anulado,
           (SELECT string_agg(co.ncf, ', ' ORDER BY co.ncf) FROM aplicaciones_pago a JOIN compras co ON co.id = a.compra_id WHERE a.pago_id = c.id) AS compras
      FROM pagos c JOIN proveedores pr ON pr.id = c.proveedor_id
     WHERE to_char(c.fecha, 'YYYY-MM') = ${mes}
       AND (${q} = '' OR pr.nombre ILIKE ${"%" + q + "%"} OR c.referencia ILIKE ${"%" + q + "%"} OR c.numero::text = ${q})
     ORDER BY c.fecha DESC, c.numero DESC`);
  const vigentes = filas.filter((f) => !f.anulado && f.moneda === "DOP");

  return (
    <>
      <div className="entre">
        <div>
          <h1>Pagos a proveedores</h1>
          <p className="sub">Un pago puede saldar varias compras del mismo proveedor, con las retenciones que le hagas.</p>
        </div>
        {puede(permisos, "contabilizar") && <Link className="boton primario" href={`/e/${id}/pagos/nuevo`}>+ Registrar pago</Link>}
      </div>
      <form className="fila" style={{ marginBottom: 12 }}>
        <label>Mes<input type="month" name="mes" defaultValue={mes} /></label>
        <label style={{ flex: "1 1 220px" }}>Buscar<input name="q" defaultValue={q} placeholder="Proveedor, referencia o n.º" /></label>
        <button>Ver</button>
      </form>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Pago</th><th>Fecha</th><th>Proveedor</th><th>Compras</th><th>Forma</th><th className="num">Pagado</th><th className="num">Retenido</th></tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.numero} className={f.anulado ? "anulado" : undefined}>
                <td><Link href={`/e/${id}/pagos/${f.numero}`}>{f.numero}</Link></td>
                <td>{verFecha(f.fecha)}</td>
                <td>{f.proveedor}</td>
                <td>{f.compras}</td>
                <td>{FORMAS_PAGO[f.forma_pago]}</td>
                <td className="num">{f.moneda === "USD" && "US$ "}{verMonto(f.pagado)}</td>
                <td className="num">{verMonto(f.retenciones, true)}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={7}>No hay pagos en este mes.</td></tr>}
          </tbody>
          {vigentes.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={5}>Total en pesos ({vigentes.length})</td>
                <td className="num">{verMonto(vigentes.reduce((s, f) => s + Number(f.pagado), 0))}</td>
                <td className="num">{verMonto(vigentes.reduce((s, f) => s + Number(f.retenciones), 0))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
