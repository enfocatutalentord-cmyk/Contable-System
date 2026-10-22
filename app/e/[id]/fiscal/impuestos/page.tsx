import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { listarImpuestos, TIPOS_IMPUESTO, verPorcentaje, vigenciaTexto } from "@/lib/fiscal";
import { hoyISO, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { guardarImpuesto } from "../../fiscal-acciones";
import { CamposImpuesto } from "../campos";

export default async function Impuestos({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const { impuestos, cuentas } = await conEmpresa(id, async (tx) => ({ impuestos: await listarImpuestos(tx), cuentas: await listarCuentas(tx) }));
  const nombreCuenta = new Map(cuentas.map((c) => [c.id, `${c.codigo} · ${c.nombre}`]));
  const editable = puede(permisos, "impuestos");
  const hoy = hoyISO();

  return (
    <>
      <h1>Impuestos</h1>
      <p className="sub">
        Las tasas que este cliente usa en ventas y compras, cada una con sus cuentas contables. Las facturas guardan la tasa que
        aplicaron, así que cambiar o cerrar una tasa no altera lo ya registrado.
      </p>
      {sp.guardado && <p className="exito">Impuesto actualizado.</p>}
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Nombre</th><th>Tipo</th><th className="num">Tasa</th><th>Cuenta en ventas</th><th>Cuenta en compras</th><th>Vigencia</th><th>Estado</th>{editable && <th />}</tr></thead>
          <tbody>
            {impuestos.map((i) => {
              const vigente = i.activo && i.vigente_desde <= hoy && (!i.vigente_hasta || i.vigente_hasta >= hoy);
              return (
                <tr key={i.id} className={vigente ? undefined : "inactivo"}>
                  <td>{i.nombre}{i.nota && <div className="sub" style={{ margin: 0 }}>{i.nota}</div>}</td>
                  <td>{TIPOS_IMPUESTO[i.tipo]}</td>
                  <td className="num">{verPorcentaje(i.tasa)}</td>
                  <td>{i.cuenta_ventas_id ? nombreCuenta.get(i.cuenta_ventas_id) : "—"}</td>
                  <td>{i.cuenta_compras_id ? nombreCuenta.get(i.cuenta_compras_id) : "—"}</td>
                  <td>{vigenciaTexto(i.vigente_desde, i.vigente_hasta, verFecha)}</td>
                  <td>{!i.activo ? "Inactivo" : vigente ? "Vigente" : i.vigente_desde > hoy ? "Futuro" : "Vencido"}</td>
                  {editable && <td className="num"><Link href={`/e/${id}/fiscal/impuestos/${i.id}`}>Editar</Link></td>}
                </tr>
              );
            })}
            {impuestos.length === 0 && <tr><td colSpan={8}>No hay impuestos configurados.</td></tr>}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="tarjeta" style={{ marginTop: 20 }}>
          <h2 style={{ marginTop: 0 }}>Agregar impuesto</h2>
          <Formulario accion={guardarImpuesto.bind(null, id, null)} boton="Agregar impuesto" className="">
            <CamposImpuesto cuentas={cuentas.filter((c) => c.de_detalle && c.activa)} />
          </Formulario>
        </div>
      )}
    </>
  );
}
