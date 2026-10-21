import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { anularAsiento } from "../../acciones";

export default async function VerAsiento({ params, searchParams }: {
  params: Promise<{ id: string; numero: string }>;
  searchParams: Promise<{ nuevo?: string; anulado?: string }>;
}) {
  const { id, numero: n } = await params;
  const { nuevo, anulado } = await searchParams;
  const numero = Number(n);
  if (!Number.isInteger(numero) || numero < 1) notFound();
  const { rol, empresa } = await accesoEmpresa(id);

  const datos = await conEmpresa(id, async (tx) => {
    const [a] = await tx<{
      id: string; fecha: string; concepto: string; referencia: string | null; origen: string; anulado: boolean;
      motivo_anulacion: string | null; anulado_en: Date | null; creado: Date; creado_por: string; anulado_por: string | null;
      documento: string | null;
    }[]>`
      SELECT a.id, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.concepto, a.referencia, a.origen, a.anulado,
             a.motivo_anulacion, a.anulado_en, a.creado, uc.nombre AS creado_por, ua.nombre AS anulado_por,
             COALESCE((SELECT '/facturas/' || f.id FROM facturas f WHERE f.asiento_id = a.id),
                      (SELECT '/cobros/' || c.numero FROM cobros c WHERE c.asiento_id = a.id)) AS documento
        FROM asientos a
        LEFT JOIN usuarios uc ON uc.id = a.creado_por
        LEFT JOIN usuarios ua ON ua.id = a.anulado_por
       WHERE a.numero = ${numero}`;
    if (!a) return null;
    const lineas = await tx<{ codigo: string; nombre: string; descripcion: string | null; debe: string; haber: string }[]>`
      SELECT c.codigo, c.nombre, l.descripcion, l.debe::text, l.haber::text
        FROM lineas_asiento l JOIN cuentas c ON c.id = l.cuenta_id
       WHERE l.asiento_id = ${a.id} ORDER BY l.orden`;
    return { a, lineas };
  });
  if (!datos) notFound();
  const { a, lineas } = datos;
  const total = lineas.reduce((s, l) => s + Number(l.debe), 0);
  const enPeriodoCerrado = !!empresa.fecha_bloqueo && a.fecha <= empresa.fecha_bloqueo;

  return (
    <>
      <p><Link href={`/e/${id}/asientos?mes=${a.fecha.slice(0, 7)}`}>← Asientos</Link></p>
      {nuevo && <p className="exito">Asiento registrado.</p>}
      {anulado && <p className="exito">Asiento anulado.</p>}
      <h1>Asiento n.º {numero}{a.anulado && " (anulado)"}</h1>
      <p className="sub">
        {verFecha(a.fecha)} · {a.concepto}
        {a.referencia && <> · Ref. {a.referencia}</>}
        <br />Registrado por {a.creado_por ?? "—"} el {a.creado.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" })}
      </p>
      {a.anulado && (
        <p className="aviso">
          Anulado por {a.anulado_por ?? "—"} el {a.anulado_en?.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" })}. Motivo: {a.motivo_anulacion}
        </p>
      )}
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cuenta</th><th>Descripción</th><th className="num">Debe</th><th className="num">Haber</th></tr></thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td>{l.codigo} · {l.nombre}</td>
                <td>{l.descripcion}</td>
                <td className="num">{verMonto(l.debe, true)}</td>
                <td className="num">{verMonto(l.haber, true)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={2}>Totales</td><td className="num">{verMonto(total)}</td><td className="num">{verMonto(total)}</td></tr></tfoot>
        </table>
      </div>
      {a.documento && (
        <p className="sub" style={{ marginTop: 16 }}>
          Este asiento lo generó un documento. <Link href={`/e/${id}${a.documento}`}>Ver el documento</Link>; si hay que anularlo, se anula desde ahí.
        </p>
      )}
      {!a.anulado && !a.documento && puede(rol, "anular") && (
        enPeriodoCerrado ? (
          <p className="sub" style={{ marginTop: 16 }}>Este asiento está en un período cerrado y no se puede anular.</p>
        ) : (
          <>
            <h2>Anular asiento</h2>
            <p className="sub">El asiento no se borra: queda tachado, con el motivo, y deja de contar en los libros.</p>
            <Formulario accion={anularAsiento.bind(null, id, numero)} boton="Anular asiento" className="fila">
              <label style={{ flex: "1 1 320px" }}>Motivo<input name="motivo" required /></label>
            </Formulario>
          </>
        )
      )}
    </>
  );
}
