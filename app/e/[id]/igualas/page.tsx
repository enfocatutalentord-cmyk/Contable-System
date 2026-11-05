import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { esPeriodo, igualaDelMes, nombrePeriodo, periodoDe, SERVICIOS_INCLUIDOS, TIPOS_ACUERDO } from "@/lib/igualas";
import { avisosDe, igualasDelPeriodo, listarAcuerdos, prepararIgualas } from "@/lib/igualas-db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { confirmarAumentoIguala, emitirMes, guardarAcuerdo, prepararMes } from "../igualas-acciones";

// Igualas (bloque 2b, Documento maestro, sección 4): el acuerdo de cada cliente y las facturas del mes. Desde el día de
// facturación de cada cliente su iguala se prepara sola como borrador al abrir esta pantalla; se revisa y se emite con un clic.
const mover = (periodo: string, n: number) => {
  const t = Number(periodo.slice(0, 4)) * 12 + Number(periodo.slice(4)) - 1 + n;
  return `${Math.floor(t / 12)}${String((t % 12) + 1).padStart(2, "0")}`;
};

export default async function Igualas({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ periodo?: string; editar?: string; nuevo?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { permisos, usuario } = await accesoEmpresa(id);
  const hoy = hoyISO();
  const actual = periodoDe(hoy);
  const periodo = sp.periodo && esPeriodo(sp.periodo) ? sp.periodo : actual;
  const registra = puede(permisos, "registrar");
  const datos = await conEmpresa(id, async (tx) => {
    // Lo que ya toca este mes se prepara solo (borradores, sin NCF).
    if (registra && periodo === actual) await prepararIgualas(tx, { empresaId: id, usuarioId: usuario.id, periodo, hoy, soloHastaHoy: true });
    return {
      acuerdos: await listarAcuerdos(tx),
      mes: await igualasDelPeriodo(tx, periodo),
      clientes: await tx<{ id: string; nombre: string }[]>`SELECT id, nombre FROM clientes WHERE activo ORDER BY nombre`,
      servicios: await tx<{ id: string; nombre: string; precio: string }[]>`SELECT id, nombre, precio::text FROM servicios WHERE activo ORDER BY nombre`,
    };
  });
  const avisos = avisosDe(datos.acuerdos, hoy);
  const enEdicion = registra ? datos.acuerdos.find((a) => a.id === sp.editar) : undefined;
  const mostrarFormulario = registra && (enEdicion || sp.nuevo || datos.acuerdos.length === 0);
  const porAcuerdo = new Map(datos.acuerdos.map((a) => [a.id, a]));
  const borradores = datos.mes.filter((f) => f.estado === "borrador");
  const emitidas = datos.mes.filter((f) => f.estado === "emitida");
  const suma = (fs: typeof datos.mes) => fs.reduce((s, f) => s + Number(f.total ?? 0), 0);

  return (
    <>
      <div className="entre">
        <div>
          <h1>Igualas</h1>
          <p className="sub">
            El acuerdo de cada cliente y sus facturas del mes. Desde el día de facturación de cada cliente su iguala se prepara sola
            como borrador (sin NCF); se revisa y se emite con un clic. Usa el comprobante habitual del cliente y el ITBIS del servicio.
          </p>
        </div>
        {registra && !mostrarFormulario && <Link className="boton primario" href={`/e/${id}/igualas?nuevo=1`}>+ Nuevo acuerdo</Link>}
      </div>

      {avisos.length > 0 && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Avisos</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {avisos.map((a, i) => (
              <li key={i} style={{ marginBottom: 8 }}>
                <strong>{a.acuerdo.cliente}:</strong> {a.texto}
                {a.clave === "aumento" && puede(permisos, "empresa") && (
                  <Formulario accion={confirmarAumentoIguala.bind(null, id, a.acuerdo.id)} boton="Confirmar el aumento" className="fila"><span /></Formulario>
                )}
                {a.clave === "aumento" && !puede(permisos, "empresa") && <span className="sub"> Lo confirma quien administra la ficha (Patricia).</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <nav className="fila" style={{ marginBottom: 12, alignItems: "center" }} aria-label="Mes">
        <Link className="boton" href={`/e/${id}/igualas?periodo=${mover(periodo, -1)}`}>← {nombrePeriodo(mover(periodo, -1))}</Link>
        <strong style={{ textTransform: "capitalize" }}>{nombrePeriodo(periodo)}</strong>
        <Link className="boton" href={`/e/${id}/igualas?periodo=${mover(periodo, 1)}`}>{nombrePeriodo(mover(periodo, 1))} →</Link>
      </nav>
      <div className="cifras">
        <div className="tarjeta cifra"><div className="etiqueta">Acuerdos activos</div><div className="valor">{datos.acuerdos.filter((a) => a.activo).length}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Borradores por emitir</div><div className="valor">{borradores.length}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Emitidas</div><div className="valor">{emitidas.length}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Total del mes con ITBIS (RD$)</div><div className="valor">{verMonto(suma(datos.mes))}</div></div>
      </div>
      <div className="fila" style={{ marginBottom: 12 }}>
        {registra && <Formulario accion={prepararMes.bind(null, id, periodo)} boton="Preparar todas las del mes" className="fila"><span /></Formulario>}
        {puede(permisos, "contabilizar") && (
          <Formulario accion={emitirMes.bind(null, id, periodo)} boton={borradores.length ? `Emitir ${borradores.length === 1 ? "el borrador" : `los ${borradores.length} borradores`}` : "Emitir los borradores del mes"} className="fila"><span /></Formulario>
        )}
      </div>
      <div className="tabla-envoltura" style={{ marginBottom: 24 }}>
        <table>
          <thead><tr><th>Cliente</th><th>Acuerdo</th><th>Le toca</th><th>Estado</th><th className="num">Total</th></tr></thead>
          <tbody>
            {datos.mes.map((f) => {
              const a = porAcuerdo.get(f.acuerdo_id)!;
              const calculo = a ? igualaDelMes(a, periodo) : null;
              return (
                <tr key={f.acuerdo_id}>
                  <td>{f.cliente}</td>
                  <td>{TIPOS_ACUERDO[f.tipo]}</td>
                  <td>
                    {calculo ? <>{verFecha(calculo.fecha)} · RD${verMonto(calculo.total, false)}{calculo.nota && <div className="sub" style={{ margin: 0 }}>{calculo.nota}</div>}</> : "Antes del inicio del contrato"}
                  </td>
                  <td>
                    {f.factura_id
                      ? <Link href={`/e/${id}/facturas/${f.factura_id}`}>{f.estado === "emitida" ? `Emitida · ${f.ncf}` : "Borrador"}</Link>
                      : calculo && calculo.total === 0n ? "Mes gratis" : "Sin preparar"}
                  </td>
                  <td className="num">{f.total ? verMonto(f.total) : "—"}</td>
                </tr>
              );
            })}
            {datos.mes.length === 0 && <tr><td colSpan={5}>Todavía no hay acuerdos de iguala.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Acuerdos</h2>
      {mostrarFormulario && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{enEdicion ? `Acuerdo de ${enEdicion.cliente}` : "Nuevo acuerdo (Hoja de Acuerdo)"}</h3>
          <Formulario key={enEdicion?.id ?? "nuevo"} accion={guardarAcuerdo.bind(null, id)} boton="Guardar acuerdo" className="fila">
            {enEdicion && <input type="hidden" name="id" value={enEdicion.id} />}
            <label style={{ flex: "2 1 240px" }}>Cliente
              <select name="cliente" defaultValue={enEdicion?.cliente_id ?? ""} required>
                <option value="" disabled>Elige el cliente…</option>
                {datos.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </label>
            <label>Tipo de acuerdo
              <select name="tipo" defaultValue={enEdicion?.tipo ?? "normal"}>
                {Object.entries(TIPOS_ACUERDO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label style={{ flex: "2 1 240px" }}>Servicio que se factura
              <select name="servicio" defaultValue={enEdicion?.servicio_id ?? ""} required>
                <option value="" disabled>Elige de la lista de precios…</option>
                {datos.servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre} · RD${verMonto(s.precio)}</option>)}
              </select>
            </label>
            <label style={{ width: 150 }}>Iguala mensual (sin ITBIS)<input name="monto" inputMode="decimal" defaultValue={enEdicion?.monto ?? ""} required /></label>
            <label style={{ width: 160 }}>Inicio del contrato<input type="date" name="inicio" defaultValue={enEdicion?.inicio ?? hoy} required /></label>
            <label style={{ width: 130 }}>Día de facturación<input type="number" name="dia_facturacion" min={1} max={31} defaultValue={enEdicion?.dia_facturacion ?? 30} /></label>
            <fieldset style={{ border: 0, padding: 0, margin: 0, flex: "1 1 100%" }}>
              <legend className="sub" style={{ margin: 0 }}>
                Plan de Arranque o ajuste gradual: la tarifa especial (0 = mes gratis) rige hasta la fecha; después, la iguala de arriba.
              </legend>
              <div className="fila">
                <label style={{ width: 150 }}>Tarifa especial<input name="tarifa_especial" inputMode="decimal" defaultValue={enEdicion?.tarifa_especial ?? ""} /></label>
                <label style={{ width: 160 }}>Hasta<input type="date" name="tarifa_hasta" defaultValue={enEdicion?.tarifa_hasta ?? ""} /></label>
              </div>
            </fieldset>
            <fieldset style={{ border: 0, padding: 0, margin: 0, flex: "1 1 100%" }}>
              <legend className="sub" style={{ margin: 0 }}>Acuerdo especial: la cuota se suma a la iguala hasta la fecha de término.</legend>
              <div className="fila">
                <label style={{ width: 150 }}>Deuda total<input name="deuda" inputMode="decimal" defaultValue={enEdicion?.deuda ?? ""} /></label>
                <label style={{ width: 150 }}>Cuota mensual<input name="cuota" inputMode="decimal" defaultValue={enEdicion?.cuota ?? ""} /></label>
                <label style={{ width: 160 }}>Termina<input type="date" name="deuda_hasta" defaultValue={enEdicion?.deuda_hasta ?? ""} /></label>
              </div>
            </fieldset>
            <fieldset style={{ border: 0, padding: 0, margin: 0, flex: "1 1 100%" }}>
              <legend className="sub" style={{ margin: 0 }}>Servicios incluidos en la iguala (lo demás es servicio adicional y se cotiza aparte)</legend>
              <div className="casillas">
                {SERVICIOS_INCLUIDOS.map(([k, v]) => (
                  <label key={k} className="casilla">
                    <input type="checkbox" name="incluidos" value={k} defaultChecked={enEdicion ? enEdicion.servicios_incluidos.includes(k) : true} /> {v}
                  </label>
                ))}
              </div>
            </fieldset>
            <label style={{ flex: "1 1 100%" }}>Notas<input name="notas" defaultValue={enEdicion?.notas ?? ""} /></label>
            {enEdicion && (
              <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <input type="checkbox" name="activo" defaultChecked={enEdicion.activo} style={{ minHeight: 0 }} /> Activo
              </label>
            )}
          </Formulario>
          {(enEdicion || sp.nuevo) && <p><Link href={`/e/${id}/igualas?periodo=${periodo}`}>Cancelar</Link></p>}
        </div>
      )}
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Cliente</th><th>Tipo</th><th>Servicio</th><th className="num">Iguala</th><th>Especial</th><th>Inicio</th><th>Día</th>{registra && <th />}</tr></thead>
          <tbody>
            {datos.acuerdos.map((a) => (
              <tr key={a.id} style={a.activo ? undefined : { opacity: 0.55 }}>
                <td>{a.cliente}{!a.activo && " (inactivo)"}</td>
                <td>{TIPOS_ACUERDO[a.tipo]}</td>
                <td>{a.servicio}</td>
                <td className="num">{verMonto(a.monto)}</td>
                <td>
                  {a.tarifa_hasta ? <>RD${verMonto(a.tarifa_especial!)} hasta {verFecha(a.tarifa_hasta)}</> : ""}
                  {a.deuda_hasta ? <>Cuota RD${verMonto(a.cuota!)} hasta {verFecha(a.deuda_hasta)}</> : ""}
                  {!a.tarifa_hasta && !a.deuda_hasta && "—"}
                </td>
                <td>{verFecha(a.inicio)}</td>
                <td>{a.dia_facturacion}</td>
                {registra && <td className="num"><Link href={`/e/${id}/igualas?editar=${a.id}&periodo=${periodo}`}>Editar</Link></td>}
              </tr>
            ))}
            {datos.acuerdos.length === 0 && <tr><td colSpan={8}>Todavía no hay acuerdos. Crea el primero con el formulario de arriba.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
