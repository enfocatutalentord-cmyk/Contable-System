import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { CODIGOS_606, listarRetenciones, verPorcentaje, vigenciaTexto } from "@/lib/fiscal";
import { hoyISO, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { guardarRetencion } from "../../fiscal-acciones";
import { CamposRetencion } from "../campos";

export default async function Retenciones({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const { retenciones, cuentas } = await conEmpresa(id, async (tx) => ({ retenciones: await listarRetenciones(tx), cuentas: await listarCuentas(tx) }));
  const nombreCuenta = new Map(cuentas.map((c) => [c.id, `${c.codigo} · ${c.nombre}`]));
  const editable = puede(permisos, "impuestos");
  const hoy = hoyISO();

  return (
    <>
      <h1>Retenciones</h1>
      <p className="sub">
        Las de ITBIS se calculan sobre el ITBIS facturado; las de ISR, sobre el monto sin impuestos. Cada una sirve en los dos sentidos:
        cuando un cliente nos retiene y cuando retenemos a un proveedor.
      </p>
      <p className="aviso">
        Las tasas cambian con las normas (por ejemplo, la Ley 30-26 subió desde julio de 2026 la retención por honorarios a personas
        físicas). Confirma con el contador de la firma las que aplican a este cliente antes de usarlas.
      </p>
      {sp.guardado && <p className="exito">Retención actualizada.</p>}
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Nombre</th><th>Impuesto</th><th className="num">Tasa</th><th>606</th><th>Cuando nos retienen</th><th>Cuando retenemos</th><th>Vigencia</th><th>Estado</th>{editable && <th />}</tr></thead>
          <tbody>
            {retenciones.map((r) => {
              const vigente = r.activo && r.vigente_desde <= hoy && (!r.vigente_hasta || r.vigente_hasta >= hoy);
              return (
                <tr key={r.id} className={vigente ? undefined : "inactivo"}>
                  <td>{r.nombre}{r.nota && <div className="sub" style={{ margin: 0 }}>{r.nota}</div>}</td>
                  <td>{r.impuesto.toUpperCase()}</td>
                  <td className="num">{verPorcentaje(r.tasa)}</td>
                  <td title={r.codigo_606 ? CODIGOS_606[r.codigo_606] : undefined}>{r.codigo_606 ?? "—"}</td>
                  <td>{nombreCuenta.get(r.cuenta_por_terceros_id)}</td>
                  <td>{nombreCuenta.get(r.cuenta_a_terceros_id)}</td>
                  <td>{vigenciaTexto(r.vigente_desde, r.vigente_hasta, verFecha)}</td>
                  <td>{!r.activo ? "Inactiva" : vigente ? "Vigente" : r.vigente_desde > hoy ? "Futura" : "Vencida"}</td>
                  {editable && <td className="num"><Link href={`/e/${id}/fiscal/retenciones/${r.id}`}>Editar</Link></td>}
                </tr>
              );
            })}
            {retenciones.length === 0 && <tr><td colSpan={9}>No hay retenciones configuradas.</td></tr>}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="tarjeta" style={{ marginTop: 20 }}>
          <h2 style={{ marginTop: 0 }}>Agregar retención</h2>
          <Formulario accion={guardarRetencion.bind(null, id, null)} boton="Agregar retención" className="">
            <CamposRetencion cuentas={cuentas.filter((c) => c.de_detalle && c.activa)} />
          </Formulario>
        </div>
      )}
    </>
  );
}
