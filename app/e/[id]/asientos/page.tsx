import Link from "next/link";
import { accesoEmpresa } from "@/lib/acceso";
import { buscarAsientos, consultaFiltros, ESTADOS, estadoTexto, leerFiltros, ORIGENES } from "@/lib/busqueda-asientos";
import { listarCuentas } from "@/lib/cuentas";
import { conEmpresa } from "@/lib/db";
import { verFecha, verMonto } from "@/lib/montos";
import { puede } from "@/lib/permisos";

const POR_PAGINA = 50;

export default async function Asientos({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { permisos } = await accesoEmpresa(id);
  const f = leerFiltros(sp);
  const { desde, hasta, estado, origen, q, cuenta, usuario } = f;
  const pagina = Math.max(1, Number(sp.pagina) || 1);
  const { filas, cuentas, usuarios, total } = await conEmpresa(id, async (tx) => ({
    ...(await buscarAsientos(tx, f, POR_PAGINA, (pagina - 1) * POR_PAGINA)),
    cuentas: await listarCuentas(tx),
    usuarios: await tx<{ id: string; nombre: string }[]>`SELECT DISTINCT u.id, u.nombre FROM asientos a JOIN usuarios u ON u.id = a.creado_por ORDER BY u.nombre`,
  }));
  const consulta = (extra: Record<string, string>) => consultaFiltros(f, extra);
  const paginas = Math.ceil(total / POR_PAGINA);

  return (
    <>
      {sp.descartado && <p className="exito">Borrador descartado. Queda constancia en el historial de cambios.</p>}
      <div className="entre">
        <div>
          <h1>Asientos</h1>
          <p className="sub">Los borradores no cuentan en los libros hasta contabilizarse. Lo contabilizado se corrige con una reversión.</p>
        </div>
        {puede(permisos, "registrar") && <Link className="boton primario" href={`/e/${id}/asientos/nuevo`}>+ Nuevo asiento</Link>}
      </div>
      <form className="filtros" style={{ marginBottom: 16 }}>
        <label>Desde<input type="date" name="desde" defaultValue={desde} /></label>
        <label>Hasta<input type="date" name="hasta" defaultValue={hasta} /></label>
        <label>Estado
          <select name="estado" defaultValue={estado}>{Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label>Origen
          <select name="origen" defaultValue={origen}>
            <option value="">Todos</option>
            {Object.entries(ORIGENES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="ancho">Cuenta (incluye subcuentas)
          <select name="cuenta" defaultValue={cuenta}>
            <option value="">Todas</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </label>
        <label>Registró
          <select name="usuario" defaultValue={usuario}>
            <option value="">Cualquiera</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </label>
        <label>Monto desde<input name="min" inputMode="decimal" defaultValue={sp.min} placeholder="0.00" /></label>
        <label>Monto hasta<input name="max" inputMode="decimal" defaultValue={sp.max} placeholder="0.00" /></label>
        <label className="ancho">Texto<input name="q" defaultValue={q} placeholder="Concepto, referencia o n.º" /></label>
        <div className="fila" style={{ alignSelf: "end" }}>
          <button className="primario">Buscar</button>
          <Link className="boton" href={`/e/${id}/asientos`}>Limpiar</Link>
          {puede(permisos, "exportar") && (
            <>
              <a className="boton" href={`/e/${id}/exportar/asientos?formato=xlsx&${consulta({})}`}>Excel</a>
              <a className="boton" href={`/e/${id}/exportar/asientos?formato=pdf&${consulta({})}`}>PDF</a>
            </>
          )}
        </div>
      </form>
      <p className="sub">{total} {total === 1 ? "asiento" : "asientos"}</p>
      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>N.º</th><th>Fecha</th><th>Concepto</th><th>Referencia</th><th>Registró</th><th>Estado</th><th className="num">Total</th></tr></thead>
          <tbody>
            {filas.map((a) => (
              <tr key={a.id} className={a.estado === "anulado" ? "anulado" : a.estado === "borrador" ? "borrador" : undefined}>
                <td><Link href={`/e/${id}/asientos/${a.id}`}>{a.numero ?? "Borrador"}</Link></td>
                <td>{verFecha(a.fecha)}</td>
                <td>{a.concepto}{a.adjuntos > 0 && <span className="sub" title="Documentos adjuntos"> · 📎 {a.adjuntos}</span>}</td>
                <td>{a.referencia}</td>
                <td>{a.creado_por}</td>
                <td>{estadoTexto(a)}</td>
                <td className="num">{verMonto(a.total ?? "0")}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={7}>No hay asientos con esos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
      {paginas > 1 && (
        <div className="fila" style={{ marginTop: 12 }}>
          {pagina > 1 && <Link className="boton" href={`/e/${id}/asientos?${consulta({ pagina: String(pagina - 1) })}`}>← Anteriores</Link>}
          <span className="sub">Página {pagina} de {paginas}</span>
          {pagina < paginas && <Link className="boton" href={`/e/${id}/asientos?${consulta({ pagina: String(pagina + 1) })}`}>Siguientes →</Link>}
        </div>
      )}
    </>
  );
}
