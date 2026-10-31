import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { ejercicios, propuestaCierre } from "@/lib/cierre-ejercicio";
import { listarCuentas } from "@/lib/cuentas";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { ultimoDiaMes } from "@/lib/reportes";
import { fijarBloqueo } from "../acciones";
import { cerrarElEjercicio, deshacerElCierre, traspasarElResultado } from "../cierre-ejercicio-acciones";

const AVISOS: Record<string, string> = {
  cerrado: "Ejercicio cerrado: el asiento de cierre quedó contabilizado y el ejercicio bloqueado.",
  traspasado: "El resultado pasó a resultados acumulados.", deshecho: "Se deshizo el cierre del ejercicio y se anularon sus asientos.",
};

export default async function Cierres({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ejercicio?: string; aviso?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa, permisos } = await accesoEmpresa(id);
  const datos = await conEmpresa(id, async (tx) => {
    const [{ mes_cierre }] = await tx<{ mes_cierre: number }[]>`SELECT mes_cierre FROM empresas WHERE id = ${id}`;
    const lista = await ejercicios(tx, mes_cierre);
    // El elegido, o el último ejercicio terminado sin cerrar, o el más reciente.
    const elegido = lista.find((e) => e.fin === sp.ejercicio) ?? lista.find((e) => e.terminado && !e.cierre) ?? lista[0];
    const propuesta = elegido && !elegido.cierre ? await propuestaCierre(tx, elegido.fin, mes_cierre) : null;
    const patrimonio = (await listarCuentas(tx)).filter((c) => c.tipo === "patrimonio" && c.de_detalle && c.activa);
    return { lista, elegido, propuesta, patrimonio };
  });
  const { lista, elegido, propuesta, patrimonio } = datos;
  const porCodigo = (codigo: string) => patrimonio.find((c) => c.codigo === codigo)?.id ?? "";
  const historial = await conEmpresa(id, (tx) => tx<{ accion: string; detalle: { antes: string | null; despues: string | null }; fecha: Date; nombre: string | null }[]>`
    SELECT b.accion, b.detalle, b.fecha, u.nombre FROM bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id
     WHERE b.accion IN ('periodo_cerrado', 'periodo_reabierto') ORDER BY b.fecha DESC LIMIT 24`);
  // Sugerencia: cerrar hasta el último día del mes anterior al actual (o al siguiente del bloqueo vigente).
  const hoy = new Date();
  const mesAnterior = ultimoDiaMes(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1)).toISOString().slice(0, 10));

  return (
    <>
      <h1>Cierres de período y del ejercicio</h1>
      <p className="sub">
        Al cerrar un período, nadie puede registrar, cambiar ni anular asientos con fecha igual o anterior a la fecha de cierre.
        Así los reportes ya entregados (a la DGII, al banco, a los socios) no cambian.
      </p>
      <div className="tarjeta" style={{ marginBottom: 16 }}>
        <p style={{ marginTop: 0 }}>
          {empresa.fecha_bloqueo
            ? <>Período cerrado hasta el <strong>{verFecha(empresa.fecha_bloqueo)}</strong>.</>
            : <>No hay ningún período cerrado.</>}
        </p>
        {puede(permisos, "cerrar") ? (
          <Formulario accion={fijarBloqueo.bind(null, id)} boton="Guardar fecha de cierre" className="fila">
            <label>Cerrar hasta<input type="date" name="fecha" defaultValue={empresa.fecha_bloqueo ?? mesAnterior} /></label>
          </Formulario>
        ) : (
          <p className="sub">Solo el dueño o el contador pueden cerrar períodos.</p>
        )}
        {puede(permisos, "cerrar") && !puede(permisos, "reabrir") && (
          <p className="sub" style={{ marginBottom: 0 }}>Puedes avanzar la fecha de cierre. Para reabrir un período cerrado hace falta el dueño.</p>
        )}
        {puede(permisos, "reabrir") && (
          <p className="sub" style={{ marginBottom: 0 }}>Para reabrir, pon una fecha anterior o deja el campo vacío. Queda anotado quién lo hizo.</p>
        )}
      </div>
      <h2>Cierre del ejercicio</h2>
      <p className="sub">
        Al terminar el año fiscal, los ingresos, costos y gastos quedan en cero contra «Resultado del ejercicio» y el año queda
        bloqueado. Después, cuando se decida, el resultado pasa a «Resultados acumulados».
      </p>
      {sp.aviso && AVISOS[sp.aviso] && <p className="exito" role="status">{AVISOS[sp.aviso]}</p>}
      {lista.length === 0 ? <p className="sub">Todavía no hay asientos contabilizados.</p> : (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <nav className="fila" style={{ marginBottom: 12 }} aria-label="Ejercicio">
            {lista.map((e) => (
              <Link key={e.fin} className={`boton${e.fin === elegido?.fin ? " primario" : ""}`} href={`/e/${id}/cierres?ejercicio=${e.fin}`}>
                {e.inicio.slice(0, 4) === e.fin.slice(0, 4) ? e.fin.slice(0, 4) : `${e.inicio.slice(0, 4)}-${e.fin.slice(2, 4)}`}{e.cierre ? " · cerrado" : !e.terminado ? " · en curso" : ""}
              </Link>
            ))}
          </nav>
          {elegido && (
            <>
              <p style={{ marginTop: 0 }}>Ejercicio del <strong>{verFecha(elegido.inicio)}</strong> al <strong>{verFecha(elegido.fin)}</strong>.</p>
              {elegido.cierre ? (
                <>
                  <p>
                    Cerrado por {elegido.cierre.quien} el {elegido.cierre.cerrado_en.toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo" })} con {Number(elegido.cierre.resultado) >= 0 ? "utilidad" : "pérdida"} de <strong>{verMonto(elegido.cierre.resultado.replace("-", ""))}</strong>
                    {" "}(<Link href={`/e/${id}/asientos/${elegido.cierre.asiento_id}`}>asiento {elegido.cierre.asiento}</Link>
                    {elegido.cierre.traspaso_id && <>; traspaso: <Link href={`/e/${id}/asientos/${elegido.cierre.traspaso_id}`}>asiento {elegido.cierre.traspaso}</Link></>}).
                  </p>
                  {!elegido.cierre.traspaso_id && puede(permisos, "cerrar") && Number(elegido.cierre.resultado) !== 0 && (
                    <Formulario accion={traspasarElResultado.bind(null, id, elegido.fin)} boton="Pasar a resultados acumulados" className="fila">
                      <label style={{ flex: "1 1 300px" }}>Cuenta de resultados acumulados
                        <select name="cuenta_acumulados" required defaultValue={porCodigo("310301")}>
                          <option value="" disabled>Elige…</option>
                          {patrimonio.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                        </select>
                      </label>
                    </Formulario>
                  )}
                  {puede(permisos, "reabrir") && (
                    <Formulario accion={deshacerElCierre.bind(null, id, elegido.fin)} boton="Deshacer el cierre" className="fila"><span /></Formulario>
                  )}
                </>
              ) : !elegido.terminado ? (
                <p className="sub">El ejercicio todavía está en curso; se cierra después del {verFecha(elegido.fin)}.</p>
              ) : propuesta && (
                <>
                  {propuesta.borradores > 0 && <p className="aviso">Hay {propuesta.borradores} asiento{propuesta.borradores > 1 ? "s" : ""} en borrador en este ejercicio: contabilízalos o descártalos antes de cerrar.</p>}
                  <p>Asiento propuesto: {propuesta.resultado >= 0n ? "utilidad" : "pérdida"} del ejercicio de <strong>{verMonto(propuesta.resultado < 0n ? -propuesta.resultado : propuesta.resultado)}</strong>.</p>
                  <div className="tabla-envoltura" style={{ marginBottom: 12 }}>
                    <table>
                      <thead><tr><th>Cuenta</th><th className="num">Debe</th><th className="num">Haber</th></tr></thead>
                      <tbody>
                        {propuesta.lineas.map((l) => <tr key={l.cuentaId}><td>{l.codigo} {l.nombre}</td><td className="num">{verMonto(l.debe, true)}</td><td className="num">{verMonto(l.haber, true)}</td></tr>)}
                        <tr><td><em>Resultado del ejercicio</em></td><td className="num">{propuesta.resultado < 0n ? verMonto(-propuesta.resultado) : ""}</td><td className="num">{propuesta.resultado > 0n ? verMonto(propuesta.resultado) : ""}</td></tr>
                      </tbody>
                    </table>
                  </div>
                  {puede(permisos, "cerrar") && propuesta.lineas.length > 0 && (
                    <Formulario accion={cerrarElEjercicio.bind(null, id, elegido.fin)} boton={`Contabilizar el cierre del ejercicio ${elegido.fin.slice(0, 4)}`} className="fila">
                      <label style={{ flex: "1 1 300px" }}>Cuenta del resultado del ejercicio
                        <select name="cuenta_resultado" required defaultValue={porCodigo("310302")}>
                          <option value="" disabled>Elige…</option>
                          {patrimonio.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                        </select>
                      </label>
                    </Formulario>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      <h2>Historial</h2>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th></tr></thead>
          <tbody>
            {historial.map((h, i) => (
              <tr key={i}>
                <td>{h.fecha.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" })}</td>
                <td>{h.nombre}</td>
                <td>
                  {h.accion === "periodo_reabierto" ? "Reabrió" : "Cerró"}:{" "}
                  {h.detalle.antes ? verFecha(h.detalle.antes) : "sin cierre"} → {h.detalle.despues ? verFecha(h.detalle.despues) : "sin cierre"}
                </td>
              </tr>
            ))}
            {historial.length === 0 && <tr><td colSpan={3}>Sin cambios todavía.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
