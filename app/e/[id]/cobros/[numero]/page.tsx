import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { BotonImprimir } from "@/app/imprimir";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { DocumentosSoporte } from "../../documentos/soporte";
import { HistorialRegistro } from "../../historial/registro";
import { anularRecibo } from "../../ventas-acciones";

type Cobro = {
  id: string; fecha: string; moneda: string; tasa: string; forma_pago: string; referencia: string | null; notas: string | null;
  recibido: string; retencion_itbis: string; retencion_isr: string; anulado: boolean; motivo_anulacion: string | null;
  cliente: string; rnc: string | null; cuenta: string; asiento: number | null; asiento_id: string | null; creado_por: string | null;
};

export default async function VerCobro({ params, searchParams }: {
  params: Promise<{ id: string; numero: string }>;
  searchParams: Promise<{ nuevo?: string; anulado?: string }>;
}) {
  const { id, numero: n } = await params;
  const sp = await searchParams;
  const numero = Number(n);
  if (!Number.isInteger(numero) || numero < 1) notFound();
  const { empresa, permisos } = await accesoEmpresa(id);
  const datos = await conEmpresa(id, async (tx) => {
    const [c] = await tx<Cobro[]>`
      SELECT c.id, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.moneda, c.tasa::text, c.forma_pago, c.referencia, c.notas,
             c.recibido::text, c.retencion_itbis::text, c.retencion_isr::text, c.anulado, c.motivo_anulacion,
             cl.nombre AS cliente, cl.rnc, cu.codigo || ' · ' || cu.nombre AS cuenta, a.numero AS asiento, a.id AS asiento_id, u.nombre AS creado_por
        FROM cobros c JOIN clientes cl ON cl.id = c.cliente_id JOIN cuentas cu ON cu.id = c.cuenta_destino_id
        LEFT JOIN asientos a ON a.id = c.asiento_id LEFT JOIN usuarios u ON u.id = c.creado_por
       WHERE c.numero = ${numero}`;
    if (!c) return null;
    const aplicaciones = await tx<{ id: string; ncf: string; fecha: string; total: string; monto: string }[]>`
      SELECT f.id, f.ncf, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, f.total::text, a.monto::text
        FROM aplicaciones_cobro a JOIN facturas f ON f.id = a.factura_id WHERE a.cobro_id = ${c.id} ORDER BY f.ncf`;
    const retenciones = await tx<{ nombre: string; tasa: string; monto: string }[]>`
      SELECT r.nombre, rc.tasa::text, rc.monto::text FROM retenciones_cobro rc JOIN retenciones r ON r.id = rc.retencion_id
       WHERE rc.cobro_id = ${c.id} ORDER BY rc.impuesto DESC, r.nombre`;
    return { c, aplicaciones, retenciones };
  });
  if (!datos) notFound();
  const { c, aplicaciones, retenciones } = datos;
  const simbolo = c.moneda === "USD" ? "US$" : "RD$";
  const total = Number(c.recibido) + retenciones.reduce((s, r) => s + Number(r.monto), 0);
  const fueraDeCierre = !empresa.fecha_bloqueo || c.fecha > empresa.fecha_bloqueo;

  return (
    <>
      <div className="no-imprimir">
        <p><Link href={`/e/${id}/cobros`}>← Cobros</Link></p>
        {sp.nuevo && <p className="exito">Cobro registrado{c.asiento && <> con el asiento n.º {c.asiento}</>}.</p>}
        {sp.anulado && <p className="exito">Recibo anulado. Las facturas vuelven a quedar pendientes.</p>}
        {c.anulado && <p className="aviso">Recibo anulado. Motivo: {c.motivo_anulacion}</p>}
        <div className="fila" style={{ marginBottom: 16 }}>
          <BotonImprimir />
          {c.asiento && <Link className="boton" href={`/e/${id}/asientos/${c.asiento_id}`}>Ver asiento n.º {c.asiento}</Link>}
        </div>
      </div>
      <div className="documento">
        <div className="cabecera">
          <div><h2>{empresa.nombre}</h2>{empresa.rnc && <div>RNC {empresa.rnc}</div>}</div>
          <div style={{ textAlign: "right" }}><h2>Recibo de ingreso n.º {numero}{c.anulado && " (ANULADO)"}</h2><div>{verFecha(c.fecha)}</div></div>
        </div>
        <div className="cabecera">
          <dl>
            <dt>Recibimos de</dt><dd>{c.cliente}</dd>
            {c.rnc && <><dt>RNC / cédula</dt><dd>{c.rnc}</dd></>}
          </dl>
          <dl>
            <dt>Forma de pago</dt><dd style={{ textTransform: "capitalize" }}>{c.forma_pago}{c.referencia && ` · ${c.referencia}`}</dd>
            <dt className="no-imprimir">Depositado en</dt><dd className="no-imprimir">{c.cuenta}</dd>
            {c.moneda === "USD" && <><dt>Tasa</dt><dd>{Number(c.tasa).toFixed(2)}</dd></>}
          </dl>
        </div>
        <div className="tabla-envoltura">
          <table>
            <thead><tr><th>Factura (NCF)</th><th>Fecha</th><th className="num">Total factura</th><th className="num">Pagado</th></tr></thead>
            <tbody>
              {aplicaciones.map((a) => (
                <tr key={a.id}>
                  <td><Link href={`/e/${id}/facturas/${a.id}`}>{a.ncf}</Link></td>
                  <td>{verFecha(a.fecha)}</td>
                  <td className="num">{verMonto(a.total)}</td>
                  <td className="num">{verMonto(a.monto)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={3}>Total aplicado {simbolo}</td><td className="num">{verMonto(total)}</td></tr>
              {retenciones.map((r, i) => (
                <tr key={i}><td colSpan={3}>Menos {r.nombre}</td><td className="num">{verMonto(r.monto)}</td></tr>
              ))}
              <tr><td colSpan={3}>Recibido {simbolo}</td><td className="num">{verMonto(c.recibido)}</td></tr>
            </tfoot>
          </table>
        </div>
        {c.notas && <p>{c.notas}</p>}
      </div>
      {!c.anulado && puede(permisos, "revertir") && (
        <div className="no-imprimir">
          <h2>Anular recibo</h2>
          {fueraDeCierre ? (
            <Formulario accion={anularRecibo.bind(null, id, numero)} boton="Anular recibo" className="fila">
              <label style={{ flex: "1 1 320px" }}>Motivo<input name="motivo" required /></label>
            </Formulario>
          ) : <p className="sub">Este recibo está en un período cerrado y no se puede anular.</p>}
        </div>
      )}
      <div className="no-imprimir">
        <DocumentosSoporte empresaId={id} entidad="cobro" entidadId={c.id} retirables={false} puedeAdjuntar={puede(permisos, "adjuntar") && !c.anulado} />
        <p className="sub" style={{ marginTop: 16 }}>Registrado por {c.creado_por ?? "—"}.</p>
        {puede(permisos, "auditoria") && (
          <>
            <h2>Historial de cambios</h2>
            <HistorialRegistro empresaId={id} registroId={c.id} />
          </>
        )}
      </div>
    </>
  );
}
