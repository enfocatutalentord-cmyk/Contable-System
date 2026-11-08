import Link from "next/link";
import { Descargar } from "@/app/descargar";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, misFirmas } from "@/lib/acceso";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { listarUnidades } from "@/lib/empresa-propia";
import { CATEGORIAS } from "@/lib/ficha";
import { listarImpuestos } from "@/lib/fiscal";
import { hoyISO, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { CATEGORIAS_PRECIO, GRUPOS_SERVICIO, preciosVigentes } from "@/lib/precios";
import { LISTA_P01 } from "@/lib/lista-p01";
import { cargarLista, guardarServicio } from "../ventas-acciones";

type Servicio = {
  id: string; nombre: string; precio: string; impuesto_id: string | null; impuesto_adicional_id: string | null;
  cuenta_ingreso_id: string | null; activo: boolean; cuenta: string | null; codigo: string | null; grupo: string | null;
  unidad_id: string | null; unidad: string | null;
};

// Productos y servicios con su lista de precios (bloque 2a, Lista de Precios EMP-P01): precio general y uno por categoría de
// cliente, con fecha de vigencia. La factura toma el de la categoría del cliente.
export default async function Servicios({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ editar?: string; grupo?: string }>;
}) {
  const { id } = await params;
  const { editar, grupo } = await searchParams;
  const { permisos, usuario } = await accesoEmpresa(id);
  const puedeCargar = puede(permisos, "empresa") && (await misFirmas(usuario.id)).some((f) => f.empresa_propia_id === id);
  const totalP01 = Object.values(LISTA_P01).flat().length;
  const hoy = hoyISO();
  const { servicios, ingresos, impuestos, precios, unidades } = await conEmpresa(id, async (tx) => ({
    impuestos: (await listarImpuestos(tx)).filter((i) => i.activo),
    servicios: await tx<Servicio[]>`
      SELECT s.id, s.nombre, s.precio::text, s.impuesto_id, s.impuesto_adicional_id, s.cuenta_ingreso_id, s.activo, s.codigo, s.grupo,
             s.unidad_id, u.nombre AS unidad, c.codigo || ' · ' || c.nombre AS cuenta
        FROM servicios s LEFT JOIN cuentas c ON c.id = s.cuenta_ingreso_id LEFT JOIN unidades_negocio u ON u.id = s.unidad_id
       ORDER BY s.activo DESC, s.grupo NULLS LAST, s.codigo NULLS LAST, s.nombre`,
    ingresos: (await listarCuentas(tx)).filter((c) => c.tipo === "ingreso" && c.de_detalle && c.activa),
    precios: await preciosVigentes(tx, hoy),
    unidades: await listarUnidades(tx),
  }));
  const editable = puede(permisos, "registrar");
  const nombreImpuesto = new Map(impuestos.map((i) => [i.id, i.nombre]));
  const principales = impuestos.filter((i) => i.tipo === "itbis" || i.tipo === "exento");
  const adicionales = impuestos.filter((i) => i.tipo !== "itbis" && i.tipo !== "exento");
  const enEdicion = editable ? servicios.find((s) => s.id === editar) : undefined;
  const vigentes = enEdicion ? precios.get(enEdicion.id) ?? {} : {};
  const visibles = grupo ? servicios.filter((s) => (s.grupo ?? "ninguno") === grupo) : servicios;
  const conPrecios = servicios.some((s) => precios.has(s.id));

  return (
    <>
      <div className="entre">
        <div>
          <h1>Productos y servicios</h1>
          <p className="sub">
            La lista de precios: lo que vendes, con un precio general y, si quieres, uno por categoría de cliente (Pequeña, Mediana,
            Grande, Emprendedor). La factura toma el de la categoría del cliente. Los precios no incluyen ITBIS.
          </p>
        </div>
        {puede(permisos, "exportar") && <Descargar href={`/e/${id}/exportar/lista-precios`} />}
      </div>
      {puedeCargar && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Lista de Precios EMP-P01 · edición octubre 2026</h2>
          <p className="sub">
            Carga los {totalP01} servicios con sus precios por categoría, sin ITBIS. Se puede repetir: no duplica nada y lo que hayas cambiado después
            de la edición se queda como está. El precio general queda en 0, para que a un cliente sin categoría no se le cobre otra columna por error.
          </p>
          <Formulario accion={cargarLista.bind(null, id)} boton="Cargar la lista EMP-P01" className="fila"><span /></Formulario>
        </div>
      )}
      {editable && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>{enEdicion ? `Editar ${enEdicion.nombre}` : "Nuevo producto o servicio"}</h2>
          <Formulario key={enEdicion?.id ?? "nuevo"} accion={guardarServicio.bind(null, id)} boton="Guardar" className="fila">
            {enEdicion && <input type="hidden" name="id" value={enEdicion.id} />}
            <label style={{ width: 110 }}>Código<input name="codigo" defaultValue={enEdicion?.codigo ?? ""} maxLength={20} placeholder="Opcional" /></label>
            <label style={{ flex: "2 1 260px" }}>Nombre<input name="nombre" defaultValue={enEdicion?.nombre} required /></label>
            <label>Grupo
              <select name="grupo" defaultValue={enEdicion?.grupo ?? ""}>
                <option value="">Sin grupo</option>
                {Object.entries(GRUPOS_SERVICIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label style={{ width: 150 }}>Precio general<input name="precio" inputMode="decimal" defaultValue={enEdicion?.precio ?? ""} required /></label>
            <label>ITBIS
              <select name="impuesto" defaultValue={enEdicion?.impuesto_id ?? principales[0]?.id} required>
                {principales.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
              </select>
            </label>
            {adicionales.length > 0 && (
              <label>Otro cargo
                <select name="impuesto_adicional" defaultValue={enEdicion?.impuesto_adicional_id ?? ""}>
                  <option value="">Ninguno</option>
                  {adicionales.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
                </select>
              </label>
            )}
            <label style={{ flex: "1 1 240px" }}>Cuenta de ingreso
              <select name="cuenta_ingreso" defaultValue={enEdicion?.cuenta_ingreso_id ?? ""}>
                <option value="">La de la unidad o la de Configuración de ventas</option>
                {ingresos.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
              </select>
            </label>
            {unidades.length > 0 && (
              <label>Unidad de negocio
                <select name="unidad" defaultValue={enEdicion?.unidad_id ?? ""}>
                  <option value="">Sin unidad</option>
                  {unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </label>
            )}
            <fieldset style={{ border: 0, padding: 0, margin: 0, flex: "1 1 100%" }}>
              <legend className="sub" style={{ margin: 0 }}>
                Precios por categoría (sin ITBIS). Vacío: se usa el precio general. Un precio nuevo rige desde la fecha que pongas; lo ya facturado no cambia.
              </legend>
              <div className="fila">
                {CATEGORIAS_PRECIO.map((c) => (
                  <label key={c} style={{ width: 150 }}>{CATEGORIAS[c]}
                    <input name={`p_${c}`} inputMode="decimal" defaultValue={vigentes[c] ?? ""} />
                  </label>
                ))}
                <label style={{ width: 170 }}>Vigente desde<input type="date" name="vigente_desde" defaultValue={hoy} /></label>
              </div>
            </fieldset>
            {enEdicion && (
              <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <input type="checkbox" name="activo" defaultChecked={enEdicion.activo} style={{ minHeight: 0 }} /> Activo
              </label>
            )}
          </Formulario>
          {enEdicion && <p><Link href={`/e/${id}/servicios`}>Cancelar</Link></p>}
        </div>
      )}
      <nav className="fila" style={{ marginBottom: 12 }} aria-label="Grupo">
        <Link className={`boton${!grupo ? " primario" : ""}`} href={`/e/${id}/servicios`}>Todos</Link>
        {Object.entries(GRUPOS_SERVICIO).filter(([k]) => servicios.some((s) => s.grupo === k)).map(([k, v]) => (
          <Link key={k} className={`boton${grupo === k ? " primario" : ""}`} href={`/e/${id}/servicios?grupo=${k}`}>{v}</Link>
        ))}
      </nav>
      <div className="tabla-envoltura">
        <table>
          <thead>
            <tr>
              <th>Producto o servicio</th><th className="num">General</th>
              {conPrecios && CATEGORIAS_PRECIO.map((c) => <th key={c} className="num">{CATEGORIAS[c]}</th>)}
              <th>Impuestos</th><th>Cuenta</th>{unidades.length > 0 && <th>Unidad</th>}{editable && <th />}
            </tr>
          </thead>
          <tbody>
            {visibles.map((s) => {
              const p = precios.get(s.id) ?? {};
              return (
                <tr key={s.id} style={s.activo ? undefined : { opacity: 0.55 }}>
                  <td>
                    {s.codigo && <span className="sub" style={{ margin: 0 }}>{s.codigo} · </span>}{s.nombre}{!s.activo && " (inactivo)"}
                    {s.grupo && <div className="sub" style={{ margin: 0 }}>{GRUPOS_SERVICIO[s.grupo]}</div>}
                  </td>
                  <td className="num">{verMonto(s.precio)}</td>
                  {conPrecios && CATEGORIAS_PRECIO.map((c) => <td key={c} className="num">{p[c] !== undefined ? verMonto(p[c]!) : "—"}</td>)}
                  <td>{[s.impuesto_id, s.impuesto_adicional_id].filter(Boolean).map((i) => nombreImpuesto.get(i!) ?? "—").join(" + ") || "Sin impuesto: edítalo"}</td>
                  <td>{s.cuenta ?? (s.unidad ? "La de la unidad" : "La de Configuración de ventas")}</td>
                  {unidades.length > 0 && <td>{s.unidad ?? "—"}</td>}
                  {editable && <td className="num"><Link href={`/e/${id}/servicios?editar=${s.id}`}>Editar</Link></td>}
                </tr>
              );
            })}
            {visibles.length === 0 && <tr><td colSpan={10}>Todavía no hay productos ni servicios.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
