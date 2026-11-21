import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { SelectorClienteRapido } from "@/app/selector-cliente-rapido";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { clientesDeFirma } from "@/lib/firma";
import { ESTADOS_CONTEO, listarConteos } from "@/lib/inventario";
import { hoyISO, verFecha } from "@/lib/montos";
import { crearConteoAccion } from "../../inventario-acciones";

export const metadata = { title: "Inventario · Empire Tax & Legal" };

// Conteos de inventario de todos los clientes (Prioridad 3, P3l): se abre un conteo con el Excel de existencias del cliente y se anota lo contado con un lector de código de barras o a mano.
export default async function Inventario({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ ver?: string; nuevo?: string }> }) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound(); // solo el equipo de la firma
  const todos = sp.ver === "todos";
  const clientes = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => !c.propia && c.estado_cliente !== "retirado");
  const filas = (await Promise.all(clientes.map(async (c) => (await conEmpresa(c.id, (tx) => listarConteos(tx))).map((k) => ({ c, k })))))
    .flat().filter((f) => todos || f.k.estado !== "cerrado")
    .sort((x, y) => (x.k.estado === "cerrado" ? 1 : 0) - (y.k.estado === "cerrado" ? 1 : 0) || y.k.fecha.localeCompare(x.k.fecha));
  const abiertos = filas.filter((f) => f.k.estado !== "cerrado").length;

  return (
    <>
      <div className="entre">
        <div>
          <h1>Conteos de inventario</h1>
          <p className="sub">
            Se abre un conteo con el Excel de existencias del cliente y se anota lo contado con un lector de código de barras o a mano. {abiertos ? `${abiertos} abierto${abiertos > 1 ? "s" : ""}.` : "No hay conteos abiertos."}
          </p>
        </div>
        <Link className="boton" href={`/firma/${fid}/inventario${todos ? "" : "?ver=todos"}`}>{todos ? "Solo los abiertos" : "Ver también los cerrados"}</Link>
      </div>

      <details className="tarjeta" style={{ marginBottom: 16 }} open={sp.nuevo === "1" || undefined}>
        <summary><strong>+ Nuevo conteo</strong></summary>
        <div style={{ marginTop: 12 }}>
          <Formulario accion={crearConteoAccion.bind(null, fid)} boton="Abrir el conteo">
            <div className="fila"><SelectorClienteRapido clientes={clientes.map((c) => ({ id: c.id, nombre: c.nombre }))} crearClientes={firma.crear_clientes} /></div>
            <div className="fila">
              <label style={{ flex: "3 1 260px" }}>Nombre del conteo<input name="nombre" required minLength={3} maxLength={150} placeholder="Ej.: Conteo de fin de año, bodega principal" /></label>
              <label style={{ flex: "2 1 200px" }}>Bodega o ubicación (opcional)<input name="ubicacion" maxLength={150} /></label>
              <label>Fecha del conteo<input type="date" name="fecha" defaultValue={hoyISO()} required /></label>
            </div>
            <label>Excel (.xlsx) o CSV con las existencias del cliente
              <input type="file" name="archivo" required accept=".xlsx,.csv" />
            </label>
            <p className="sub" style={{ margin: 0 }}>
              La primera fila lleva los títulos. Obligatorias: <strong>Código</strong> y <strong>Cantidad</strong> (o «Existencia»). Opcionales: <strong>Nombre</strong>, <strong>Costo</strong> (para el reporte en pesos), <strong>Unidad</strong> y{" "}
              <strong>Código de barras</strong> (si el lector lee otro código distinto al interno). Si hay un problema en alguna fila, no se crea el conteo y se dice cuál.
            </p>
            <label>Notas (opcional)<textarea name="notas" rows={2} maxLength={2000} /></label>
          </Formulario>
        </div>
      </details>

      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Conteo</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th>Artículos</th><th>Contados</th><th>Lecturas</th></tr></thead>
          <tbody>
            {filas.map(({ c, k }) => (
              <tr key={k.id}>
                <td><Link href={`/firma/${fid}/inventario/${c.id}/${k.id}`}><strong>{k.nombre}</strong></Link><div className="sub" style={{ margin: 0 }}>n.º {k.numero}{k.ubicacion && ` · ${k.ubicacion}`}</div></td>
                <td>{c.nombre}</td>
                <td>{verFecha(k.fecha)}</td>
                <td>{ESTADOS_CONTEO[k.estado]}</td>
                <td>{k.articulos}</td>
                <td>
                  {k.contados} de {k.articulos}
                  {k.sin_listado > 0 && <div className="sub" style={{ margin: 0 }}>{k.sin_listado} código{k.sin_listado > 1 ? "s" : ""} sin listado</div>}
                </td>
                <td>{k.lecturas}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={7}>{todos ? "No hay conteos." : "No hay conteos abiertos."} Abre uno con «+ Nuevo conteo».</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
