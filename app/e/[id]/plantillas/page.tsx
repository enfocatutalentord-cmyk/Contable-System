import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { borradoresDePlantillas, listarPlantillas, prepararRecurrentes, totalesLineas, type Preparados } from "@/lib/plantillas";
import { contabilizarBorradoresPlantilla, eliminarPlantilla, pausarPlantilla } from "../plantillas-acciones";

// Asientos frecuentes (bloque 7a): plantillas «sin programar» que se usan a mano y mensuales que preparan un borrador cada mes
// al abrir esta pantalla (como las facturas recurrentes); los borradores se contabilizan aquí con un clic.
export default async function Plantillas({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ guardada?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { usuario, permisos, empresa } = await accesoEmpresa(id);
  const registra = puede(permisos, "registrar");
  const contabiliza = puede(permisos, "contabilizar");
  const hoy = hoyISO();
  const { plantillas, borradores, preparados } = await conEmpresa(id, async (tx) => {
    const preparados: Preparados = registra ? await prepararRecurrentes(tx, id, usuario.id, hoy) : { creados: [], errores: [] };
    return { plantillas: await listarPlantillas(tx), borradores: await borradoresDePlantillas(tx), preparados };
  });

  return (
    <>
      <h1>Asientos frecuentes</h1>
      <p className="sub">
        Plantillas de los asientos que se repiten. Las «sin programar» se usan a mano y vienen con sus cuentas (por ejemplo «Depósito a
        ahorro» o «Pago de luz»); las mensuales preparan un borrador cada mes (depreciación, pagos fijos) que se contabiliza aquí. Nada se
        contabiliza solo. Para crear una, haz el asiento y usa «Guardar como plantilla», o empieza aquí.
      </p>
      {sp.guardada && <p className="exito" role="status">Plantilla guardada.</p>}
      {preparados.creados.length > 0 && (
        <p className="exito" role="status">
          Se prepararon {preparados.creados.length} {preparados.creados.length === 1 ? "borrador" : "borradores"}:{" "}
          {preparados.creados.map((c) => `${c.plantilla} (${verFecha(c.fecha)})`).join(", ")}.
        </p>
      )}
      {preparados.errores.map((e) => <p key={e} className="aviso">{e}</p>)}
      {registra && <p><Link className="boton primario" href={`/e/${id}/plantillas/nueva`}>Nueva plantilla</Link></p>}

      {(borradores.length > 0 || plantillas.some((p) => p.frecuencia === "mensual")) && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Borradores por contabilizar</h2>
          <Formulario accion={contabilizarBorradoresPlantilla.bind(null, id)} boton={contabiliza && borradores.length > 0 ? "Contabilizar los marcados" : ""}>
            {borradores.length === 0 && <p className="sub" style={{ margin: 0 }}>No hay borradores pendientes. El próximo se prepara al abrir esta pantalla cuando llegue su fecha.</p>}
            {borradores.length > 0 && <>
            <div className="tabla-envoltura">
              <table>
                <thead><tr>{contabiliza && <th />}<th>Fecha</th><th>Plantilla</th><th>Concepto</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {borradores.map((b) => (
                    <tr key={b.id}>
                      {contabiliza && (
                        <td>
                          <input type="checkbox" name="asiento" value={b.id} aria-label={`Contabilizar ${b.concepto}`}
                            defaultChecked={!(empresa.requiere_aprobacion && b.creado_por === usuario.id)} style={{ minHeight: 0 }} />
                        </td>
                      )}
                      <td>{verFecha(b.fecha)}</td>
                      <td>{b.plantilla}</td>
                      <td><Link href={`/e/${id}/asientos/${b.id}`}>{b.concepto}</Link></td>
                      <td className="num">{verMonto(b.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {empresa.requiere_aprobacion && <p className="sub">En esta empresa los asientos requieren aprobación: otra persona contabiliza los que tú preparaste.</p>}
            </>}
          </Formulario>
        </div>
      )}

      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Plantilla</th><th>Concepto</th><th>Se repite</th><th>Próximo</th><th className="num">Monto</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {plantillas.map((p) => {
              const t = totalesLineas(p.lineas);
              return (
                <tr key={p.id} style={p.activa ? undefined : { opacity: 0.65 }}>
                  <td>{p.nombre}</td>
                  <td>{p.concepto}</td>
                  <td>{p.frecuencia === "mensual" ? `Cada mes, día ${p.dia === 30 ? "último" : p.dia}${p.hasta ? ` hasta el ${verFecha(p.hasta)}` : ""}` : "No (a mano)"}</td>
                  <td>{p.frecuencia === "mensual" && p.activa && p.proxima ? verFecha(p.proxima) : "—"}</td>
                  <td className="num">{t.debe ? verMonto(t.debe) : "Se escribe al usarla"}</td>
                  <td>{p.activa ? "Activa" : p.frecuencia === "mensual" ? "En pausa o terminada" : "En pausa"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {registra && (
                      <div className="fila" style={{ gap: 6 }}>
                        <Link className="boton" href={`/e/${id}/asientos/nuevo?plantilla=${p.id}`}>Usar</Link>
                        <Link className="boton" href={`/e/${id}/plantillas/${p.id}`}>Editar</Link>
                        <Formulario accion={pausarPlantilla.bind(null, id, p.id, !p.activa)} boton={p.activa ? "Pausar" : "Activar"} className="fila"><span /></Formulario>
                        <Formulario accion={eliminarPlantilla.bind(null, id, p.id)} boton="Eliminar" className="fila"><span /></Formulario>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {plantillas.length === 0 && <tr><td colSpan={7}>Todavía no hay plantillas.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
