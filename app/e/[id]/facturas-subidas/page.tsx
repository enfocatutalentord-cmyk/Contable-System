import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { nombreMes } from "@/lib/bitacora";
import { TIPOS_GASTO } from "@/lib/compras";
import { conEmpresa } from "@/lib/db";
import { contadorMes, ESTADOS_SUBIDA, FORMAS_SUBIDA, listarSubidas } from "@/lib/facturas-subidas";
import { hoyISO, verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { TIPOS_NCF } from "@/lib/validar-fiscal";
import { aprobarSubidaAccion, rechazarSubidaAccion, subirFacturaAccion } from "../facturas-subidas-acciones";
import { SubirFactura } from "./subir";

const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" });
const FILTROS: Record<string, string> = { recibida: "Por revisar", aprobada: "Aprobadas", rechazada: "Rechazadas", desestimada: "Desestimadas", todas: "Todas" };

// Facturas que sube el cliente desde la aplicación (bloque 8b; documento «Sistema Empire · Fase 2», sección 3). El cliente las sube
// y ve su estado («Mis facturas»); el equipo las revisa: aprobar (pasa a borrador de compra o de venta), rechazar o desestimar.
export default async function FacturasSubidas({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ estado?: string; hecho?: string; compra?: string; venta?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { empresa, permisos, paraClientes } = await accesoEmpresa(id);
  const mes = hoyISO().slice(0, 7);
  const filtro = sp.estado && sp.estado in FILTROS ? sp.estado : paraClientes ? "todas" : "recibida";
  const { lista, contador } = await conEmpresa(id, async (tx) => ({
    lista: await listarSubidas(tx, filtro === "todas" ? null : filtro), contador: await contadorMes(tx, mes),
  }));
  const sube = puede(permisos, "adjuntar");
  const revisa = !paraClientes && puede(permisos, "registrar");
  const doc = (did: string) => `/e/${id}/documentos/${did}`;

  const resumen = (
    <div className="cifras">
      <div className="tarjeta cifra"><div className="etiqueta">Gastos subidos en {nombreMes(mes)}</div><div className="valor">{contador.gastos}</div><div className="sub">{contador.gastos_ok} aprobados</div></div>
      <div className="tarjeta cifra"><div className="etiqueta">Ventas subidas en {nombreMes(mes)}</div><div className="valor">{contador.ingresos}</div><div className="sub">{contador.ingresos_ok} aprobadas</div></div>
      <div className="tarjeta cifra"><div className="etiqueta">En revisión</div><div className="valor">{contador.revision}</div></div>
    </div>
  );

  if (paraClientes) {
    return (
      <>
        <h1>Mis facturas</h1>
        <p className="sub">Sube aquí las facturas de tus gastos y de tus ventas. Con la foto basta; si es electrónica, la foto del código QR trae los datos sola.</p>
        {resumen}
        {sube && <div className="tarjeta" style={{ marginBottom: 16 }}><SubirFactura accion={subirFacturaAccion.bind(null, id)} /></div>}
        <h2>Lo que he subido</h2>
        <div className="tabla-envoltura">
          <table>
            <thead><tr><th>N.º</th><th>Subida</th><th>Qué</th><th>NCF</th><th className="num">Total</th><th>Estado</th></tr></thead>
            <tbody>
              {lista.map((f) => (
                <tr key={f.id}>
                  <td>{f.numero}</td>
                  <td>{fechaHora(f.subido_en)}</td>
                  <td>{f.tipo === "gasto" ? "Gasto" : "Venta"}{f.nombre_contraparte ? ` · ${f.nombre_contraparte}` : ""}</td>
                  <td>{f.ncf ?? "—"}</td>
                  <td className="num">{f.total ? verMonto(f.total) : "—"}</td>
                  <td className={f.estado === "rechazada" ? "error" : undefined}>{ESTADOS_SUBIDA[f.estado]}{f.motivo && <><br /><span className="sub">{f.motivo}</span></>}</td>
                </tr>
              ))}
              {lista.length === 0 && <tr><td colSpan={6}>Todavía no has subido facturas.</td></tr>}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Facturas subidas</h1>
      <p className="sub">
        Las facturas de gastos y de ventas que {empresa.nombre} sube desde la aplicación. Se revisan solas al subirlas (RNC, NCF, repetidas, a nombre de
        otra empresa, sin crédito fiscal); aquí se completan, se aprueban (pasan a borrador de compra o de venta), se rechazan para que la suba de nuevo
        o se desestiman. Si el NCF está vencido o fuera de rango lo dice la DGII: este sistema no la consulta.
      </p>
      {sp.hecho === "aprobada" && (
        <p className="exito" role="status">
          Aprobada. {sp.compra ? <>Quedó el borrador de la compra: <Link href={`/e/${id}/compras/${sp.compra}`}>revisarlo y registrarlo</Link>.</>
            : sp.venta ? <>Quedó el borrador de la venta: <Link href={`/e/${id}/facturas/${sp.venta}`}>revisarlo y emitirlo</Link> (conserva su NCF).</> : null}
        </p>
      )}
      {sp.hecho === "rechazada" && <p className="exito" role="status">Rechazada: el cliente ve el motivo y la sube de nuevo.</p>}
      {sp.hecho === "desestimada" && <p className="exito" role="status">Desestimada: queda registrada y no entra.</p>}
      {resumen}
      <nav className="fila" style={{ gap: 8, marginBottom: 12 }}>
        {Object.entries(FILTROS).map(([k, t]) => (
          <Link key={k} className={`boton${k === filtro ? " primario" : ""}`} href={`/e/${id}/facturas-subidas?estado=${k}`}>{t}</Link>
        ))}
      </nav>
      {sube && (
        <details className="tarjeta" style={{ marginBottom: 16 }}>
          <summary>Subir una factura del cliente</summary>
          <div style={{ marginTop: 12 }}><SubirFactura accion={subirFacturaAccion.bind(null, id)} /></div>
        </details>
      )}

      {lista.length === 0 && <p className="sub">No hay facturas en «{FILTROS[filtro]}».</p>}
      {lista.map((f) => (
        <section key={f.id} className="tarjeta" style={{ marginBottom: 12 }}>
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>
            N.º {f.numero} · {f.tipo === "gasto" ? "Gasto" : "Venta"} · {FORMAS_SUBIDA[f.forma]} · {ESTADOS_SUBIDA[f.estado]}
          </h2>
          <p className="sub" style={{ marginTop: 0 }}>
            Subida el {fechaHora(f.subido_en)}{f.subido_por ? ` por ${f.subido_por}` : ""}
            {f.documento && <> · <a href={doc(f.documento)} target="_blank" rel="noreferrer">Ver el archivo</a></>}
            {f.qr_url && <> · <a href={f.qr_url} target="_blank" rel="noreferrer">Consultar el timbre en la DGII</a></>}
            {f.sin_credito && <> · sin crédito fiscal</>}
          </p>
          {f.marcas.length > 0 && (
            <ul style={{ margin: "0 0 8px", paddingLeft: 20 }}>
              {f.marcas.map((m, i) => <li key={i} className={m.nivel === "error" ? "error" : undefined}>{m.texto}</li>)}
            </ul>
          )}
          {f.estado === "recibida" && revisa ? (
            <>
              <Formulario accion={aprobarSubidaAccion.bind(null, id, f.id)} boton="Aprobar">
                <div className="fila">
                  <label style={{ flex: "1 1 150px" }}>{f.tipo === "gasto" ? "RNC del proveedor" : "RNC del cliente"}<input name="rnc" defaultValue={f.rnc_contraparte ?? ""} inputMode="numeric" /></label>
                  <label style={{ flex: "2 1 200px" }}>Nombre<input name="nombre" defaultValue={f.nombre_contraparte ?? ""} maxLength={200} /></label>
                  <label style={{ flex: "1 1 160px" }}>NCF<input name="ncf" defaultValue={f.ncf ?? ""} required /></label>
                  <label>Fecha<input type="date" name="fecha" defaultValue={f.fecha ?? ""} required /></label>
                </div>
                <div className="fila">
                  <label style={{ width: 140 }}>Subtotal<input name="subtotal" inputMode="decimal" defaultValue={f.subtotal ?? ""} required /></label>
                  <label style={{ width: 140 }}>ITBIS<input name="itbis" inputMode="decimal" defaultValue={f.itbis ?? "0.00"} /></label>
                  {f.tipo === "gasto" && <>
                    <label style={{ flex: "2 1 240px" }}>Tipo de gasto del 606
                      <select name="tipo_gasto" defaultValue="02">{Object.entries(TIPOS_GASTO).map(([k, t]) => <option key={k} value={k}>{k} · {t}</option>)}</select>
                    </label>
                    <label>Es
                      <select name="clase" defaultValue="servicio"><option value="servicio">Servicio</option><option value="bien">Bien</option></select>
                    </label>
                  </>}
                </div>
                <p className="sub" style={{ margin: 0 }}>
                  {f.tipo === "gasto" ? "Queda el borrador de la compra (con el proveedor, el NCF y el archivo) para revisarlo y registrarlo en Compras."
                    : "Queda el borrador de la venta con este NCF; al emitirlo no toma número del rango y va al 607."}
                  {f.ncf && TIPOS_NCF[f.ncf.slice(0, 3)] && <> Comprobante {f.ncf.slice(0, 3)}: {TIPOS_NCF[f.ncf.slice(0, 3)].toLowerCase()}.</>}
                </p>
              </Formulario>
              <div className="fila" style={{ marginTop: 8 }}>
                <details style={{ flex: "1 1 260px" }}>
                  <summary>Rechazar (que la suba de nuevo)</summary>
                  <Formulario accion={rechazarSubidaAccion.bind(null, id, f.id, "rechazada")} boton="Rechazar" className="fila">
                    <label style={{ flex: "1 1 220px" }}>Motivo (lo ve el cliente)<input name="motivo" required minLength={3} maxLength={500} placeholder="Ej.: la foto está borrosa" /></label>
                  </Formulario>
                </details>
                <details style={{ flex: "1 1 260px" }}>
                  <summary>Desestimar (no sirve)</summary>
                  <Formulario accion={rechazarSubidaAccion.bind(null, id, f.id, "desestimada")} boton="Desestimar" className="fila">
                    <label style={{ flex: "1 1 220px" }}>Motivo (lo ve el cliente)<input name="motivo" required minLength={3} maxLength={500} placeholder="Ej.: es una cotización, no una factura" /></label>
                  </Formulario>
                </details>
              </div>
            </>
          ) : (
            <p style={{ margin: 0 }}>
              {f.ncf ?? "Sin NCF"} · {f.fecha ? verFecha(f.fecha) : "sin fecha"} · {f.total ? `RD$${verMonto(f.total)}` : "sin monto"}
              {f.nombre_contraparte && ` · ${f.nombre_contraparte}`}
              {f.motivo && <> · <span className="sub">Motivo: {f.motivo}</span></>}
              {f.revisado_por && <span className="sub"> · revisó {f.revisado_por}</span>}
              {f.compra_id && <> · <Link href={`/e/${id}/compras/${f.compra_id}`}>Ver la compra</Link></>}
              {f.factura_id && <> · <Link href={`/e/${id}/facturas/${f.factura_id}`}>Ver la venta</Link></>}
            </p>
          )}
        </section>
      ))}
    </>
  );
}
