import Link from "next/link";
import { notFound } from "next/navigation";
import { accesoEmpresa, accesoFirma, esUuid, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { verCantidad } from "@/lib/inventario";
import { lineasResumen, ordenarDiferencias, reporteConteo } from "@/lib/inventario-reporte";
import { deCentavos, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";

export const metadata = { title: "Diferencias de inventario · Empire Tax & Legal" };

const EN_PANTALLA = 200;
const pesos = (c: bigint) => `${c < 0n ? "-" : ""}RD$${verMonto(deCentavos(c < 0n ? -c : c))}`;

// Reporte de diferencias de un conteo cerrado (Prioridad 3, P3m): por artículo lo que decía el listado del cliente, lo contado y la diferencia en cantidad y en pesos.
export default async function Reporte({ params }: { params: Promise<{ fid: string; eid: string; cid: string }> }) {
  const { fid, eid, cid } = await params;
  if (!esUuid(eid) || !esUuid(cid)) notFound();
  const { usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  const { empresa, permisos } = await accesoEmpresa(eid);
  if (empresa.firma_id !== fid) notFound();
  const rep = await conEmpresa(eid, (tx) => reporteConteo(tx, cid));
  if (!rep) notFound();
  const volver = <p><Link href={`/firma/${fid}/inventario/${eid}/${cid}`}>← Volver al conteo</Link></p>;
  if ("error" in rep) return <>{volver}<h1>Diferencias de inventario</h1><p className="aviso">{rep.error}</p></>;

  const r = rep.resumen;
  const filas = ordenarDiferencias(rep.filas.filter((f) => f.tipo !== "igual"));
  const base = `/firma/${fid}/inventario/${eid}/${cid}/reporte/archivo`;
  const descarga = puede(permisos, "exportar");
  const color = (t: string) => (t === "faltante" ? "var(--peligro)" : "var(--dorado-texto, #8a6424)");

  return (
    <>
      {volver}
      <div className="entre">
        <div>
          <h1>Diferencias de inventario</h1>
          <p className="sub">{empresa.nombre} · {rep.nombre}{rep.ubicacion && ` · ${rep.ubicacion}`} · conteo n.º {rep.numero} del {verFecha(rep.fecha)}</p>
        </div>
        {descarga && (
          <div className="fila" style={{ gap: 8 }}>
            <a className="boton" href={`${base}?formato=pdf`} target="_blank" rel="noreferrer">PDF</a>
            <a className="boton" href={`${base}?formato=xlsx`}>Excel</a>
            <a className="boton" href={`${base}?formato=xlsx&todos=1`}>Excel con todos los artículos</a>
          </div>
        )}
      </div>

      <div className="cifras">
        <div className="tarjeta cifra"><div className="etiqueta">Con diferencia</div><div className="valor" style={{ fontSize: "1.2rem" }}>{r.faltantes + r.sobrantes} de {r.articulos}</div>
          <div className="sub">{r.faltantes} faltantes · {r.sobrantes} sobrantes</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Unidades</div><div className="valor" style={{ fontSize: "1.2rem" }}>−{verCantidad(r.unidadesFaltantes)} / +{verCantidad(r.unidadesSobrantes)}</div></div>
        {r.conCosto && (
          <>
            <div className="tarjeta cifra"><div className="etiqueta">Faltante valorado</div><div className="valor peligro" style={{ fontSize: "1.2rem" }}>{pesos(-r.valorFaltante)}</div></div>
            <div className="tarjeta cifra"><div className="etiqueta">Sobrante valorado</div><div className="valor" style={{ fontSize: "1.2rem" }}>{pesos(r.valorSobrante)}</div>
              <div className="sub">Neto {pesos(r.valorNeto)}</div></div>
          </>
        )}
      </div>

      <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>{lineasResumen(r).map((l) => <li key={l}>{l}</li>)}</ul>
      {r.sinContar > 0 && <p className="aviso">{r.sinContar} artículo{r.sinContar > 1 ? "s no se contaron" : " no se contó"} (quedan como faltante total). Confirma que no quedó mercancía sin contar.</p>}

      <div className="tabla-envoltura">
        <table>
          <thead>
            <tr>
              <th>Código</th><th>Artículo</th><th style={{ textAlign: "right" }}>Listado</th><th style={{ textAlign: "right" }}>Contado</th><th style={{ textAlign: "right" }}>Diferencia</th>
              {r.conCosto && <><th style={{ textAlign: "right" }}>Costo</th><th style={{ textAlign: "right" }}>Valor</th></>}
            </tr>
          </thead>
          <tbody>
            {filas.slice(0, EN_PANTALLA).map((f) => (
              <tr key={f.codigo}>
                <td><strong>{f.codigo}</strong></td>
                <td>{f.nombre || <span className="sub">—</span>}{f.unidad && <span className="sub"> · {f.unidad}</span>}</td>
                <td style={{ textAlign: "right" }}>{verCantidad(f.existencia)}</td>
                <td style={{ textAlign: "right" }}>{f.lecturas === 0 ? <span className="sub">sin contar</span> : verCantidad(f.contado)}</td>
                <td style={{ textAlign: "right", fontWeight: 600, color: color(f.tipo) }}>{f.diferencia > 0n ? "+" : ""}{verCantidad(f.diferencia)}</td>
                {r.conCosto && (
                  <>
                    <td style={{ textAlign: "right" }}>{f.costo === null ? <span className="sub">—</span> : verMonto(deCentavos(f.costo / 100n))}</td>
                    <td style={{ textAlign: "right", color: color(f.tipo) }}>{f.valor === null ? <span className="sub">sin costo</span> : pesos(f.valor)}</td>
                  </>
                )}
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={7}>No hay diferencias: todo lo contado coincide con el listado.</td></tr>}
          </tbody>
        </table>
      </div>
      {filas.length > EN_PANTALLA && <p className="sub">Se muestran las {EN_PANTALLA} de mayor valor de {filas.length}. El PDF y el Excel traen todas.</p>}

      {rep.sinListado.length > 0 && (
        <section className="tarjeta" style={{ marginTop: 16, borderLeft: "4px solid var(--peligro)" }}>
          <h2 style={{ marginTop: 0 }}>Códigos contados que no están en el listado</h2>
          <p className="sub">Se contaron pero el listado del cliente no los trae: mercancía que su sistema no tiene, o un código mal escaneado. No se valoran.</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {rep.sinListado.map((s) => <li key={s.codigo}><strong>{s.codigo}</strong> · {verCantidad(s.cantidad)} ({s.lecturas} lectura{s.lecturas > 1 ? "s" : ""})</li>)}
          </ul>
        </section>
      )}
    </>
  );
}
