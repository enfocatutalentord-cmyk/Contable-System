import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/app/formulario";
import { SelectorClienteRapido } from "@/app/selector-cliente-rapido";
import { accesoFirma, soloCliente } from "@/lib/acceso";
import { ESTADOS, listarAuditorias } from "@/lib/auditorias";
import { conEmpresa } from "@/lib/db";
import { clientesDeFirma, equipoDe } from "@/lib/firma";
import { verFecha } from "@/lib/montos";
import { crearAuditoriaAccion } from "../../auditoria-acciones";
import { CamposPlan } from "./campos";

export const metadata = { title: "Auditoría · Empire Tax & Legal" };

// Auditorías de todos los clientes (Prioridad 3, P3j): plan, pasos y hallazgos con sus pruebas. El informe final en PDF llega con la P3k.
export default async function Auditorias({ params, searchParams }: { params: Promise<{ fid: string }>; searchParams: Promise<{ ver?: string; nueva?: string }> }) {
  const { fid } = await params;
  const sp = await searchParams;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound(); // solo el equipo de la firma
  const todas = sp.ver === "todas";
  const clientes = (await clientesDeFirma(fid, usuario.id, firma.administrador)).filter((c) => !c.propia && c.estado_cliente !== "retirado");
  const [filas, equipo] = await Promise.all([
    Promise.all(clientes.map(async (c) => (await conEmpresa(c.id, (tx) => listarAuditorias(tx))).map((a) => ({ c, a })))).then((x) => x.flat()),
    equipoDe(fid),
  ]);
  const visibles = filas.filter((f) => todas || f.a.estado !== "cerrada");
  visibles.sort((x, y) => (x.a.estado === "cerrada" ? 1 : 0) - (y.a.estado === "cerrada" ? 1 : 0) || (x.a.fecha_fin ?? "9999").localeCompare(y.a.fecha_fin ?? "9999"));
  const enCurso = filas.filter((f) => f.a.estado !== "cerrada").length;

  return (
    <>
      <div className="entre">
        <div>
          <h1>Auditoría</h1>
          <p className="sub">
            Cada auditoría tiene su objetivo, alcance, fechas y equipo; una lista de pasos que se marcan; y hallazgos con situación, criterio, causa, efecto y recomendación, con sus fotos y
            archivos de prueba. {enCurso ? `${enCurso} sin cerrar.` : "No hay auditorías sin cerrar."}
          </p>
        </div>
        <Link className="boton" href={`/firma/${fid}/auditoria${todas ? "" : "?ver=todas"}`}>{todas ? "Solo las sin cerrar" : "Ver también las cerradas"}</Link>
      </div>

      <details className="tarjeta" style={{ marginBottom: 16 }} open={sp.nueva === "1" || undefined}>
        <summary><strong>+ Nueva auditoría</strong></summary>
        <div style={{ marginTop: 12 }}>
          <Formulario accion={crearAuditoriaAccion.bind(null, fid)} boton="Crear la auditoría">
            <div className="fila"><SelectorClienteRapido clientes={clientes.map((c) => ({ id: c.id, nombre: c.nombre }))} crearClientes={firma.crear_clientes} /></div>
            <CamposPlan equipo={equipo} />
            <label>Pasos del plan (uno por línea, opcional: se pueden agregar después)
              <textarea name="pasos" rows={4} placeholder={"Pedir el listado de compras del período\nCotejar una muestra de facturas contra su comprobante\nContar el inventario de la bodega principal"} />
            </label>
          </Formulario>
        </div>
      </details>

      <div className="tabla-envoltura">
        <table>
          <thead><tr><th>Auditoría</th><th>Cliente</th><th>Estado</th><th>Fechas del trabajo</th><th>Pasos</th><th>Hallazgos</th><th>Responsable</th></tr></thead>
          <tbody>
            {visibles.map(({ c, a }) => (
              <tr key={a.id}>
                <td><Link href={`/firma/${fid}/auditoria/${c.id}/${a.id}`}><strong>{a.nombre}</strong></Link><div className="sub" style={{ margin: 0 }}>n.º {a.numero}</div></td>
                <td>{c.nombre}</td>
                <td>{ESTADOS[a.estado]}</td>
                <td>{a.fecha_inicio || a.fecha_fin ? `${a.fecha_inicio ? verFecha(a.fecha_inicio) : "…"} a ${a.fecha_fin ? verFecha(a.fecha_fin) : "…"}` : <span className="sub">—</span>}</td>
                <td>{a.pasos ? `${a.pasos_hechos} de ${a.pasos}` : <span className="sub">—</span>}</td>
                <td>
                  {a.hallazgos ? `${a.hallazgos}` : <span className="sub">—</span>}
                  {a.hallazgos_abiertos > 0 && <div className="sub" style={{ margin: 0 }}>{a.hallazgos_abiertos} abierto{a.hallazgos_abiertos > 1 ? "s" : ""}{a.altos_abiertos > 0 && <span className="peligro"> · {a.altos_abiertos} de riesgo alto</span>}</div>}
                </td>
                <td>{a.responsable ?? "—"}</td>
              </tr>
            ))}
            {visibles.length === 0 && <tr><td colSpan={7}>{todas ? "No hay auditorías." : "No hay auditorías sin cerrar."} Crea una con «+ Nueva auditoría».</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
