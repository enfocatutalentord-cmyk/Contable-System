import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { SelectorClienteRapido } from "@/app/selector-cliente-rapido";
import { EnviarWhatsApp } from "@/app/whatsapp";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { DURACIONES, ESTADOS_CITA, fechaLarga, listarCitas, MODALIDADES, terminaA, verHora, type Cita } from "@/lib/agenda";
import { moverMes, nombreMes } from "@/lib/bitacora";
import { conEmpresa } from "@/lib/db";
import { clientesDeFirma, equipoDe } from "@/lib/firma";
import { hoyISO } from "@/lib/montos";
import { nombreCorto } from "@/lib/nombre-corto";
import { cancelarCitaAccion, crearCitaAccion, moverCitaAccion, realizarCitaAccion } from "../../agenda-acciones";

export const metadata = { title: "Agenda de citas · Empire Tax & Legal" };

const SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DIA_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const finDeMes = (mes: string) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);
const sumar = (f: string, n: number) => { const d = new Date(`${f}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

type Fila = Cita & { cliente: string };

// Agenda de citas (Prioridad 3, P3c): las reuniones con clientes y prospectos. Cada cita queda en la ficha de su cliente; el recordatorio sale por
// WhatsApp con un clic. Sin conexión con Google Calendar.
export default async function Agenda({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ mes?: string; dia?: string; cliente?: string; nueva?: string }> }) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound(); // solo el equipo de la firma
  const hoy = hoyISO();
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(sp.dia ?? "") ? sp.dia! : null;
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes ?? "") ? sp.mes! : (dia ?? hoy).slice(0, 7);
  const diaElegido = dia ?? (mes === hoy.slice(0, 7) ? hoy : `${mes}-01`);
  const todos = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => !c.propia && c.estado_cliente !== "retirado");
  const elegido = todos.find((c) => c.id === sp.cliente) ?? null;
  const clientes = elegido ? [elegido] : todos;
  const equipo = await equipoDe(fid);
  const nombreDe = new Map(equipo.map((p) => [p.id, p.nombre]));

  // Un solo recorrido: el mes mostrado y los próximos 30 días.
  const desde = [`${mes}-01`, hoy].sort()[0], hasta = [finDeMes(mes), sumar(hoy, 30)].sort().reverse()[0];
  const filas: Fila[] = (await Promise.all(clientes.map((c) => conEmpresa(c.id, async (tx) => (await listarCitas(tx, desde, hasta)).map((x) => ({ ...x, cliente: c.nombre })))))).flat()
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
  const delMes = filas.filter((c) => c.fecha.slice(0, 7) === mes);
  const porDia = new Map<string, Fila[]>();
  for (const c of delMes) porDia.set(c.fecha, [...(porDia.get(c.fecha) ?? []), c]);
  const delDia = filas.filter((c) => c.fecha === diaElegido);
  const proximas = filas.filter((c) => c.estado === "programada" && c.fecha >= hoy && c.fecha !== diaElegido).slice(0, 8);

  const anio = Number(mes.slice(0, 4)), nMes = Number(mes.slice(5, 7));
  const inicio = (new Date(Date.UTC(anio, nMes - 1, 1)).getUTCDay() + 6) % 7; // la semana empieza en lunes
  const celdas: (string | null)[] = [...Array(inicio).fill(null), ...Array.from({ length: Number(finDeMes(mes).slice(8)) }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`)];
  while (celdas.length % 7) celdas.push(null);
  const enlace = (extra: Record<string, string>) => `/firma/${fid}/agenda?${new URLSearchParams({ mes, ...(elegido ? { cliente: elegido.id } : {}), ...extra })}`;

  const tarjeta = (c: Fila) => {
    const programada = c.estado === "programada";
    return (
      <div key={c.id} className="tarjeta cita" style={{ marginBottom: 10 }}>
        <div className="entre">
          <div>
            <strong>{verHora(c.hora)} – {verHora(terminaA(c.hora, c.duracion_min))}</strong> · {c.titulo}
            <div><Link href={`/e/${c.empresa_id}/empresa?seccion=citas`}>{c.cliente}</Link> · {MODALIDADES[c.modalidad]}{c.lugar && ` · ${c.lugar}`}</div>
            {c.asistentes.length > 0 && <div className="sub" style={{ margin: 0 }}>Asisten: {c.asistentes.map((a) => nombreDe.get(a) ?? "—").join(", ")}</div>}
            {c.notas && <div className="sub" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{c.notas}</div>}
            {c.motivo_cancelacion && <div className="sub" style={{ margin: 0 }}>Motivo: {c.motivo_cancelacion}</div>}
            {c.movida_veces > 0 && <div className="sub" style={{ margin: 0 }}>Movida {c.movida_veces} {c.movida_veces === 1 ? "vez" : "veces"}</div>}
          </div>
          <span className={`etiqueta-cita cita-${c.estado}`}>{ESTADOS_CITA[c.estado]}</span>
        </div>
        {programada && (
          <div className="fila" style={{ marginTop: 8, alignItems: "center" }}>
            <EnviarWhatsApp empresaId={c.empresa_id} clave="cita" docRef={{ tipo: "cita", id: c.id }} etiqueta="Recordatorio por WhatsApp" />
            {c.recordatorio_enviado ? <span className="sub" style={{ margin: 0 }}>Recordatorio enviado el {c.recordatorio_enviado}</span> : <span className="sub" style={{ margin: 0 }}>Sin recordatorio todavía</span>}
          </div>
        )}
        {programada && (
          <div className="fila" style={{ marginTop: 8, alignItems: "start" }}>
            <details>
              <summary>Mover</summary>
              <Formulario accion={moverCitaAccion.bind(null, c.empresa_id, c.id)} boton="Mover la cita" className="fila">
                <label>Fecha<input type="date" name="fecha" min={hoy} defaultValue={c.fecha} required /></label>
                <label>Hora<input type="time" name="hora" defaultValue={c.hora} required /></label>
              </Formulario>
            </details>
            <details>
              <summary>Marcar realizada</summary>
              <Formulario accion={realizarCitaAccion.bind(null, c.empresa_id, c.id)} boton="Marcar realizada" className="fila">
                <label style={{ flex: "1 1 280px" }}>Qué se habló o acordó<input name="resultado" maxLength={1500} /></label>
              </Formulario>
            </details>
            <details>
              <summary>Cancelar</summary>
              <Formulario accion={cancelarCitaAccion.bind(null, c.empresa_id, c.id)} boton="Cancelar la cita" className="fila">
                <label style={{ flex: "1 1 280px" }}>Motivo (opcional)<input name="motivo" maxLength={300} /></label>
              </Formulario>
            </details>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <h1>Agenda de citas</h1>
      <p className="sub">
        Las reuniones con clientes y prospectos. Cada cita queda en la ficha de su cliente (sección «Citas»). Al crear una cita con alguien que todavía no es cliente, se
        crea su ficha como prospecto. El recordatorio sale por WhatsApp con un clic; las alertas avisan de las citas de hoy y de mañana.
      </p>

      <details className="tarjeta" style={{ marginBottom: 16 }} open={sp.nueva === "1"}>
        <summary><strong>+ Nueva cita</strong></summary>
        <Formulario accion={crearCitaAccion.bind(null, fid)} boton="Guardar la cita" className="fila">
          <SelectorClienteRapido clientes={todos.map((c) => ({ id: c.id, nombre: c.nombre }))} crearClientes={firma.crear_clientes} etiqueta="Cliente o prospecto" inicial={elegido?.id ?? ""} />
          <label style={{ flex: "2 1 240px" }}>Asunto<input name="titulo" maxLength={200} placeholder="Reunión" /></label>
          <label>Fecha<input type="date" name="fecha" min={hoy} defaultValue={diaElegido < hoy ? hoy : diaElegido} required /></label>
          <label>Hora<input type="time" name="hora" defaultValue="09:00" required /></label>
          <label>Duración<select name="duracion" defaultValue="60">{DURACIONES.map((m) => <option key={m} value={m}>{m >= 60 ? `${m / 60} h` : `${m} min`}</option>)}</select></label>
          <label>Modalidad<select name="modalidad" defaultValue="presencial">{Object.entries(MODALIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label style={{ flex: "2 1 260px" }}>Lugar o enlace<input name="lugar" maxLength={300} placeholder="Dirección o enlace de la reunión" /></label>
          <fieldset style={{ flex: "1 1 100%", border: 0, padding: 0, margin: 0 }}>
            <legend className="sub" style={{ margin: "0 0 4px" }}>Quiénes del equipo asisten</legend>
            <div className="fila">
              {equipo.map((p) => (
                <label key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" name="asistentes" value={p.id} defaultChecked={p.id === usuario.id} style={{ minHeight: 0 }} /> {p.nombre}
                </label>
              ))}
            </div>
          </fieldset>
          <label style={{ flex: "1 1 100%" }}>Notas<input name="notas" maxLength={2000} placeholder="Qué se va a tratar" /></label>
        </Formulario>
      </details>

      <nav className="fila" style={{ marginBottom: 12, alignItems: "center" }} aria-label="Mes">
        <Link className="boton" href={enlace({ mes: moverMes(mes, -1) })}>← {nombreMes(moverMes(mes, -1))}</Link>
        <strong style={{ textTransform: "capitalize" }}>{nombreMes(mes)}</strong>
        <Link className="boton" href={enlace({ mes: moverMes(mes, 1) })}>{nombreMes(moverMes(mes, 1))} →</Link>
        {mes !== hoy.slice(0, 7) && <Link className="boton" href={enlace({ mes: hoy.slice(0, 7), dia: hoy })}>Hoy</Link>}
      </nav>
      <form method="get" action={`/firma/${fid}/agenda`} className="fila" style={{ marginBottom: 16 }}>
        <input type="hidden" name="mes" value={mes} />
        <label>Cliente
          <select name="cliente" defaultValue={elegido?.id ?? ""}>
            <option value="">Todos los clientes</option>
            {todos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <button className="boton" type="submit">Ver</button>
      </form>

      <h2>{fechaLarga(diaElegido).replace(/^./, (c) => c.toUpperCase())}{diaElegido === hoy && " · hoy"}</h2>
      {delDia.length === 0 ? <p className="sub">No hay citas este día.</p> : delDia.map(tarjeta)}

      <div className="cal-rejilla" style={{ marginTop: 20 }}>
        {SEMANA.map((d) => <div key={d} className="cal-semana">{d}</div>)}
        {celdas.map((f, i) => {
          if (!f) return <div key={i} className="cal-dia fuera vacio" />;
          const ev = porDia.get(f) ?? [];
          return (
            <div key={f} className={`cal-dia${f === hoy ? " hoy" : ""}${ev.length ? "" : " vacio"}`}>
              <Link href={enlace({ dia: f })} className="cal-numero" data-nombre={DIA_LARGO[new Date(`${f}T00:00:00Z`).getUTCDay()]}>{Number(f.slice(8))}</Link>
              {ev.map((c) => (
                <Link key={c.id} href={enlace({ dia: f })} className={`cal-chip cal-cita-${c.estado}`} title={`${verHora(c.hora)} · ${c.titulo} · ${c.cliente}`}>
                  {verHora(c.hora)}{!elegido && <small>{nombreCorto(c.cliente)}</small>}
                </Link>
              ))}
            </div>
          );
        })}
      </div>
      {delMes.length === 0 && <p className="sub" style={{ marginTop: 12 }}>No hay citas en {nombreMes(mes)}.</p>}

      {proximas.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2>Próximas citas</h2>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Cuándo</th><th>Cliente</th><th>Asunto</th><th>Recordatorio</th></tr></thead>
              <tbody>
                {proximas.map((c) => (
                  <tr key={c.id}>
                    <td style={{ whiteSpace: "nowrap" }}><Link href={enlace({ dia: c.fecha, mes: c.fecha.slice(0, 7) })}>{fechaLarga(c.fecha)} · {verHora(c.hora)}</Link></td>
                    <td>{c.cliente}</td><td>{c.titulo}</td><td>{c.recordatorio_enviado ? "Enviado" : "Pendiente"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
