import Link from "next/link";
import { Descargar } from "@/app/descargar";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { CODIGOS_606, TIPOS_INGRESO } from "@/lib/fiscal";
import { FORMAS_PAGO, TIPOS_GASTO } from "@/lib/compras";
import { conEmpresa } from "@/lib/db";
import {
  armarFormato, FORMATOS, periodoAnterior, periodoDe, type Armado, type Detalle606, type Detalle607, type Detalle608, type Formato,
} from "@/lib/formatos-dgii";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { MOTIVOS_608 } from "@/lib/ventas";
import { marcarEnviado, quitarEnvio } from "../dgii-acciones";

type Envio = { formato: Formato; en_cero: boolean; referencia: string | null; huella: string; registros: number; enviado_en: Date; quien: string | null };

const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" });
const dgiiAFecha = (f: string) => (f ? `${f.slice(6, 8)}/${f.slice(4, 6)}/${f.slice(0, 4)}` : "");
const m = (c: bigint) => verMonto((Number(c) / 100).toFixed(2));
const suma = <T,>(xs: T[], f: (x: T) => bigint) => xs.reduce((s, x) => s + f(x), 0n);

export default async function ReportesDgii({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mes?: string }>;
}) {
  const { id } = await params;
  const { mes } = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const hoy = hoyISO();
  const p = periodoDe((mes ?? "").replace("-", "")) ?? periodoDe(periodoAnterior(hoy))!;
  const { armados, envios } = await conEmpresa(id, async (tx) => ({
    armados: [await armarFormato(tx, "606", p), await armarFormato(tx, "607", p), await armarFormato(tx, "608", p)],
    envios: await tx<Envio[]>`
      SELECT e.formato, e.en_cero, e.referencia, e.huella, e.registros, e.enviado_en, u.nombre AS quien
        FROM envios_dgii e LEFT JOIN usuarios u ON u.id = e.enviado_por WHERE e.periodo = ${p.periodo}`,
  }));
  const vencido = hoy > p.vence;
  const puedeMarcar = puede(permisos, "impuestos");
  const mesTexto = new Date(`${p.inicio}T12:00:00Z`).toLocaleDateString("es-DO", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <div className="entre">
        <div>
          <h1>Reportes DGII</h1>
          <p className="sub">
            Formatos de envío de datos 606, 607 y 608 (Norma General 07-2018), armados con lo registrado. Se envían por la Oficina
            Virtual a más tardar el día 15 del mes siguiente, aunque no haya operaciones («Declaraciones en cero»).
          </p>
        </div>
      </div>
      <form className="fila" style={{ marginBottom: 12 }}>
        <label>Mes que se reporta<input type="month" name="mes" defaultValue={`${p.periodo.slice(0, 4)}-${p.periodo.slice(4)}`} /></label>
        <button>Ver</button>
        <p className={vencido && envios.length < 3 ? "error" : "sub"} style={{ margin: 0, alignSelf: "center" }}>
          {mesTexto} · período {p.periodo} · vence el {verFecha(p.vence)}
        </p>
      </form>

      {armados.map((a) => (
        <Seccion key={a.formato} id={id} a={a} periodo={p.periodo} envio={envios.find((e) => e.formato === a.formato)} puedeMarcar={puedeMarcar} />
      ))}

      <section className="tarjeta" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Cómo enviarlos</h2>
        <ol className="pasos">
          <li>Revisa que ningún formato tenga errores (en rojo). Cada error lleva al documento que hay que corregir.</li>
          <li>Descarga el Excel: trae las columnas en el mismo orden que la herramienta de la DGII («Herramienta de Envío Formato 606/607/608»).</li>
          <li>En la herramienta de la DGII completa el encabezado (RNC, período {p.periodo} y cantidad de registros), pulsa «Inicio», pega las filas, pulsa «Validar» y luego «Generar Archivo».</li>
          <li>Prevalida el TXT con la herramienta de prevalidación y envíalo en la Oficina Virtual › Formatos de Envíos › Enviar Archivos. En el 607 completa también el «Resumen General de Facturas de Consumo».</li>
          <li>Vuelve aquí y marca el formato como enviado con la referencia que te da la Oficina Virtual.</li>
        </ol>
      </section>
    </>
  );
}

function Seccion({ id, a, periodo, envio, puedeMarcar }: { id: string; a: Armado; periodo: string; envio?: Envio; puedeMarcar: boolean }) {
  const errores = a.avisos.filter((x) => x.nivel === "error");
  const avisos = a.avisos.filter((x) => x.nivel === "aviso");
  const cambio = envio && envio.huella !== a.huella;
  const sinDatos = a.filas.length === 0 && !(a.consumo && a.consumo.cantidad > 0);
  return (
    <section className="tarjeta formato-dgii" id={`f${a.formato}`}>
      <div className="entre">
        <h2 style={{ margin: 0 }}>{a.formato} · {FORMATOS[a.formato]}</h2>
        <span className={`estado-envio ${envio ? (cambio ? "cambio" : "enviado") : errores.length ? "con-errores" : "listo"}`}>
          {envio ? (cambio ? "Cambió después del envío" : envio.en_cero ? "Enviado en cero" : "Enviado") : errores.length ? `${errores.length} por corregir` : sinDatos ? "Se envía en cero" : "Listo para enviar"}
        </span>
      </div>
      <Resumen a={a} />
      {errores.length > 0 && (
        <ul className="avisos-dgii">
          {errores.map((x, i) => <li key={i} className="error">{x.texto}{x.enlace && <> <Link href={`/e/${id}${x.enlace}`}>Corregir →</Link></>}</li>)}
        </ul>
      )}
      {avisos.length > 0 && (
        <ul className="avisos-dgii">
          {avisos.map((x, i) => <li key={i} className="aviso-texto">{x.texto}{x.enlace && <> <Link href={`/e/${id}${x.enlace}`}>Ver →</Link></>}</li>)}
        </ul>
      )}
      <div className="fila" style={{ alignItems: "center", marginTop: 8 }}>
        {!sinDatos && <Descargar href={`/e/${id}/exportar/dgii-${a.formato}?periodo=${periodo}`} />}
        {sinDatos && <p className="sub" style={{ margin: 0 }}>Sin operaciones este mes: se envía en cero (Oficina Virtual › Declaraciones Juradas › Declaraciones en Cero).</p>}
      </div>
      {envio ? (
        <div style={{ marginTop: 10 }}>
          <p className="sub" style={{ margin: 0 }}>
            Marcado como enviado el {fechaHora(envio.enviado_en)} por {envio.quien ?? "—"} · {envio.registros} registros
            {envio.referencia && <> · referencia {envio.referencia}</>}
          </p>
          {cambio && <p className="error">Después del envío cambió algo de este mes. Si corresponde, corrige en la Oficina Virtual y reenvía; luego quita la marca y vuelve a marcarlo.</p>}
          {puedeMarcar && <Formulario accion={quitarEnvio.bind(null, id, a.formato, periodo)} boton="Quitar marca de enviado" className="fila"><span /></Formulario>}
        </div>
      ) : puedeMarcar && errores.length === 0 && (
        <Formulario accion={marcarEnviado.bind(null, id, a.formato, periodo)} boton={sinDatos ? "Marcar enviado en cero" : "Marcar como enviado"} className="fila">
          <label style={{ flex: "1 1 260px" }}>Referencia de la Oficina Virtual (opcional)<input name="referencia" maxLength={60} /></label>
        </Formulario>
      )}
      {a.detalle.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary>{a.detalle.length === 1 ? "Ver el registro" : `Ver los ${a.detalle.length} registros`}</summary>
          <Detalle id={id} a={a} />
        </details>
      )}
    </section>
  );
}

function Resumen({ a }: { a: Armado }) {
  if (a.formato === "606") {
    const d = a.detalle as Detalle606[];
    return (
      <dl className="cifras-dgii">
        <div><dt>Registros</dt><dd>{d.length}</dd></div>
        <div><dt>Total facturado</dt><dd>{m(suma(d, (x) => x.totalFacturado))}</dd></div>
        <div><dt>ITBIS facturado</dt><dd>{m(suma(d, (x) => x.itbisFacturado))}</dd></div>
        <div><dt>ITBIS por adelantar</dt><dd>{m(suma(d, (x) => x.itbisAdelantar))}</dd></div>
        <div><dt>ITBIS retenido</dt><dd>{m(suma(d, (x) => x.itbisRetenido))}</dd></div>
        <div><dt>ISR retenido</dt><dd>{m(suma(d, (x) => x.retencionRenta))}</dd></div>
      </dl>
    );
  }
  if (a.formato === "607") {
    const d = a.detalle as Detalle607[];
    const c = a.consumo!;
    return (
      <>
        <dl className="cifras-dgii">
          <div><dt>Registros</dt><dd>{d.length}</dd></div>
          <div><dt>Monto facturado</dt><dd>{m(suma(d, (x) => x.montoFacturado))}</dd></div>
          <div><dt>ITBIS facturado</dt><dd>{m(suma(d, (x) => x.itbisFacturado))}</dd></div>
          <div><dt>ITBIS retenido por terceros</dt><dd>{m(suma(d, (x) => x.itbisRetenido))}</dd></div>
          <div><dt>ISR retenido por terceros</dt><dd>{m(suma(d, (x) => x.retencionRenta))}</dd></div>
        </dl>
        <p className="sub" style={{ margin: "6px 0 0" }}>
          <b>Resumen General de Facturas de Consumo</b> (B02 menores de RD$250,000, se escriben en la Oficina Virtual al enviar el 607):{" "}
          {c.cantidad} facturas · monto facturado {m(c.montoFacturado)} · ITBIS {m(c.itbis)} · total {m(c.total)}
          {c.cantidad > 0 && <> · efectivo {m(c.efectivo)} · cheque/transferencia {m(c.cheque)} · tarjeta {m(c.tarjeta)} · crédito {m(c.credito)}</>}
        </p>
      </>
    );
  }
  return <dl className="cifras-dgii"><div><dt>Comprobantes anulados</dt><dd>{a.detalle.length}</dd></div></dl>;
}

function Detalle({ id, a }: { id: string; a: Armado }) {
  if (a.formato === "606") {
    return (
      <div className="tabla-envoltura"><table>
        <thead><tr><th>NCF</th><th>Proveedor</th><th>Fecha</th><th>Tipo de gasto</th><th className="num">Facturado</th><th className="num">ITBIS</th><th className="num">ITBIS retenido</th><th className="num">ISR retenido</th><th>Forma de pago</th></tr></thead>
        <tbody>{(a.detalle as Detalle606[]).map((f) => (
          <tr key={`${f.id}${f.reenvio}`}>
            <td><Link href={`/e/${id}/compras/${f.id}`}>{f.ncf}</Link>{f.reenvio && " (reenvío)"}</td><td>{f.proveedor}</td><td>{dgiiAFecha(f.fechaComprobante)}</td>
            <td>{f.tipoBienes} · {TIPOS_GASTO[f.tipoBienes] ?? ""}</td><td className="num">{m(f.totalFacturado)}</td><td className="num">{m(f.itbisFacturado)}</td>
            <td className="num">{m(f.itbisRetenido)}</td><td className="num">{m(f.retencionRenta)}{f.tipoRetencionIsr && ` (${CODIGOS_606[Number(f.tipoRetencionIsr)] ?? f.tipoRetencionIsr})`}</td>
            <td>{FORMAS_PAGO[f.formaPago] ?? f.formaPago}</td>
          </tr>))}</tbody>
      </table></div>
    );
  }
  if (a.formato === "607") {
    return (
      <div className="tabla-envoltura"><table>
        <thead><tr><th>NCF</th><th>Cliente</th><th>Fecha</th><th>Tipo de ingreso</th><th className="num">Monto facturado</th><th className="num">ITBIS</th><th className="num">ITBIS retenido</th><th className="num">ISR retenido</th></tr></thead>
        <tbody>{(a.detalle as Detalle607[]).map((f) => (
          <tr key={`${f.id}${f.reenvio}`}>
            <td><Link href={`/e/${id}/facturas/${f.id}`}>{f.ncf}</Link>{f.reenvio && " (reenvío)"}</td><td>{f.cliente}</td><td>{dgiiAFecha(f.fechaComprobante)}</td>
            <td>{TIPOS_INGRESO[f.tipoIngreso] ?? f.tipoIngreso}</td><td className="num">{m(f.montoFacturado)}</td><td className="num">{m(f.itbisFacturado)}</td>
            <td className="num">{m(f.itbisRetenido)}</td><td className="num">{m(f.retencionRenta)}</td>
          </tr>))}</tbody>
      </table></div>
    );
  }
  return (
    <div className="tabla-envoltura"><table>
      <thead><tr><th>NCF</th><th>Cliente o proveedor</th><th>Fecha del comprobante</th><th>Tipo de anulación</th></tr></thead>
      <tbody>{(a.detalle as Detalle608[]).map((f) => (
        <tr key={f.id}>
          <td><Link href={`/e/${id}/${f.origen === "factura" ? "facturas" : "compras"}/${f.id}`}>{f.ncf}</Link></td><td>{f.detalle}</td>
          <td>{dgiiAFecha(f.fechaComprobante)}</td><td>{f.tipoAnulacion ? `${f.tipoAnulacion} · ${MOTIVOS_608[f.tipoAnulacion]}` : "—"}</td>
        </tr>))}</tbody>
    </table></div>
  );
}
