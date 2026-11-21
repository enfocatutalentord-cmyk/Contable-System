import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { esCartaDeTrabajo, valoresDeEmpleado, type EmpleadoFicha } from "@/lib/cartas-trabajo";
import { conEmpresa } from "@/lib/db";
import { CARPETAS } from "@/lib/expediente";
import { clientesDeFirma } from "@/lib/firma";
import { hoyISO } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { plantillaDe, valoresDeCliente } from "@/lib/plantillas-documento";
import { ESPACIOS } from "@/lib/plantillas-word";
import { generarDocumentoAccion } from "../../../plantillas-acciones";

export const metadata = { title: "Generar un documento · Empire Tax & Legal" };

const NOMBRE = new Map(ESPACIOS.map((e) => [e.clave, e.nombre]));

// Generar un documento (P3d): cada espacio de la plantilla viene lleno con lo que el sistema sabe del cliente. Se revisa, se corrige lo que haga falta y se
// escribe a mano lo que no se sabe; al generar, sale el Word con su número de referencia y queda en el expediente.
export default async function Generar({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ empresa?: string; plantilla?: string; empleado?: string }> }) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  if (!esUuid(sp.empresa ?? "") || !esUuid(sp.plantilla ?? "")) notFound();
  const cliente = (await clientesDeFirma(fid, usuario.id, firma.administrador)).find((c) => c.id === sp.empresa);
  const plantilla = await plantillaDe(fid, sp.plantilla!);
  if (!cliente || !plantilla) notFound();
  const hoy = hoyISO();
  const { permisos } = await exigirPermiso(cliente.id, "ver");
  // Cartas de trabajo (P3i): si la plantilla usa espacios del empleado, se elige al empleado de la ficha (con sueldos: solo quien puede editar la ficha los ve).
  const conEmpleado = esCartaDeTrabajo(plantilla.campos), puedeVerEmpleados = puede(permisos, "empresa");
  const { sabidosCliente, empleados } = await conEmpresa(cliente.id, async (tx) => ({
    sabidosCliente: await valoresDeCliente(tx, cliente.id, { firmaNombre: firma.nombre, firmaRnc: firma.rnc, usuarioNombre: usuario.nombre, hoy }),
    empleados: conEmpleado && puedeVerEmpleados
      ? await tx<(EmpleadoFicha & { id: string })[]>`SELECT id, nombre, cedula, cargo, to_char(fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso, sueldo::text AS sueldo FROM empleados_empresa ORDER BY orden`
      : [],
  }));
  const elegido = esUuid(sp.empleado ?? "") ? empleados.find((e) => e.id === sp.empleado) : undefined;
  const sabidos = { ...sabidosCliente, ...(elegido ? valoresDeEmpleado(elegido, hoy) : {}) };
  const campos = plantilla.campos.filter((c) => c !== "referencia");
  const vacios = campos.filter((c) => !sabidos[c]);

  return (
    <>
      <p><Link href={`/firma/${fid}/plantillas`}>← Documentos y plantillas</Link></p>
      <h1>{plantilla.nombre}</h1>
      <p className="sub">
        Para <strong>{cliente.nombre}</strong>. Revisa lo que el sistema llenó con sus datos y corrige o escribe lo que haga falta. Al generar, el documento sale en Word con su número
        {" "}<strong>ETL-{plantilla.codigo}-{hoy.slice(0, 4)}-NNNN</strong>{plantilla.campos.includes("referencia") ? "" : " (esta plantilla no lo muestra en el texto)"} y se guarda en la carpeta
        {" "}{plantilla.carpeta} · {CARPETAS[plantilla.carpeta]?.nombre} de su expediente.
      </p>
      {conEmpleado && (
        empleados.length > 0 ? (
          <form method="get" className="tarjeta fila" style={{ marginBottom: 16, alignItems: "flex-end" }}>
            <input type="hidden" name="empresa" value={cliente.id} />
            <input type="hidden" name="plantilla" value={plantilla.id} />
            <label style={{ flex: "2 1 260px" }}>Empleado de la ficha del cliente
              <select name="empleado" defaultValue={elegido?.id ?? ""}>
                <option value="">Escribir los datos a mano</option>
                {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </label>
            <button className="boton" type="submit">Usar sus datos</button>
          </form>
        ) : (
          <p className="sub">
            {puedeVerEmpleados ? "Este cliente no tiene empleados en su ficha: escribe los datos del empleado abajo." : "Tu perfil no puede ver los empleados de la ficha: escribe sus datos abajo."}
          </p>
        )
      )}
      {vacios.length > 0 && (
        <p className="aviso">
          Falta escribir: {vacios.map((c) => NOMBRE.get(c) ?? c).join(", ")}. Lo que dejes vacío queda en el Word con sus llaves, por ejemplo <code>{`{{${vacios[0]}}}`}</code>, para llenarlo allá.
        </p>
      )}
      <Formulario key={elegido?.id ?? "manual"} accion={generarDocumentoAccion.bind(null, fid, cliente.id, plantilla.id)} boton="Generar el Word" className="">
        <div className="fila">
          {campos.map((c) => {
            const largo = c === "socios" || (sabidos[c] ?? "").length > 90;
            return (
              <label key={c} style={{ flex: largo ? "1 1 100%" : "1 1 280px" }}>
                {NOMBRE.get(c) ?? <>Escribe: <code>{c}</code></>}
                {largo
                  ? <textarea name={`v_${c}`} rows={Math.min(8, Math.max(2, (sabidos[c] ?? "").split("\n").length))} defaultValue={sabidos[c] ?? ""} maxLength={4000} />
                  : <input name={`v_${c}`} defaultValue={sabidos[c] ?? ""} maxLength={4000} />}
              </label>
            );
          })}
        </div>
      </Formulario>
    </>
  );
}
