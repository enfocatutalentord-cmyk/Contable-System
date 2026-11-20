import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa, accesoFirma, soloCliente } from "@/lib/acceso";
import { listarAprobaciones, TIPOS_APROBACION, type Aprobacion } from "@/lib/aprobaciones";
import { conEmpresa } from "@/lib/db";
import { clientesDeFirma } from "@/lib/firma";
import { puede } from "@/lib/permisos";
import { aprobarAccion, devolverAccion } from "@/app/e/[id]/aprobaciones-acciones";
import { notFound } from "next/navigation";

export const metadata = { title: "Por aprobar · Empire Tax & Legal" };

const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" });
const enlace = (empresaId: string, a: Aprobacion) => `/e/${empresaId}/${a.tipo === "factura" ? "facturas" : "compras"}/${a.referenciaId}`;

// Bandeja «Por aprobar» (Prioridad 2.1): todo lo que espera el visto bueno, de todas las empresas. Mientras no se apruebe, no sale al
// cliente ni entra a la contabilidad. Quien tiene el permiso «aprobar» ve lo que puede aprobar o devolver (menos lo que preparó él);
// todos ven lo que pidieron y lo que les devolvieron para corregir.
export default async function PorAprobar({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma, usuario } = await accesoFirma(fid, false);
  if (await soloCliente(fid, usuario.id)) notFound();
  const empresas = await clientesDeFirma(fid, usuario.id, firma.administrador);
  const filas = (await Promise.all(empresas.map(async (e) => {
    const acceso = await accesoEmpresa(e.id);
    const lista = await conEmpresa(e.id, (tx) => listarAprobaciones(tx, ["pendiente", "devuelta"]));
    return lista.map((a) => ({ e, a, aprueba: puede(acceso.permisos, "aprobar") }));
  }))).flat();
  const espera = filas.filter((f) => f.a.estado === "pendiente" && f.aprueba && f.a.solicitadoPorId !== usuario.id);
  const mias = filas.filter((f) => f.a.estado === "pendiente" && f.a.solicitadoPorId === usuario.id);
  const devueltas = filas.filter((f) => f.a.estado === "devuelta" && (f.a.solicitadoPorId === usuario.id || f.aprueba));

  const tabla = (lista: typeof filas, acciones: boolean) => (
    <div className="tabla-envoltura" style={{ marginBottom: 16 }}>
      <table>
        <thead><tr><th>Qué</th><th>Empresa</th><th>Lo preparó</th><th>Desde</th>{acciones ? <th /> : <th>Estado</th>}</tr></thead>
        <tbody>
          {lista.map(({ e, a }) => (
            <tr key={a.id}>
              <td>
                <Link href={enlace(e.id, a)}><strong>{a.titulo}</strong></Link>
                <div className="sub" style={{ margin: 0 }}>{TIPOS_APROBACION[a.tipo]}{a.detalle && ` · ${a.detalle}`}</div>
                {a.estado === "devuelta" && <div style={{ color: "var(--peligro)" }}>Devuelto: {a.motivo}</div>}
                {a.vecesDevuelta > 0 && <div className="sub" style={{ margin: 0 }}>Devuelto {a.vecesDevuelta} {a.vecesDevuelta === 1 ? "vez" : "veces"}</div>}
              </td>
              <td>{e.nombre}</td><td>{a.solicitadoPor}</td><td>{fechaHora(a.solicitadoEn)}</td>
              <td>
                {acciones ? (
                  <div className="fila" style={{ alignItems: "flex-start" }}>
                    <Formulario accion={aprobarAccion.bind(null, e.id, a.id)} boton="Aprobar" className="fila"><></></Formulario>
                    <Formulario accion={devolverAccion.bind(null, e.id, a.id)} boton="Devolver" className="fila">
                      <input name="motivo" required maxLength={1000} placeholder="Qué hay que corregir" aria-label="Qué hay que corregir" style={{ minWidth: 200 }} />
                    </Formulario>
                  </div>
                ) : a.estado === "devuelta" ? "A corregir" : "Esperando"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <h1>Por aprobar</h1>
      <p className="sub">
        Lo que se prepara con un permiso «con aprobación» espera aquí. Mientras no se apruebe no se emite, no se registra y no sale al cliente.
        Quien lo preparó nunca lo aprueba. Al devolver, se escribe qué corregir y queda en el historial de ese trabajo.
      </p>
      <h2>Esperan tu aprobación ({espera.length})</h2>
      {espera.length ? tabla(espera, true) : <p className="sub">No hay nada esperando tu aprobación.</p>}
      <h2>Devueltos para corregir ({devueltas.length})</h2>
      {devueltas.length ? tabla(devueltas, false) : <p className="sub">Nada devuelto.</p>}
      <h2>Lo que pediste y espera ({mias.length})</h2>
      {mias.length ? tabla(mias, false) : <p className="sub">No tienes nada esperando.</p>}
    </>
  );
}
