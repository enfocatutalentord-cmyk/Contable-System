import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, esUuid } from "@/lib/acceso";
import { NOMBRE_TIPO } from "@/lib/archivos-banco";
import { cuentaBancaria, listarImportaciones, listarMovimientos } from "@/lib/bancos";
import { conEmpresa } from "@/lib/db";
import { verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";
import { deshacer, guardarCuentaBancaria, subirEstadoCuenta } from "../../bancos-acciones";

export const metadata = { title: "Cuenta bancaria · Empire Tax’N Legal" };

const ESTADOS: Record<string, string> = { pendiente: "Por conciliar", conciliado: "Conciliado", excluido: "Excluido" };
const FILTROS: Record<string, string> = { pendiente: "Por conciliar", todos: "Todos" };
const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "medium", timeStyle: "short" });

export default async function CuentaBanco({ params, searchParams }: {
  params: Promise<{ id: string; cid: string }>;
  searchParams: Promise<{ estado?: string; importados?: string; repetidos?: string; deshecha?: string }>;
}) {
  const { id, cid } = await params;
  const sp = await searchParams;
  if (!esUuid(cid)) notFound();
  const { permisos } = await accesoEmpresa(id);
  const filtro = FILTROS[sp.estado ?? ""] ? sp.estado! : "pendiente";
  const datos = await conEmpresa(id, async (tx) => {
    const c = await cuentaBancaria(tx, cid).catch(() => null);
    if (!c) return null;
    return { c, movimientos: await listarMovimientos(tx, cid, { estado: filtro === "todos" ? null : filtro, desde: null, hasta: null }), importaciones: await listarImportaciones(tx, cid) };
  });
  if (!datos) notFound();
  const { c, movimientos, importaciones } = datos;
  const registra = puede(permisos, "registrar");
  const configura = puede(permisos, "catalogo");
  const usd = c.moneda === "USD" ? "US$ " : "";

  return (
    <>
      <p className="sub" style={{ marginBottom: 4 }}><Link href={`/e/${id}/bancos`}>← Bancos</Link></p>
      <h1>{c.nombre}</h1>
      <p className="sub">{c.banco}{c.numero && ` · ****${c.numero}`} · {c.moneda} · cuenta contable {c.codigo} {c.cuenta} · se concilia desde el {verFecha(c.fecha_inicial)}</p>
      {sp.importados && (
        <p className="exito" role="status">
          Se importaron {sp.importados} movimiento{sp.importados === "1" ? "" : "s"}{sp.repetidos && sp.repetidos !== "0" ? ` (${sp.repetidos} ya estaban y no se repitieron)` : ""}.
        </p>
      )}

      {sp.deshecha && <p className="exito" role="status">Importación deshecha: se quitaron sus movimientos.</p>}
      <div className="cifras">
        <div className="tarjeta cifra"><div className="etiqueta">Saldo según banco</div><div className="valor">{usd}{verMonto(c.saldo_banco)}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Saldo en libros{c.moneda === "USD" && " (RD$)"}</div><div className="valor">{verMonto(c.saldo_libros)}</div></div>
        <div className="tarjeta cifra"><div className="etiqueta">Por conciliar</div><div className="valor">{c.pendientes}</div></div>
      </div>

      {registra && c.activa && (
        <div className="tarjeta" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>Importar estado de cuenta</h2>
          <Formulario accion={subirEstadoCuenta.bind(null, id, cid)} boton="Subir y ver la vista previa" className="fila">
            <label style={{ flex: "2 1 320px" }}>Archivo del banco (Excel .xlsx, CSV u OFX, hasta 4 MB)
              <input type="file" name="archivo" required accept=".xlsx,.csv,.txt,.ofx,.qfx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
            </label>
          </Formulario>
          <p className="sub" style={{ marginBottom: 0 }}>
            {c.formato ? "Se usará el mismo formato de la última vez; puedes cambiarlo en la vista previa." : "La primera vez se indica qué columna es cada dato; queda guardado para esta cuenta."}
          </p>
        </div>
      )}

      <div className="entre">
        <h2>Movimientos del banco</h2>
        <nav className="fila" aria-label="Filtro">
          {Object.entries(FILTROS).map(([k, v]) => (
            <Link key={k} className={`boton${k === filtro ? " primario" : ""}`} href={`/e/${id}/bancos/${cid}?estado=${k}`}>{v}</Link>
          ))}
        </nav>
      </div>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Fecha</th><th>Descripción</th><th>Referencia</th><th className="num">Entra</th><th className="num">Sale</th><th className="num">Saldo del banco</th><th>Estado</th></tr></thead>
          <tbody>
            {movimientos.map((m) => (
              <tr key={m.id}>
                <td>{verFecha(m.fecha)}</td>
                <td>{m.descripcion}</td>
                <td>{m.referencia}</td>
                <td className="num">{Number(m.monto) > 0 ? verMonto(m.monto) : ""}</td>
                <td className="num">{Number(m.monto) < 0 ? verMonto(m.monto.slice(1)) : ""}</td>
                <td className="num">{verMonto(m.saldo)}</td>
                <td>{ESTADOS[m.estado]}</td>
              </tr>
            ))}
            {movimientos.length === 0 && <tr><td colSpan={7}>{filtro === "pendiente" ? "No hay movimientos por conciliar." : "Todavía no hay movimientos importados."}</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Archivos importados</h2>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Archivo</th><th>Período</th><th className="num">Nuevos</th><th className="num">Ya estaban</th><th>Quién</th><th>Estado</th>{registra && <th />}</tr></thead>
          <tbody>
            {importaciones.map((i) => (
              <tr key={i.id} className={i.estado === "deshecha" ? "anulado" : undefined}>
                <td>{i.nombre}<div className="sub" style={{ margin: 0 }}>{NOMBRE_TIPO[i.tipo]}{i.recepcion_id && " · enviado por el cliente"}</div></td>
                <td>{i.desde ? `${verFecha(i.desde)} al ${verFecha(i.hasta)}` : ""}</td>
                <td className="num">{i.nuevos ?? ""}</td>
                <td className="num">{i.repetidos ?? ""}</td>
                <td>{i.quien}<div className="sub" style={{ margin: 0 }}>{fechaHora(i.importado_en ?? i.creado)}</div></td>
                <td>{i.estado === "borrador" ? "Sin terminar" : i.estado === "importada" ? "Importado" : "Deshecho"}</td>
                {registra && (
                  <td>
                    {i.estado === "borrador" && <Link className="boton" href={`/e/${id}/bancos/${cid}/importar/${i.id}`}>Seguir</Link>}
                    {i.estado === "importada" && i.conciliados === 0 && (
                      <Formulario accion={deshacer.bind(null, id, i.id)} boton="Deshacer importación" className="fila"><span /></Formulario>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {importaciones.length === 0 && <tr><td colSpan={registra ? 7 : 6}>Todavía no se ha importado ningún archivo.</td></tr>}
          </tbody>
        </table>
      </div>

      {configura && (
        <details className="tarjeta" style={{ marginTop: 20 }}>
          <summary><strong>Datos de la cuenta</strong></summary>
          <Formulario accion={guardarCuentaBancaria.bind(null, id, cid)} boton="Guardar" className="fila">
            <label style={{ flex: "1 1 180px" }}>Banco<input name="banco" required maxLength={80} defaultValue={c.banco} /></label>
            <label style={{ flex: "1 1 180px" }}>Nombre<input name="nombre" required maxLength={80} defaultValue={c.nombre} /></label>
            <label style={{ flex: "0 1 120px" }}>Últimos 4 dígitos<input name="numero" inputMode="numeric" pattern="\d{4}" maxLength={4} defaultValue={c.numero ?? ""} /></label>
            <input type="hidden" name="moneda" value={c.moneda} />
            <label style={{ flex: "0 1 170px" }}>Conciliar desde<input type="date" name="fecha_inicial" required defaultValue={c.fecha_inicial} /></label>
            <label style={{ flex: "0 1 170px" }}>Saldo del banco ese día<input name="saldo_inicial" inputMode="decimal" required defaultValue={c.saldo_inicial} /></label>
            <label className="casilla" style={{ flex: "0 1 140px" }}><input type="checkbox" name="activa" defaultChecked={c.activa} /> Activa</label>
          </Formulario>
        </details>
      )}
    </>
  );
}
