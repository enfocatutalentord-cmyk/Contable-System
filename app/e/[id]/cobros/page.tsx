import { exigirModulo } from "@/lib/modulos";
import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";

type Fila = { numero: number; fecha: string; cliente: string; moneda: string; recibido: string; retenciones: string; forma_pago: string; anulado: boolean; facturas: string };

export default async function Cobros({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mes?: string; q?: string }>;
}) {
  exigirModulo("ventas");
  const { id } = await params;
  const sp = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : hoyISO().slice(0, 7);
  const q = (sp.q ?? "").trim();
  const filas = await conEmpresa(id, (tx) => tx<Fila[]>`
    SELECT c.numero, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, cl.nombre AS cliente, c.moneda, c.recibido::text,
           (c.retencion_itbis + c.retencion_isr)::text AS retenciones, c.forma_pago, c.anulado,
           (SELECT string_agg(f.ncf, ', ' ORDER BY f.ncf) FROM aplicaciones_cobro a JOIN facturas f ON f.id = a.factura_id WHERE a.cobro_id = c.id) AS facturas
      FROM cobros c JOIN clientes cl ON cl.id = c.cliente_id
     WHERE to_char(c.fecha, 'YYYY-MM') = ${mes}
       AND (${q} = '' OR cl.nombre ILIKE ${"%" + q + "%"} OR c.referencia ILIKE ${"%" + q + "%"} OR c.numero::text = ${q})
     ORDER BY c.fecha DESC, c.numero DESC`);
  const vigentes = filas.filter((f) => !f.anulado && f.moneda === "DOP");

  return (
    <>
      <div className="entre">
        <div>
          <h1>Cobros</h1>
          <p className="sub">Recibos de ingreso. Un cobro puede saldar varias facturas del mismo cliente.</p>
        </div>
        {puede(permisos, "registrar") && <Link className="boton primario" href={`/e/${id}/cobros/nuevo`}>+ Registrar cobro</Link>}
      </div>
      <form className="fila" style={{ marginBottom: 12 }}>
        <label>Mes<input type="month" name="mes" defaultValue={mes} /></label>
        <label style={{ flex: "1 1 220px" }}>Buscar<input name="q" defaultValue={q} placeholder="Cliente, referencia o n.º" /></label>
        <button>Ver</button>
      </form>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Recibo</th><th>Fecha</th><th>Cliente</th><th>Facturas</th><th>Forma</th><th className="num">Recibido</th><th className="num">Retenciones</th></tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.numero} className={f.anulado ? "anulado" : undefined}>
                <td><Link href={`/e/${id}/cobros/${f.numero}`}>{f.numero}</Link></td>
                <td>{verFecha(f.fecha)}</td>
                <td>{f.cliente}</td>
                <td>{f.facturas}</td>
                <td style={{ textTransform: "capitalize" }}>{f.forma_pago}</td>
                <td className="num">{f.moneda === "USD" && "US$ "}{verMonto(f.recibido)}</td>
                <td className="num">{verMonto(f.retenciones, true)}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={7}>No hay cobros en este mes.</td></tr>}
          </tbody>
          {vigentes.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={5}>Total en pesos ({vigentes.length})</td>
                <td className="num">{verMonto(vigentes.reduce((s, f) => s + Number(f.recibido), 0))}</td>
                <td className="num">{verMonto(vigentes.reduce((s, f) => s + Number(f.retenciones), 0))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
