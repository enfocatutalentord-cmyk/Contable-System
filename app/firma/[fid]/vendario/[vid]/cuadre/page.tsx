import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoFirma, esUuid, soloCliente } from "@/lib/acceso";
import { db } from "@/lib/db";
import { hoyISO, verMonto } from "@/lib/montos";
import { NOMBRE_EVENTO } from "@/lib/vendario-contable";
import type { Comparacion, Fila } from "@/lib/vendario-cuadre";
import { cuadrarMes } from "../../../../vendario-acciones";

export const metadata = { title: "Cuadre con Vendario · Empire Tax & Legal" };

const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo" });

// Cuadre mensual con Vendario (acuerdo, sección 10): lo que Vendario dice que mandó contra lo que llegó a Empire.
export default async function CuadreVendario({ params, searchParams }: {
  params: Promise<{ fid: string; vid: string }>; searchParams: Promise<{ mes?: string }>;
}) {
  const { fid, vid } = await params;
  const sp = await searchParams;
  if (!esUuid(vid)) notFound();
  const { usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  const [c] = await db()<{ nombre: string | null; rnc: string | null }[]>`
    SELECT coalesce(empresa_datos->>'trade_name', empresa_datos->>'legal_name') AS nombre, rnc FROM vendario_clientes WHERE id = ${vid} AND firma_id = ${fid}`;
  if (!c) notFound();
  const hoy = hoyISO();
  const anterior = (() => { const m = Number(hoy.slice(5, 7)); return m === 1 ? `${Number(hoy.slice(0, 4)) - 1}-12` : `${hoy.slice(0, 4)}-${String(m - 1).padStart(2, "0")}`; })();
  const mes = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : anterior;
  const historial = await db()<{ id: string; mes: string; cuadra: boolean | null; error: string | null; consultado_en: Date; quien: string | null; comparacion: Comparacion | null }[]>`
    SELECT q.id, to_char(q.desde, 'YYYY-MM') AS mes, q.cuadra, q.error, q.consultado_en, u.nombre AS quien, q.comparacion
      FROM vendario_cuadres q LEFT JOIN usuarios u ON u.id = q.consultado_por
     WHERE q.vendario_cliente_id = ${vid} ORDER BY q.consultado_en DESC LIMIT 24`;
  const ultimo = historial.find((h) => h.mes === mes) ?? null;
  const q = ultimo?.comparacion ?? null;
  const tabla = (filas: Fila[], titulo: string, cols: [string, string], nombre: (k: string) => string) => (
    <div className="tabla-envoltura">
      <table>
        <thead><tr><th>{titulo}</th><th>{cols[0]} según Vendario</th><th>{cols[0]} en Empire</th><th>{cols[1]} según Vendario</th><th>{cols[1]} en Empire</th></tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave} style={f.igual ? undefined : { color: "var(--peligro)", fontWeight: 600 }}>
              <td>{nombre(f.clave)}</td>
              <td>{cols[0] === "Cantidad" ? f.vendario[0] : verMonto(f.vendario[0])}</td><td>{cols[0] === "Cantidad" ? f.empire[0] : verMonto(f.empire[0])}</td>
              <td>{verMonto(f.vendario[1])}</td><td>{verMonto(f.empire[1])}</td>
            </tr>
          ))}
          {filas.length === 0 && <tr><td colSpan={5}>Sin movimientos en el mes.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <p><Link href={`/firma/${fid}/vendario/${vid}`}>← {c.nombre ?? "Cliente de Vendario"}</Link></p>
      <h1>Cuadre con Vendario</h1>
      <p className="sub">
        Se le pregunta a Vendario qué operaciones tiene del mes (por tipo, por cuenta y una por una) y se compara con lo que llegó a Empire.
        Si falta algo, se le pide a Vendario que lo reenvíe desde su panel.
      </p>
      {!c.rnc && <p className="aviso">Este cliente llegó sin RNC: Vendario busca el cuadre por RNC y no lo va a encontrar.</p>}
      <Formulario accion={cuadrarMes.bind(null, fid, vid)} boton="Consultar a Vendario" className="fila">
        <label>Mes<input type="month" name="mes" defaultValue={mes} required /></label>
      </Formulario>

      {!ultimo && <p className="sub">Todavía no se ha consultado el cuadre de {mes}.</p>}
      {ultimo?.error && <p className="aviso">La consulta del {fechaHora(ultimo.consultado_en)} no salió: {ultimo.error}</p>}
      {q && (
        <>
          <p className={q.cuadra ? "exito" : "aviso"}>
            {q.cuadra ? `Cuadra: Empire tiene todo lo que Vendario registró en ${mes}.` : `No cuadra en ${mes}: revisa lo marcado en rojo.`}
            {" "}Consultado el {fechaHora(ultimo!.consultado_en)}{ultimo!.quien && ` por ${ultimo!.quien}`}.
          </p>
          {q.faltan.length > 0 && (
            <div className="tarjeta" style={{ margin: "12px 0" }}>
              <h2 style={{ marginTop: 0 }}>Vendario los tiene y no llegaron a Empire ({q.faltan.length})</h2>
              <p className="sub" style={{ marginTop: 0 }}>Pídele a Vendario que reenvíe estos eventos (los identificadores son los de su bandeja).</p>
              <ul>{q.faltan.slice(0, 100).map((id) => <li key={id}><code>{id}</code></li>)}</ul>
            </div>
          )}
          {q.sobran.length > 0 && (
            <div className="tarjeta" style={{ margin: "12px 0" }}>
              <h2 style={{ marginTop: 0 }}>Llegaron a Empire y Vendario no los cuenta ({q.sobran.length})</h2>
              <p className="sub" style={{ marginTop: 0 }}>Puede ser un evento de otro mes en Vendario o uno que Vendario descartó. Revísalos en la lista de eventos.</p>
              <ul>{q.sobran.slice(0, 100).map((id) => <li key={id}><code>{id}</code></li>)}</ul>
            </div>
          )}
          <h2>Por tipo de operación</h2>
          {tabla(q.eventos, "Operación", ["Cantidad", "Total"], (k) => NOMBRE_EVENTO[k] ?? k)}
          <h2>Por cuenta</h2>
          {tabla(q.cuentas, "Cuenta de Vendario", ["Débitos", "Créditos"], (k) => k)}
        </>
      )}

      {historial.length > 0 && (
        <>
          <h2>Consultas anteriores</h2>
          <div className="tabla-envoltura">
            <table>
              <thead><tr><th>Mes</th><th>Cuándo</th><th>Quién</th><th>Resultado</th></tr></thead>
              <tbody>
                {historial.map((h) => (
                  <tr key={h.id}>
                    <td><Link href={`/firma/${fid}/vendario/${vid}/cuadre?mes=${h.mes}`}>{h.mes}</Link></td><td>{fechaHora(h.consultado_en)}</td>
                    <td>{h.quien ?? "—"}</td><td>{h.error ? "No salió" : h.cuadra ? "Cuadra" : "No cuadra"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
