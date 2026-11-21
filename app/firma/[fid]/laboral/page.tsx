import { notFound } from "next/navigation";
import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { clientesDeFirma } from "@/lib/firma";
import { puede } from "@/lib/permisos";
import { Calculadora, type EmpleadoFicha } from "./calculadora";

export const metadata = { title: "Prestaciones laborales · Empire Tax & Legal" };

// Prestaciones laborales (Prioridad 3, P3g): preaviso, cesantía, vacaciones y salario de Navidad de un empleado, con el artículo del Código de Trabajo de cada
// concepto. El cliente se elige aquí; los empleados de su ficha (que llevan sueldos) solo los ve quien puede editar la ficha, y el resto escribe los datos.
export default async function Prestaciones({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ empresa?: string }> }) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound(); // solo el equipo de la firma
  const clientes = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => c.estado_cliente !== "retirado" && c.estado_cliente !== "prospecto");
  const elegido = esUuid(sp.empresa ?? "") ? clientes.find((c) => c.id === sp.empresa) : undefined;

  let empleados: EmpleadoFicha[] = [];
  if (elegido) {
    const { empresa, permisos } = await exigirPermiso(elegido.id, "ver");
    if (empresa.firma_id !== fid) notFound();
    if (puede(permisos, "empresa")) {
      empleados = (await conEmpresa(elegido.id, (tx) => tx<{ nombre: string; ingreso: string | null; sueldo: string | null }[]>`
        SELECT nombre, to_char(fecha_ingreso, 'YYYY-MM-DD') AS ingreso, sueldo::text AS sueldo FROM empleados_empresa ORDER BY orden`))
        .map((e) => ({ nombre: e.nombre, ingreso: e.ingreso ?? "", sueldo: e.sueldo ?? "" }));
    }
  }

  return (
    <>
      <h1>Prestaciones laborales</h1>
      <p className="sub">
        Lo que se le debe a un empleado cuando termina su contrato: preaviso, cesantía, vacaciones y salario de Navidad. Cada concepto dice su artículo del Código de Trabajo
        (Ley 16-92) y de su Reglamento. Es un cálculo para que la firma lo revise antes de entregarlo: no se guarda nada.
      </p>
      <form method="get" className="tarjeta fila" style={{ marginBottom: 16, alignItems: "flex-end" }}>
        <label style={{ flex: "2 1 260px" }}>Cliente
          <select name="empresa" required defaultValue={elegido?.id ?? ""}>
            <option value="" disabled>Elige el cliente</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <button className="primario" type="submit">Continuar</button>
      </form>
      {!elegido && <p className="sub">Elige el cliente al que pertenece el empleado.</p>}
      {elegido && (
        <>
          <h2>{elegido.nombre}</h2>
          {empleados.length === 0 && <p className="sub">No hay empleados en su ficha, o tu perfil no puede verlos: escribe los datos a mano.</p>}
          <Calculadora key={elegido.id} firmaId={fid} empresaId={elegido.id} empleados={empleados} />
        </>
      )}
    </>
  );
}
