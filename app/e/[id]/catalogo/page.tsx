import { Descargar } from "@/app/descargar";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { puede } from "@/lib/permisos";
import { crearCuenta, editarCuenta } from "../acciones";

const TIPOS: Record<string, string> = {
  activo: "Activo", pasivo: "Pasivo", patrimonio: "Patrimonio", ingreso: "Ingreso", costo: "Costo", gasto: "Gasto",
};

export default async function Catalogo({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ editar?: string }>;
}) {
  const { id } = await params;
  const { editar } = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const cuentas = await conEmpresa(id, listarCuentas);
  const editable = puede(permisos, "catalogo");
  const enEdicion = editable ? cuentas.find((c) => c.id === editar) : undefined;

  return (
    <>
      <div className="entre">
        <h1>Catálogo de cuentas</h1>
        {puede(permisos, "exportar") && <Descargar href={`/e/${id}/exportar/catalogo`} />}
      </div>
      <p className="sub">
        Catálogo por niveles: clase, grupo, subgrupo y cuenta de detalle. Solo las cuentas de detalle reciben asientos;
        las de grupo suman a sus subcuentas.
      </p>

      {editable && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          {enEdicion ? (
            <>
              <h2 style={{ marginTop: 0 }}>Editar {enEdicion.codigo}</h2>
              <Formulario accion={editarCuenta.bind(null, id)} boton="Guardar" className="fila">
                <input type="hidden" name="cuenta" value={enEdicion.id} />
                <label style={{ flex: "1 1 280px" }}>Nombre<input name="nombre" defaultValue={enEdicion.nombre} required /></label>
                <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" name="activa" defaultChecked={enEdicion.activa} style={{ minHeight: 0 }} /> Activa
                </label>
              </Formulario>
              <p><a href={`/e/${id}/catalogo`}>Cancelar</a></p>
            </>
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>Nueva subcuenta</h2>
              <Formulario accion={crearCuenta.bind(null, id)} boton="Crear cuenta" className="fila">
                <label style={{ flex: "1 1 260px" }}>Cuenta madre
                  <select name="padre" required defaultValue="">
                    <option value="" disabled>Elige…</option>
                    {cuentas.filter((c) => c.nivel >= 2 && c.codigo.length <= 8).map((c) => (
                      <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
                    ))}
                  </select>
                </label>
                <label style={{ width: 110 }}>Código (+2)<input name="sufijo" inputMode="numeric" maxLength={2} placeholder="05" required /></label>
                <label style={{ flex: "1 1 220px" }}>Nombre<input name="nombre" required /></label>
              </Formulario>
            </>
          )}
        </div>
      )}

      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Código</th><th>Cuenta</th><th>Tipo</th><th>Uso</th>{editable && <th />}</tr></thead>
          <tbody>
            {cuentas.map((c) => (
              <tr key={c.id} className={c.de_detalle ? undefined : "grupo"} style={c.activa ? undefined : { opacity: 0.55 }}>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{c.codigo}</td>
                <td style={{ paddingLeft: 12 + (c.nivel - 1) * 18 }}>{c.nombre}{!c.activa && " (inactiva)"}</td>
                <td>{TIPOS[c.tipo]}</td>
                <td>{c.de_detalle ? "Detalle" : "Grupo"}</td>
                {editable && <td className="num"><a href={`/e/${id}/catalogo?editar=${c.id}`}>Editar</a></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
