import Link from "next/link";
import { notFound } from "next/navigation";
import { Descargar } from "@/app/descargar";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, esUuid, misFirmas } from "@/lib/acceso";
import { EnviarWhatsApp } from "@/app/whatsapp";
import { listarAnticipos } from "@/lib/anticipos";
import { cantidadTexto } from "@/lib/calculos";
import { conEmpresa } from "@/lib/db";
import { listarImpuestos } from "@/lib/fiscal";
import { deCentavos, hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { aLinea, descuentoAEmprendedor, ESTADOS_PROPUESTA, lineasDe, montoAnticipo, totalesPropuesta } from "@/lib/propuestas";
import { datosFormulario } from "../../facturas/datos-formulario";
import { cambiarEstadoPropuesta, guardarPropuestaAccion, propuestaAFactura, propuestaAIguala } from "../../propuestas-acciones";
import { FormularioPropuesta } from "../formulario-propuesta";

export default async function Propuesta({ params, searchParams }: {
  params: Promise<{ id: string; pid: string }>; searchParams: Promise<{ editar?: string }>;
}) {
  const { id, pid } = await params;
  const { editar } = await searchParams;
  if (!esUuid(pid)) notFound();
  const { permisos, usuario } = await accesoEmpresa(id);
  const propia = (await misFirmas(usuario.id)).some((x) => x.empresa_propia_id === id); // WhatsApp (bloque 3c)
  const hoy = hoyISO();
  const r = await conEmpresa(id, async (tx) => {
    const [p] = await tx<{
      numero: number; cliente_id: string; cliente: string; categoria: string | null; rnc: string | null; fecha: string; valida_hasta: string; estado: string; requisitos: string | null;
      anticipo_pct: string; forma_pago: string | null; entrega: string | null; notas: string | null; factura_id: string | null; acuerdo_id: string | null;
    }[]>`
      SELECT p.numero, p.cliente_id, c.nombre AS cliente, c.categoria, c.rnc, to_char(p.fecha, 'YYYY-MM-DD') AS fecha, to_char(p.valida_hasta, 'YYYY-MM-DD') AS valida_hasta,
             p.estado, p.requisitos, p.anticipo_pct::text, p.forma_pago, to_char(p.entrega, 'YYYY-MM-DD') AS entrega, p.notas, p.factura_id, p.acuerdo_id
        FROM propuestas p JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ${pid}`;
    if (!p) return null;
    const lineas = await lineasDe(tx, pid);
    const impuestos = new Map((await listarImpuestos(tx)).map((i) => [i.id, i]));
    const anticipos = (await listarAnticipos(tx, p.cliente_id)).filter((a) => !a.anulado);
    return { p, lineas, impuestos, anticipos, form: editar ? await datosFormulario(tx, hoy) : null };
  });
  if (!r) notFound();
  const { p, lineas, impuestos } = r;
  const t = totalesPropuesta(lineas.map(aLinea), impuestos);
  const anticipo = montoAnticipo(t.total, p.anticipo_pct);
  const abierta = p.estado === "borrador" || p.estado === "enviada";
  const vencida = abierta && p.valida_hasta < hoy;
  const registra = puede(permisos, "registrar");
  const deEsta = r.anticipos.filter((a) => a.propuesta === p.numero);

  if (r.form && abierta && registra) {
    return (
      <>
        <p><Link href={`/e/${id}/propuestas/${pid}`}>← Propuesta n.º {p.numero}</Link></p>
        <h1>Editar propuesta n.º {p.numero}</h1>
        <FormularioPropuesta accion={guardarPropuestaAccion.bind(null, id, pid)} clientes={r.form.clientes} servicios={r.form.servicios}
          impuestos={r.form.impuestos} impuestoPorDefecto={r.form.impuestoPorDefecto} unidades={r.form.unidades} hoy={hoy}
          inicial={{
            cliente: p.cliente_id, fecha: p.fecha, validaHasta: p.valida_hasta, requisitos: p.requisitos ?? "", anticipo: String(Number(p.anticipo_pct)),
            formaPago: p.forma_pago ?? "", entrega: p.entrega ?? "", notas: p.notas ?? "",
            lineas: lineas.map((l) => ({
              servicioId: l.servicio_id ?? "", descripcion: l.descripcion, cantidad: String(Number(l.cantidad)), precio: l.precio_lista,
              descuento: Number(l.descuento) ? l.descuento : "", impuesto: l.impuesto_id, adicional: l.impuesto_adicional_id ?? "", unidad: l.unidad_id ?? "",
            })),
          }} />
      </>
    );
  }

  return (
    <>
      <p><Link href={`/e/${id}/propuestas`}>← Propuestas</Link></p>
      {descuentoAEmprendedor(p.categoria, lineas) && (
        <p className="aviso">Este cliente es Emprendedor: la lista de precios dice que su precio es fijo, sin negociación. Esta propuesta tiene descuento.</p>
      )}
      <div className="entre">
        <div>
          <h1>Propuesta n.º {p.numero}</h1>
          <p className="sub">
            {p.cliente}{p.rnc && ` · RNC ${p.rnc}`} · {verFecha(p.fecha)} · válida hasta {verFecha(p.valida_hasta)} ·{" "}
            <strong>{vencida ? "Vencida" : ESTADOS_PROPUESTA[p.estado]}</strong>
          </p>
        </div>
        <div className="fila">
          {puede(permisos, "exportar") && <Descargar href={`/e/${id}/exportar/propuesta?id=${pid}`} />}
          {abierta && registra && <Link className="boton" href={`/e/${id}/propuestas/${pid}?editar=1`}>Editar</Link>}
        </div>
      </div>
      {propia && p.estado !== "rechazada" && puede(permisos, "exportar") && (
        <div style={{ marginBottom: 12 }}><EnviarWhatsApp empresaId={id} clave="propuesta" docRef={{ tipo: "propuesta", id: pid }} /></div>
      )}
      <div className="tabla-envoltura" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>Servicio</th><th className="num">Cantidad</th><th className="num">Precio de lista</th><th className="num">Descuento</th><th className="num">Precio final</th></tr></thead>
          <tbody>
            {lineas.map((l, i) => {
              const x = aLinea(l);
              return (
                <tr key={i}>
                  <td>{l.descripcion}</td>
                  <td className="num">{Number(cantidadTexto(x.cantidad)).toLocaleString("es-DO", { maximumFractionDigits: 4 })}</td>
                  <td className="num">{verMonto(l.precio_lista)}</td>
                  <td className="num">{verMonto(l.descuento, true) || "—"}</td>
                  <td className="num">{verMonto(deCentavos(x.precioLista - x.descuento))}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td colSpan={2}>Totales</td><td className="num">{verMonto(t.lista)}</td><td className="num">{verMonto(t.descuento)}</td><td className="num">{verMonto(t.subtotal)}</td></tr>
            <tr><td colSpan={4}>Impuestos</td><td className="num">{verMonto(t.impuestos)}</td></tr>
            <tr><td colSpan={4}><strong>Total</strong></td><td className="num"><strong>{verMonto(t.total)}</strong></td></tr>
          </tfoot>
        </table>
      </div>
      <dl className="cifras-dgii">
        <div><dt>Anticipo</dt><dd>{Number(p.anticipo_pct)} % · RD${verMonto(anticipo)}</dd></div>
        <div><dt>Forma de pago</dt><dd>{p.forma_pago ?? "—"}</dd></div>
        <div><dt>Entrega estimada</dt><dd>{p.entrega ? verFecha(p.entrega) : "—"}</dd></div>
      </dl>
      {p.requisitos && <><h2>Requisitos</h2><p style={{ whiteSpace: "pre-wrap" }}>{p.requisitos}</p></>}
      {p.notas && <p className="sub" style={{ whiteSpace: "pre-wrap" }}>{p.notas}</p>}

      {registra && (
        <div className="tarjeta" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Siguiente paso</h2>
          {abierta && (
            <div className="fila">
              {p.estado === "borrador" && <Formulario accion={cambiarEstadoPropuesta.bind(null, id, pid, "enviada")} boton="Marcar como enviada" className="fila"><span /></Formulario>}
              <Formulario accion={cambiarEstadoPropuesta.bind(null, id, pid, "aceptada")} boton="El cliente la aceptó" className="fila"><span /></Formulario>
              <Formulario accion={cambiarEstadoPropuesta.bind(null, id, pid, "rechazada")} boton="La rechazó" className="fila"><span /></Formulario>
            </div>
          )}
          {p.estado === "aceptada" && !p.factura_id && !p.acuerdo_id && (
            <div className="fila">
              <Formulario accion={propuestaAFactura.bind(null, id, pid)} boton="Convertir en factura (servicio extra)" className="fila"><span /></Formulario>
              <Formulario accion={propuestaAIguala.bind(null, id, pid)} boton="Convertir en iguala" className="fila">
                <label>Inicio del contrato<input type="date" name="inicio" defaultValue={hoy} required /></label>
              </Formulario>
            </div>
          )}
          {p.factura_id && <p>Facturada: <Link href={`/e/${id}/facturas/${p.factura_id}`}>ver la factura</Link>.</p>}
          {p.acuerdo_id && <p>Convertida en iguala: <Link href={`/e/${id}/igualas?editar=${p.acuerdo_id}`}>ver el acuerdo</Link>.</p>}
          {p.estado === "rechazada" && <p className="sub">El cliente la rechazó.</p>}
          {p.estado !== "rechazada" && anticipo > 0n && puede(permisos, "contabilizar") && (
            <p>
              <Link className="boton" href={`/e/${id}/anticipos?propuesta=${pid}&cliente=${p.cliente_id}&monto=${deCentavos(anticipo)}`}>
                Registrar el anticipo de RD${verMonto(anticipo)}
              </Link>
            </p>
          )}
          {deEsta.length > 0 && (
            <p className="sub">Anticipos de esta propuesta: {deEsta.map((a) => `n.º ${a.numero} por RD$${verMonto(a.monto)} (saldo RD$${verMonto(a.saldo)})`).join(" · ")}</p>
          )}
        </div>
      )}
    </>
  );
}
