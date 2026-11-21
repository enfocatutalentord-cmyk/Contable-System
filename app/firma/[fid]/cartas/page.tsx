import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { esCartaDeTrabajo } from "@/lib/cartas-trabajo";
import { clientesDeFirma } from "@/lib/firma";
import { plantillasDeFirma } from "@/lib/plantillas-documento";
import { agregarCartasAccion } from "../../plantillas-acciones";

export const metadata = { title: "Cartas de trabajo · Empire Tax & Legal" };

// Cartas de trabajo (Prioridad 3, P3i): constancias, comunicaciones y avisos para los empleados de un cliente, hechos con las plantillas de Word de la P3d. Al elegir al
// empleado de la ficha, el sistema llena su nombre, cédula, cargo, fecha de ingreso, tiempo de servicio y salario (también en letras).
export default async function Cartas({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound(); // solo el equipo de la firma
  const clientes = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => c.estado_cliente !== "retirado" && c.estado_cliente !== "prospecto");
  const cartas = (await plantillasDeFirma(fid)).filter((p) => esCartaDeTrabajo(p.campos));

  return (
    <>
      <h1>Cartas de trabajo</h1>
      <p className="sub">
        Constancias de trabajo, comunicaciones y avisos para los empleados de un cliente. Eliges al cliente, la carta y al empleado de su ficha, y el sistema llena sus datos (nombre, cédula,
        cargo, fecha de ingreso, tiempo de servicio y salario, también en letras). El documento sale en Word, con su número de referencia, y queda en el expediente del cliente.
      </p>

      <section className="tarjeta" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Hacer una carta</h2>
        {cartas.length === 0 ? (
          <p className="sub" style={{ marginBottom: 0 }}>
            Todavía no hay cartas de trabajo. {firma.administrador ? "Agrega las de ejemplo aquí abajo o sube la tuya en Documentos y plantillas." : "Pídele a una administradora que las agregue."}
          </p>
        ) : (
          <form method="get" action={`/firma/${fid}/plantillas/generar`} className="fila">
            <label style={{ flex: "2 1 260px" }}>Cliente
              <select name="empresa" required defaultValue="">
                <option value="" disabled>Elige el cliente</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </label>
            <label style={{ flex: "2 1 260px" }}>Carta
              <select name="plantilla" required defaultValue="">
                <option value="" disabled>Elige la carta</option>
                {cartas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
            <button className="primario" type="submit">Continuar</button>
          </form>
        )}
      </section>

      {firma.administrador && (
        <section className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Cartas de ejemplo</h2>
          <p className="sub">
            Tres borradores para empezar: <strong>constancia de trabajo</strong>, <strong>comunicación de desahucio</strong> (artículos 75 a 80 y 86 del Código de Trabajo) y <strong>aviso de vacaciones</strong>{" "}
            (artículos 177 a 182). Son textos de ejemplo: revísalos y ajústalos antes de usarlos con un cliente. Se agregan a Documentos y plantillas, donde puedes bajarlos, cambiarles el texto en Word y
            volver a subirlos, o subir las tuyas con los mismos espacios.
          </p>
          <Formulario accion={agregarCartasAccion.bind(null, fid)} boton="Agregar las cartas de ejemplo" className="fila"><span /></Formulario>
        </section>
      )}

      <h2>Espacios del empleado</h2>
      <p className="sub">
        Úsalos en cualquier plantilla de Word. Se llenan al elegir al empleado de la ficha del cliente (solo quien puede editar la ficha ve a los empleados; los demás los escriben a mano).
      </p>
      <div className="tabla-envoltura">
        <table>
          <tbody>
            {[
              ["{{empleado}}", "Nombre"], ["{{empleado_cedula}}", "Cédula, con guiones"], ["{{empleado_cargo}}", "Cargo"], ["{{empleado_fecha_ingreso}}", "Fecha de ingreso, en palabras"],
              ["{{empleado_fecha_ingreso_corta}}", "Fecha de ingreso, 05/03/2020"], ["{{empleado_antiguedad}}", "Tiempo de servicio hasta hoy"], ["{{empleado_sueldo}}", "Salario mensual, RD$50,000.00"],
              ["{{empleado_sueldo_letras}}", "Salario mensual en letras"],
            ].map(([c, d]) => <tr key={c}><td><code>{c}</code></td><td>{d}</td></tr>)}
          </tbody>
        </table>
      </div>
    </>
  );
}
