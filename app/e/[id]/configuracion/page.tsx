import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { puede } from "@/lib/permisos";
import { listarUnidades } from "@/lib/empresa-propia";
import { crearUnidad, guardarUnidad } from "../unidades-acciones";
import { guardarCuentasEmpresa } from "../ventas-acciones";

const CLAVES: [clave: string, nombre: string, ayuda: string][] = [
  ["cxc", "Cuentas por cobrar clientes", "Se carga con cada factura y se abona con cada cobro."],
  ["ingreso_servicios", "Ingresos por servicios", "Para las líneas de factura sin cuenta propia."],
  ["devoluciones_ventas", "Devoluciones y descuentos en ventas", "Para las notas de crédito."],
  ["ganancia_cambiaria", "Ganancia cambiaria", "Cuando cobras o pagas dólares a una tasa que te favorece."],
  ["perdida_cambiaria", "Pérdida cambiaria", "Cuando cobras o pagas dólares a una tasa que te desfavorece."],
  ["cxp", "Cuentas por pagar a proveedores locales", "Se carga con cada compra y se abona con cada pago."],
  ["cxp_exterior", "Cuentas por pagar a proveedores del exterior", "Para los proveedores marcados como del exterior."],
  ["gasto_general", "Gasto por defecto de las compras", "Para las líneas de compra sin cuenta del proveedor."],
];

export default async function Configuracion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { permisos } = await accesoEmpresa(id);
  const { cuentas, actuales, unidades } = await conEmpresa(id, async (tx) => ({
    unidades: await listarUnidades(tx, false),
    cuentas: (await listarCuentas(tx)).filter((c) => c.de_detalle && c.activa),
    actuales: Object.fromEntries((await tx<{ clave: string; cuenta_id: string }[]>`SELECT clave, cuenta_id FROM cuentas_empresa`).map((r) => [r.clave, r.cuenta_id])),
  }));
  const editable = puede(permisos, "catalogo");
  const ingresos = cuentas.filter((c) => c.tipo === "ingreso");

  return (
    <>
      <h1>Configuración de cuentas</h1>
      <p className="sub">
        Las cuentas que usan los asientos automáticos de ventas, cobros, compras y pagos. Las de impuestos y retenciones
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

      <h2 id="unidades">Unidades de negocio</h2>
      <p className="sub">
        Para separar los ingresos y gastos de cada negocio de la empresa. Si hay alguna, las líneas de facturas, compras y
        asientos piden su unidad y el estado de resultados se puede ver por unidad. La cuenta de ingreso es opcional: las líneas
        de factura de la unidad cuyo producto no tiene cuenta propia van a ella. Una unidad no se borra: se desactiva.
      </p>
      <div className="tabla-envoltura" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>Unidad</th><th>Cuenta de ingreso</th><th>Activa</th>{editable && <th />}</tr></thead>
          <tbody>
            {unidades.map((u) => (
              <tr key={u.id} style={u.activa ? undefined : { opacity: 0.6 }}>
                <td colSpan={editable ? 4 : 1}>
                  {editable ? (
                    <Formulario accion={guardarUnidad.bind(null, id, u.id)} boton="Guardar" className="fila">
                      <input name="nombre" defaultValue={u.nombre} aria-label="Nombre de la unidad" required maxLength={80} />
                      <select name="cuenta" defaultValue={u.cuenta_ingreso_id ?? ""} aria-label={`Cuenta de ingreso de ${u.nombre}`}>
                        <option value="">Sin cuenta propia</option>
                        {ingresos.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                      </select>
                      <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <input type="checkbox" name="activa" defaultChecked={u.activa} style={{ minHeight: 0 }} /> Activa
                      </label>
                    </Formulario>
                  ) : u.nombre}
                </td>
                {!editable && <><td>{ingresos.find((c) => c.id === u.cuenta_ingreso_id)?.nombre ?? "—"}</td><td>{u.activa ? "Sí" : "No"}</td></>}
              </tr>
            ))}
            {unidades.length === 0 && <tr><td colSpan={4}>Esta empresa no usa unidades de negocio.</td></tr>}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="tarjeta" style={{ maxWidth: 640 }}>
          <Formulario accion={crearUnidad.bind(null, id)} boton="Agregar unidad" className="fila">
            <label style={{ flex: "2 1 220px" }}>Nombre<input name="nombre" required maxLength={80} placeholder="Ej.: Tienda, Taller" /></label>
            <label style={{ flex: "2 1 220px" }}>Cuenta de ingreso
              <select name="cuenta" defaultValue="">
                <option value="">Sin cuenta propia</option>
                {ingresos.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
              </select>
            </label>
          </Formulario>
        </div>
      )}
    </>
  );
}
