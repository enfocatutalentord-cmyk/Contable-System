import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { ESTADOS_PROPUESTA } from "@/lib/propuestas";

// Propuestas de servicios (bloque 2c): se cotiza con la lista de precios y el descuento a la vista; aceptada, pasa a factura o iguala.
export default async function Propuestas({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { permisos } = await accesoEmpresa(id);
  const hoy = hoyISO();
  const filas = await conEmpresa(id, (tx) => tx<{
    id: string; numero: number; cliente: string; fecha: string; valida_hasta: string; estado: string; final: string; descuento: string;
    factura_id: string | null; acuerdo_id: string | null;
  }[]>`
    SELECT p.id, p.numero, c.nombre AS cliente, to_char(p.fecha, 'YYYY-MM-DD') AS fecha, to_char(p.valida_hasta, 'YYYY-MM-DD') AS valida_hasta, p.estado,
           COALESCE(sum(round(l.cantidad * (l.precio_lista - l.descuento), 2)), 0)::text AS final,
           COALESCE(sum(round(l.cantidad * l.descuento, 2)), 0)::text AS descuento, p.factura_id, p.acuerdo_id
      FROM propuestas p JOIN clientes c ON c.id = p.cliente_id LEFT JOIN lineas_propuesta l ON l.propuesta_id = p.id
     GROUP BY p.id, c.nombre ORDER BY p.numero DESC`);
  const estadoDe = (f: (typeof filas)[number]) =>
    (f.estado === "borrador" || f.estado === "enviada") && f.valida_hasta < hoy ? "Vencida" : ESTADOS_PROPUESTA[f.estado];
  return (
    <>
      <div className="entre">
        <div>
          <h1>Propuestas</h1>
          <p className="sub">
            Cotizaciones de servicios: el precio sale de la lista según la categoría del cliente y el descuento se ve aparte. Llevan
            requisitos, anticipo, forma de pago y fecha de entrega. Aceptada, se convierte en factura o en iguala.
          </p>
        </div>
        {puede(permisos, "registrar") && <Link className="boton primario" href={`/e/${id}/propuestas/nueva`}>+ Nueva propuesta</Link>}
      </div>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>N.º</th><th>Cliente</th><th>Fecha</th><th>Válida hasta</th><th>Estado</th><th className="num">Descuento</th><th className="num">Precio final (sin ITBIS)</th></tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id}>
                <td><Link href={`/e/${id}/propuestas/${f.id}`}>{f.numero}</Link></td>
                <td>{f.cliente}</td>
                <td>{verFecha(f.fecha)}</td>
                <td>{verFecha(f.valida_hasta)}</td>
                <td>{estadoDe(f)}{f.factura_id && " · facturada"}{f.acuerdo_id && " · iguala"}</td>
                <td className="num">{verMonto(f.descuento, true)}</td>
                <td className="num">{verMonto(f.final)}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={7}>Todavía no hay propuestas.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
