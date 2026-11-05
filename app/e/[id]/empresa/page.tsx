import Link from "next/link";
import { CamposFicha } from "@/app/campos-ficha";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa, db } from "@/lib/db";
import {
  CATEGORIAS, ESTADOS_CLIENTE, leerFicha, MAX_EMPLEADOS, MAX_SOCIOS, MODALIDADES, ROLES_CONTACTO, TIPOS_CLIENTE,
} from "@/lib/ficha";
import { verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { actualizarFicha } from "../acciones";
import {
  guardarFichaContactos, guardarFichaEmpleados, guardarFichaOperaciones, guardarFichaRelacion, guardarFichaSocios, guardarFichaSociedad, subirLogo,
} from "../ficha-acciones";

const SECCIONES: Record<string, string> = {
  general: "Datos generales", sociedad: "Sociedad", socios: "Socios", contactos: "Contactos", operaciones: "Operaciones",
  empleados: "Empleados", relacion: "Relación con Empire",
};
const FILAS_EXTRA = 3;
const v = (x: unknown) => (x === null || x === undefined ? "" : String(x));

// Ficha única del cliente (Documento maestro «Sistema Empire», sección 5): de aquí salen los datos de facturas, documentos,
// mensajes y alertas. Ver la ficha pide «ver»; cambiarla, «empresa»; los empleados (llevan sueldos), «empresa» para verlos.
export default async function Ficha({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ seccion?: string }> }) {
  const { id } = await params;
  const { seccion: s } = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const editable = puede(permisos, "empresa");
  const verEmpleados = editable;
  const seccion = s && s in SECCIONES && (s !== "empleados" || verEmpleados) ? s : "general";
  const [d] = await db()<{
    nombre: string; nombre_comercial: string | null; tipo_identificacion: string; rnc: string | null; actividad_economica: string | null;
    regimen: string; direccion: string | null; telefono: string | null; correo: string | null; mes_cierre: number;
    inicio_operaciones: string | null; requiere_aprobacion: boolean; activa: boolean; creada: Date;
  }[]>`
    SELECT nombre, nombre_comercial, tipo_identificacion, rnc, actividad_economica, regimen, direccion, telefono, correo, mes_cierre,
           to_char(inicio_operaciones, 'YYYY-MM-DD') AS inicio_operaciones, requiere_aprobacion, activa, creada
      FROM empresas WHERE id = ${id}`;
  const { ficha: f, socios, contactos, empleados, sugerida, formalizado } = await conEmpresa(id, (tx) => leerFicha(tx, id, verEmpleados));
  const [logo] = await conEmpresa(id, (tx) => tx<{ id: string }[]>`
    SELECT id FROM documentos WHERE entidad = 'empresa' AND entidad_id = ${id} AND descripcion = 'logo' AND NOT eliminado ORDER BY subido_en DESC LIMIT 1`);
  const boton = (t: string) => (editable ? t : "");
  const campos = (hijos: React.ReactNode) => <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 14 }}>{hijos}</fieldset>;
  const seleccion = (nombre: string, valor: unknown, opciones: Record<string, string>, vacio = "—") => (
    <select name={nombre} defaultValue={v(valor)}>
      <option value="">{vacio}</option>
      {Object.entries(opciones).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
    </select>
  );
  const siNo = (nombre: string, valor: unknown) => (
    <select name={nombre} defaultValue={valor === true ? "si" : valor === false ? "no" : ""}>
      <option value="">—</option><option value="si">Sí</option><option value="no">No</option>
    </select>
  );

  return (
    <>
      <h1>Ficha del cliente</h1>
      <p className="sub">
        Una sola ficha por cliente: de aquí salen los datos de facturas, documentos y mensajes. Cliente desde el {d.creada.toLocaleDateString("es-DO")}.
        {" "}{formalizado ? "Formalizado (ficha, hoja de acuerdo y contrato firmados)." : "Sin formalizar del todo."}
      </p>
      <nav className="fila" style={{ marginBottom: 12 }} aria-label="Secciones de la ficha">
        {Object.entries(SECCIONES).filter(([k]) => k !== "empleados" || verEmpleados).map(([k, t]) => (
          <Link key={k} className={`boton${k === seccion ? " primario" : ""}`} href={`/e/${id}/empresa?seccion=${k}`}>{t}</Link>
        ))}
      </nav>

      <div className="tarjeta">
        {seccion === "general" && (editable ? (
          <Formulario accion={actualizarFicha.bind(null, id)} boton="Guardar cambios" className=""><CamposFicha d={d} edicion /></Formulario>
        ) : <CamposFicha d={d} edicion deshabilitado />)}

        {seccion === "sociedad" && (
          <>
            <Formulario accion={guardarFichaSociedad.bind(null, id)} boton={boton("Guardar")} className="">
              {campos(<>
                <div className="fila">
                  <label style={{ flex: "1 1 220px" }}>Tipo de sociedad<input name="tipo_sociedad" defaultValue={v(f.tipo_sociedad)} placeholder="Ej.: SRL, SAS, persona física" /></label>
                  <label>Fecha de constitución<input name="fecha_constitucion" type="date" defaultValue={v(f.fecha_constitucion)} /></label>
                  <label>Capital social RD$<input name="capital_social" inputMode="decimal" defaultValue={v(f.capital_social)} /></label>
                </div>
                <div className="fila">
                  <label style={{ flex: "1 1 200px" }}>Municipio<input name="municipio" defaultValue={v(f.municipio)} /></label>
                  <label style={{ flex: "1 1 200px" }}>Provincia<input name="provincia" defaultValue={v(f.provincia)} /></label>
                </div>
                <div className="fila">
                  <label>Vence el registro mercantil<input name="vence_registro_mercantil" type="date" defaultValue={v(f.vence_registro_mercantil)} /></label>
                  <label>Vence el nombre comercial (ONAPI)<input name="vence_nombre_comercial" type="date" defaultValue={v(f.vence_nombre_comercial)} /></label>
                  <label>Próxima asamblea ordinaria<input name="fecha_asamblea" type="date" defaultValue={v(f.fecha_asamblea)} /></label>
                </div>
              </>)}
            </Formulario>
            <h3>Logo y membrete</h3>
            {logo ? <p><img src={`/e/${id}/documentos/${logo.id}`} alt="Logo del cliente" style={{ maxHeight: 80, maxWidth: 240 }} /></p> : <p className="sub">Sin logo todavía.</p>}
            {editable && (
              <Formulario accion={subirLogo.bind(null, id)} boton="Subir logo" className="fila">
                <label>Imagen PNG o JPG (hasta 1 MB)<input name="logo" type="file" accept="image/png,image/jpeg" required /></label>
              </Formulario>
            )}
          </>
        )}

        {seccion === "socios" && (
          <Formulario accion={guardarFichaSocios.bind(null, id)} boton={boton("Guardar socios")} className="">
            <p className="sub">Las cuotas deben sumar 100 %. Los anexos H-1 y H-2 del IR-2 toman los socios de aquí.</p>
            {campos(
              <div className="tabla-envoltura">
                <table>
                  <thead><tr><th>N.º</th><th>Nombre</th><th>Cédula</th><th>Teléfono</th><th>% de cuotas</th></tr></thead>
                  <tbody>
                    {Array.from({ length: Math.min(MAX_SOCIOS, socios.length + (editable ? FILAS_EXTRA : 0)) }, (_, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td><input name={`s${i}_nombre`} defaultValue={v(socios[i]?.nombre)} aria-label={`Socio ${i + 1}, nombre`} /></td>
                        <td><input name={`s${i}_cedula`} defaultValue={v(socios[i]?.cedula)} aria-label={`Socio ${i + 1}, cédula`} /></td>
                        <td><input name={`s${i}_telefono`} defaultValue={v(socios[i]?.telefono)} aria-label={`Socio ${i + 1}, teléfono`} /></td>
                        <td><input name={`s${i}_porcentaje`} inputMode="decimal" defaultValue={v(socios[i]?.porcentaje)} aria-label={`Socio ${i + 1}, %`} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>,
            )}
          </Formulario>
        )}

        {seccion === "contactos" && (
          <Formulario accion={guardarFichaContactos.bind(null, id)} boton={boton("Guardar contactos")} className="">
            <p className="sub">El representante legal y el gerente firman las cartas del cliente. La fecha de nacimiento sirve para las felicitaciones.</p>
            {campos(<>
              {ROLES_CONTACTO.map(([rol, titulo]) => {
                const c = contactos.find((x) => x.rol === rol);
                const k = (x: string) => `c_${rol}_${x}`;
                return (
                  <fieldset key={rol} style={{ border: "1px solid var(--borde)", borderRadius: 8, padding: 12 }}>
                    <legend>{titulo}</legend>
                    <div className="fila">
                      <label style={{ flex: "2 1 220px" }}>Nombre<input name={k("nombre")} defaultValue={v(c?.nombre)} /></label>
                      <label>Cédula<input name={k("cedula")} defaultValue={v(c?.cedula)} /></label>
                      <label>Cargo<input name={k("cargo")} defaultValue={v(c?.cargo)} /></label>
                    </div>
                    <div className="fila">
                      <label>Teléfono<input name={k("telefono")} defaultValue={v(c?.telefono)} /></label>
                      <label>WhatsApp<input name={k("whatsapp")} defaultValue={v(c?.whatsapp)} /></label>
                      <label style={{ flex: "1 1 220px" }}>Correo<input name={k("correo")} type="email" defaultValue={v(c?.correo)} /></label>
                      <label>Fecha de nacimiento<input name={k("nacimiento")} type="date" defaultValue={v(c?.nacimiento)} /></label>
                    </div>
                  </fieldset>
                );
              })}
              <label>Nombre del grupo de WhatsApp de contabilidad<input name="grupo_whatsapp" defaultValue={v(f.grupo_whatsapp)} /></label>
            </>)}
          </Formulario>
        )}

        {seccion === "operaciones" && (
          <Formulario accion={guardarFichaOperaciones.bind(null, id)} boton={boton("Guardar")} className="">
            <p className="sub">Ventas, facturas y empleados al mes definen la categoría del cliente (regla de dos de tres criterios).</p>
            {campos(<>
              <div className="fila">
                <label>Ventas al mes RD$<input name="ventas_mes" inputMode="decimal" defaultValue={v(f.ventas_mes)} /></label>
                <label>Facturas al mes (compras + ventas)<input name="facturas_mes" inputMode="numeric" defaultValue={v(f.facturas_mes)} /></label>
                <label>Empleados<input name="empleados_mes" inputMode="numeric" defaultValue={v(f.empleados_mes)} /></label>
              </div>
              <div className="fila">
                <label>Tiene TSS{siNo("tiene_tss", f.tiene_tss)}</label>
                <label>Emite e-CF{siNo("emite_ecf", f.emite_ecf)}</label>
                <label style={{ flex: "1 1 220px" }}>Sistema que usa<input name="sistema_usa" defaultValue={v(f.sistema_usa)} /></label>
              </div>
            </>)}
          </Formulario>
        )}

        {seccion === "empleados" && verEmpleados && (
          <Formulario accion={guardarFichaEmpleados.bind(null, id)} boton={boton("Guardar empleados")} className="">
            <p className="sub">Para cartas de trabajo y nómina. Llevan sueldos: solo los ve quien tiene el permiso «Editar la ficha de la empresa».</p>
            {campos(
              <div className="tabla-envoltura">
                <table>
                  <thead><tr><th>N.º</th><th>Nombre</th><th>Cédula</th><th>Cargo</th><th>Fecha de ingreso</th><th>Sueldo RD$</th></tr></thead>
                  <tbody>
                    {Array.from({ length: Math.min(MAX_EMPLEADOS, empleados.length + FILAS_EXTRA) }, (_, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td><input name={`p${i}_nombre`} defaultValue={v(empleados[i]?.nombre)} aria-label={`Empleado ${i + 1}, nombre`} /></td>
                        <td><input name={`p${i}_cedula`} defaultValue={v(empleados[i]?.cedula)} aria-label={`Empleado ${i + 1}, cédula`} /></td>
                        <td><input name={`p${i}_cargo`} defaultValue={v(empleados[i]?.cargo)} aria-label={`Empleado ${i + 1}, cargo`} /></td>
                        <td><input name={`p${i}_fecha_ingreso`} type="date" defaultValue={v(empleados[i]?.fecha_ingreso)} aria-label={`Empleado ${i + 1}, ingreso`} /></td>
                        <td><input name={`p${i}_sueldo`} inputMode="decimal" defaultValue={v(empleados[i]?.sueldo)} aria-label={`Empleado ${i + 1}, sueldo`} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>,
            )}
          </Formulario>
        )}

        {seccion === "relacion" && (
          <Formulario accion={guardarFichaRelacion.bind(null, id)} boton={boton("Guardar")} className="">
            {campos(<>
              <div className="fila">
                <label>Categoría{seleccion("categoria", f.categoria, CATEGORIAS)}
                  <small className="sub">{sugerida ? `Sugerida por sus operaciones: ${CATEGORIAS[sugerida]}` : "Llena Operaciones para sugerirla"}</small>
                </label>
                <label>Tipo de cliente{seleccion("tipo_cliente", f.tipo_cliente, TIPOS_CLIENTE)}</label>
                <label>Estado{seleccion("estado_cliente", f.estado_cliente, ESTADOS_CLIENTE, "Activo")}</label>
              </div>
              <div className="fila">
                <label>Inicio del contrato<input name="fecha_inicio_contrato" type="date" defaultValue={v(f.fecha_inicio_contrato)} /></label>
                <label>Día de facturación<input name="dia_facturacion" inputMode="numeric" defaultValue={v(f.dia_facturacion)} placeholder="Ej.: 30" /></label>
                <label style={{ flex: "1 1 300px" }}>Modalidad{seleccion("modalidad", f.modalidad, MODALIDADES)}</label>
              </div>
              <div className="fila">
                <label>Ficha de registro firmada el<input name="ficha_firmada" type="date" defaultValue={v(f.ficha_firmada)} /></label>
                <label>Hoja de acuerdo firmada el<input name="hoja_firmada" type="date" defaultValue={v(f.hoja_firmada)} /></label>
                <label>Contrato firmado el<input name="contrato_firmado" type="date" defaultValue={v(f.contrato_firmado)} /></label>
              </div>
              <label>Quién custodia los accesos de DGII y TSS (nunca se guardan las claves)<input name="custodio_accesos" defaultValue={v(f.custodio_accesos)} /></label>
              <p className="sub" style={{ margin: 0 }}>
                {f.fecha_inicio_contrato ? `Contrato desde el ${verFecha(String(f.fecha_inicio_contrato))}. ` : ""}
                La iguala, los servicios incluidos y el tipo de acuerdo llegan con la lista de precios (bloque 2).
              </p>
            </>)}
          </Formulario>
        )}
      </div>
    </>
  );
}
