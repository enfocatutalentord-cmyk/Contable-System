import Link from "next/link";
import { notFound } from "next/navigation";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { moverMes, nombreMes } from "@/lib/bitacora";
import { calendarioDeFirma, finDeMes, nombreDelMes, type Estado, type Evento } from "@/lib/calendario-fiscal";
import { db } from "@/lib/db";
import { clientesDeFirma } from "@/lib/firma";
import { hoyISO, verFecha } from "@/lib/montos";
import { nombreCorto } from "@/lib/nombre-corto";

export const metadata = { title: "Calendario fiscal · Empire Tax & Legal" };

const SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DIA_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const VER: Record<string, string> = { todo: "Todo", impuestos: "Declaraciones y pagos", renovaciones: "Renovaciones" };

// Lo que dice cada estado según qué es: una declaración se presenta; un pago se paga; una renovación se renueva.
function textoEstado(e: Evento): string {
  const hecha = e.tipo === "declaracion" ? "Presentada" : e.tipo === "pago" ? "Pagada" : "Renovada";
  const vigente = e.tipo === "declaracion" ? "Pendiente" : "Vigente";
  return ({ hecho: hecha, vencido: e.tipo === "declaracion" || e.tipo === "pago" ? "Vencida" : "Vencido", por_vencer: "Por vencer", pendiente: vigente, recordatorio: "Recordatorio" } as Record<Estado, string>)[e.estado];
}

// Calendario fiscal y renovaciones (Prioridad 3, P3a): lo que vence cada mes de todos los clientes, o de uno que se elige adentro. No guarda nada:
// se arma con el calendario fiscal de la firma (Normas y tasas), lo presentado y lo que cada cliente tiene registrado.
export default async function CalendarioFiscal({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ mes?: string; cliente?: string; ver?: string }> }) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound(); // solo el equipo de la firma
  const hoy = hoyISO();
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes ?? "") ? sp.mes! : hoy.slice(0, 7);
  const ver = sp.ver && sp.ver in VER ? sp.ver : "todo";
  const todos = (await clientesDeFirma(fid, usuario.id, firma.administrador))
    .filter((c) => c.activa && !c.propia && c.estado_cliente !== "prospecto" && c.estado_cliente !== "retirado");
  const elegido = todos.find((c) => c.id === sp.cliente) ?? null;
  const clientes = elegido ? [elegido] : todos;
  const todosLosEventos = await calendarioDeFirma(fid, clientes.map((c) => ({ id: c.id, nombre: c.nombre, creada: c.creada })), mes, hoy);
  const eventos = todosLosEventos.filter((e) => ver === "todo" || (ver === "impuestos" ? e.tipo === "declaracion" || e.tipo === "pago" : e.tipo !== "declaracion" && e.tipo !== "pago"));
  const [tss] = await db()<{ dia: number | null }[]>`SELECT dia FROM calendario_fiscal WHERE firma_id = ${fid} AND formato = 'TSS'`;

  const desde = `${mes}-01`, hasta = finDeMes(mes);
  const delMes = eventos.filter((e) => e.fecha >= desde && e.fecha <= hasta);
  const atrasados = eventos.filter((e) => e.fecha < desde);
  const porDia = new Map<string, Evento[]>();
  for (const e of delMes) porDia.set(e.fecha, [...(porDia.get(e.fecha) ?? []), e]);

  const anio = Number(mes.slice(0, 4)), nMes = Number(mes.slice(5, 7));
  const inicio = (new Date(Date.UTC(anio, nMes - 1, 1)).getUTCDay() + 6) % 7; // la semana empieza en lunes
  const ultimoDia = Number(hasta.slice(8));
  const celdas: (string | null)[] = [...Array(inicio).fill(null), ...Array.from({ length: ultimoDia }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`)];
  while (celdas.length % 7) celdas.push(null);

  const cuenta = {
    vencidas: eventos.filter((e) => e.estado === "vencido").length,
    porVencer: eventos.filter((e) => e.estado === "por_vencer").length,
    delMes: delMes.length,
    hechas: delMes.filter((e) => e.estado === "hecho").length,
  };
  const enlace = (extra: Record<string, string>) => `/firma/${fid}/calendario?${new URLSearchParams({ mes, ver, ...(elegido ? { cliente: elegido.id } : {}), ...extra })}`;
  const chip = (e: Evento, i: number) => (
    <Link key={i} href={e.enlace} className={`cal-chip cal-${e.tipo} cal-${e.estado}`} title={`${e.titulo} · ${e.empresa} · ${textoEstado(e)}${e.detalle ? ` · ${e.detalle}` : ""}`}>
      {e.estado === "hecho" ? "✓ " : ""}{elegido ? e.titulo : e.corto}{!elegido && <small>{nombreCorto(e.empresa)}</small>}
    </Link>
  );
  const porCliente = clientes.map((c) => ({ c, ev: eventos.filter((e) => e.empresaId === c.id) })).filter((x) => x.ev.length > 0);

  return (
    <>
      <h1>Calendario fiscal</h1>
      <p className="sub">
        Lo que vence en {nombreMes(mes)} {elegido ? `de ${elegido.nombre}` : "de todos los clientes"}: declaraciones, pagos y renovaciones. Las fechas salen del
        calendario fiscal de Normas y tasas y de lo que cada cliente tiene registrado; lo que ya se presentó queda marcado.
      </p>
      <nav className="fila" style={{ marginBottom: 12, alignItems: "center" }} aria-label="Mes">
        <Link className="boton" href={enlace({ mes: moverMes(mes, -1) })}>← {nombreMes(moverMes(mes, -1))}</Link>
        <strong style={{ textTransform: "capitalize" }}>{nombreMes(mes)}</strong>
        <Link className="boton" href={enlace({ mes: moverMes(mes, 1) })}>{nombreMes(moverMes(mes, 1))} →</Link>
        {mes !== hoy.slice(0, 7) && <Link className="boton" href={enlace({ mes: hoy.slice(0, 7) })}>Este mes</Link>}
        {Object.entries(VER).map(([k, v]) => <Link key={k} className={`boton${ver === k ? " primario" : ""}`} href={enlace({ ver: k })}>{v}</Link>)}
      </nav>
      <form method="get" action={`/firma/${fid}/calendario`} className="fila" style={{ marginBottom: 16 }}>
        <input type="hidden" name="mes" value={mes} />
        <input type="hidden" name="ver" value={ver} />
        <label>Cliente
          <select name="cliente" defaultValue={elegido?.id ?? ""}>
            <option value="">Todos los clientes</option>
            {todos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <button className="boton" type="submit">Ver</button>
      </form>

      <div className="cifras">
        <div className="tarjeta cifra"><div className="etiqueta">Vencen este mes</div><div className="valor">{cuenta.delMes}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Ya presentadas o renovadas</div><div className="valor">{cuenta.hechas}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Por vencer (7 días o aviso)</div><div className="valor">{cuenta.porVencer}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Vencidas</div><div className="valor" style={cuenta.vencidas ? { color: "var(--peligro)" } : undefined}>{cuenta.vencidas}</div></div>
      </div>

      {tss?.dia == null && (
        <p className="aviso">
          El pago a la TSS no sale en el calendario porque todavía no tiene día. {firma.administrador ? <>Escríbelo en <Link href={`/firma/${fid}/normas#calendario`}>Normas y tasas</Link>.</> : "Pídele a una administradora que lo escriba en Normas y tasas."}
        </p>
      )}

      <div className="cal-leyenda" aria-label="Leyenda">
        <span className="cal-chip cal-declaracion">Declaración</span><span className="cal-chip cal-pago">Anticipo o TSS</span>
        <span className="cal-chip cal-renovacion">Renovación</span><span className="cal-chip cal-comprobantes">Comprobantes o certificado</span>
        <span className="cal-chip cal-hecho">✓ Hecha</span><span className="cal-chip cal-por_vencer">Por vencer</span>
        <span className="cal-chip cal-vencido">Vencida</span><span className="cal-chip cal-recordatorio">Recordatorio</span>
      </div>

      <div className="cal-rejilla">
        {SEMANA.map((d) => <div key={d} className="cal-semana">{d}</div>)}
        {celdas.map((f, i) => {
          if (!f) return <div key={i} className="cal-dia fuera vacio" />;
          const ev = porDia.get(f) ?? [];
          const nombre = DIA_LARGO[new Date(`${f}T00:00:00Z`).getUTCDay()];
          return (
            <div key={f} className={`cal-dia${f === hoy ? " hoy" : ""}${ev.length ? "" : " vacio"}`}>
              <span className="cal-numero" data-nombre={nombre}>{Number(f.slice(8))}</span>
              {ev.map(chip)}
            </div>
          );
        })}
      </div>
      {delMes.length === 0 && <p className="sub" style={{ marginTop: 12 }}>No hay vencimientos en {nombreMes(mes)} con ese filtro.</p>}

      {atrasados.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2>Atrasado de meses anteriores</h2>
          <p className="sub">Declaraciones de los últimos 90 días que siguen sin presentar y renovaciones vencidas que no se han renovado.</p>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Venció</th>{!elegido && <th>Cliente</th>}<th>Qué</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {atrasados.map((e, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap" }}>{verFecha(e.fecha)}</td>
                    {!elegido && <td>{e.empresa}</td>}
                    <td>{e.titulo}{e.detalle && <div className="sub" style={{ margin: 0 }}>{e.detalle}</div>}</td>
                    <td className="peligro">{textoEstado(e)}</td>
                    <td><Link href={e.enlace}>Abrir</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section style={{ marginTop: 24 }}>
        <h2>Por cliente en {nombreMes(mes)}</h2>
        {porCliente.length === 0 && <p className="sub">Ningún cliente tiene vencimientos con ese filtro.</p>}
        {porCliente.map(({ c, ev }) => (
          <div key={c.id} style={{ marginBottom: 16 }}>
            <h3><Link href={`/e/${c.id}`}>{c.nombre}</Link></h3>
            <div className="tabla-envoltura">
              <table>
                <thead><tr><th>Vence</th><th>Qué</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {ev.map((e, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap" }}>{verFecha(e.fecha)}</td>
                      <td>{e.titulo}{e.detalle && <div className="sub" style={{ margin: 0 }}>{e.detalle}</div>}</td>
                      <td className={e.estado === "vencido" ? "peligro" : e.estado === "hecho" ? "exito" : undefined}>{textoEstado(e)}</td>
                      <td><Link href={e.enlace}>Abrir</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>
      <p className="sub">
        Un recordatorio es una fecha que el sistema no puede comprobar (el anticipo del ISR, o la TSS cuando no hay notificación de pago registrada).
        Las alertas del Inicio de la firma siguen avisando antes de cada vencimiento.
      </p>
    </>
  );
}
