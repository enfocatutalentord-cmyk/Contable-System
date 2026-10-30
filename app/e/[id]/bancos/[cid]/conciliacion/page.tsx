import Link from "next/link";
import { notFound } from "next/navigation";
import { Descargar } from "@/app/descargar";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, esUuid } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { reporteConciliacion, type PartidaBanco, type PartidaLibros } from "@/lib/reporte-conciliacion";
import { cerrarMesBanco, reabrirMesBanco } from "../../../bancos-acciones";

export const metadata = { title: "Conciliación del mes · Empire Tax’N Legal" };

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });
const total = (xs: { monto: bigint }[]) => xs.reduce((s, x) => s + x.monto, 0n);

function Libros({ titulo, partidas }: { titulo: string; partidas: PartidaLibros[] }) {
  if (!partidas.length) return null;
  return (
    <>
      <h3>{titulo}</h3>
      <div className="tabla-envoltura" style={{ marginBottom: 12 }}>
        <table>
          <thead><tr><th>Fecha</th><th>Registro</th><th>Referencia</th><th className="num">Monto</th></tr></thead>
          <tbody>
            {partidas.map((p) => (
              <tr key={p.id}><td>{verFecha(p.fecha)}</td><td>{p.documento ?? p.concepto} · asiento {p.numero}</td><td>{p.referencia}</td><td className="num">{verMonto(p.monto)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Banco({ partidas }: { partidas: PartidaBanco[] }) {
  if (!partidas.length) return null;
  return (
    <>
      <h3>En el banco y no en libros al cierre</h3>
      <div className="tabla-envoltura" style={{ marginBottom: 12 }}>
        <table>
          <thead><tr><th>Fecha</th><th>Descripción</th><th>Situación</th><th className="num">Monto</th></tr></thead>
          <tbody>
            {partidas.map((p) => (
              <tr key={p.id}><td>{verFecha(p.fecha)}</td><td>{p.descripcion}{p.referencia && ` · ref. ${p.referencia}`}</td><td>{p.motivo}</td><td className="num">{verMonto(p.monto)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Reporte de conciliación del mes y su cierre: saldo del banco contra saldo en libros, con lo que está en tránsito.
export default async function Conciliacion({ params, searchParams }: {
  params: Promise<{ id: string; cid: string }>;
  searchParams: Promise<{ mes?: string; cerrado?: string; reabierto?: string }>;
}) {
  const { id, cid } = await params;
  const sp = await searchParams;
  if (!esUuid(cid)) notFound();
  const { permisos } = await accesoEmpresa(id);
  const pedido = (sp.mes ?? "").replace("-", "");
  const r = await conEmpresa(id, async (tx) => {
    let periodo = /^\d{4}(0[1-9]|1[0-2])$/.test(pedido) ? pedido : "";
    if (!periodo) {
      const [u] = await tx<{ p: string | null }[]>`SELECT to_char(max(fecha), 'YYYYMM') AS p FROM movimientos_banco WHERE cuenta_bancaria_id = ${cid}`;
      periodo = u?.p ?? hoyISO().slice(0, 7).replace("-", "");
    }
    return reporteConciliacion(tx, cid, periodo).catch(() => null);
  });
  if (!r) notFound();
  const c = r.cuenta;
  const nombreMes = `${MESES[Number(r.periodo.slice(4)) - 1]} de ${r.periodo.slice(0, 4)}`;
  const cambio = r.cierre && r.cierre.huella !== r.huella;
  const usd = c.moneda === "USD" ? "US$ " : "";

  return (
    <>
      <p className="sub" style={{ marginBottom: 4 }}><Link href={`/e/${id}/bancos/${cid}`}>← {c.nombre}</Link></p>
      <div className="entre">
        <div>
          <h1>Conciliación de {nombreMes}</h1>
          <p className="sub">{c.nombre} · {c.banco}{c.numero && ` ****${c.numero}`} · cuenta {c.codigo} · al {verFecha(r.fin)}</p>
        </div>
        {puede(permisos, "exportar") && <Descargar href={`/e/${id}/exportar/conciliacion-banco?cuenta=${cid}&mes=${r.periodo}`} />}
      </div>
      <form className="fila" style={{ marginBottom: 12 }}>
        <label>Mes<input type="month" name="mes" defaultValue={`${r.periodo.slice(0, 4)}-${r.periodo.slice(4)}`} /></label>
        <button>Ver</button>
      </form>
      {sp.cerrado && <p className="exito" role="status">Conciliación de {nombreMes} cerrada.</p>}
      {sp.reabierto && <p className="exito" role="status">Se quitó el cierre de {nombreMes}.</p>}
      {r.cierre && (
        <p className={cambio ? "aviso" : "exito"}>
          {cambio ? "Cambió después del cierre: " : "Cerrada "}
          por {r.cierre.quien} el {fechaHora(r.cierre.cerrado_en)} con saldo del banco {usd}{verMonto(r.cierre.saldo_banco)} y en libros {verMonto(r.cierre.saldo_libros)}.
          {cambio && " Algo de este mes se concilió, desconcilió o registró después. Revísalo y, si está bien, quita el cierre y vuelve a cerrarla."}
        </p>
      )}
      {!r.comparable && (
        <p className="aviso">Esta cuenta es en dólares y los libros están en pesos: revisa las partidas; la diferencia no se calcula y el mes no se cierra aquí.</p>
      )}

      <div className="tarjeta" style={{ marginBottom: 20 }}>
        <div className="tabla-envoltura">
          <table className="resumen-conciliacion">
            <tbody>
              <tr><td>Saldo según el banco al {verFecha(r.fin)}</td><td className="num">{usd}{verMonto(r.saldoBanco)}</td></tr>
              <tr><td>(+) Depósitos en tránsito: en libros, aún no en el banco ({r.depositosTransito.length})</td><td className="num">{verMonto(total(r.depositosTransito))}</td></tr>
              <tr><td>(−) Cheques y pagos en tránsito ({r.pagosTransito.length})</td><td className="num">{verMonto(-total(r.pagosTransito))}</td></tr>
              <tr className="total"><td>Saldo del banco ajustado</td><td className="num">{verMonto(r.bancoAjustado)}</td></tr>
              <tr><td>Saldo en libros al {verFecha(r.fin)}{c.moneda === "USD" && " (RD$)"}</td><td className="num">{verMonto(r.saldoLibros)}</td></tr>
              <tr><td>(±) En el banco y no en libros ({r.bancoNoLibros.length})</td><td className="num">{verMonto(total(r.bancoNoLibros))}</td></tr>
              {r.apertura.diferencia !== 0n && (
                <tr><td>(±) Diferencia al empezar a conciliar el {verFecha(c.fecha_inicial)}: libros {verMonto(r.apertura.libros)} y banco {verMonto(r.apertura.banco)}</td><td className="num">{verMonto(-r.apertura.diferencia)}</td></tr>
              )}
              <tr className="total"><td>Saldo en libros ajustado</td><td className="num">{verMonto(r.librosAjustado)}</td></tr>
              {r.comparable && (
                <tr className="total"><td>Diferencia</td><td className="num" style={{ color: r.diferencia === 0n ? "var(--ok)" : "var(--peligro)" }}>{verMonto(r.diferencia)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {r.pendientesMes > 0 && (
          <p className="aviso" style={{ marginTop: 12 }}>
            Hay {r.pendientesMes} movimiento{r.pendientesMes > 1 ? "s" : ""} del banco por conciliar hasta el {verFecha(r.fin)}. <Link href={`/e/${id}/bancos/${cid}`}>Concílialos</Link> para cerrar el mes.
          </p>
        )}
        {r.comparable && !r.cierre && puede(permisos, "cerrar") && r.pendientesMes === 0 && r.diferencia === 0n && (
          <div style={{ marginTop: 12 }}><Formulario accion={cerrarMesBanco.bind(null, id, cid, r.periodo)} boton={`Cerrar la conciliación de ${nombreMes}`} className="fila"><span /></Formulario></div>
        )}
        {r.cierre && puede(permisos, "reabrir") && (
          <div style={{ marginTop: 12 }}><Formulario accion={reabrirMesBanco.bind(null, id, cid, r.periodo)} boton="Quitar el cierre" className="fila"><span /></Formulario></div>
        )}
      </div>

      <Libros titulo="Depósitos en tránsito" partidas={r.depositosTransito} />
      <Libros titulo="Cheques y pagos en tránsito" partidas={r.pagosTransito} />
      <Banco partidas={r.bancoNoLibros} />
    </>
  );
}
