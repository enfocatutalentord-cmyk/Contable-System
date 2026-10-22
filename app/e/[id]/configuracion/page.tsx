import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { puede } from "@/lib/permisos";
import { guardarCuentasEmpresa } from "../ventas-acciones";

const CLAVES: [clave: string, nombre: string, ayuda: string][] = [
  ["cxc", "Cuentas por cobrar clientes", "Se carga con cada factura y se abona con cada cobro."],
  ["ingreso_servicios", "Ingresos por servicios", "Para las líneas de factura sin cuenta propia."],
  ["devoluciones_ventas", "Devoluciones y descuentos en ventas", "Para las notas de crédito."],
  ["ganancia_cambiaria", "Ganancia cambiaria", "Cuando cobras en dólares a una tasa mayor que la de la factura."],
  ["perdida_cambiaria", "Pérdida cambiaria", "Cuando cobras en dólares a una tasa menor que la de la factura."],
];

export default async function Configuracion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { permisos } = await accesoEmpresa(id);
  const { cuentas, actuales } = await conEmpresa(id, async (tx) => ({
    cuentas: (await listarCuentas(tx)).filter((c) => c.de_detalle && c.activa),
    actuales: Object.fromEntries((await tx<{ clave: string; cuenta_id: string }[]>`SELECT clave, cuenta_id FROM cuentas_empresa`).map((r) => [r.clave, r.cuenta_id])),
  }));
  const editable = puede(permisos, "catalogo");

  return (
    <>
      <h1>Configuración de ventas</h1>
      <p className="sub">
        Las cuentas que usan los asientos automáticos de facturas, notas de crédito y cobros. Las de impuestos y retenciones
        se eligen en <Link href={`/e/${id}/fiscal/impuestos`}>Impuestos</Link> y <Link href={`/e/${id}/fiscal/retenciones`}>Retenciones</Link>.
      </p>
      <div className="tarjeta">
        <Formulario accion={guardarCuentasEmpresa.bind(null, id)} boton={editable ? "Guardar configuración" : ""}>
          {CLAVES.map(([clave, nombre, ayuda]) => (
            <label key={clave}>
              <span><strong style={{ color: "var(--texto)" }}>{nombre}</strong> · {ayuda}</span>
              <select name={clave} defaultValue={actuales[clave] ?? ""} disabled={!editable} required>
                <option value="" disabled>Elige…</option>
                {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
              </select>
            </label>
          ))}
        </Formulario>
      </div>
    </>
  );
}
