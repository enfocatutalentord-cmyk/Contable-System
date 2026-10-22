import { exigirModulo } from "@/lib/modulos";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { NOMBRE_NCF, type TipoNcf } from "@/lib/ventas";
import { agregarSecuencia, desactivarSecuencia } from "../ventas-acciones";

type Secuencia = { id: string; tipo: TipoNcf; desde: string; hasta: string; siguiente: string; vence: string; activa: boolean };

export default async function Comprobantes({ params }: { params: Promise<{ id: string }> }) {
  exigirModulo("ventas");
  const { id } = await params;
  const { permisos } = await accesoEmpresa(id);
  const secuencias = await conEmpresa(id, (tx) => tx<Secuencia[]>`
    SELECT id, tipo, desde::text, hasta::text, siguiente::text, to_char(vence, 'YYYY-MM-DD') AS vence, activa
      FROM secuencias_ncf ORDER BY tipo, desde`);
  const hoy = hoyISO();
  const editable = puede(permisos, "catalogo");
  const finDeAnio = `${Number(hoy.slice(0, 4)) + 1}-12-31`;

  return (
    <>
      <h1>Comprobantes NCF</h1>
      <p className="sub">
        Los rangos de comprobantes que la DGII te autorizó (en la Oficina Virtual, «Solicitud de comprobantes»).
        Cada factura toma el siguiente número del rango activo y vigente de su tipo.
      </p>
      {editable && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Agregar rango autorizado</h2>
          <Formulario accion={agregarSecuencia.bind(null, id)} boton="Agregar rango" className="fila">
            <label>Tipo
              <select name="tipo" defaultValue="B01">
                {(Object.keys(NOMBRE_NCF) as TipoNcf[]).map((t) => <option key={t} value={t}>{t} · {NOMBRE_NCF[t]}</option>)}
              </select>
            </label>
            <label style={{ width: 140 }}>Desde<input name="desde" type="number" min={1} defaultValue={1} required /></label>
            <label style={{ width: 140 }}>Hasta<input name="hasta" type="number" min={1} max={99999999} defaultValue={100} required /></label>
            <label>Vence<input name="vence" type="date" defaultValue={finDeAnio} required /></label>
          </Formulario>
        </div>
      )}
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Tipo</th><th>Rango</th><th>Próximo NCF</th><th className="num">Quedan</th><th>Vence</th><th>Estado</th>{editable && <th />}</tr></thead>
          <tbody>
            {secuencias.map((s) => {
              const quedan = Number(s.hasta) - Number(s.siguiente) + 1;
              const vencida = s.vence < hoy;
              const estado = !s.activa ? "Desactivado" : vencida ? "Vencido" : quedan <= 0 ? "Agotado" : quedan <= 10 ? "Quedan pocos" : "Disponible";
              return (
                <tr key={s.id}>
                  <td>{s.tipo} · {NOMBRE_NCF[s.tipo]}</td>
                  <td>{s.tipo}{s.desde.padStart(8, "0")} – {s.tipo}{s.hasta.padStart(8, "0")}</td>
                  <td>{quedan > 0 ? s.tipo + s.siguiente.padStart(8, "0") : "—"}</td>
                  <td className="num">{Math.max(0, quedan)}</td>
                  <td>{verFecha(s.vence)}</td>
                  <td className={estado === "Disponible" ? undefined : "error"}>{estado}</td>
                  {editable && (
                    <td className="num">
                      {s.activa && (
                        <Formulario accion={desactivarSecuencia.bind(null, id)} boton="Desactivar" className="fila">
                          <input type="hidden" name="id" value={s.id} />
                        </Formulario>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {secuencias.length === 0 && <tr><td colSpan={7}>Agrega tus rangos de NCF para poder facturar.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
