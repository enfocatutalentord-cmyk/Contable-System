import Link from "next/link";
import { conEmpresa } from "@/lib/db";
import { inicioCliente } from "@/lib/inicio-cliente";
import { nombreMes } from "@/lib/bitacora";
import { aCentavos, hoyISO, verFecha, verMonto } from "@/lib/montos";
import { Instalar } from "./instalar";

const mes = (p: string) => nombreMes(`${p.slice(0, 4)}-${p.slice(4)}`);

// Pantalla de inicio del cliente en la aplicación (bloque 8a): lo suyo del mes, para el celular.
export async function InicioClienteApp({ id, nombre, usuario }: { id: string; nombre: string; usuario: string }) {
  const hoy = hoyISO();
  const base = `/e/${id}`;
  const d = await conEmpresa(id, (tx) => inicioCliente(tx, id, hoy, base));
  const prospecto = d.estado === "prospecto";
  const descargar = (tipo: string, rid: string) => `${base}/mis-documentos/${tipo}/${rid}`;

  return (
    <div className="inicio-cliente">
      <h1>Hola, {usuario.split(" ")[0]}</h1>
      <p className="sub">{nombre} · {verFecha(hoy)}</p>
      <Instalar />
      {!prospecto && <p><Link className="boton primario" href={`${base}/facturas-subidas`}>Subir una factura</Link></p>}

      {prospecto ? (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Bienvenido a Empire</h2>
          <p>Desde aquí puedes pedir servicios, llenar tus formularios y subir tus documentos. Cuando firmes el contrato, en esta misma pantalla verás
            tus impuestos, tu reporte del mes y tu cuenta con Empire.</p>
          <div className="fila">
            <Link className="boton primario" href={`${base}/solicitudes`}>Pedir un servicio</Link>
            <Link className="boton" href={`${base}/recepcion`}>Subir documentos</Link>
          </div>
        </div>
      ) : (
        <div className="cifras">
          <Link href={`${base}/facturas-subidas`} className="tarjeta cifra" style={{ color: "inherit", textDecoration: "none" }}>
            <div className="etiqueta">Facturas subidas en {nombreMes(hoy.slice(0, 7))}</div><div className="valor">{d.facturas.gastos + d.facturas.ingresos}</div>
            <div className="sub">{d.facturas.gastos} de gastos · {d.facturas.ingresos} de ventas{d.facturas.revision > 0 ? ` · ${d.facturas.revision} en revisión` : ""}</div>
          </Link>
          <Link href={`${base}/recepcion`} className="tarjeta cifra" style={{ color: "inherit", textDecoration: "none" }}>
            <div className="etiqueta">Documentos subidos en {nombreMes(hoy.slice(0, 7))}</div><div className="valor">{d.documentosMes}</div>
            {d.porProcesar > 0 && <div className="sub">{d.porProcesar} en revisión</div>}
          </Link>
          <div className="tarjeta cifra">
            <div className="etiqueta">Impuestos por pagar</div>
            <div className="valor">{verMonto(d.impuestos.reduce((s, n) => s + aCentavos(n.monto), 0n))}</div>
            <div className="sub">{d.impuestos.length ? `${d.impuestos.length} pendiente${d.impuestos.length > 1 ? "s" : ""}` : "Nada pendiente"}</div>
          </div>
          {d.cuenta && (
            <div className="tarjeta cifra">
              <div className="etiqueta">Saldo con Empire</div><div className="valor">{verMonto(d.cuenta.saldo)}</div>
            </div>
          )}
        </div>
      )}

      {d.avisos.length > 0 && (
        <div className="tarjeta" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Avisos</h2>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {d.avisos.map((a, i) => <li key={i}>{a.enlace ? <Link href={a.enlace}>{a.texto}</Link> : a.texto}</li>)}
          </ul>
        </div>
      )}

      {!prospecto && (
        <>
          <div className="tarjeta" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>Impuestos a pagar</h2>
            {d.impuestos.length === 0 ? <p className="sub" style={{ margin: 0 }}>No tienes impuestos pendientes de pago.</p> : (
              <div className="tabla-envoltura">
                <table>
                  <thead><tr><th>Qué</th><th className="num">Monto</th><th>Fecha límite</th><th /></tr></thead>
                  <tbody>
                    {d.impuestos.map((n) => (
                      <tr key={n.id}>
                        <td>{n.tipo.toUpperCase()} · {n.concepto ?? mes(n.periodo)}</td>
                        <td className="num">{verMonto(n.monto)}</td>
                        <td className={n.alerta ? "error" : undefined}>{verFecha(n.fecha_limite)}</td>
                        <td>{n.doc && <a href={descargar("notificacion", n.id)}>Ver</a>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="tarjeta" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>Mis reportes</h2>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>{d.reporte ? <a href={descargar("reporte", d.reporte.id)}>Reporte de {mes(d.reporte.periodo)} (PDF)</a> : "El reporte del mes estará aquí cuando Empire lo apruebe."}</li>
              <li>{d.proyeccion ? <a href={descargar("proyeccion", d.proyeccion.id)}>Proyección del cierre fiscal hasta {mes(d.proyeccion.periodo)} (PDF)</a> : "La proyección del IR-2 estará aquí cuando esté lista."}</li>
            </ul>
          </div>

          {d.cuenta && (
            <div className="tarjeta" style={{ marginBottom: 16 }}>
              <h2 style={{ marginTop: 0 }}>Mi cuenta con Empire</h2>
              {d.cuenta.facturas.length === 0 ? <p className="sub" style={{ margin: 0 }}>No tienes facturas pendientes.</p> : (
                <div className="tabla-envoltura">
                  <table>
                    <thead><tr><th>Factura</th><th>Fecha</th><th className="num">Total</th><th className="num">Pendiente</th></tr></thead>
                    <tbody>
                      {d.cuenta.facturas.map((f) => (
                        <tr key={f.ncf}><td>{f.ncf}<br /><span className="sub">{f.detalle}</span></td><td>{verFecha(f.fecha)}</td><td className="num">{verMonto(f.total)}</td><td className="num">{verMonto(f.saldo)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="tarjeta" style={{ marginBottom: 16, opacity: 0.8 }}>
        <h2 style={{ marginTop: 0 }}>Talleres del Laboratorio de Imperios</h2>
        <p className="sub" style={{ margin: 0 }}>Muy pronto podrás ver e inscribirte en los talleres desde aquí.</p>
      </div>
    </div>
  );
}
