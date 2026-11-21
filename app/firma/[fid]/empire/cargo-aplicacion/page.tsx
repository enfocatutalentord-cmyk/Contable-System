import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoFirma } from "@/lib/acceso";
import { moverMes, nombreMes } from "@/lib/bitacora";
import { reporteDelMes } from "@/lib/cargo-aplicacion";
import { conEmpresa, db } from "@/lib/db";
import { deCentavos, hoyISO, verMonto } from "@/lib/montos";
import { guardarPorcentajeCargo } from "../../../cargo-acciones";

export const metadata = { title: "Cargo por la aplicación · Empire Tax & Legal" };

// Cargo por la aplicación (Prioridad 3, P3b): el porcentaje que se suma al precio de los clientes que usan la aplicación, y cuánto de lo cobrado
// es ese cargo, para pasarlo a la cuenta exclusiva. Solo administradoras.
export default async function CargoAplicacion({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ mes?: string }> }) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma } = await accesoFirma(fid);
  const hoy = hoyISO();
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes ?? "") ? sp.mes! : hoy.slice(0, 7);
  const [{ cargo_aplicacion }] = await db()<{ cargo_aplicacion: string }[]>`SELECT cargo_aplicacion::text FROM firmas WHERE id = ${fid}`;
  const propia = firma.empresa_propia_id;
  const datos = propia ? await conEmpresa(propia, async (tx) => ({
    reporte: await reporteDelMes(tx, mes),
    usan: await tx<{ nombre: string; empresa_vinculada_id: string | null }[]>`SELECT nombre, empresa_vinculada_id FROM clientes WHERE usa_aplicacion AND activo ORDER BY nombre`,
  })) : null;
  const m = (c: bigint) => verMonto(deCentavos(c));
  const enlace = (nuevo: string) => `/firma/${fid}/empire/cargo-aplicacion?mes=${nuevo}`;

  return (
    <>
      <h1>Cargo por la aplicación</h1>
      <p className="sub">
        A los clientes que usan la aplicación se les suma un porcentaje al precio de sus servicios y de su iguala. La factura no lo muestra separado: el precio
        ya lo incluye. Aquí ves cuánto de lo facturado y de lo cobrado es ese cargo. Solo lo ven las administradoras.
      </p>

      <section className="tarjeta" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Porcentaje</h2>
        <Formulario accion={guardarPorcentajeCargo.bind(null, fid)} boton="Guardar" className="fila">
          <label>Cargo en %<input name="porcentaje" inputMode="decimal" defaultValue={Number(cargo_aplicacion)} style={{ width: 110, textAlign: "right" }} /></label>
        </Formulario>
        <p className="sub" style={{ marginBottom: 0 }}>
          Es un solo porcentaje para toda la firma (10 % al empezar) y se aplica a las facturas nuevas. Lo ya facturado queda con el que tenía. Para que un cliente lo
          pague, marca «Usa la aplicación» en su ficha (Relación con Empire).
          {datos && datos.usan.length > 0 && <> Hoy lo pagan: {datos.usan.map((c, i) => <span key={i}>{i > 0 && ", "}{c.empresa_vinculada_id ? <Link href={`/e/${c.empresa_vinculada_id}/empresa?seccion=relacion`}>{c.nombre}</Link> : c.nombre}</span>)}.</>}
          {datos && datos.usan.length === 0 && <> Ningún cliente tiene marcada la casilla todavía.</>}
        </p>
      </section>

      {!datos ? (
        <p className="aviso">Primero marca la empresa que factura a los clientes de la firma en Contabilidad.</p>
      ) : (
        <>
          <nav className="fila" style={{ marginBottom: 12, alignItems: "center" }} aria-label="Mes">
            <Link className="boton" href={enlace(moverMes(mes, -1))}>← {nombreMes(moverMes(mes, -1))}</Link>
            <strong style={{ textTransform: "capitalize" }}>{nombreMes(mes)}</strong>
            <Link className="boton" href={enlace(moverMes(mes, 1))}>{nombreMes(moverMes(mes, 1))} →</Link>
            {mes !== hoy.slice(0, 7) && <Link className="boton" href={enlace(hoy.slice(0, 7))}>Este mes</Link>}
          </nav>
          <div className="cifras">
            <div className="tarjeta cifra"><div className="etiqueta">Facturado con cargo</div><div className="valor">RD${m(datos.reporte.facturado)}</div></div>
            <div className="tarjeta cifra"><div className="etiqueta">Cobrado: para la cuenta exclusiva</div><div className="valor">RD${m(datos.reporte.cobrado)}</div></div>
            <div className="tarjeta cifra"><div className="etiqueta">Por cobrar a fin de mes</div><div className="valor">RD${m(datos.reporte.porCobrar)}</div></div>
            <div className="tarjeta cifra"><div className="etiqueta">Cobrado en {mes.slice(0, 4)}</div><div className="valor">RD${m(datos.reporte.cobradoAnio)}</div></div>
          </div>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Cliente</th><th className="num">Facturado en el mes</th><th className="num">Cobrado en el mes</th><th className="num">Por cobrar a fin de mes</th></tr></thead>
              <tbody>
                {datos.reporte.filas.map((f) => (
                  <tr key={f.clienteId}><td>{f.cliente}</td><td className="num">{m(f.facturado)}</td><td className="num">{m(f.cobrado)}</td><td className="num">{m(f.porCobrar)}</td></tr>
                ))}
                {datos.reporte.filas.length === 0 && <tr><td colSpan={4}>No hay facturas con cargo ni cobros de cargo hasta este mes.</td></tr>}
              </tbody>
              {datos.reporte.filas.length > 0 && (
                <tfoot><tr><th>Total</th><th className="num">{m(datos.reporte.facturado)}</th><th className="num">{m(datos.reporte.cobrado)}</th><th className="num">{m(datos.reporte.porCobrar)}</th></tr></tfoot>
              )}
            </table>
          </div>
          <p className="sub">
            El cargo de una factura es la parte de su precio, sin impuestos, que corresponde a los servicios de la lista: precio × % ÷ (100 + %). Se acumula cuando el
            cliente paga: a cada cobro le toca la parte del cargo que tiene su factura. No cuentan las facturas en dólares, las notas de crédito, las facturas anuladas
            ni los cobros hechos con un anticipo ya recibido. El sistema no mueve dinero: pasa a la cuenta exclusiva lo cobrado de este reporte. Esa misma parte aparece
            como «Cargo por la aplicación» en los ingresos del presupuesto, sin cambiar su total.
          </p>
        </>
      )}
    </>
  );
}
