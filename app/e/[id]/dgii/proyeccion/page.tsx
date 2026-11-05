import Link from "next/link";
import { Descargar } from "@/app/descargar";
import { Formulario } from "@/app/formulario";
import { EnviarWhatsApp } from "@/app/whatsapp";
import { accesoEmpresa, soloCliente } from "@/lib/acceso";
import { moverMes, nombreMes } from "@/lib/bitacora";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { mesCorto, proyeccionDe, UMBRALES } from "@/lib/proyeccion";
import { prepararProyeccion } from "../../proyeccion-acciones";

// Proyección de cierre fiscal (bloque 4c, Documento maestro, sección 8): lo acumulado del ejercicio, el resultado proyectado al
// cierre y el ISR estimado, con alertas preventivas. A mitad de año se prepara y se envía al cliente para planificar.
export default async function Proyeccion({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa, permisos, usuario } = await accesoEmpresa(id);
  const hoy = hoyISO();
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes ?? "") ? sp.mes! : moverMes(hoy.slice(0, 7), -1);
  const periodo = mes.replace("-", "");
  const { d, guardada } = await conEmpresa(id, async (tx) => ({
    d: await proyeccionDe(tx, periodo, hoy),
    guardada: (await tx<{ id: string; notas: string | null; preparado_en: Date; quien: string | null }[]>`
      SELECT p.id, p.notas, p.preparado_en, u.nombre AS quien FROM proyecciones_fiscales p LEFT JOIN usuarios u ON u.id = p.preparado_por
       WHERE p.periodo = ${periodo}`)[0],
  }));
  const equipo = !(await soloCliente(empresa.firma_id, usuario.id));
  const m = (x: string | null) => (x === null ? "—" : verMonto(x));

  return (
    <>
      <p><Link href={`/e/${id}/dgii?mes=${mes}`}>← Reportes DGII</Link></p>
      <div className="entre">
        <div>
          <h1>Proyección de cierre fiscal</h1>
          <p className="sub">
            {d.persona === "juridica" ? "IR-2" : "IR-1"} · ejercicio del {verFecha(d.inicio)} al {verFecha(d.fin)}, acumulado a {d.mes}. Es una estimación con lo
            registrado: (utilidad acumulada ÷ meses con datos) × 12.
          </p>
        </div>
        {puede(permisos, "exportar") && <Descargar href={`/e/${id}/exportar/proyeccion?mes=${mes}`} />}
      </div>
      <nav className="fila" style={{ marginBottom: 12, alignItems: "center" }} aria-label="Mes">
        <Link className="boton" href={`/e/${id}/dgii/proyeccion?mes=${moverMes(mes, -1)}`}>← {nombreMes(moverMes(mes, -1))}</Link>
        <strong style={{ textTransform: "capitalize" }}>{nombreMes(mes)}</strong>
        <Link className="boton" href={`/e/${id}/dgii/proyeccion?mes=${moverMes(mes, 1)}`}>{nombreMes(moverMes(mes, 1))} →</Link>
      </nav>

      <div className="cifras">
        <div className="tarjeta cifra"><div className="etiqueta">Utilidad acumulada</div><div className="valor">{m(d.acumulado.utilidad)}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Utilidad proyectada al cierre</div><div className="valor">{m(d.proyectado.utilidad)}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">{d.tasa ? `ISR estimado (${d.tasa} %)` : "ISR estimado"}</div><div className="valor">{d.impuesto === null ? "Falta la escala del IR-1" : m(d.impuesto)}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">ISR estimado a pagar</div><div className="valor">{m(d.aPagar)}</div>
          <div className="sub" style={{ margin: 0 }}>menos RD${verMonto(d.retenciones)} retenidos por sus clientes</div></div>
      </div>

      {d.alertas.length > 0 && (
        <ul className="avisos-dgii">{d.alertas.map((a, i) => <li key={i} className={a.nivel === "urgente" ? "error" : "aviso-texto"}>{a.texto}</li>)}</ul>
      )}

      <div className="tarjeta" style={{ margin: "12px 0" }}>
        <h2 style={{ marginTop: 0 }}>Para el cliente</h2>
        {guardada && <p className="sub">Preparada el {guardada.preparado_en.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" })}{guardada.quien && ` por ${guardada.quien}`}. El PDF que recibe es el de ese momento; prepárala otra vez si cambian las cifras.</p>}
        {puede(permisos, "impuestos") && (
          <Formulario accion={prepararProyeccion.bind(null, id, periodo)} boton={guardada ? "Preparar otra vez" : "Preparar para el cliente"}>
            <textarea name="notas" defaultValue={guardada?.notas ?? ""} rows={3} maxLength={3000} aria-label="Notas para el cliente"
              placeholder="Recomendaciones antes del cierre (por ejemplo, compras de activos o gastos por documentar)" />
          </Formulario>
        )}
        {guardada && equipo && puede(permisos, "exportar") && (
          <div style={{ marginTop: 10 }}><EnviarWhatsApp empresaId={id} clave="proyeccion_ir2" docRef={{ tipo: "proyeccion", id: guardada.id }} /></div>
        )}
      </div>

      <div className="tabla-envoltura" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>Mes</th><th className="num">Ingresos</th><th className="num">Costos</th><th className="num">Gastos</th><th className="num">Utilidad</th></tr></thead>
          <tbody>
            {d.meses.map((x) => <tr key={x.mes}><td>{mesCorto(x.mes)}</td><td className="num">{m(x.ingresos)}</td><td className="num">{m(x.costos)}</td><td className="num">{m(x.gastos)}</td><td className="num">{m(x.utilidad)}</td></tr>)}
          </tbody>
          <tfoot>
            <tr><td>Acumulado ({d.mesesConDatos} meses con datos)</td><td className="num">{m(d.acumulado.ingresos)}</td><td className="num">{m(d.acumulado.costos)}</td><td className="num">{m(d.acumulado.gastos)}</td><td className="num">{m(d.acumulado.utilidad)}</td></tr>
            <tr><td>Proyectado a 12 meses</td><td className="num">{m(d.proyectado.ingresos)}</td><td /><td /><td className="num">{m(d.proyectado.utilidad)}</td></tr>
            {d.anterior !== null && <tr><td>Ejercicio anterior</td><td /><td /><td /><td className="num">{m(d.anterior)}</td></tr>}
          </tfoot>
        </table>
      </div>

      <div className="fila" style={{ alignItems: "flex-start" }}>
        <section className="tarjeta" style={{ flex: "1 1 340px" }}>
          <h2 style={{ marginTop: 0 }}>Costos y gastos por categoría</h2>
          <table><tbody>{d.categorias.map((c) => <tr key={c.codigo}><td>{c.codigo} {c.nombre}</td><td className="num">{m(c.monto)}</td></tr>)}
            {d.categorias.length === 0 && <tr><td className="sub">Sin costos ni gastos en el ejercicio.</td></tr>}</tbody></table>
        </section>
        <section className="tarjeta" style={{ flex: "1 1 340px" }}>
          <h2 style={{ marginTop: 0 }}>Compras con comprobante (606)</h2>
          <table><tbody>{d.comprobantes.map((c) => <tr key={c.tipo}><td>{c.tipo} {c.nombre}</td><td className="num">{m(c.monto)}</td></tr>)}
            {d.comprobantes.length === 0 && <tr><td className="sub">Sin compras registradas en el ejercicio.</td></tr>}
            <tr><td>Gastos registrados sin factura de compra (sin contar nómina, TSS ni depreciación)</td><td className="num">{m(d.sinComprobante)}</td></tr></tbody></table>
        </section>
      </div>
      <p className="sub">
        Alertas con umbrales sugeridos: costos y gastos sobre el {UMBRALES.gastosSobreIngresos} % de los ingresos, gastos sin factura sobre el
        {" "}{UMBRALES.sinComprobante} %, cambio de la utilidad del mes de {UMBRALES.cambioMes} % o más, proyección {UMBRALES.cambioAnual} % distinta del
        ejercicio anterior y revisión {UMBRALES.mesesAntesDelCierre} meses antes del cierre.
      </p>
    </>
  );
}
