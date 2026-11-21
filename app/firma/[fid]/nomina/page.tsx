import { notFound } from "next/navigation";
import { accesoFirma, esUuid, exigirPermiso, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { clientesDeFirma } from "@/lib/firma";
import { puede } from "@/lib/permisos";
import { NominaForm, type EmpleadoNomina } from "./nomina-form";

export const metadata = { title: "Nómina y TSS · Empire Tax & Legal" };

// Nómina del mes y archivo de la TSS (Prioridad 3, P3h). El cliente se elige aquí; los empleados de su ficha (con sueldos) solo los ve quien puede editar la ficha,
// y el resto escribe los datos. No se guarda nada.
export default async function Nomina({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ empresa?: string }> }) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound(); // solo el equipo de la firma
  const clientes = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => c.estado_cliente !== "retirado" && c.estado_cliente !== "prospecto");
  const elegido = esUuid(sp.empresa ?? "") ? clientes.find((c) => c.id === sp.empresa) : undefined;

  let empleados: EmpleadoNomina[] = [];
  let rnc: string | null = null;
  if (elegido) {
    const { empresa, permisos } = await exigirPermiso(elegido.id, "ver");
    if (empresa.firma_id !== fid) notFound();
    rnc = empresa.rnc;
    if (puede(permisos, "empresa")) {
      empleados = (await conEmpresa(elegido.id, (tx) => tx<{ nombre: string; cedula: string | null; sueldo: string | null }[]>`
        SELECT nombre, cedula, sueldo::text AS sueldo FROM empleados_empresa ORDER BY orden`))
        .map((e) => ({ nombre: e.nombre, cedula: e.cedula ?? "", sueldo: e.sueldo ?? "" }));
    }
  }

  return (
    <>
      <h1>Nómina y archivo de la TSS</h1>
      <p className="sub">
        La nómina de un cliente para el mes: lo que se le descuenta a cada empleado (AFP, SFS e ISR), lo que paga el empleador (AFP, SFS, riesgos laborales e INFOTEP), el neto a pagar y el
        archivo de autodeterminación para cargar en el SUIR Plus de la TSS. Las tasas, topes y posiciones del archivo salen de los documentos oficiales de la TSS; la escala del ISR, de la DGII.
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
      {!elegido && <p className="sub">Elige el cliente al que pertenece la nómina.</p>}
      {elegido && (
        <>
          <h2>{elegido.nombre}</h2>
          {!rnc && <p className="aviso" role="status">Este cliente no tiene RNC en su ficha: sin él no se puede armar el archivo de la TSS.</p>}
          {empleados.length === 0 && <p className="sub">No hay empleados en su ficha, o tu perfil no puede verlos: escribe los datos a mano.</p>}
          <NominaForm key={elegido.id} firmaId={fid} empresaId={elegido.id} empleados={empleados} />
        </>
      )}
    </>
  );
}
