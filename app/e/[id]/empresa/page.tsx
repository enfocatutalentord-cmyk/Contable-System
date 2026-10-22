import { CamposFicha } from "@/app/campos-ficha";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { db } from "@/lib/db";
import { puede } from "@/lib/permisos";
import { actualizarFicha } from "../acciones";

export default async function Ficha({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { permisos } = await accesoEmpresa(id);
  const [d] = await db()<{
    nombre: string; nombre_comercial: string | null; tipo_identificacion: string; rnc: string | null; actividad_economica: string | null;
    regimen: string; direccion: string | null; telefono: string | null; correo: string | null; mes_cierre: number;
    inicio_operaciones: string | null; requiere_aprobacion: boolean; activa: boolean; creada: Date;
  }[]>`
    SELECT nombre, nombre_comercial, tipo_identificacion, rnc, actividad_economica, regimen, direccion, telefono, correo, mes_cierre,
           to_char(inicio_operaciones, 'YYYY-MM-DD') AS inicio_operaciones, requiere_aprobacion, activa, creada
      FROM empresas WHERE id = ${id}`;
  const editable = puede(permisos, "empresa");
  return (
    <>
      <h1>Ficha de la empresa</h1>
      <p className="sub">Datos generales y fiscales del cliente. Cliente desde el {d.creada.toLocaleDateString("es-DO")}.</p>
      <div className="tarjeta">
        {editable ? (
          <Formulario accion={actualizarFicha.bind(null, id)} boton="Guardar cambios" className="">
            <CamposFicha d={d} edicion />
          </Formulario>
        ) : (
          <CamposFicha d={d} edicion deshabilitado />
        )}
      </div>
    </>
  );
}
