import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, accesoFirma, esUuid, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { detalleConteo, ESTADOS_CONTEO, FILTROS_ARTICULOS, LIMITE_ARTICULOS, verCantidad } from "@/lib/inventario";
import { verFecha } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { cambiarEstadoConteoAccion, deshacerLecturaAccion, fijarTotalAccion, registrarLecturaAccion } from "../../../../inventario-acciones";
import { LectorConteo } from "../../lector";

export const metadata = { title: "Conteo de inventario · Empire Tax & Legal" };

const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" });

// Un conteo: el lector, lo contado, los códigos que no estaban en el listado y el listado con su total contado. Mientras el conteo está abierto no se muestra lo que dice el listado
// (conteo a ciegas, para no influir en quien cuenta); al cerrarlo salen la existencia y la diferencia.
export default async function Conteo({ params, searchParams }: {
  params: Promise<{ fid: string; eid: string; cid: string }>; searchParams: Promise<{ creado?: string; q?: string; ver?: string }>;
}) {
  const { fid, eid, cid } = await params;
  const sp = await searchParams;
  if (!esUuid(eid) || !esUuid(cid)) notFound();
  const { usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  const { empresa, permisos } = await accesoEmpresa(eid);
  if (empresa.firma_id !== fid) notFound();
  const c = await conEmpresa(eid, (tx) => detalleConteo(tx, cid, { q: sp.q, ver: sp.ver }));
  if (!c) notFound();

  const cerrado = c.estado === "cerrado";
  const edita = puede(permisos, "registrar") && !cerrado;
  const ver = sp.ver && sp.ver in FILTROS_ARTICULOS ? sp.ver : "todos";
  const base = `/firma/${fid}/inventario/${eid}/${cid}`;
  const enlace = (v: string) => `${base}?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ver: v })}`;

  return (
    <>
      <p><Link href={`/firma/${fid}/inventario`}>← Conteos de inventario</Link></p>
      {sp.creado && (
        <p className="exito">
          Conteo abierto con {sp.creado} artículos.
          {c.con_nombre === 0 && " El listado no trae nombre: solo se verá el código."}
          {c.con_costo === 0 && " El listado no trae costo: el reporte de diferencias saldrá en cantidades, sin pesos."}
          {" "}Empieza a escanear o escribir los códigos.
        </p>
      )}
      <div className="entre">
        <div>
          <h1>{c.nombre}</h1>
          <p className="sub">
            {empresa.nombre} · conteo n.º {c.numero}{c.ubicacion && ` · ${c.ubicacion}`} · {verFecha(c.fecha)} · abierto por {c.creado_por}
            {c.archivo_id && <> · <a href={`/e/${eid}/documentos/${c.archivo_id}`} target="_blank" rel="noreferrer">Excel original</a></>}
          </p>
        </div>
      </div>

      <div className="cifras">
        <div className="tarjeta cifra"><div className="etiqueta">Estado</div><div className="valor" style={{ fontSize: "1.2rem" }}>{ESTADOS_CONTEO[c.estado]}</div>
          {cerrado && c.cerrado_en && <div className="sub">{c.cerrado_por ? `por ${c.cerrado_por} · ` : ""}{fechaHora(c.cerrado_en)}</div>}</div>
        <div className="tarjeta cifra"><div className="etiqueta">Artículos contados</div><div className="valor" style={{ fontSize: "1.2rem" }}>{c.contados} de {c.total_articulos}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Lecturas</div><div className="valor" style={{ fontSize: "1.2rem" }}>{c.lecturas}</div><div className="sub">{verCantidad(c.unidades)} unidades</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Códigos sin listado</div><div className="valor" style={{ fontSize: "1.2rem", color: c.sin_listado.length ? "var(--peligro)" : undefined }}>{c.sin_listado.length}</div></div>
      </div>

      <div className="tarjeta" style={{ marginBottom: 16 }}>
        <div className="fila" style={{ alignItems: "center", gap: 8 }}>
          <strong>Estado del conteo:</strong>
          {!cerrado && puede(permisos, "cerrar") && <Formulario accion={cambiarEstadoConteoAccion.bind(null, fid, eid, cid, "cerrado")} boton="Cerrar el conteo" className="fila"><></></Formulario>}
          {cerrado && puede(permisos, "reabrir") && <Formulario accion={cambiarEstadoConteoAccion.bind(null, fid, eid, cid, "abierto")} boton="Reabrir el conteo" className="fila"><></></Formulario>}
        </div>
        <p className="sub" style={{ marginBottom: 0 }}>
          {cerrado ? "Cerrado, no se cambia nada hasta reabrirlo. Abajo se ve lo que decía el listado y la diferencia."
            : "Mientras está abierto no se muestra lo que dice el listado, para no influir en quien cuenta. Al cerrarlo salen la existencia y la diferencia."}
        </p>
      </div>

      {edita && (
        <section className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Contar</h2>
          <LectorConteo accion={registrarLecturaAccion.bind(null, fid, eid, cid)} />
        </section>
      )}

      {c.sin_listado.length > 0 && (
        <section className="tarjeta" style={{ marginBottom: 16, borderLeft: "4px solid var(--peligro)" }}>
          <h2 style={{ marginTop: 0 }}>Códigos que no están en el listado</h2>
          <p className="sub">Se anotaron pero no existen en el Excel del cliente: pueden ser sobrantes de mercancía que el sistema del cliente no tiene, o un código mal escaneado.</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {c.sin_listado.map((s) => <li key={s.codigo}><strong>{s.codigo}</strong> · {verCantidad(s.cantidad)} unidad{s.cantidad === 10n ** 4n ? "" : "es"} ({s.lecturas} lectura{s.lecturas > 1 ? "s" : ""})</li>)}
          </ul>
        </section>
      )}

      <section className="tarjeta" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Últimas lecturas</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {c.recientes.map((l) => (
            <li key={l.id} className="fila" style={{ alignItems: "center", gap: 8, ...(l.anulada ? { color: "var(--suave)", textDecoration: "line-through" } : {}) }}>
              <span>
                <strong>{l.nombre || l.codigo}</strong> {l.nombre && <span className="sub">({l.codigo})</span>} · {l.cantidad > 0n ? "+" : ""}{verCantidad(l.cantidad)}
                {l.origen === "ajuste" && " (total fijado a mano)"}{l.nota && ` · ${l.nota}`}
                <span className="sub"> · {l.quien}, {fechaHora(l.creado_en)}{l.anulada && " · deshecha"}</span>
              </span>
              {edita && !l.anulada && <Formulario accion={deshacerLecturaAccion.bind(null, fid, eid, cid, l.id)} boton="Deshacer" className="fila boton-chico"><></></Formulario>}
            </li>
          ))}
          {c.recientes.length === 0 && <li className="sub">Todavía no hay lecturas.</li>}
        </ul>
      </section>

      <section>
        <h2>Artículos del listado</h2>
        <form method="get" action={base} className="fila" style={{ alignItems: "flex-end", marginBottom: 8 }}>
          <label style={{ flex: "3 1 240px" }}>Buscar por código, nombre o código de barras<input name="q" defaultValue={sp.q ?? ""} maxLength={60} /></label>
          <label>Mostrar
            <select name="ver" defaultValue={ver}>{Object.entries(FILTROS_ARTICULOS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          </label>
          <button className="boton" type="submit">Buscar</button>
          {(sp.q || ver !== "todos") && <Link className="boton" href={base}>Quitar filtros</Link>}
        </form>
        <p className="sub" style={{ margin: "0 0 6px" }}>
          {Object.entries(FILTROS_ARTICULOS).map(([k, n]) => <span key={k}>{k === "todos" ? "" : " · "}{k === ver ? <strong>{n}</strong> : <Link href={enlace(k)}>{n}</Link>}</span>)}
        </p>
        <div className="tabla-envoltura">
          <table>
            <thead>
              <tr>
                <th>Código</th><th>Nombre</th><th>Unidad</th><th style={{ textAlign: "right" }}>Contado</th>
                {cerrado && <><th style={{ textAlign: "right" }}>Listado</th><th style={{ textAlign: "right" }}>Diferencia</th></>}
                {edita && <th>Fijar el total a mano</th>}
              </tr>
            </thead>
            <tbody>
              {c.articulos.map((a) => {
                const dif = a.contado - a.existencia;
                return (
                  <tr key={a.id}>
                    <td><strong>{a.codigo}</strong>{a.barras && <div className="sub" style={{ margin: 0 }}>barras {a.barras}</div>}</td>
                    <td>{a.nombre || <span className="sub">—</span>}</td>
                    <td>{a.unidad || <span className="sub">—</span>}</td>
                    <td style={{ textAlign: "right" }}>{a.lecturas ? verCantidad(a.contado) : <span className="sub">sin contar</span>}</td>
                    {cerrado && (
                      <>
                        <td style={{ textAlign: "right" }}>{verCantidad(a.existencia)}</td>
                        <td style={{ textAlign: "right", fontWeight: dif === 0n ? undefined : 600, color: dif === 0n ? undefined : dif < 0n ? "var(--peligro)" : "var(--dorado-texto, #8a6424)" }}>
                          {dif === 0n ? "0" : `${dif > 0n ? "+" : ""}${verCantidad(dif)}`}
                        </td>
                      </>
                    )}
                    {edita && (
                      <td>
                        <Formulario accion={fijarTotalAccion.bind(null, fid, eid, cid, a.id)} boton="Fijar" className="fila">
                          <label style={{ width: 120 }}><span className="sub">Total contado</span><input name="total" inputMode="decimal" required defaultValue={a.lecturas ? verCantidad(a.contado).replaceAll(",", "") : ""} /></label>
                          <label style={{ width: 150 }}><span className="sub">Nota</span><input name="nota" maxLength={300} /></label>
                        </Formulario>
                      </td>
                    )}
                  </tr>
                );
              })}
              {c.articulos.length === 0 && <tr><td colSpan={7}>No hay artículos con ese filtro.</td></tr>}
            </tbody>
          </table>
        </div>
        {c.hay_mas && <p className="sub">Se muestran los primeros {LIMITE_ARTICULOS}. Usa la búsqueda para encontrar uno en particular.</p>}
      </section>
    </>
  );
}
